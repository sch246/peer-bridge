# M3 Agent-Blind Design Report

> Protocol: `decisions/agent-blind-check-protocol.md` (闭卷 + 白名单 + 负向约束 + 父模型 diff)
> Date: 2026-05-30
> Agent: blind subagent (pre-impl check)
> Status: report only — 零代码、零 telos 编辑、零 DESIGN.md 读取

---

## §1 我读了哪些 telos 文件 (whitelist compliance check)

### .telos/facts/ (17 files)

| #   | 路径                                         | 用途                      |
| --- | -------------------------------------------- | ------------------------- |
| 1   | `.telos/facts/cbor-key-allocation.md`        | CBOR key 唯一性 invariant |
| 2   | `.telos/facts/crypto-library-mapping.md`     | 密码学 npm 包映射         |
| 3   | `.telos/facts/daemon-sqlite-schema.md`       | daemon SQLite schema      |
| 4   | `.telos/facts/ed25519-x25519-conversion.md`  | Ed25519↔X25519 转换      |
| 5   | `.telos/facts/inbox-directory-structure.md`  | 文件落盘目录结构          |
| 6   | `.telos/facts/known-peers-toml-schema.md`    | known_peers.toml 格式     |
| 7   | `.telos/facts/nacl-sealed-box-properties.md` | NaCl sealed box 属性      |
| 8   | `.telos/facts/peer-id-encoding.md`           | Peer ID 编码规范          |
| 9   | `.telos/facts/pi-extension-api-surface.md`   | pi extension API          |
| 10  | `.telos/facts/pi-session-append-only.md`     | pi session 写模型         |
| 11  | `.telos/facts/platform-ipc-mechanisms.md`    | 跨平台 IPC                |
| 12  | `.telos/facts/rendezvous-health-endpoint.md` | rendezvous health 端点    |
| 13  | `.telos/facts/rendezvous-server-config.md`   | rendezvous 服务端配置     |
| 14  | `.telos/facts/rendezvous-tech-stack.md`      | rendezvous 技术栈         |
| 15  | `.telos/facts/signaling-client-fsm.md`       | 信令客户端 5-state FSM    |
| 16  | `.telos/facts/signaling-message-fields.md`   | 信令消息字段 inventory    |
| 17  | `.telos/facts/webrtc-datachannel-limits.md`  | WebRTC DataChannel 限制   |

### .telos/decisions/ (25 files)

| #   | 路径                                                            |
| --- | --------------------------------------------------------------- |
| 18  | `.telos/decisions/agent-blind-check-protocol.md`                |
| 19  | `.telos/decisions/chatroom-abstraction.md`                      |
| 20  | `.telos/decisions/daemon-no-pi-spawn.md`                        |
| 21  | `.telos/decisions/deterministic-1to1-room-id.md`                |
| 22  | `.telos/decisions/disconnect-immediate-offline.md`              |
| 23  | `.telos/decisions/implicit-1to1-room-creation.md`               |
| 24  | `.telos/decisions/invite-create-no-cross-reconnect-state.md`    |
| 25  | `.telos/decisions/long-poll-wait-onupdate-streaming.md`         |
| 26  | `.telos/decisions/m2-cli-bypasses-daemon.md`                    |
| 27  | `.telos/decisions/m2-notification-queue-unbounded.md`           |
| 28  | `.telos/decisions/m2-rate-limit-invite-create-only.md`          |
| 29  | `.telos/decisions/manual-fingerprint-confirmation-on-accept.md` |
| 30  | `.telos/decisions/node-22-minimum.md`                           |
| 31  | `.telos/decisions/per-sender-seq-numbering.md`                  |
| 32  | `.telos/decisions/reconnect-requires-reregister.md`             |
| 33  | `.telos/decisions/rendezvous-federation-not-turn.md`            |
| 34  | `.telos/decisions/sealed-box-for-offline-notify.md`             |
| 35  | `.telos/decisions/signaling-client-fifo-queue-wait.md`          |
| 36  | `.telos/decisions/signaling-fifo-no-request-id.md`              |
| 37  | `.telos/decisions/test-vectors-as-spec-not-regression.md`       |
| 38  | `.telos/decisions/transcript-jsonl-per-room.md`                 |
| 39  | `.telos/decisions/unique-cbor-keys-not-message-scoped.md`       |
| 40  | `.telos/decisions/webrtc-over-noise-tcp.md`                     |
| 41  | `.telos/decisions/windows-first-class.md`                       |

### .telos/tensions/ (2 files)

| 42 | `.telos/tensions/single-identity-per-device.md` |
| 43 | `.telos/tensions/wait-gap-message-visibility.md` |

### 根 telos

| 44 | `.telos/README.md` |
| 45 | `.telos/BACKLOG.md` |

### 协议规范

| 46 | `docs/protocol.md` |

### Test vectors (JSON only)

| 47 | `packages/protocol/test-vectors/cbor_frames.json` |
| 48 | `packages/protocol/test-vectors/fingerprint_sig.json` |
| 49 | `packages/protocol/test-vectors/invite.json` |
| 50 | `packages/protocol/test-vectors/peer_id.json` |
| 51 | `packages/protocol/test-vectors/sealed_box.json` |

**总计**: 51 个文件，全部在白名单内。未读取 `.telos/audit-trails/`、`DESIGN.md`、`README.md`、`packages/*/src/`、`packages/*/test/`、`packages/p2p-probe/`。

---

## §2 M3 P2P 设计 (闭卷推断)

### §2.1 信令到 P2P 的桥

**(a) 信令 sub-envelope 的字段格式**

`signal` / `signal_in` 的 `payload` 字段内嵌一个 JSON sub-envelope，与 protocol.md §3 步骤 3 一致：

```json
{
  "type": "signal",
  "subtype": "<webrtc_offer | webrtc_answer | ice_candidate>",
  "sdp": "<SDP string>",
  "candidate": "<ICE candidate string>", // 仅 ice_candidate  subtype
  "sdp_mid": "<string>", // 仅 ice_candidate  subtype
  "sdp_mline_index": 0, // 仅 ice_candidate  subtype
  "fingerprint": "<hex>", // 仅 offer / answer
  "signature": "<base64-ed25519>", // 仅 offer / answer
  "peer_id": "PB-...", // 仅 offer / answer
  "timestamp": 1736937600, // 仅 offer / answer
  "nonce": "<base64>" // 仅 offer / answer
}
```

**字段说明**：

- `subtype` 区分信令消息类型。是唯一的路由 key — 接收方根据 subtype 决定调 `setRemoteDescription()`（offer）、`addIceCandidate()`（ice_candidate）、还是 `setLocalDescription()`（对 answer）。
- `sdp` 是 WebRTC SDP 字符串（包含 DTLS fingerprint 在 `a=fingerprint:` 行）。
- `candidate` / `sdp_mid` / `sdp_mline_index` 仅在 `ice_candidate` subtype 时存在。
- `fingerprint` + `signature` + `peer_id` + `timestamp` + `nonce` 仅在 `webrtc_offer` 和 `webrtc_answer` 时存在。这是 protocol.md §3 步骤 2-3 的签名验证 payload。
- ICE candidate 本身不签名（SDP offer 已签名；candidate 是 ICE 层的增量更新，不引入新的 identity 威胁）。

**依据**：

- `docs/protocol.md` §3 步骤 3 给出 `{ subtype: "webrtc_offer", sdp, fingerprint, signature, ... }` 格式
- `facts/signaling-message-fields.md` 定义 `signal` 为 `{ to, payload }`，`signal_in` 为 `{ from, payload }`，payload 为 opaque binary/string — M3 将其解读为上述 JSON
- `facts/webrtc-datachannel-limits.md` 提到 WebRTC 协商过程包括 SDP offer/answer + ICE

**(b) 谁先发 offer**

**发起方**（想发送文件/消息的 peer）创建 `RTCPeerConnection`、生成 offer、通过 `signal` 发送 `webrtc_offer` 给目标 peer。

接收方在收到 `signal_in` 后，`setRemoteDescription(offer)`，生成 answer，通过 `signal` 回发 `webrtc_answer`。

**依据**：protocol.md §3 步骤 2 明确说 "Alice 生成 ephemeral DTLS 证书"→签名→发送，Bob 验证。这暗示 Alice 是发起方。且 WebRTC offer/answer 模型本身就是调用方先 offer。

**(c) 重发/超时策略**

**INFERRED — 见 §3 I-1**。

我对重发/超时的选择：

- SDP exchange 本身无重发。如果 `signal` 发送后 30 秒内未收到对方的 `webrtc_answer`（通过 `signal_in`），发起方放弃，关闭 PeerConnection，CLI 退出码 1。
- ICE candidates 挤在一起发送。不做单独超时。ICE gathering 完成后批量发送最关键的 candidate 集合（trickle ICE）。
- 如果 PeerConnection state 在 60 秒内未达到 `connected`，视为握手超时。

**理由**：telos 未规定重发策略。`signaling-client-fsm.md` 的 reconnect 是信令层的，不是 P2P 层的。`facts/webrtc-datachannel-limits.md` 描述了 ICE 框架但未规定超时。我选的 30s / 60s 是合理默认值（WebRTC 默认 ICE 超时约 30s）。

### §2.2 PeerConnection 配置

**(a) 默认 ICE servers**

**INFERRED — 见 §3 I-2**。

我选择提供**一个默认 Google STUN server**：

```typescript
const DEFAULT_ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
```

**理由**：

- WebRTC 需要 STUN 才能穿透大多数 NAT。无 STUN 时仅 local-host candidate，跨网络连接无法建立。
- telos 完全未提 ICE server 配置。`rendezvous-server-config.md` 只定义 rendezvous 的配置，不含 ICE。
- `webrtc-over-noise-tcp.md` 决策说 "ICE 框架处理 NAT 穿透（主机候选、STUN、TURN）"，暗示有 STUN。
- Google 的 public STUN 是行业默认（Chrome 内建、大多数 WebRTC 应用都用）。
- TURN 不提供（`rendezvous-federation-not-turn.md` 明确说联邦不做在 TURN 层）。TURN 需要 relay 带宽，M3 不自托管 TURN。
- 用户可以覆盖：通过 `config.toml` 或 CLI flag `--stun` 指定自定义 STUN。

**(b) DTLS fingerprint pinning 验证流程**

protocol.md §3 步骤 2-6 详细规定：

1. 创建 `RTCPeerConnection` 时使用**自签名 ECDSA P-256 证书**（WebRTC 默认，每次连接不同）
2. 从 SDP 中提取 `a=fingerprint:sha-256 xx:xx:xx:...` → decode 为 32 bytes → 这是 `fingerprint_bytes`
3. 构造 `signed_payload` = `fingerprint_bytes(32) || peer_id_bytes(32) || timestamp_be(8) || nonce(16)` = 88 bytes
4. 用自身 Ed25519 长期私钥对 `signed_payload` 签名，得到 64-byte `signature`
5. 将 `{ subtype, sdp, fingerprint, signature, peer_id, timestamp, nonce }` 打包成 signal payload 发送
6. 接收方验证：
   - 解码 `peer_id` → 32-byte Ed25519 公钥 → 从 `known_peers.toml` 查找信任状态
   - 重组相同的 `signed_payload`
   - `Ed25519_verify(pubkey, signed_payload, signature)` → 必须 return `true`
   - `|now - timestamp| ≤ 300` seconds
   - DTLS 层自动验证 certificate fingerprint 匹配 SDP 中的 fingerprint

**如果 DTLS 层验证失败**（中间人替换了 certificate）→ WebRTC `iceConnectionState` 进入 `failed` → 关闭连接。

**如果 Ed25519 签名验证失败** → 在 `setRemoteDescription` 之前就拒绝（关闭 PeerConnection、不设置 remote description、CLI 退出码 1）。

**(c) Ed25519 签名字节范围 + verify 时机**

- 字节范围：`fingerprint_bytes(32) || peer_id_bytes(32) || timestamp_be(8) || nonce(16)` = 88 bytes
- 验证时机：**在 `setRemoteDescription(sdp)` 之前**。必须先验证签名再信任 SDP 内容。如果验证失败，不调用 `setRemoteDescription`，直接关闭 PeerConnection。

**依据**：`test-vectors/fingerprint_sig.json` 的 signed_payload_hex 精确匹配此 88-byte 结构。protocol.md §3 步骤 4 的验证流程。

### §2.3 DataChannel 双通道结构

**两个 DataChannel**：

| Channel   | Label     | ID (negotiated) | Ordered | Reliable | 用途                                   |
| --------- | --------- | --------------- | ------- | -------- | -------------------------------------- |
| `control` | "control" | 0               | true    | true     | `room:hello/msg/file_offer` 等控制消息 |
| `bulk`    | "bulk"    | 1               | true    | true     | `room:file_chunk`                      |

**依据**：`docs/protocol.md` Appendix C。

**(a) 协商方式**

**INFERRED — 见 §3 I-3**。

我选择 **non-negotiated 模式**（发起方 `createDataChannel("control", options)` + `createDataChannel("bulk", options)`，接收方通过 `peer.ondatachannel` 回调接收）。

**理由**：

- protocol.md Appendix C 只给了 label、ordered、reliable 属性，未提 `negotiated` + `id` 参数
- non-negotiated 是 WebRTC DataChannel 的默认模式 — 一个 peer 创建 channel，另一个 peer 收到 `datachannel` 事件
- 缺点：如果两个 peer 同时创建同 label 的 channel，可能有两个同名 channel 竞争
- 但这个竞态在 peer-bridge 场景中被 **offer/answer 角色** 消解：只有发起 offer 的 peer 创建 DataChannel。接收 answer 的 peer 通过 `ondatachannel` 接收
- 两个 channel 都预判在 offer 的 SDP 中列出，确保 ICE 协商时 channel 已知

**(b) 谁创建，谁接收**

- **发起方**（发送 offer 的 peer）创建两个 DataChannel：`control`(label="control") 和 `bulk`(label="bulk")
- **接收方**（发送 answer 的 peer）通过 `peer.addEventListener('datachannel', (dc) => { if (dc.label === 'control') ... })` 接收
- 接收方根据 label 路由到 control 或 bulk 处理路径

**(c) 接收方通过 label 匹配**

接收方在 `datachannel` 事件中检查 `channel.label`：

- `label === "control"` → 绑定 control message handler
- `label === "bulk"` → 绑定 file chunk handler
- `label` 为其他值 → 未知 channel，记录警告日志并关闭该 channel

### §2.4 应用层握手

`room:hello` 是 DataChannel `control` 打开后发送的**第一条消息**。

**(a) 何时发送**

控制 channel `open` 事件触发后（`channel.addEventListener('open', ...)`），发送方**立即**发送 `room:hello`。

接收方在收到第一条 DataChannel 消息后（即 control channel 的 `message` 事件触发），如果消息 type 是 `room:hello`，验证版本和能力后回复自己的 `room:hello`。

**(b) 对方如何回应**

接收方验证发起方的 `room:hello` 后，**在同一个 control channel 上**回复一条 `room:hello` 消息。

**version 字段**：protocol.md §5 规定 `version: "0.1.0"`（tstr，CBOR key 8）。

**(c) 版本协商失败的行为**

**INFERRED — 见 §3 I-4**。

我的选择：

- 如果接收方收到 `room:hello` 的 `version` 与自己不兼容（major 不同，如 `0.1.0` vs `1.0.0`）：

  - 发送一条 `room:hello` 回复，但包含一个 `error: "version_mismatch"` 字段（或附在 capabilities 中表示不兼容）
  - 然后关闭 DataChannel（不再发送任何其他应用消息）
  - CLI 退出码 1 + stderr "版本不兼容: 对方版本 X.X.X，本地版本 Y.Y.Y"

- 如果 minor 不同（如 `0.1.0` vs `0.2.0`）：
  - 接受连接。capabilities 协商决定实际可用功能集

**(d) capabilities 字段的 key set 推断**

基于 `protocol.md` §5 `room:hello` 定义 + `register` capabilities + 已有 feature：

```json
{
  "webrtc": true, // 支持 WebRTC P2P（M3 起点）
  "bulk_transfer": true, // 支持文件 bulk 传输
  "version": "0.1.0" // 协议版本（等同于 version 字段，冗余但向前兼容）
}
```

**依据**：

- `protocol.md` §1 register message 有 `capabilities: { "webrtc": true, "bulk_transfer": true, "version": "0.1.0" }`
- `room:hello` 的 `capabilities` map（CBOR key 9）标记为"可选能力"
- `cbor_frames.json` 的 room:hello vector 用 `capabilities: {}` 空 map — 表示 capabilities 是可扩展的
- `BACKLOG.md` B-4 提到 `RendezvousClient` 的 `capabilities` 当前固定为空 `{}` — M3+ 需要展开
- 我推断 M3 room:hello 的 capabilities 至少包含这三个 key

**注意**：`version` 字段（CBOR key 8）是协议版本，`capabilities.version` 在 register 中是"application protocol version"可能有不同语义。我没有足够信息判断它们是否需要一致，所以我默认 `room:hello` 的 `version`（key 8）是协议版本，`capabilities` 内的 hash 是可选能力开关。

### §2.5 文件传输流程

**(a) chunk 大小**

**64 KiB (65536 bytes)**。

**依据**：`facts/webrtc-datachannel-limits.md` §"对 peer-bridge 的影响" 第 1 项：

> "文件 chunk 大小 = 64 KiB：SCTP 单消息上限，应用层分片必需"

SCTP 单消息上限 `65536 bytes = 2^16`。使用 64 KiB 是唯一的安全选择—更大的 chunk 会被 SCTP 层拒绝，更小的 chunk 增加 overhead（更多 CBOR frame header）。

与 `cbor_frames.json` 的 `room:file_chunk` vector 一致：`data` 字段为 bstr (CBOR type)，chunk 大小为 data + CBOR 编码 overhead。64 KiB 是 data 部分的硬上限。

**(b) 流控 (bufferedAmount + bufferedAmountLow)**

**INFERRED — 见 §3 I-5**。

我的选择：

- **bufferedAmountLowThreshold**: **1 MiB** (1,048,576 bytes = 16 个 chunk)
- **发送策略**: 连续发送 chunk，每个 chunk 发完后检查 `bufferedAmount`。如果 `bufferedAmount > bufferedAmountLowThreshold`，暂停发送，等待 `bufferedamountlow` 事件触发后恢复。
- **暂停保护**: 如果在 `bufferedamountlow` 事件来临前，发送方等待超过 5 秒 → 视为对端背压（可能是网络极差），发 abort + 退出码 1。

**理由**：

- `facts/webrtc-datachannel-limits.md` 提到流控模式："发送数据后检查 bufferedAmount，超过阈值时暂停发送，等 `bufferedAmountLow` 事件后恢复"
- 但未给出具体阈值数值
- 1 MiB 在典型的 1 Gbps 局域网中约 8 ms RTT 可以清空；在较慢的 10 Mbps 链路中也只需约 0.8 秒
- 16 个 chunk 的积压是合理平衡——太多浪费内存，太少增加 `bufferedamountlow` 事件次数

**(c) SHA-256 校验时机**

**所有 chunk 接收完毕后**。

流程：

1. 接收方收到 `room:file_offer` → 记录 `sha256` 期望值 → **等待用户接受**（CLI 提示 accept/reject）
2. 接收方发 `room:file_accept`
3. 发送方开始发送 `room:file_chunk` 序列（each with `seq_num` 0, 1, 2, ...)
4. 接收方创建 `inbox/<file_id>.part`，逐步追加 chunk data
5. 收到最后一个 chunk（检测：`file.offer.size` 已经写满，或收到 `room:file_done`）
6. **此时** compute SHA-256 over the accumulated file
7. 比对 `sha256(actual) === sha256(expected)`：
   - **匹配** → rename `inbox/<file_id>.part` → `inbox/<file_id>`；发 `room:file_done`
   - **不匹配** → 删除 `.part`；发 `room:file_abort{reason: "sha256_mismatch"}`

**依据**：

- `facts/inbox-directory-structure.md` §文件落盘流程步骤 4-6 明确描述此流程
- `docs/protocol.md` §5 `room:file_offer` 的 `sha256` 字段（CBOR key 6, bstr 32）
- `docs/protocol.md` §5 `room:file_done` / `room:file_abort` 消息类型

**(d) 落盘路径**

`<data_dir>/rooms/<room_id>/inbox/<file_id>.part` （传输中）
`<data_dir>/rooms/<room_id>/inbox/<file_id>` （完成后）

**依据**：

- `facts/inbox-directory-structure.md` §inbox/ — 确切路径 + `.part` 后缀约定
- `facts/inbox-directory-structure.md` 的 data_dir 平台路径表

**(e) 临时文件命名**

`<file_id>.part` — `file_id` 是 `room:file_offer` 中的 UUID string。

**依据**：

- `facts/inbox-directory-structure.md` 使用 `<file_id>.part` 模式
- `docs/protocol.md` §5 `room:file_offer` 的 `file_id` 字段（CBOR key 10, tstr, UUID format）

**(f) abort 处理**

- **发送方主动 abort**：发送 `room:file_abort{file_id, reason: "user_cancelled" | "timeout" | ...}` → 停止发送 chunk。接收方收到 abort → 删除 `.part` 文件。
- **接收方主动 abort**：接收方检查失败（SHA-256 mismatch、chunk gap 不可恢复、用户 Ctrl+C）→ 发送 `room:file_abort{file_id, reason: "sha256_mismatch" | "chunk_gap" | "user_rejected"}` → 删除 `.part` 文件。
- **connection break mid-transfer**：DataChannel 关闭 → 接收方 30 秒内未重连 → 删除 `.part`。

**(g) 文件大小限制**

**500 MiB（可配置）**。

**依据**：`facts/webrtc-datachannel-limits.md` §"对 peer-bridge 的影响" 第 4 项：

> "500 MiB 文件上限（可配置）：合理上限，约 8000 个 chunk"

### §2.6 CLI 命令形态

**INFERRED — 见 §3 I-6**。

我推断 M3 CLI 沿袭 M2 的 `m2-cli-bypasses-daemon.md` 模式 — **CLI 直接绕过 daemon**。

**三个命令**：

1. **`peer-bridge send <peer> <file>`**

   - `<peer>` 是 `known_peers.toml` 中的 `alias` 或 `peer_id`
   - 解析为 `peer_id` → 通过 rendezvous `signal` 发起 WebRTC offer → 建立 P2P 连接 → await `room:hello` 握手 → 发送 `room:file_offer` → 等待 `room:file_accept` → 开始发送 chunk → `room:file_done`
   - CLI flags: `--stun <url>` (override ICE server), `--timeout <sec>`, `--note <text>` (attached to file_offer)
   - 退出码: 0 = 成功, 1 = 错误

2. **`peer-bridge send-text <peer> <text>`**

   - 同上但走 `room:msg{kind="text"}` 路径（不涉及 file chunk）
   - 等待对端的 `room:msg` 回复？不需要。fire-and-forget + 显示对端连接状态

3. **`peer-bridge recv`**
   - 监听来自 rendezvous `signal_in` 的 WebRTC offer
   - 收到 offer → 接受 → 完成 P2P 握手 → 接收 `room:hello` → 等待 `room:file_offer` 或 `room:msg`
   - 对于 `room:file_offer`：打印文件名、size、sender peer_id → 提示 `Accept? [Y/n]`
   - 用户确认 → 发 `room:file_accept` → 接收 chunk → 校验 SHA-256 → 打印落盘路径
   - CLI flags: `--timeout <sec>`, `--accept-all` (自动接受所有人)
   - 这是一个**监听循环**（不退出）→ 持续接收直到 Ctrl+C 或超时

**(d) daemon 是否存在**

**否 — M3 CLI 绕过 daemon**。

**理由**：

- `decisions/m2-cli-bypasses-daemon.md` 明确 M2 CLI 绕过 daemon。该 decision 的 Boundaries 说："M3（P2P 传输）的 CLI 通信路径不在本 decision 范围内——M3 CLI 可能需要通过 signaling.ts 或 daemon，取决于 daemon 在 M3 时的完成度"
- `BACKLOG.md` M3 启动准入中列出 U-1: `decisions/m3-cli-p2p-bypass-daemon.md` — M3 CLI 绕过 daemon 的 P2P 接入路径。这个文件名暗示 M3 也 bypass daemon
- `design.md §6.4` 被 m2-cli-bypasses-daemon 引用为 steady-state 架构（CLI → daemon socket → rendezvous），但 daemon 是 M4 组件
- 因此 M3 CLI 直接使用 `core/signaling.ts` + `node-datachannel` 进行 P2P 通信，不经过 daemon
- `recv` 在 CLI 中是**前台阻塞进程**（不涉及后台 daemon）、带超时

### §2.7 PeerConnection 生命周期

**(a) 何时建立**

当 CLI `send` / `send-text` 命令被调用，或 `recv` 收到对端 `signal_in` webrtc_offer 时。

具体：发起方在 `RendezvousClient` 状态到达 `ready` 后，创建 `RTCPeerConnection` → 生成 SDP offer → 通过 `signal` 发送 → 等待 answer。

接收方在收到 `signal_in{subtype: "webrtc_offer"}` 后创建 `RTCPeerConnection`。

**(b) 何时关闭**

**INFERRED — 见 §3 I-7**。

我的选择：

- **send 命令**：文件发送完成（收到 `room:file_done` from peer）→ 发送方等待 5 秒（让对端处理完成确认）→ 关闭 DataChannel → 关闭 PeerConnection → 退出
- **send-text 命令**：消息发送完成 → 等待 2 秒（让对端接收确认）→ 关闭连接 → 退出
- **recv 模式**：无活动超时后关闭。如果有当前传输进行中 → 等传输完成。Ctrl+C → abort 当前传输 → 关闭连接
- **idle timeout**：如果 control channel 上最后一条消息后 **300 秒**无新消息或传输 → 视为闲置，发送 `room:ping` 探活。如果 pong 在 10 秒内未返回 → 关闭 PeerConnection

**(c) 闲置超时**

300 秒闲置后 ping → 10 秒无 pong → 关闭。

**理由**：

- protocol.md §5 定义了 `room:ping` / `room:pong` 消息类型，暗示有 keepalive 机制
- 300 秒是 common default（类似 TCP keepalive）
- 没有 read-line telos 规定具体阈值

**(d) 重连 vs 放弃**

**INFERRED — 见 §3 I-8**。

我的选择 — 取决于场景：

| 断开类型                                                 | 行为                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DataChannel 意外关闭（`onclose` without explicit close） | 尝试重新打开 DataChannel（在同一个 RTCPeerConnection 上）。如果 PeerConnection 仍为 `connected` 状态，重新 `createDataChannel("control")` + `createDataChannel("bulk")` → 重新 `room:hello` 握手。**文件传输不 resume — 从头重传** |
| PeerConnection `connectionState` → `failed`              | 完全关闭，不重连。CLI 退出码 1                                                                                                                                                                                                     |
| PeerConnection `connectionState` → `disconnected`        | 等待 ICE restart（最多 15 秒）。如果恢复到 `connected` → 继续。如果超时 → 失败                                                                                                                                                     |

**"从头重传"的依据**：`facts/webrtc-datachannel-limits.md` §"对 peer-bridge 的影响" 第 3 项：

> "续传：第一版不做。失败重传整个文件（简化实现）"

### §2.8 错误处理

以下场景的协议行为和 CLI 退出码。

| 场景                               | 协议行为                                                                                                                                                                                                                                                     | CLI 退出码                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| **fingerprint signature mismatch** | 在 `setRemoteDescription` 前验证 Ed25519 签名。失败 → 不设置 remote description，关闭 PeerConnection。不发送任何 error 给对端（因为对端的 identity 未验证）                                                                                                  | 1                         |
| **DTLS certificate mismatch**      | WebRTC 层自动检测。`connectionstatechange` → `failed`。记录日志 "certificate fingerprint mismatch"                                                                                                                                                           | 1                         |
| **peer_id not in known_peers**     | 同上（在 Ed25519 签名验证前不查 known_peers，但签名验证通过后查。如果不在 known_peers 中 → 拒绝）。`facts/known-peers-toml-schema.md` 定义 `trust: "verified" \| "tofu"`。如果 trust 是 `tofu` → 允许连接但 CLI 显示警告。如果完全不在 known_peers 中 → 拒绝 | 1                         |
| **capabilities 不兼容**            | `room:hello` 中的 `capabilities` 比对。如对方声明 `bulk_transfer: false` 但我方需要文件传输 → 发送 `room:hello` 回复 + error indication → 关闭 DataChannel                                                                                                   | 1                         |
| **version 不兼容**                 | 见 §2.4(c)                                                                                                                                                                                                                                                   | 1                         |
| **DataChannel open 超时**          | 发起方创建 DataChannel 后等待 `open` 事件。30 秒超时 → 关闭 PeerConnection                                                                                                                                                                                   | 1                         |
| **SDP answer 超时**                | 发起方发送 offer 后 30 秒内未收到 answer → 关闭 PeerConnection                                                                                                                                                                                               | 1                         |
| **file_offer 被拒绝**              | 接收方发送 `room:file_reject{file_id, reason: "user_rejected" \| "size_too_large"}` → 发送方收到后关闭 DataChannel（如果无其他传输）                                                                                                                         | 1 (sender) / 0 (receiver) |
| **chunk gap (seq_num 跳号)**       | 接收方检测 seq_num 不连续。当前 M3 行为：直接 abort（`room:file_abort{reason: "chunk_gap"}`）。**不做重传请求**                                                                                                                                              | 1                         |
| **SHA-256 mismatch**               | 接收方删除 `.part`、发 `room:file_abort{reason: "sha256_mismatch"}`                                                                                                                                                                                          | 1                         |
| **文件大小超过 500 MiB**           | 接收方在 `room:file_offer` 到达时检查 `size` 字段。超过上限 → `room:file_reject{reason: "file_too_large"}`                                                                                                                                                   | 1 (sender) / 0 (receiver) |
| **bulk channel 打开失败**          | 如果 control channel 成功但 bulk channel 创建失败 → 继续连接，但标记 `capabilities.bulk_transfer = false`。发送 `room:hello` 时 capabilities 不含 `bulk_transfer`                                                                                            | 0 (warning)               |
| **未知 message type**              | 在 control channel 上收到未知 type 的消息 → 记录日志警告，不中断连接                                                                                                                                                                                         | 0                         |
| **bufferedAmount 背压超时**        | 见 §2.5(b)：等待 `bufferedamountlow` 超过 5 秒 → abort                                                                                                                                                                                                       | 1                         |

**退出码约定**：

- `0` = 成功
- `1` = 失败（任意错误）
- `2` = 信号中断（Ctrl+C）

### §2.9 公开 API surface

**(a) 新建 npm 包**

**`packages/p2p`** — M3 P2P 传输核心包。

**理由**：当前项目结构：`packages/protocol`、`packages/core`、`packages/rendezvous`、`packages/cli`。P2P 是独立关注点，应独立成包。

依赖关系：

```
packages/p2p
  └── packages/core   (identity, known-peers, signaling)
  └── packages/protocol (types, peer-id, frame, cbor)
  └── node-datachannel  (外部)
```

**(b) 主要 export**

```typescript
// packages/p2p/src/index.ts

// WebRTC Connection Manager
export { PeerConnectionManager } from './peer-connection-manager';

// DataChannel 抽象
export { ControlChannel } from './control-channel';
export { BulkChannel } from './bulk-channel';

// File Transfer
export { FileSender } from './file-sender';
export { FileReceiver } from './file-receiver';

// Types
export type {
  P2PConfig,
  P2PEvent,
  FileTransferProgress,
  HelloMessage,
  SignalPayload,
} from './types';
```

**(c) 核心类型定义**

**INFERRED — 见 §3 I-9**。

我推断的核心类型：

```typescript
// types.ts
interface P2PConfig {
  iceServers: RTCIceServer[]; // 默认 [Google STUN]
  signalTimeoutMs: number; // 默认 30000
  dataChannelOpenTimeoutMs: number; // 默认 30000
  idleTimeoutMs: number; // 默认 300000
  maxFileSizeBytes: number; // 默认 500 MiB
  chunkSizeBytes: number; // 固定 65536 (64 KiB)
  bufferedAmountLowThreshold: number; // 默认 1 MiB
  dataDir: string; // platform-default
}

interface SignalPayload {
  subtype: 'webrtc_offer' | 'webrtc_answer' | 'ice_candidate';
  sdp?: string;
  candidate?: string;
  sdp_mid?: string;
  sdp_mline_index?: number;
  fingerprint?: string;
  signature?: string;
  peer_id?: string;
  timestamp?: number;
  nonce?: string;
}

interface HelloMessage {
  version: string; // "0.1.0"
  capabilities: {
    webrtc: boolean;
    bulk_transfer: boolean;
    version: string;
  };
}

interface FileTransferProgress {
  fileId: string;
  fileName: string;
  totalBytes: number;
  transferredBytes: number;
  status: 'negotiating' | 'transferring' | 'verifying' | 'done' | 'aborted';
  errorReason?: string;
}

type P2PEvent =
  | { type: 'connected'; peerId: string }
  | { type: 'disconnected'; peerId: string }
  | { type: 'hello'; peerId: string; version: string; capabilities: object }
  | { type: 'file_offer'; fileId: string; name: string; size: number; sender: string }
  | { type: 'file_progress'; progress: FileTransferProgress }
  | { type: 'file_done'; fileId: string; path: string }
  | { type: 'file_abort'; fileId: string; reason: string }
  | { type: 'message'; body: string; sender: string }
  | { type: 'error'; message: string; code?: string };
```

**(d) 主要类 API**

```typescript
class PeerConnectionManager {
  constructor(config: P2PConfig, identity: Identity, rendezvousClient: RendezvousClient);
  on(event: 'p2p_event', handler: (event: P2PEvent) => void): void;
  async connect(peerId: string): Promise<void>;
  async waitForConnection(timeoutMs: number): Promise<string>; // returns peerId
  async sendMessage(peerId: string, text: string): Promise<void>;
  async sendFile(peerId: string, filePath: string, note?: string): Promise<void>;
  async disconnect(peerId: string): Promise<void>;
  async shutdown(): Promise<void>;
}

class FileSender {
  async send(
    controlChannel: ControlChannel,
    bulkChannel: BulkChannel,
    filePath: string,
    note?: string,
  ): Promise<void>;
  abort(): void;
  onProgress: (progress: FileTransferProgress) => void;
}

class FileReceiver {
  async receive(
    controlChannel: ControlChannel,
    bulkChannel: BulkChannel,
    offer: FileOffer,
    outputDir: string,
  ): Promise<string>; // returns saved path
  reject(reason: string): void;
  onProgress: (progress: FileTransferProgress) => void;
}
```

**(e) CLI 包**

`packages/cli` 新增三个命令（如 §2.6）。CLI 使用 `PeerConnectionManager` 而非直接操作 `RTCPeerConnection`。

---

## §3 推断标记

以下是我 confidence 不高的项，标记为 INFERRED：

| ID       | 主题                                   | 我的选择                                                                                      | Confidence        | 理由                                                                                                                                                                                                                                                                                                               |
| -------- | -------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **I-1**  | SDP 信令超时 + ICE 超时                | offer→answer 超时 30s；ICE completion 超时 60s                                                | **low**           | telos 未提任何 P2P 信令超时值。`facts/signaling-client-fsm.md` 有 reconnect backoff 但那是 WebSocket 层的，不是 P2P 信令的。`facts/webrtc-datachannel-limits.md` 描述了 ICE 但没说超时。30s/60s 是我从 WebRTC 常态取的                                                                                             |
| **I-2**  | 默认 STUN server                       | `stun:stun.l.google.com:19302`                                                                | **medium**        | `facts/webrtc-datachannel-limits.md` 说 "ICE 框架处理 NAT 穿透" 隐含需要 STUN，但没指定哪个 server。`decisions/webrtc-over-noise-tcp.md` 未列 ICE server。`rendezvous-server-config.md` 的 config 没有 STUN 字段。Google STUN 是行业默认但我选了它相当于引入了一个外部依赖和 privacy 问题（Google 能看到 IP 映射） |
| **I-3**  | DataChannel 协商模式                   | non-negotiated (发起方创建，接收方 ondatachannel)                                             | **medium**        | protocol.md Appendix C 只给了 label/ordered/reliable 属性，未提 negotiated。两种模式（negotiated vs non-negotiated）都是 WebRTC 标准。我选 non-negotiated 是因为它更简单，但如果有多个并发连接，两个 peer 同时创建 channel 可能有竞态。用 offer/answer 角色可以消解这个竞态                                        |
| **I-4**  | 版本协商失败后行为                     | major mismatch → close channel；minor mismatch → proceed with capabilities negotiation        | **low**           | protocol.md §5 定义了 `room:hello{version: "0.1.0"}` 但没有定义 version 不匹配时的行为。我假设 semver 风格的 major/minor 策略。但如果版本是 monolithic 的（像 protocol.md 的 "v0.1"），那任何差异都是 breaking。telos 没有明确答案                                                                                 |
| **I-5**  | bufferedAmount 流控阈值                | bufferedAmountLowThreshold = 1 MiB (16 chunks)；背压超时 5s                                   | **low**           | `facts/webrtc-datachannel-limits.md` 描述了 bufferedAmount 机制但未给数字。1 MiB 是我凭经验的合理值，但不是从 telos 推出的。5s 背压超时更是我拍的                                                                                                                                                                  |
| **I-6**  | M3 CLI 是否绕过 daemon                 | 是 — 沿袭 M2 模式                                                                             | **medium**        | `decisions/m2-cli-bypasses-daemon.md` 的 Boundaries 说 "M3 CLI 通信路径不在本 decision 范围内"。`BACKLOG.md` 的 U-1 项名 "M3 CLI 绕过 daemon 的 P2P 接入路径" 强烈暗示 bypass。但我不能确定这是已经决定 bypass 还是还需要 sediment。我推测是 bypass                                                                |
| **I-7**  | PeerConnection 关闭逻辑 + idle timeout | 发送完成等 5s；idle 300s 后 ping → 10s 无 pong → 关闭                                         | **low**           | telos 完全沉默。`decisions/disconnect-immediate-offline.md` 是关于 WS 的，不是 P2P 的。`protocol.md` 有 `room:ping/pong` 但没有规定何时发。300s 是我从 keepalive 常识取的                                                                                                                                          |
| **I-8**  | DataChannel 断开后行为                 | 同 PC 内重开 DataChannel + 文件从头重传；PC failed → 放弃                                     | **medium**        | `facts/webrtc-datachannel-limits.md` §"续传" 说 "第一版不做。失败重传整个文件" 暗示不 resume。但 "同 PC 内重开 DataChannel" vs "完全重建 PeerConnection" 的分界线是 I 推的                                                                                                                                         |
| **I-9**  | npm 包名和 API 结构                    | `packages/p2p` + `PeerConnectionManager` / `FileSender` / `FileReceiver`                      | **low**           | telos 不提 M3 的包结构。从现有 `packages/{protocol,core,rendezvous,cli}` 模式我推断新增 `packages/p2p`。API surface 全是 I 推断的                                                                                                                                                                                  |
| **I-10** | `room:file_chunk` 的终止检测           | 两种方式同时使用：file offer 中的 `size` 字段 + `room:file_done` 显式信号                     | **medium**        | protocol.md §5 有 `room:file_chunk{seq_num, data}` + `room:file_done`。我推断接收方用 `size` 做字节计数（已知总数），同时也等 `room:file_done` 作为显式终止。`cbor_frames.json` 的 room:file_chunk vector 没有 ts 字段，暗示 chunk 不携带时间戳，终止只能靠计数或显式 done                                         |
| **I-11** | room_id 计算时机                       | 发送方在 P2P 连接建立前计算（用自己和目标的 peer_id bytes 做 `SHA-256(min,max)`）             | **high (但隐含)** | `decisions/deterministic-1to1-room-id.md` + `protocol.md` §8 规定了算法，但没有明确 P2P 层何时调用。我推断在 `PeerConnectionManager.connect(peerId)` 时计算。几乎确定                                                                                                                                              |
| **I-12** | `room:file_accept` 是否有 seq          | 否 — `room:file_accept` / `room:file_reject` 没有 `seq` 字段（protocol.md §5 表格中不带 seq） | **medium**        | protocol.md §5 的 `room:file_accept` / `room:file_reject` 表没有 `seq` 字段。但这与 `decisions/per-sender-seq-numbering.md` "所有 room:\* 消息类型共享同一 seq 空间" 矛盾 — 如果 accept 没有 seq，那它在 transcript 中怎么排序？这可能是协议设计上的 oversight 而非 M3 需要解决的                                  |

---

## §4 telos 没明说的工程决定

以下是我在闭卷设计过程中做的、telos 没有提供明确指导的工程决定。每一项都是 telos 覆盖盲区候选。

| #        | 决定                                                                             | 简述                                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **D-1**  | 默认 STUN server = stun.l.google.com:19302                                       | 没有 telos 规定 STUN URL，但 WebRTC 没有 STUN 几乎等于不能跨 NAT。选 Google 是因为它是行业常态，但这引入了对 Google 基础设施的外部依赖和 privacy 考虑                                                        |
| **D-2**  | SDP offer → answer 信令超时 = 30s                                                | 没有 telos 规定 P2P 信令超时。30s 是合理值 (WebRTC 自己的 ICE 超时类似)。需要 CLI flag `--timeout` 覆盖                                                                                                      |
| **D-3**  | DataChannel open 超时 = 30s                                                      | 同 D-2。如果对端 30s 内没有打开 DataChannel，放弃                                                                                                                                                            |
| **D-4**  | PeerConnection connectionState→failed 不重连                                     | 没有 telos 规定 P2P 重连策略。我选"完全放弃"而非重连，因为文件传输重连 + resume 的复杂度超出了 M3 scope（与 "第一版不做续传" 约束一致）                                                                      |
| **D-5**  | Idle timeout = 300s, ping interval = 300s, pong timeout = 10s                    | `room:ping` / `room:pong` 消息类型存在但 telos 未规定何时使用。我推断协议定义了消息但没有规定调度策略 — 这些参数是 M3 实现者必须填的空白                                                                     |
| **D-6**  | `room:file_accept` / `room:file_reject` 不带 seq                                 | 我保持 protocol.md §5 的定义不变（表里没有 seq 字段），但与 `per-sender-seq-numbering.md` "所有 room:\* 共享 seq" 冲突。这是矛盾 — 我不知道哪个是正确的                                                      |
| **D-7**  | 文件上传进度由 FileSender.onProgress event emitter 报告                          | telos 没有定义进度报告机制。CLI 需要显示进度（"120/500 MiB transferred"），所以我需要 event emitter 在 chunk 发送/接收时触发                                                                                 |
| **D-8**  | bulk channel 创建失败不会 abort — 退化为纯消息连接                               | telos 沉默。我选不中断连接因为聊天消息仍然可以正常工作                                                                                                                                                       |
| **D-9**  | `recv` 是阻塞命令行 (带 --timeout)，不是 daemon                                  | telos 暗示 daemon 在 M4，所以 M3 需要 CLI recv 作为前台监听。没有 telos 明确说 M3 CLI recv 的模式                                                                                                            |
| **D-10** | chunks 没有 application-level 重传或 ACK                                         | 我默认 SCTP 可靠传输保证 chunk 按序到达。如果 seq_num 跳号 → 直接 abort，不重传。这在 `facts/webrtc-datachannel-limits.md` 中有呼应（"第一版不做续传"），但 chunk 级的 gap 处理是另一个维度                  |
| **D-11** | ICE candidates 按 trickle ICE 发送                                               | protocol.md §3 没有提 trickle ICE vs vanilla ICE。我选 trickle (每个 candidate 就绪即发) 因为这是现代 WebRTC 标准做法，且可以减少信令延迟                                                                    |
| **D-12** | `known_peers.toml` 的 `trust: "tofu"` 在 P2P 连接时允许但 CLI 发出警告           | `facts/known-peers-toml-schema.md` 定义了 `trust: "tofu"`，`decisions/manual-fingerprint-confirmation-on-accept.md` 说 fingerprint 在 accept 时必须手动确认。但 M3 P2P 连接时对已有 tofu peer 的行为没有规定 |
| **D-13** | 两个 package exports: `packages/p2p` (Node.js API) + `packages/cli` (三个新命令) | telos 不提 M3 的包结构。从现有 monorepo 布局我推断独立 p2p 包，但这也可能是 core 的子模块                                                                                                                    |
| **D-14** | send/send-text 完成后默认关闭连接（非持久）                                      | telos 未明说 M3 的连接语义（持久性）。M2 的 rendezvous 连接是持久的（长连），但 PeerConnection 是否持久是独立的。我选 send → close 因为 M3 是文件传输 milestone，不是 chat daemon                            |

---

## §5 telos 内部歧义/矛盾

| #       | 矛盾                                                                                               | 详情                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C-1** | `room:file_accept` / `room:file_reject` 缺少 `seq` vs `per-sender-seq-numbering.md`                | `decisions/per-sender-seq-numbering.md` 明确说："`room:msg`、`room:file_offer`、`room:system` 等**所有** `room:*` 消息类型共享同一个 seq 空间"。但 `docs/protocol.md` §5 的 `room:file_accept` 和 `room:file_reject` 字段表没有 `seq` 字段。如果 accept/reject 不参与 seq numbering，它们在 transcript 中如何排序？或它们被认为不需要 seq（单向协议：sender 发 offer + chunks，receiver 只发一次 accept/reject，不需要排序）？                                                               |
| **C-2** | `room:file_chunk` 没有 `ts` 字段 但 `decisions/transcript-jsonl-per-room.md` 暗示所有消息都有 `ts` | `cbor_frames.json` 的 `room:file_chunk` vector 不包含 `ts`（CBOR key 99）。protocol.md §5 的 file_chunk 表也没有 ts。但 transcript.jsonl 的示例全部带 ts。chunk 是 bulk channel 上的，可能有意略去 ts 以节省带宽（bulk channel 上千个 chunk，每个加 8-byte timestamp 是明显 waste）—但这与"transcript 包含所有 frame 完整数据"一致吗？                                                                                                                                                       |
| **C-3** | `BACKLOG.md` 的 U-7 (`facts/p2p-signal-payload-format.md`) vs 我已经从 protocol.md §3 推断出的格式 | BACKLOG 说"U-7: `facts/p2p-signal-payload-format.md` — signal.payload 内容 JSON sub-envelope" 是一个 block-M3-start 项。但 protocol.md §3 步骤 3 已经给出了 `{ subtype, sdp, fingerprint, signature, peer_id, timestamp, nonce }` 格式 — 很详细。U-7 的 fact 是什么，超出了 protocol.md 已有内容？可能是 ICE candidate subtype 没有在 proto.md 中覆盖？或者需要规范所有 3 种 subtype 的完整字段集合。从 telos 我给不出来 — 我只能推断                                                        |
| **C-4** | M3 CLI 与 daemon 的关系被 BACKLOG 标记为 U-1 但未有决策文件                                        | `BACKLOG.md` 的 U-1 文件名是 `decisions/m3-cli-p2p-bypass-daemon.md`，表明需要一个 M3 CLI bypass daemon 的单独 decision。但当前这个文件不存在（在 BLOCK-M3-START 勾选框中，未勾选）。`decisions/m2-cli-bypasses-daemon.md` 明确说其 M3 范围未定。我推断 M3 bypasses daemon，但如果 daemon 在 M3 里提前启动（至少 minimal daemon），CLI 经 daemon 走 IPC 也是一种可能路径。telos 在此点上有意地未沉积                                                                                         |
| **C-5** | 500 MiB 文件上限的来源不一致                                                                       | `facts/webrtc-datachannel-limits.md` §"对 peer-bridge 的影响" 第 4 项说 "500 MiB 文件上限（可配置）：合理上限，约 8000 个 chunk"。但 `facts/inbox-directory-structure.md` 也说 "单个文件 ≤500 MiB（可配置）"。两者一致（都好），但 8000 ≈ 500×1024²/65536 = 8000 exactly — 这是 back-of-napkin 计算，暗示这个限制是人为选的，不是从 SCTP/W3C/协议约束推导的。实际有没有任何协议层限制 500 MiB？SCTP 没有。所以 500 MiB 是 aesthetic choice，但作为 fact 呈现时可能会被误读为 hard constraint |

---

## §6 提交清单

**应为空**（blind 本身不产生文件修改）。

```
（如果 git status --short 非空，说明违反了 ZERO-EDIT 约束。
 报告生成 m3-blind-design.md 是本次调用的输出文件，不应提交到 repo。
 如果已写入，请确认它是唯一的 untracked 文件。）
```

---

_Report generated by agent-blind check per `decisions/agent-blind-check-protocol.md`._
_51 whitelist files read. Zero blacklist reads. 14 engineering decisions identified. 5 telos inconsistencies noted._
