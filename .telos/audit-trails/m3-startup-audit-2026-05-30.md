# M3 启动准入 Audit — Known-Unknowns + Scope Ledger

> **日期**: 2026-05-30
> **仓库**: E:/peer-bridge/ | commit `c5ec36b` | working tree clean
> **M2 状态**: ✅ M2 完结（rendezvous server + signaling client + invite/accept E2E + 三平台 CI 全绿）
> **M3 sanity probe**: ✅ CI run 26687227899 三 cell 全绿（`node-datachannel@0.32.3`）
> **Read-only — 不写任何 telos 文件，不写代码**

---

## 读取清单

以下文件已完整读取（全文或关键节段）：

| 文件                              | 读取范围                                                        | 行号/节段     |
| --------------------------------- | --------------------------------------------------------------- | ------------- |
| `DESIGN.md`                       | §3.1 (WebRTC 传输决策)                                          | lines 82-96   |
| `DESIGN.md`                       | §3.3 (DTLS fingerprint + Ed25519 签名)                          | lines 120-134 |
| `DESIGN.md`                       | §3.4 (BYO TURN)                                                 | lines 136-143 |
| `DESIGN.md`                       | §3.11 (wait-gap tension)                                        | lines 280-299 |
| `DESIGN.md`                       | §3.12 (per-sender seq)                                          | lines 287-296 |
| `DESIGN.md`                       | §5.3 (P2P 握手)                                                 | lines 374-384 |
| `DESIGN.md`                       | §5.4 (应用消息 CBOR)                                            | lines 386-417 |
| `DESIGN.md`                       | §5.5 (文件传输)                                                 | lines 419-439 |
| `DESIGN.md`                       | §6.4 (daemon IPC / CLI 架构)                                    | lines 490-545 |
| `DESIGN.md`                       | §11.M3 (M3 in-scope)                                            | lines 885-891 |
| `DESIGN.md`                       | config.toml 示例 (§ICE servers)                                 | lines 720-750 |
| `docs/protocol.md`                | 全文（P2P 握手 §3 + CBOR 帧 §4 + 消息类型 §5 + Appendix A/B/C） | lines 1-569   |
| `packages/p2p-probe/src/probe.ts` | 全文                                                            | 95 lines      |
| `packages/protocol/src/types.ts`  | 全文                                                            | ~180 lines    |
| `packages/protocol/src/frame.ts`  | 全文                                                            | ~220 lines    |
| `.telos/BACKLOG.md`               | 全文                                                            | all sections  |
| `.telos/facts/`                   | 全部 16 个文件 — grep 过滤后读取                                | (见下方明细)  |
| `.telos/decisions/`               | 全部 24 个文件 — grep 过滤后精读 M3 相关的 18 个                | (见下方明细)  |
| `.telos/tensions/`                | 全部 2 个文件                                                   | both          |

### Telos 文件读取明细

**Facts**（16 files — 通过 grep `-li` 过滤 webRTC/datachannel/p2p/handshake/file/transport/sctp/dtls/ice/stun/noise 后精读）:

- `cbor-key-allocation.md` ✅
- `ed25519-x25519-conversion.md` ✅
- `inbox-directory-structure.md` ✅
- `pi-extension-api-surface.md` ✅
- `signaling-client-fsm.md` ✅
- `signaling-message-fields.md` ✅
- `webrtc-datachannel-limits.md` ✅
- `crypto-library-mapping.md` — M1 scope, not M3-relevant (skim only)
- `daemon-sqlite-schema.md` — M4 scope, read for §B scope ledger
- `known-peers-toml-schema.md` — read for fingerprint confirmation context
- `nacl-sealed-box-properties.md` — M2 scope, not M3-relevant
- `peer-id-encoding.md` — M1 scope, not M3-relevant
- `pi-session-append-only.md` — M5 scope, not M3-relevant
- `platform-ipc-mechanisms.md` — M4 scope, read for §B
- `rendezvous-health-endpoint.md` — M2 scope, not M3-relevant
- `rendezvous-server-config.md` — M2 scope, not M3-relevant
- `rendezvous-tech-stack.md` — M2 scope, not M3-relevant

**Decisions**（24 files — 通过 grep 过滤后精读 M3 相关文件）:

- `agent-blind-check-protocol.md` ✅
- `chatroom-abstraction.md` ✅
- `daemon-no-pi-spawn.md` ✅
- `deterministic-1to1-room-id.md` ✅
- `disconnect-immediate-offline.md` ✅
- `m2-cli-bypasses-daemon.md` ✅ (CRITICAL for M3 CLI path unknown)
- `per-sender-seq-numbering.md` ✅
- `reconnect-requires-reregister.md` ✅ (rendezvous reconnect, NOT P2P DataChannel)
- `sealed-box-for-offline-notify.md` ✅
- `signaling-client-fifo-queue-wait.md` ✅
- `signaling-fifo-no-request-id.md` ✅
- `unique-cbor-keys-not-message-scoped.md` ✅
- `webrtc-over-noise-tcp.md` ✅
- Others (implicit-1to1-room-creation, invite-create-no-cross-reconnect, long-poll-wait, manual-fingerprint-confirmation, m2-notification-queue, m2-rate-limit, node-22-minimum, rendezvous-federation-not-turn, test-vectors-as-spec, transcript-jsonl-per-room, windows-first-class) — skim for cross-refs, not M3-primary

**Tensions**（2 files）:

- `single-identity-per-device.md` ✅
- `wait-gap-message-visibility.md` ✅

---

## §A: M3 known-unknowns 表

**分类定义**:

- **block-M3-start**: 不 sediment 就无法实施（架构/协议/安全必须在前）
- **block-M3-exit**: 实施中可以暂用默认/stub，但 M3 退出时必须决议
- **cross-slice**: 牵涉 M4/M5，M3 实施中需预留接口但不必完全决议
- **defer**: 明确不在 M3 范围，不阻塞

---

### A.1 block-M3-start

> 这些项不 sediment 前 M3 不可启动。核心问题是 M3 CLI 在 daemon 不存在时如何直接管理 PeerConnection + 信令 + 文件 I/O。

- **U-1: M3 CLI 架构路径 — 绕过 daemon (P2P 版)** | DESIGN.md §11.M3 (line 885-891), §11.M4 (line 893-899), §6.4 (line 490-545)
  | 现有 telos: `m2-cli-bypasses-daemon.md` §Boundaries 明确声明 **"M3（P2P 传输）的 CLI 通信路径不在本 decision 范围内"**
  | 缺口: M3 要求 CLI `send`/`send-text`/`recv` 在三平台可用，但 daemon（负责 WebRTC 连接管理、房间状态、inbox）是 M4 组件。M3 CLI 是 (a) 像 M2 一样直接 import `node-datachannel` + `signaling.ts` 自建 PeerConnection？(b) 构建最小 daemon stub？(c) 把 PeerConnection 管理层放进 `packages/core`（复用 M4 daemon）？
  | 需要决策: M3 CLI 的 P2P 接入路径 + 与 M4 daemon 的迁移契约
  | **分类: block-M3-start**

- **U-2: DataChannel 双通道协商方式** | DESIGN.md §5.3 line 382-384 ("默认开两个 channel: control + bulk") | protocol.md Appendix C (line 567-569)
  | 现有 telos: `webrtc-datachannel-limits.md` 记录 `negotiated` 模式与 `onDataChannel` 模式的存在，未指定 M3 选择
  | 缺口: DESIGN.md 只说"两个 channel"但没说谁创建、如何协商。p2p-probe 使用 offerer `createDataChannel` + answerer `onDataChannel`（非 negotiated 模式），但这只有一个 `control` 通道。双通道 (`control` + `bulk`) 的建立策略未决策:

  - (a) 非 negotiated: offerer 创建两个 channel（`control`, `bulk`），answerer 在 `onDataChannel` 中按 label 路由？
  - (b) negotiated: offerer + answerer 各自创建自己的 `bulk` channel (id=1, negotiated=true)？
  - (c) offerer 创建 `control`，`control` channel open 后通过 `room:hello` 协商 `bulk` channel 的 id？
    | 需要在 telos 落地一个 fact/decision
    | **分类: block-M3-start**

- **U-3: M3 默认 STUN / ICE servers 配置** | DESIGN.md §3.4 line 136-143 ("不提供官方 TURN，用户 BYO") | config.toml 示例 line 731 (`stun:stun.l.google.com:19302`)
  | 现有 telos: ZERO — `webrtc-over-noise-tcp.md` 说 ICE 但不说具体 server 列表。`webrtc-datachannel-limits.md` 完全不提 ICE servers。
  | 缺口: config.toml 示例里有 `stun:stun.l.google.com:19302` 作为默认 STUN，但这只是示例不是决策。p2p-probe 用 `iceServers: []`（无 STUN，纯本地）。M3 实际部署用什么默认 STUN？如果硬编码 Google STUN，是否有 privacy 披露义务（用户文件元数据不经过 STUN，但 IP 泄露）？如果空数组，NAT 穿透完全不可能。
  | 需要 sediment: 默认 STUN 服务器 + privacy 声明（如"仅用于打洞，用户可在 config.toml 替换或清空"）
  | **分类: block-M3-start**

- **U-4: PeerConnection 生命周期管理** | DESIGN.md §6.4 line 496 ("WebRTC 连接管理：按需建立/拆除与 peer 的 P2P 连接")
  | 现有 telos: ZERO — telos 无任何 PeerConnection 生命周期决策
  | 缺口: DESIGN.md 说 daemon "按需建立/拆除"，但 M3 CLI 无 daemon。以下全未定义:

  - PeerConnection **何时建立**？accept invite 后立即建立？还是首次发消息时？（如果是 CLI `recv` 等待接收，需要先建立连接再等 DataChannel 消息）
  - PeerConnection **何时关闭**？闲置超时？用户显式 disconnect？CLI 进程退出时？
  - **闲置超时**值？WebRTC 无应用层 keepalive 的话，NAT 映射可能过期（典型 30-120s UDP binding）。
  - 一套已知 peers 是否保活成持久连接池？还是每发一条消息就重新握手？
    | 必须 sediment 基本生命周期（至少: establish trigger + teardown trigger + idle timeout）
    | **分类: block-M3-start**

- **U-5: Ed25519 签名 of DTLS fingerprint — verify 失败行为** | DESIGN.md §3.3 line 124-131 (握手流程 step 4-6) | protocol.md §3 (line ~195-230)
  | 现有 telos: `per-sender-seq-numbering.md` 和 `known-peers-toml-schema.md` 覆盖 known_peers 信任域。但 DTLS fingerprint 签名 **verify 失败的行为** 无任何 telos 覆盖。
  | 缺口: 当 Bob 校验 Alice 的 Ed25519 签名失败（或 peer_id 不在 known_peers、或 timestamp 不在 ±5 分钟），应该:

  - (a) 关闭 PeerConnection + DataChannel，不给对方任何错误消息？
  - (b) 在 `control` channel 打开后发送一条 `room:error{code, message}` 再关闭？
  - (c) 允许 PeerConnection 建立但拒绝 DataChannel 上的消息？
    | DESIGN.md §3.3 step 4 只说 "Bob 校验"，但没说校验失败时的协议行为。错误码不存在于 `types.ts` 的 `RoomMessage` union 中。
    | 需要: 起码一个 design decision（close without error, or error message + close）
    | **分类: block-M3-start**

- **U-6: room:hello 版本协商与 capabilities 语义** | DESIGN.md §5.4 line 395 (`{ type: "room:hello", version, capabilities }`) | protocol.md §5 line ~285-300
  | 现有 telos: PARTIAL — `types.ts` 定义了 `RoomHello { version: string, capabilities: Record<string, boolean> }`。但无版本协商语义。
  | 缺口:

  - 如果两端的 `version` 不匹配（如 A=0.1.0, B=0.2.0），谁降级？谁断连？
  - `capabilities` 字段的 key set 是什么？目前 `types.ts` 只给类型 `Record<string, boolean>`，无枚举。protocol.md §5 示例里只有一个 `"webrtc": true`。现实需要哪些 capabilities？`bulk_transfer`？`resync`？`max_chunk_size`？
  - 如果 capabilities 不兼容怎么办？`room:hello` 有 `room:hello_ack` 响应？
    | M3 需要起码的 "版本不匹配 → 断开并打日志" 决策
    | **分类: block-M3-start**

- **U-7: M3 signal payload 形态 — SDP/ICE 信令传输** | DESIGN.md §5.3 line 377-379 (信令交换通过 rendezvous `signal` / `signal_in`)
  | 现有 telos: `signaling-message-fields.md` 定义 `signal {to, payload}` 为 "加密 binary"。`protocol.md` §3 定义 `subtype: "webrtc_offer"` payload 含 `sdp, fingerprint, signature, peer_id, timestamp, nonce`。
  | 缺口: PARTIAL-COVERED — `signal` 和 `signal_in` 的 envelope 已由 M2 完成，但 P2P 层的 `signal` payload 格式和嵌套关系未 sediment:
  - `signal.payload` 是否需要加密？如果 `subtype: "webrtc_offer"` 已含 ED25519 签名，再加一层 E2E 加密？还是裸传（rendezvous 已经不可读 plaintext SDP，但可以看到 who signaled who）？
  - ICE candidate 信令也是走 `signal {subtype: "ice_candidate"}`？格式是什么？
  - 信令消息类型枚举（webrtc_offer / webrtc_answer / ice_candidate / 别的？）未入 telos
    | M2 `signal` work 建立的是 opaque binary relay pipe。M3 需要定义 pipe 里的内容格式。
    | **分类: block-M3-start**

---

### A.2 block-M3-exit

> 这些项 M3 实施中可以先用 reasonable default 推进，但 M3 退出前必须 sediment。

- **U-8: Bulk channel 流控阈值** | DESIGN.md §5.5 line 422 ("流控：依赖 SCTP 自带 backpressure (DataChannel `bufferedAmount` + `bufferedAmountLow`)")
  | 现有 telos: `webrtc-datachannel-limits.md` 记录 `bufferedAmountLowThreshold` 和 `onBufferedAmountLow()` 机制存在，但**不说阈值**。
  | 缺口: `bufferedAmountLowThreshold` 设多少？太小→频繁暂停/恢复，太大→内存压力。64 KiB？512 KiB？1 MiB？node-datachannel 的默认值是什么？
  | **分类: block-M3-exit**（可以先设一个值跑通再调优）

- **U-9: 文件传输进度上报频率 N** | DESIGN.md §5.5 line 423 ("每 N chunks emit 一次 progress event")
  | 现有 telos: ZERO — telos 不提 N 值
  | 缺口: N = ？1 (每 chunk 上报 — 性能开销) vs 10 (粗糙但省事件) vs 按时间间隔？
  | **分类: block-M3-exit**（实施中可调，但 M3 退出时应有理由记录）

- **U-10: SHA-256 校验时机 — post-receive vs incremental** | DESIGN.md §5.5 line 425 ("完成后比对全文件 SHA-256") | `inbox-directory-structure.md` §inbox/ step 5
  | 现有 telos: `inbox-directory-structure.md` 说 "所有 chunk 到达 → 校验 SHA-256 → 重命名"，即 post-receive 全文件校验。
  | 缺口: 不支持 incremental（逐 chunk 更新 SHA-256 state）。对 500 MiB 文件，收完后一次性 SHA-256 需几秒 CPU 阻塞。是否需要 incremental hash？如果文件 corrupt，incremental 可以提前 abort，节省带宽和磁盘。
  | 现有 DESIGN.md 和 telos 都隐含 post-receive。M3 CLI 可以直接采用。但建议 sediment 为 decision（reject incremental, accept simplicity）。
  | **分类: block-M3-exit**

- **U-11: M3 CLI recv 模式 — 阻塞等待 vs 后台 daemon 式** | DESIGN.md §11.M3 line 891 ("CLI `recv` 在三平台可用")
  | 现有 telos: ZERO. `m2-cli-bypasses-daemon.md` 不覆盖 M3。
  | 缺口: `peer-bridge recv` 在 M3 (无 daemon) 下的语义:

  - (a) 阻塞模式: `recv` 建立 PeerConnection 后阻塞等待 DataChannel 消息/文件，Ctrl+C 退出？
  - (b) 一次性模式: `recv --timeout 30` 等 30s，超时退出？
  - (c) 后台模式: `recv` spawn 一个后台进程持续监听？
  - (d) 如果两个 peer 同时 recv（互相等待对方 send），死锁？
    | M3 CLI 形态必须匹配 "无 daemon + 三平台可用" 约束
    | **分类: block-M3-exit**

- **U-12: P2P 错误码 taxonomy** | DESIGN.md §5.4 (消息类型表无 error type) | `types.ts` (RoomMessage union 无 error 类型)
  | 现有 telos: `signaling-message-fields.md` 定义了信令层错误 transport（Channel A/B/C/D），但**全是 rendezvous 层的**，P2P DataChannel 层零覆盖。
  | 缺口: P2P 层会出现哪些错误？怎么传回 CLI？
  - DTLS fingerprint verify failed
  - DataChannel open timeout
  - File chunk sequence gap
  - File SHA-256 mismatch
  - PeerConnection ICE failed
  - Bulk channel transfer aborted (sender cancel)
    | 这些错误需要一个枚举 + 在 `RoomMessage` union 中添加 `room:error` 类型？还是 CLI 层自己根据异常映射？
    | **分类: block-M3-exit**

---

### A.3 cross-slice

> 牵涉 M4/M5，M3 需预留结构但不阻塞 M3 出口。

- **U-13: PeerConnection 重连与 SDP 重交换** | DESIGN.md §5.3 + §3.12
  | 现有 telos: `reconnect-requires-reregister.md` **明确 scoped 到 rendezvous WebSocket reconnect**。§Boundaries 说 "P2P DataChannel reconnect semantics (M3+) are independent"。`per-sender-seq-numbering.md` 确认 seq 跨连接持久（daemon 重启后从 transcript 恢复）。
  | 缺口: WebRTC DataChannel 断开后的重连协议完全未定义:

  - 是否需要重新交换 SDP offer/answer？
  - 重连的 SDP 信令走同一条 rendezvous `signal` pipe？
  - 重连后是否需要重新 `room:hello` 握手？
  - ICE restart 还是完整重建 PeerConnection？
    | M3 可以用 "断开 = 关闭 PeerConnection + 重建"（最简单），但必须 sediment 为显式决策，避免 M4 daemon 引入时反过来打破 M3 假设。
    | **分类: cross-slice** (M3 单次连接可暂不重连，但协议须预留)

- **U-14: capabilities 字段的内容枚举与安全语义** | DESIGN.md §5.4 line 395 (`capabilities` map) | `types.ts` line ~87 (`Record<string, boolean>`)
  | 现有 telos: `BACKLOG.md` Post-M2 §B-4: "RendezvousClient constructor does not accept or send capabilities (current impl sends `{ capabilities: {} }`). M3+ may gate WebRTC signaling on capability flags."
  | 缺口: capabilities 是纯 informational 还是有安全语义？如果 Alice 声明的 capabilities 不含 webrtc，Bob 是否拒绝建立 DataChannel？capabilities 是否在 `room:hello` 中重新声明（DataChannel 层独立于 rendezvous）？
  | M3 可以先 informational-only，但字段 key set 必须 settle
  | **分类: cross-slice**

- **U-15: M4 transcripts 与 M3 CLI 文件格式兼容性** | DESIGN.md §5.5 line 434 (`<data_dir>/rooms/<room_id>/inbox/`) | `inbox-directory-structure.md`
  | 现有 telos: `inbox-directory-structure.md` 和 `transcript-jsonl-per-room.md` 定义了 daemon 的文件落盘和 transcript 格式
  | 缺口: M3 CLI 无 daemon，无 `data_dir`，无 `transcript.jsonl`。如果 M3 CLI 把文件存在 `~/Downloads/` 或 `./received/`，M4 daemon 迁移时如何承认这些文件？这决定了 M3 是否写 transcript.jsonl 还是纯临时收文件。
  | **分类: cross-slice** (M3 可以 dummy transcript 或不写 transcript，但必须 sediment 兼容路径)

---

### A.4 defer

> 明确不在 M3，不阻塞。部分关联 scope ledger (§B)。

- **U-16: room:resync 实现** | DESIGN.md §3.12 line 296 ("第一版可以简化为打日志告警，先不强求 resync") | `per-sender-seq-numbering.md` §Resync 机制
  | 现有 telos: `per-sender-seq-numbering.md` 定义了 resync 的协议消息 (`room:resync_request` / `room:resync_response`)，但 DESIGN.md §3.12 和 `BACKLOG.md` 都把它标记为第一版不做
  | 缺口: seq 跳号在 M3 只打 warn 日志。resync_request/response 的类型定义在 `types.ts` 中作为注释预留（不在 RoomMessage union 中）。
  | **分类: defer** → M4 (daemon 本地的 transcript 才是 resync 数据源)

- **U-17: file_chunk 的 `seq_num` vs 消息层 `seq`** | `types.ts` (RoomFileChunk 有独立的 `seq_num` 字段，使用 CBOR key 5 即 `seq` key) | `frame.ts` (chunk frame 不含 `ts` 字段)
  | 现有 telos: `per-sender-seq-numbering.md` 说 "room:msg、room:file*offer 等所有 room:* 消息类型共享同一个 seq 空间" — **但 room:file_chunk 不在其中**（它没有 per-sender seq，只有 chunk seq*num）
  | 缺口: 这是有意设计（chunk 不计入房间消息 seq），但没有显式 documented。chunk 的 seq_num 语义（0-indexed, per-file）已在 protocol.md §5 中，但不在 telos 文件中。
  | **分类: defer** (不阻塞 M3 — types.ts 和 frame.ts 已正确实现此分野。但如果未来有人问"所有 room:* 是不是都共享 seq"，telos 应澄清 chunk 是例外)

---

## §B: Scope Ledger — M3 范围外但易被默认带进来的项

每项标记 DESIGN.md 出处 + 应在的 milestone + 为什么在 M3 范围外。

| #    | 项目                                                          | DESIGN.md 出处                                                    | 应在 milestone   | 说明                                                                                                                               |
| ---- | ------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| B-1  | **文件断点续传 (Resume)**                                     | §5.5 line 428: "续传：第一版不做。失败重传整个文件。"             | M4+ (未具体指定) | 需持久化 partial state (`.part` 文件 + chunk bitmap)，属 daemon 本地状态管理                                                       |
| B-2  | **SQLite room state + transcript 持久化**                     | §11.M4 line 893-895                                               | M4               | M3 CLI 无持久化 store；transcript 在 daemon 中                                                                                     |
| B-3  | **daemon 进程 + 跨平台 IPC server**                           | §11.M4 line 894-895                                               | M4               | M3 CLI 直接操作 PeerConnection，不经 daemon socket/pipe                                                                            |
| B-4  | **通知 hook (Windows .bat 示例)**                             | §11.M4 line 896-897                                               | M4               | 依赖 daemon 进程在后台运行，M3 无 daemon                                                                                           |
| B-5  | **离线暂存拉取与解密**                                        | §11.M4 line 897 ("离线暂存拉取与解密")                            | M4               | M2 完成了 `notify`/`notify_in` 信令通道。拉取 notify → 自动解密 → 触发 WebRTC 连接的工作流属 daemon                                |
| B-6  | **多人房间 / room invite / room:join**                        | §5.4 line 409-413: "房间管理（第二版暴露，第一版仅在协议层定义）" | M4+ (未具体指定) | M3 scope 是 1:1 文件传输                                                                                                           |
| B-7  | **room:resync 跨设备/会话消息同步**                           | §3.12 line 296: "第一版可以简化为打日志告警"                      | M4               | seq gap 在 M3 仅日志告警，不触发 resync_request                                                                                    |
| B-8  | **联邦协议 (rendezvous ↔ rendezvous)**                       | §11.M6 line 910                                                   | M6               | 纯 rendezvous server 间通信，M3 专注单 rendezvous                                                                                  |
| B-9  | **pi extension (7 个工具 + `/peer-pull` + footer)**           | §11.M5 line 901-904                                               | M5               | 必须在 M4 daemon IPC 就绪后实现                                                                                                    |
| B-10 | **ICE restart / 网络切换重连**                                | 无显式 DESIGN.md 出处                                             | M4               | WebRTC 协议支持，但 peer-bridge 层不做。M3 断开连接 → 重建新 PeerConnection。自动 ICE restart 需要连接状态机 + 配置，超出 M3 scope |
| B-11 | **文件预览 / 缩略图**                                         | 无 DESIGN.md 出处                                                 | 未规划           | 不在任何里程碑中                                                                                                                   |
| B-12 | **群组加密 (PSK 之外) / forward secrecy for stored messages** | §12 line 936: "第一版不做：前向保密的长期消息存储"                | 未规划           | 安全/隐私要点中标记为第一版不做                                                                                                    |

**补充说明 — M3 scope 边界提示**:

- **NOT M3: `peer_chat_wait` 和长轮询** — 这依赖 daemon IPC（§6.4 `/rooms/:id/wait`），属 M4/M5。
- **NOT M3: `peer_chat_status` / `peer_chat_history`** — 同样依赖 daemon 房间状态 SQLite。
- **NOT M3: `signal` payload 的 E2E 加密** — 如果 M2 signaling client 已经 bare WebSocket + server 透明，M3 的 WebRTC SDP exchange 走同一 pipe。SDP 不暴露文件内容。如需 E2E 加密信令 payload，这自身是一个决策 → 目前 DESIGN.md 未要求。
- **M3 IS: `send`, `send-text`, `recv` CLI 命令** — 且这些命令必须在三平台可用。这意味着 M3 的 `packages/p2p` 或 `packages/cli` (p2p 命令) 必须能 import `node-datachannel` + `signaling.ts` + `identity.ts` + `known-peers.ts`，独立完成完整的 send/recv 循环。

---

## §C: M3 启动准入判断

### C.1 Sediment-before-start todo list

基于 §A.1 的 block-M3-start 项，M3 实施前 **必须 sediment 的 telos 文件**：

| 优先级 | Telos 文件名（建议）                                | 内容概要                                                                                                                                                                                                                                                   | 来源            |
| ------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------- | --- |
| 1      | `decisions/m3-cli-p2p-bypass-daemon.md`             | M3 CLI 直接使用 `node-datachannel` + `signaling.ts` 管理 PeerConnection。定义 M4 迁移路径。类比 `m2-cli-bypasses-daemon.md` 但针对 P2P 层。覆盖: PeerConnection 管理模块放在 `packages/p2p/` 或 `packages/core/`，CLI `send`/`send-text`/`recv` 的调用链。 | U-1             |
| 2      | `decisions/datachannel-negotiation-two-channels.md` | `control` + `bulk` 双通道的协商方式: 非 negotiated (offerer `createDataChannel` 两个, answerer `onDataChannel` 路由) 或 negotiated。含各 channel 的 label、id、ordered/reliable 配置（引用 `protocol.md` Appendix C）。                                    | U-2             |
| 3      | `facts/default-ice-servers.md`                      | 默认 STUN 服务器列表 + privacy 声明。明确用户可在 `config.toml` 替换。含 TURN 空数组的不穿透警告。                                                                                                                                                         | U-3             |
| 4      | `facts/peerconnection-lifecycle.md`                 | PeerConnection 建立触发（accept invite 后 + 首次发消息时）、关闭触发（显式 disconnect + 闲置超时 + 进程退出）、闲置超时值。                                                                                                                                | U-4             |
| 5      | `decisions/datachannel-error-protocol.md`           | DTLS fingerprint verify 失败、capabilities 不匹配、DataChannel open 超时等场景的协议行为（close with/without error message）。定义 `room:error` 消息类型（如果需要）或决定"close without error, log locally"。                                             | U-5, U-6        |
| 6      | `facts/p2p-signal-payload-format.md`                | `signal.payload` 的 JSON sub-envelope: `{subtype: "webrtc_offer"                                                                                                                                                                                           | "webrtc_answer" | "ice_candidate", ...}`。含各 subtype 的字段定义。明确 signal payload 是否需要额外加密。 | U-7 |

**注**: U-6 (room:hello 版本协商) 和 U-5 (fingerprint verify 失败行为) 可以在 #5 中一起 sediment。

### C.2 启动判断

**结论: M3 不可直接启动。必须先 sediment 6 个 telos 文件（block-M3-start 项）。**

理由：

1. **M3 CLI 架构路径是核心未知** (U-1): 没有 daemon (M4) 的 M3 CLI 如何建立 PeerConnection、收发消息和文件、落盘 → 这决定了 M3 交付物的包结构（新 `packages/p2p` 还是放进 `packages/core`？）和 CLI 命令设计。

2. **DataChannel 协商方式影响协议基础** (U-2): 双通道的创建方式影响 `room:hello` 握手时序、错误处理路径、以及 node-datachannel API 的使用方式（`negotiated` vs `onDataChannel`）。实施前必须选一个。

3. **ICE servers 配置是功能门槛** (U-3): 默认 STUN 决定 NAT 穿透是否开箱即用。不加 STUN `iceServers: []` 会导致所有 NAT 后的 peer 无法直连（只能靠 TURN，but M3 无 TURN 服务）。

4. **PeerConnection 生命周期决定 CLI UX** (U-4): `recv` 是阻塞等待还是后台监听？闲置超时多久？这直接影响 CLI 命令语义。

5. **安全错误行为必须在实施前决定** (U-5/U-6): fingerprint verify 失败后的协议行为是安全关键路径，不能"实施中再定"。

6. **P2P signal payload 格式是 M3 实现的基础依赖** (U-7): 虽然 M2 已提供 `signal`/`signal_in` pipe，但 pipe 里的内容格式必须澄清，否则 offer/answer/ICE candidate 信令没法写。

**block-M3-exit 项 (U-8 ~ U-12)**: 可以用 reasonable defaults 推进，在 M3 实施过程中逐项 sediment。共 5 项，可分配为独立 brief。

**cross-slice 项 (U-13 ~ U-15)**: 不阻塞 M3 启动，但 M3 实施中必须预留结构和注释，避免 M4 回退时破坏 M3 契约。其中 U-15 (transcript 兼容) 可以在 M3 实施晚期决策——如果 M3 CLI 不写 transcript，M4 无需兼容。

**预计时间线**:

1. Sediment 6 个 block-M3-start telos 文件 (1-2 个 brief) → 1-2 小时
2. M3 实施启动 → 预计 4-6 个 briefs
3. 实施中 sediment 5 个 block-M3-exit 项
4. M3 退出条件: block-M3-start + block-M3-exit 全 sediment + 3 平台 CI 全绿 (send/send-text/recv E2E)

---

## §D: 我读了哪些文件

完整清单（含读法）：

### DESIGN.md

- §3.1 (lines 82-96) — WebRTC 传输决策
- §3.3 (lines 118-134) — DTLS fingerprint + Ed25519 签名
- §3.4 (lines 136-143) — BYO TURN
- §3.11 (lines 278-286) — wait-gap + seq
- §3.12 (lines 287-296) — per-sender seq
- §5.3 (lines 374-384) — P2P 握手
- §5.4 (lines 386-417) — 应用消息协议
- §5.5 (lines 419-439) — 文件传输
- §6.4 (lines 490-545) — daemon IPC + 架构
- §11.M3 (lines 885-891) — M3 in-scope
- §11.M4-M6 (lines 893-909) — scope 边界验证
- config.toml 示例 (lines 720-750)
- §12 (lines 915-940) — 安全/隐私要点
- §13 (lines 943-950) — 用户偏好
- Grep output for STUN/ICE/DataChannel/PeerConnection/reconnect keywords — 全文行号索引

### docs/protocol.md

- 全文 (569 lines): §1 信令协议、§3 P2P 握手、§4 CBOR 帧、§5 消息类型、Appendix A/B/C

### packages/protocol/src/types.ts

- 全文 (~180 lines): CBOR_KEYS、MSG_TYPES、RoomMessage union、所有消息 interface

### packages/protocol/src/frame.ts

- 全文 (~220 lines): encodeFrame/decodeFrame、messageToCBORMap、cborMapToMessage、readFrameLength

### packages/p2p-probe/src/probe.ts

- 全文 (95 lines): node-datachannel API 使用、PeerConnection 创建、SDP relay、DataChannel 创建、cleanup

### .telos/ (全部)

- `facts/`: 16 files — grep `-li` webrtc/datachannel/p2p/handshake/file/transport/sctp/dtls/ice/stun/noise 过滤后精读 7 files (cbor-key-allocation, ed25519-x25519-conversion, inbox-directory-structure, pi-extension-api-surface, signaling-client-fsm, signaling-message-fields, webrtc-datachannel-limits) + skim 其余
- `decisions/`: 24 files — 精读 18 M3-relevant (webrtc-over-noise-tcp, chatroom-abstraction, per-sender-seq-numbering, deterministic-1to1-room-id, reconnect-requires-reregister, disconnect-immediate-offline, agent-blind-check-protocol, m2-cli-bypasses-daemon, signaling-fifo-no-request-id, signaling-client-fifo-queue-wait, sealed-box-for-offline-notify, daemon-no-pi-spawn, unique-cbor-keys-not-message-scoped, + skim decisions)
- `tensions/`: 2 files (single-identity-per-device, wait-gap-message-visibility) — 全文

### .telos/BACKLOG.md

- 全文: M0-M2 退出状态、agent-blind 结果、Post-M2 BACKLOG、M2 known unknowns 全表
