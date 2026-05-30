---
id: m3-cli-p2p-bypass-daemon
kind: decision
status: decided
since: 2026-05
supersedes: none
---

# Decision: M3 CLI Bypasses Daemon for P2P Transport

## Context

M3 (P2P 传输) 必须在 daemon (M4) 之前交付。M2 已建立 CLI 直接接 rendezvous 的 bypass 模式 ([m2-cli-bypasses-daemon.md](m2-cli-bypasses-daemon.md))，但 P2P 层 (`node-datachannel` + WebRTC PeerConnection) 的接入路径尚未决策。

M3 要求三个 CLI 命令在三平台可用：

- `peer-bridge send <peer> <file>` — 向已知 peer 发送文件
- `peer-bridge send-text <peer> <text>` — 向已知 peer 发送文本消息
- `peer-bridge recv` — 监听对端发起的 P2P 连接并接收文件/消息

这些命令需要完整的 P2P 握手 (`webrtc-over-noise-tcp.md`)、DataChannel 管理、文件 I/O — 但 daemon (负责 WebRTC 连接池、房间状态、inbox) 是 M4 的交付物。

## Decision

**M3 CLI 直接管理 PeerConnection — 不依赖 daemon。**

具体架构：

1. **新建 `packages/p2p` 独立包**，依赖 `packages/core` (signaling, identity, known-peers) + `packages/protocol` (types, frame, peer-id) + `node-datachannel` (外部)。该包提供 `PeerConnectionManager` API 用于建立/关闭 WebRTC 连接、收发消息和文件。

2. **CLI 不直接操作 `RTCPeerConnection`**。`packages/cli` 新增三个 P2P 命令，全部通过 `packages/p2p` 的 `PeerConnectionManager` API 完成操作。

3. **命令语义**：

   | 命令                      | 语义                                                                                                                | 进程行为                                      |
   | ------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
   | `send <peer> <file>`      | 建立 PeerConnection → `room:hello` 握手 → `room:file_offer` → 传输 chunks → `room:file_done` → 关闭                 | 一次性，完成后退出                            |
   | `send-text <peer> <text>` | 建立 PeerConnection → `room:hello` 握手 → `room:msg` → 等待 2s 确认 → 关闭                                          | 一次性，完成后退出                            |
   | `recv`                    | 监听 `signal_in` webrtc_offer，收到后自动建立 PeerConnection → `room:hello` → 处理 `file_offer` 或 `msg` → 继续监听 | 前台阻塞循环，直到 Ctrl+C 或 `--timeout` 到期 |

4. **PeerConnection 默认非持久**。每次 `send`/`send-text` 都重新创建 PeerConnection 和 DataChannel，传输完成后关闭。`recv` 模式下，每收到一个 webrtc_offer 创建一条新的 PeerConnection，处理完毕后续转为 idle 等待下一条。这与 M4 daemon 的持久连接池策略明确区分。

5. **包边界**：
   ```
   packages/cli (send/send-text/recv 命令)
     └── packages/p2p (PeerConnectionManager, FileSender, FileReceiver)
           ├── packages/core (signaling, identity, known-peers)
           ├── packages/protocol (types, frame, peer-id)
           └── node-datachannel (外部)
   ```

## Rationale

- **M2 bypass 经验证可行**。`m2-cli-bypasses-daemon.md` 已证明 CLI 直接使用 `signaling.ts` 是可行的临时路径。M3 沿袭同一模式，将 bypass 扩展到 `packages/p2p` 层。
- **daemon 是 M4 的交付物，不能 block M3**。如果 M3 CLI 必须经过 daemon，则 M3 和 M4 变成串行依赖，违反 milestone slice 策略。
- **三命令一致的「前台进程」语义匹配 CLI UX 期望**。`send`/`send-text`/`recv` 都是终端用户直接运行的命令，不依赖后台服务，符合 Unix CLI 心智模型。

## M4 迁移契约

当 M4 daemon 完工后，M3 的 bypass 架构将迁移到 steady-state 路径：

- `packages/p2p` 的 `PeerConnectionManager` 移到 daemon 进程。CLI 通过 daemon IPC（socket/pipe，见 `platform-ipc-mechanisms.md`）调用。
- `send`/`send-text` 变为 daemon-managed：CLI 将传输请求发给 daemon，daemon 管理持久 PeerConnection 池完成传输。
- `recv` 移除。daemon 始终在后台监听 `signal_in`，自动接收文件/消息到 inbox。CLI 新增 `peer-bridge inbox list` / `peer-bridge inbox pull` 等查询命令。
- 持久连接池由 daemon 维护 — M3 的「每次重建」是临时实现，M4 中同一 `known_peers` 条目可能复用已有 PeerConnection。
- `config.toml` 中的 `[ice_servers]` 段在 M3 CLI 中由 CLI 直接读取；M4 时由 daemon 读取并透传给 CLI（透明迁移，与 M2 bypass 的迁移路径一致）。

**回退验证**（M4 退出条件）：

- CLI 不再 import `node-datachannel`。
- `peer-bridge send` / `send-text` 通过 daemon IPC 发送，不自行管理 PeerConnection。
- `peer-bridge recv` 命令不再存在。
- 如无 daemon 运行，CLI 按 DESIGN.md §6.4 自动 spawn daemon（foreground 模式）。

## Consequences

| 正面                                                               | 负面                                                                             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| M3 不阻塞 daemon 进度 — 可独立实施、测试、交付                     | M3 CLI 每次发送重建 PeerConnection，无连接复用；频繁发送产生重复握手开销         |
| CLI 可独立测试（无需 daemon 进程）                                 | `recv` 进程占用一个终端；用户需保持终端打开才能接收                              |
| 三平台部署简化 — 仅需 `node-datachannel` 预编译二进制，无 IPC 依赖 | M4 迁移时 CLI 命令语义改变（`send`/`send-text` 从一次性进程变为 daemon-managed） |
| `packages/p2p` 与 `packages/cli` 的 API 边界清晰，便于 M4 迁移     | M3 无 daemon 侧的状态持久化 — 传输中断后无法恢复状态                             |

## Boundaries

- **不覆盖**: M4 daemon 实施细节、IPC schema 设计、持久连接池策略、文件传输 resume（属 M4+）。
- **不覆盖**: PeerConnection 生命周期具体状态机 — 见 [peerconnection-lifecycle.md](../facts/peerconnection-lifecycle.md)。
- **不覆盖**: DataChannel 协商方式、signal payload 格式、错误处理协议 — 见 Brief #B / #C 待 sediment。
- **不覆盖**: M3 `recv` 的 `--accept-all` 行为细节 — 见 M3 实施 brief。
- **仅适用于 M3**。本 decision 在 M4 daemon 交付后过期，由 M4 迁移契约定义的 steady-state 架构取代。

## Related

- Sibling decision (M2 precedent): [m2-cli-bypasses-daemon.md](m2-cli-bypasses-daemon.md) — M2 CLI 绕过 daemon 的 rendezvous 层 bypass。
- Foundation decision: [webrtc-over-noise-tcp.md](webrtc-over-noise-tcp.md) — M3 P2P 传输的技术基础。
- Lifecycle fact: [peerconnection-lifecycle.md](../facts/peerconnection-lifecycle.md) — PeerConnection 状态机（本 brief）。
- Migration target: M4 daemon (DESIGN.md §11.M4).
- Fact: [platform-ipc-mechanisms.md](../facts/platform-ipc-mechanisms.md) — M4 daemon IPC 的跨平台参考。
