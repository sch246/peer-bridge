# M2 Agent-Blind Design: RendezvousClient Behavior Contract

> **Experiment**: 闭卷设计实验 — 仅基于 `.telos/` + `docs/protocol.md` + `test-vectors/` 白名单内容，独立设计 `packages/core` 中 rendezvous client 的完整行为契约。
> **Date**: 2026-05-30

---

## §1 实际读取的文件清单

以下为本次实验实际读取的全部文件（绝对路径），均在白名单内：

| #   | 路径                                                                        |
| --- | --------------------------------------------------------------------------- |
| 1   | `E:\peer-bridge\.telos\README.md`                                           |
| 2   | `E:\peer-bridge\.telos\BACKLOG.md`                                          |
| 3   | `E:\peer-bridge\docs\protocol.md`                                           |
| 4   | `E:\peer-bridge\.telos\facts\signaling-client-fsm.md`                       |
| 5   | `E:\peer-bridge\.telos\facts\signaling-message-fields.md`                   |
| 6   | `E:\peer-bridge\.telos\facts\rendezvous-server-config.md`                   |
| 7   | `E:\peer-bridge\.telos\facts\rendezvous-tech-stack.md`                      |
| 8   | `E:\peer-bridge\.telos\facts\rendezvous-health-endpoint.md`                 |
| 9   | `E:\peer-bridge\.telos\facts\nacl-sealed-box-properties.md`                 |
| 10  | `E:\peer-bridge\.telos\decisions\reconnect-requires-reregister.md`          |
| 11  | `E:\peer-bridge\.telos\decisions\disconnect-immediate-offline.md`           |
| 12  | `E:\peer-bridge\.telos\decisions\signaling-fifo-no-request-id.md`           |
| 13  | `E:\peer-bridge\.telos\decisions\signaling-client-fifo-queue-wait.md`       |
| 14  | `E:\peer-bridge\.telos\decisions\invite-create-no-cross-reconnect-state.md` |
| 15  | `E:\peer-bridge\.telos\decisions\m2-notification-queue-unbounded.md`        |
| 16  | `E:\peer-bridge\.telos\decisions\m2-rate-limit-invite-create-only.md`       |
| 17  | `E:\peer-bridge\.telos\decisions\m2-cli-bypasses-daemon.md`                 |
| 18  | `E:\peer-bridge\.telos\decisions\sealed-box-for-offline-notify.md`          |
| 19  | `E:\peer-bridge\.telos\audit-trails\m2-exit-investigation-2026-05-30.md`    |
| 20  | `E:\peer-bridge\packages\protocol\test-vectors\sealed_box.json`             |
| 21  | `E:\peer-bridge\packages\protocol\test-vectors\fingerprint_sig.json`        |
| 22  | `E:\peer-bridge\packages\protocol\test-vectors\invite.json`                 |
| 23  | `E:\peer-bridge\packages\protocol\test-vectors\peer_id.json`                |

**黑名单检查**: 未读取 DESIGN.md、README.md、任何 `packages/` 源码或测试文件、未执行 `git log` 或任何 git 命令。✅

---

## §2 设计：RendezvousClient 完整行为契约

---

### 2.1 Connection Lifecycle States — 全状态机

RendezvousClient 暴露一个 **5 状态有限状态机**（来源: `facts/signaling-client-fsm.md`）。状态是公开契约，下游代码依赖精确的状态名和转移语义。

#### States

| 状态             | 含义                                                      |
| ---------------- | --------------------------------------------------------- |
| `'disconnected'` | 无连接。初始状态，也是显式 `disconnect()` 后的终态        |
| `'connecting'`   | WebSocket 正在打开，TCP+TLS 握手进行中                    |
| `'registering'`  | WebSocket 已打开，`register` 帧已发出，等待 `register_ok` |
| `'ready'`        | 完全连接且已注册。可以收发信令消息                        |
| `'reconnecting'` | 从 `'ready'` 状态非自愿断开。退避计时器运行中             |

#### 正常连接路径（用户主动）

```
disconnected → connecting → registering → ready
```

每一步的触发条件：

- `disconnected → connecting`: 用户调用 `connect()`，client 开始 `new WebSocket(url)`
- `connecting → registering`: WebSocket `onopen` 事件触发，client 发送 `register` 帧（带 `sig` + `ts` 签名的完整认证 JSON）
- `registering → ready`: 收到 server 的 `register_ok` 响应。注意：在 `register_ok` 之前可能收到 0 或多个 `notify_in`（server 推送的离线队列 — 见 §2.4）

#### 非自愿断开路径（从 ready）

```
ready → reconnecting → connecting → registering → ready
```

或者，如果达到最大重试次数：

```
reconnecting → disconnected
```

触发 `ready → reconnecting` 的条件：WebSocket 非自愿关闭（close code 不是 1000 且不是 client 主动调用 `disconnect()`）。

退避计时器到期后自动推进 `reconnecting → connecting`。

#### 显式断开（用户主动）

```
ready → disconnected
connecting → disconnected
registering → disconnected
reconnecting → disconnected
```

`disconnect()` 总是终止到 `'disconnected'`，**取消所有 pending 退避计时器**。

#### 提前关闭（到达 ready 前）

从 `'connecting'` 或 `'registering'` 状态的关闭**不在 FSM contract 覆盖范围内**（来源: `signaling-client-fsm.md` Boundaries 段）。Client 可以立即重试 connect 或直接失败，取决于错误类型。

#### Observable Events

Client 是 EventEmitter，caller 可以通过以下事件观察 FSM：

| 事件                 | Payload                              | 何时触发                                  |
| -------------------- | ------------------------------------ | ----------------------------------------- |
| `'state_change'`     | `(newState, oldState)`               | 每次状态转移，包括重连周期                |
| `'reconnect'`        | `(attempt: number, delayMs: number)` | 退避计时器被调度时                        |
| `'reconnect_failed'` | `(attempts: number)`                 | 达到最大重试次数，终止到 `'disconnected'` |

#### Backoff Schedule（退避时间表）

| 尝试次数 | 延迟  |
| -------- | ----- |
| 1        | 1 秒  |
| 2        | 2 秒  |
| 3        | 4 秒  |
| 4        | 8 秒  |
| 5        | 16 秒 |
| 6        | 32 秒 |

公式：`delay = baseDelayMs * 2^(attempt - 1)`。默认 `baseDelayMs = 1000`, `maxAttempts = 6`，总最大等待 ~63s。

可通过 `ReconnectOptions { baseDelayMs, maxAttempts }` 配置，允许测试缩放和环境调优。

---

### 2.2 Register Handshake — 注册流程

注册是 client 与 rendezvous server 建立认证会话的唯一途径。每次连接（包括 reconnect）都必须经过完整注册。

#### 消息序列

```
Client                                Server
  │                                      │
  │  WebSocket open                      │
  │ ───────────────────────────────────> │
  │                                      │
  │  register {                          │
  │    type: "register",                 │
  │    payload: {                        │
  │      peer_id: "PB-...",             │
  │      capabilities: { webrtc, ... }  │
  │    },                                │
  │    sig: "<base64-ed25519>",          │
  │    ts: "<ISO8601>"                   │
  │  }                                   │
  │ ───────────────────────────────────> │
  │                                      │
  │  [可能的 notify_in 推送]              │
  │ <─────────────────────────────────── │
  │                                      │
  │  register_ok {                       │
  │    type: "register_ok",              │
  │    server_id: "ed25519:...",         │
  │    federation_size: 0                │
  │  }                                   │
  │ <─────────────────────────────────── │
```

#### 认证细节

- **签名算法**（来源: `protocol.md` §1 认证）:

  ```
  sig = Ed25519_sign(
    client_longterm_sk,
    SHA-256(JSON(payload_bytes) || ts)
  )
  ```

  其中 `payload_bytes` 是 `JSON.stringify(payload)` 的 UTF-8 字节，`||` 是字节拼接。

- `payload` 必须是 **稳定的 JSON 序列化**（key 排序一致），否则签名不匹配。

#### 关键时序约束

- `notify_in` 可以在 `register_ok` **之前**到达（来源: `signaling-message-fields.md` "notify_in-before-register_ok"）：

  > server MAY 在 `register_ok` 之前推送 0 或多个 `notify_in`（offline 队列中积压的 sealed-box 消息）。client 必须能处理 `notify_in` 在 `register_ok` 之前到达的情况。

  理由：保证离线消息在 client 假设"已注册"之前送达，避免 client 在 register_ok 后立即断开导致消息丢失。

- 此排序规则在**每次 register 时生效**，包括 reconnect 触发的 re-registration。每次 reconnect cycle 是独立的 `register` → `notify_in`（如有）→ `register_ok` 序列。

#### 错误处理

注册失败的 server 响应形式（来源: `signaling-message-fields.md` §Error transport）：

| 失败场景                  | Server 行为        | Client 看到               |
| ------------------------- | ------------------ | ------------------------- |
| Server 满 (`max_peers`)   | WS close code 1013 | WebSocket 关闭，code=1013 |
| 签名无效 / peer_id 格式错 | WS close code 1008 | WebSocket 关闭，code=1008 |
| 通用错误                  | WS close code 1011 | WebSocket 关闭，code=1011 |
| Rate limited              | WS close code 1013 | WebSocket 关闭，code=1013 |

**没有** `register_error` JSON payload。注册失败只通过 **WebSocket close code** 表达（来源: `signaling-message-fields.md` agent-blind 错误字段注释）。

#### `notify_in`-before-`register_ok` 的 client 处理

Client 在 `'registering'` 状态期间对收到的每条 WS 消息检查 `type`：

- `type === 'notify_in'` → 立即 emit `'notify_in'` 事件给 caller，不干扰当前 pending 的 register 请求
- `type === 'register_ok'` → resolve register promise，推进到 `'ready'`
- 其他类型 → 忽略或报错（register 是第一个请求，不应有其他响应）

---

### 2.3 Request Methods — lookup, invite_create, invite_redeem

#### Wire-Level 契约: FIFO, No request_id

Client ↔ server JSON 信令是 **at-most-one-in-flight** 模型（来源: `signaling-fifo-no-request-id.md`）。响应通过 **FIFO 顺序 + message type 匹配** 来关联，信令消息中**不存在 `request_id` 字段**。

只允许以下请求-响应对（来源: `signaling-message-fields.md`）：

| 请求类型        | 响应类型        | 说明                                 |
| --------------- | --------------- | ------------------------------------ |
| `register`      | `register_ok`   | 注册请求                             |
| `lookup`        | `lookup_result` | peer 在线查询                        |
| `invite_create` | `invite_result` | 创建邀请码                           |
| `invite_redeem` | `invite_result` | 兑换邀请码（**复用** invite_result） |

`signal` 和 `notify` 是 **fire-and-forget**（来源: `signaling-message-fields.md` 字段验证规则），它们没有对应的 response 且不进入 pending request 链。

#### Client 侧实现: Queue-Wait 语义

Client 对 `lookup()`, `invite_create()`, `invite_redeem()` 实现 **queue-wait** 语义（来源: `signaling-client-fifo-queue-wait.md`）：

- 内部维护单个 `_pendingRequest` 链 + `_fifoQueue` tail Promise
- 当 `_pendingRequest` 已设置且第二个请求方法被调用时，**不会 reject "busy"**，而是 **等待前一个请求 settle** 后再自动发送自己的帧
- Caller 永远看不到 "busy" 错误。第二个调用静默排队，第一个完成后自动继续
- 确保 wire 层始终 at-most-one-in-flight

#### 响应匹配逻辑（伪代码）

```
function _handleMessage(msg):
  switch msg.type:
    case 'register_ok':
      resolve _pendingRequest with { server_id, federation_size }
      advance to next queued request

    case 'lookup_result':
      resolve _pendingRequest with { found, home? }
      advance to next queued request

    case 'invite_result':
      resolve _pendingRequest with { peer_id?, pubkey?, error? }
      advance to next queued request

    case 'signal_in':
      emit 'signal_in' event — 不触动 _pendingRequest

    case 'notify_in':
      emit 'notify_in' event — 不触动 _pendingRequest

    case 'error':
      emit 'error' event 或 reject _pendingRequest（视是否 pending 而定）
```

关键点：`signal_in` 和 `notify_in` 可以在任意时间到达，**绕过 FIFO pending 链**。Client 通过 `type` 区分 push 消息和请求响应。

#### lookup 行为契约

- **入参**: `peer_id: string`（`"PB-..."` 格式）
- **请求帧**:
  ```json
  { "type": "lookup", "payload": { "peer_id": "PB-..." } }
  ```
  外层附 `sig` + `ts`
- **响应帧**:
  ```json
  { "type": "lookup_result", "found": true, "home": "wss://rdv.example.com" }
  ```
  或 `{ "type": "lookup_result", "found": false }`（无 `home` 字段）
- **错误处理**: server 不会对 lookup 返回错误 JSON。在 M2 中 lookup **无 rate limit**（来源: `m2-rate-limit-invite-create-only.md`），但 server 满或签名失败会以 WS close code 断开。Client 应在 `_pendingRequest` reject 时将 WS close 原因映射为查找失败。

#### invite_create 行为契约

- **入参**:
  - `code_hash: string` — `SHA-256(邀请码).hex()`
  - `pubkey: string` — creator 的 base64 Ed25519 公钥
  - `peer_id: string` — creator 的 Peer ID
  - `expires_at: string` — ISO8601 时间戳
- **请求帧**:
  ```json
  {
    "type": "invite_create",
    "payload": {
      "code_hash": "...",
      "pubkey": "...",
      "peer_id": "PB-...",
      "expires_at": "2025-01-15T10:40:00Z"
    }
  }
  ```
  外层附 `sig` + `ts`
- **成功响应**: `invite_result { peer_id, pubkey }` — server 回显 creator 身份，视为确认
- **错误响应**: `invite_result { error: "invalid_request" }` — 缺少/格式错误 required fields
- **跨重连行为**: 如果 WS 在 invite_create 发出后、invite_result 收到前断开，该 pending 状态 **丢弃**，重连后**不会自动重发**（来源: `invite-create-no-cross-reconnect-state.md`）。Server 端的 `invite_records`（以 `code_hash` 为 key）**存活**于连接断开 — 如果 server 在断开前已处理了该 invite_create，邀请码仍然有效；如果没处理，邀请码从未创建。Caller（CLI）负责在需要时重新发出 invite_create。
- **Server 端创建时校验**: `expires_at <= now` 的邀请码 server 端拒绝（不存储）。Client 应在本地前置校验。

#### invite_redeem 行为契约

- **入参**: `code_hash: string` — 邀请码的 SHA-256 hex
- **请求帧**:
  ```json
  { "type": "invite_redeem", "payload": { "code_hash": "..." } }
  ```
  外层附 `sig` + `ts`
- **成功响应**: `invite_result { peer_id, pubkey }` — inviter 的身份
- **错误响应**: `invite_result { error: "not_found" }` — code_hash 未知/过期/已 consumed
  > 注意（来源: `signaling-message-fields.md` §invite_result.error 取值）: `"expired"` 和 `"already_redeemed"` 在 M2 server 中 collapse 为 `"not_found"`。Client **不应**假设能区分这三个子原因。
- **Server 端行为**: redeem 成功后 `invite_records` 条目被删除（一次性使用）。

#### FSM 门控

Request 方法只能在特定状态下调用（来源: `signaling-client-fifo-queue-wait.md` Boundaries）：

- `'disconnected'` 状态调用 → 拒绝（返回 rejected Promise 或抛出）
- `'reconnecting'` 状态调用 → 拒绝
- `'connecting'` 或 `'registering'` 状态调用 → 允许排队（但响应只在 `'ready'` 后才能到达，因为 server 在注册前不会处理其他请求）
- `'ready'` 状态调用 → 正常排队（可能立即执行或等待前面的 request settle）

---

### 2.4 Push Notifications — signal_in, notify_in

#### signal_in

Server 主动推送给 client 的加密信令消息。

- **消息格式**（来源: `protocol.md` §1 signal → signal_in）:
  ```json
  { "type": "signal_in", "from": "PB-...", "payload": "<encrypted-signal-data>" }
  ```
- **到达时机**: 任意时间（只要 WebSocket 已打开且已注册）。在 `'registering'` 和 `'ready'` 状态期间都可能到达。
- **关联**: `signal_in.from` 是发送方 peer_id。`signal_in.payload` 是加密的 WebRTC SDP offer/answer 等信令数据。Client 不解密该 payload — 透传给上层。
- **无 ack 机制**: `signal_in` 是 server 到 client 的 fire-and-forget 推送。Client **不需要**向 server 发送确认。如果 client 在 `signal_in` 到达后恰好断开，该消息丢失，sender 需要自行重试（来源: `signaling-message-fields.md` fire-and-forget 注释）。

#### notify_in

Server 推送的离线通知（sealed-box 加密）。

- **消息格式**（来源: `protocol.md` §1 notify → notify_in）:
  ```json
  {
    "type": "notify_in",
    "sealed_box": "<base64-encrypted>",
    "queued_at": "2025-01-15T10:35:00Z"
  }
  ```
- **到达时机**:
  - 在 `'registering'` 状态期间 — 在 `register_ok` **之前**到达（来源: `signaling-message-fields.md` §notify_in-before-register_ok）
  - 在 `'ready'` 状态期间 — 在线通知到达时
- **关联**: `notify_in` 不携带 `from` 字段在明文层。发送方身份在 sealed box 密文内部（`sender_peer_id`）。Client 不解密 sealed box — 透传给上层。
- **`queued_at`**: server 接收该通知时的时间戳，用于 TTL 判断。Client 可用于日志/排序，但不做准入判断。
- **无 ack 机制**: 同 signal_in。

#### 顺序保证

- **signal_in 与 notify_in 之间**: 无顺序保证。两者是独立的 server 推送流。
- **signal_in 内**: WebSocket 本身是 FIFO channel，所以同一连接上 `signal_in` 消息按 server 发送顺序到达。
- **notify_in 内**: 同理，同一连接上的 `notify_in` 按 server 的 `offline_notifications` 队列顺序到达（即插入顺序）。
- **push 与 response 之间**: `signal_in` / `notify_in` **可以在** pending request 的 response 之前或之后插入。Client 通过 `type` 区分，不混淆。

---

### 2.5 Reconnection — 重连策略

#### 触发条件

重连在从 `'ready'` 状态**非自愿断开**时触发（来源: `signaling-client-fsm.md` Transitions）。区分：

- 非自愿断开 → `ready → reconnecting`（触发重连）
- 用户调用 `disconnect()` → `* → disconnected`（不重连）

#### 重连序列

每次重连是**全新会话**（来源: `reconnect-requires-reregister.md`）：

```
1. reconnecting (退避计时器运行)
      ↓ timer fires
2. connecting (new WebSocket, TCP+TLS)
      ↓ WS onopen
3. registering (send register 帧, fresh sig+ts)
      ↓ receive register_ok
4. ready (恢复正常)
```

**Server 不保留任何跨连接会话状态**。Client 必须为每个新 WS 连接发送完整 `register` 消息（含新签名和当前时间戳）。

#### 重连期间发生的事

- Pending request 被 reject（见 §2.6）
- 退避计时器运行期间，新请求调用被拒绝（或排队，取决于 FSM 门控策略）
- `'reconnect'` 事件在每次退避被调度时 emit

#### 配置

通过 `ReconnectOptions` 配置:

```
interface ReconnectOptions {
  baseDelayMs: number   // 默认 1000
  maxAttempts: number   // 默认 6
}
```

退避公式: `delay = baseDelayMs * 2^(attempt - 1)`。总最大等待 ~63s。

显式 `disconnect()` 取消 pending 退避计时器并重置 `maxAttempts` 计数器。

---

### 2.6 Pending State on Disconnect — 未完成请求的处理

#### Pending invite_create

从 `invite-create-no-cross-reconnect-state.md`:

- WS 断开时有 pending `invite_create` → **丢弃** pending 状态。重连后**不自动重发**。
- 如果 server 在断开前已处理 `invite_create`，邀请码已有效（`invite_records` 以 `code_hash` 为 key，不绑定 inviter 连接）。Inviter 只是没收到确认。
- 如果 server 没处理，邀请码从未创建。
- Caller（CLI）负责在需要时重新发起 `invite_create`。

#### 其他 Pending 请求 (lookup, invite_redeem)

从 D2 的 at-most-one-in-flight 模型推导：

- 断开发生时 `_pendingRequest` 被 reject，携带一个连接错误（如 `Error("Connection closed")`）
- Caller 的 Promise 被 reject，caller 可以决定是否重试
- 重连后这些请求**不自动重发**（没有跨重连的请求缓冲）

#### 已收到但未消费的推送 (signal_in, notify_in)

- `signal_in` 和 `notify_in` 没有 ack 机制。一旦 server 发送且 client 的 WebSocket 层接收，client 通过 emit 事件交付给 caller
- 如果 WebSocket 在 `signal_in` 到达后、caller 处理前断开：该 `signal_in` 已通过事件 emit 给 caller（同步），caller 有责任处理。如果 caller 的事件处理器是异步的且尚未完成，caller 自行管理
- **重连后不会重放** `signal_in` — server 不知道 client 是否已处理（无 ack），且 server 不缓存 `signal`（只有 `notify` 缓存于 `offline_notifications`）
- `notify_in` 在 `offline_notifications` 中排队，重连后的 `register` 会触发 server 重新推送它们（懒 TTL 清理）。所以 `notify_in` 有**隐式重试** —— 只要 peer 重新 register，未被之前的连接消费的 `notify_in` 会再次送达
- 但如果在 `register_ok` 前 client 再次断开，server 端的 `offline_notifications` 仍然存活，下次 register 时会再次送达

---

### 2.7 Error Handling — 错误表达与分类

Rendezvous server 通过**三个渠道**向 client 表达错误（来源: `signaling-message-fields.md` §Error transport）。Client 必须正确处理所有三个渠道：

#### Channel A — `invite_result.error` 字段

在 `invite_result` JSON 中作为 string 字段出现。

| 错误值              | 含义                                          | Client 处理                                                |
| ------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| `"not_found"`       | 邀请码未知/过期/已消费                        | 返回给 caller 作为失败结果（Promise reject 或 error 字段） |
| `"invalid_request"` | `invite_create` 缺少/格式错误 required fields | 返回给 caller（通常是编程错误，不重试）                    |

**当前 M2 行为**: `"expired"` 和 `"already_redeemed"` collapse 为 `"not_found"`（来源: `signaling-message-fields.md` §invite_result.error 取值）。Client 无需区分它们。

#### Channel B — WebSocket close codes

连接级致命错误，通过 WebSocket `close` 事件表达。

| Code   | 含义                                            | Fatal?           | Client 行为                                     |
| ------ | ----------------------------------------------- | ---------------- | ----------------------------------------------- |
| `1000` | 正常关闭                                        | 是（用户主动）   | 不重连。状态 → `'disconnected'`                 |
| `1008` | Policy violation（无效 JSON、签名失败、未注册） | **推断: 致命**   | → `'disconnected'`（不重连 — 重试也不会变有效） |
| `1011` | Server error（内部错误）                        | **推断: 可重试** | → `'reconnecting'`（退避重试）                  |
| `1013` | Too large / overload (server 满, rate limited)  | **推断: 可重试** | → `'reconnecting'`（退避重试）                  |
| `1006` | 异常关闭（网络中断、server 崩溃）               | **推断: 可重试** | → `'reconnecting'`                              |

注: 以上 close code → fatal/retryable 映射在 §4 中详细讨论 — telos 未明确给出此映射。

#### Channel C — HTTP errors（联邦端点）

M2 阶段 server 的 federation 端点返回 HTTP `501 { error: "..." }`。Client **不需要处理**这些 — HTTP 501 端点不在 M2 client-facing 路径上。

#### Channel D — `{type: "error", code, message}`（forward-compat 预留）

Client **已有** handler 处理 `{type: "error", code, message}` WS 消息（来源: `signaling-message-fields.md` §Channel D），**但 M2 server 不发射此 shape**。这是 forward-compat 预留。

Client 应在收到此消息时：

- 如果当前有 pending request → reject pending request with 该 error
- 如果没有 pending request → emit `'error'` 事件

#### Pending request 错误传播

当 WS 在请求 pending 期间关闭：

1. `_pendingRequest` Promise 被 reject，error 包含 WS close code 和 reason
2. Caller 收到 rejection
3. 如果 close 触发 reconnect，client 自动重建连接，但 **不重试** 已 rejected 的请求

---

### 2.8 Public API Surface — 上层接口

RendezvousClient 是 **EventEmitter** + **Promise-returning methods** 的混合 API。它同时被 CLI（M2 直接使用）和 daemon（M4）消费（来源: `m2-cli-bypasses-daemon.md`）。

#### 构造

```
constructor(options: {
  url: string;              // wss://rdv.example.com
  identity: {               // peer 的长期 Ed25519 密钥对
    peerId: string;         // "PB-..."
    publicKey: Uint8Array;  // 32 bytes
    secretKey: Uint8Array;  // 64 bytes (seed + pubkey)
  };
  capabilities: {           // 能力声明
    webrtc: boolean;
    bulk_transfer: boolean;
    version: string;        // "0.1.0"
  };
  reconnect?: ReconnectOptions;  // { baseDelayMs, maxAttempts }
})
```

#### 连接生命周期方法

```
connect(): Promise<void>
```

- 开始 WS 连接。返回 Promise，在到达 `'ready'` 状态时 resolve
- 如果连接失败（包括重连耗尽），Promise reject
- 幂等: 如果已在 `'connected'` 或更高状态，resolve 立即

```
disconnect(): void
```

- 关闭 WS（code 1000），终止所有 pending 操作
- 取消 pending 退避计时器
- 状态立即到 `'disconnected'`
- 同步返回，不阻塞

#### 请求方法（返回 Promise）

```
lookup(peerId: string): Promise<LookupResult>
```

- `LookupResult = { found: boolean; home?: string }`
- `home` 仅在 `found: true` 时存在
- 实现 queue-wait 语义

```
inviteCreate(params: {
  codeHash: string;
  pubkey: string;
  peerId: string;
  expiresAt: string;
}): Promise<InviteResult>
```

- `InviteResult = { peer_id: string; pubkey: string }`
- 错误时 Promise reject 或返回 `{ error: string }`（取决于 API 设计选择 — 见 §4）

```
inviteRedeem(codeHash: string): Promise<InviteResult>
```

- 同上

#### Fire-and-Forget 方法

```
signal(to: string, payload: string): void
```

- 发送 `signal` 帧。不返回 Promise（无响应）
- 如果不在 `'ready'` 状态 → 抛出或静默忽略（取决于 API 设计选择 — 见 §4）

```
notify(to: string, sealedBox: string): void
```

- 发送 `notify` 帧。不返回 Promise（无响应）
- `sealedBox` 必须 ≤ 1024 bytes (base64 编码前 ≤ 1024 原始字节)
- 如果不在 `'ready'` 状态 → 抛出或静默忽略

#### 事件

Client 继承 EventEmitter 并 emit 以下事件：

| 事件                 | 参数                                               | 含义                                                                  |
| -------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| `'state_change'`     | `(newState: string, oldState: string)`             | FSM 状态转移                                                          |
| `'reconnect'`        | `(attempt: number, delayMs: number)`               | 退避计时器调度                                                        |
| `'reconnect_failed'` | `(attempts: number)`                               | 重连耗尽                                                              |
| `'signal_in'`        | `(msg: { from: string; payload: string })`         | 收到 signal_in                                                        |
| `'notify_in'`        | `(msg: { sealed_box: string; queued_at: string })` | 收到 notify_in                                                        |
| `'error'`            | `(err: Error)`                                     | 非致命错误（如收到 unknown message type、{type:"error"} envelope 等） |

#### 状态查询

```
readonly state: string
```

- 当前 FSM 状态的 getter。可能值: `'disconnected' | 'connecting' | 'registering' | 'ready' | 'reconnecting'`

#### 使用示例（伪代码，展示调用模式）

```
const client = new RendezvousClient({
  url: 'wss://rdv.example.com',
  identity: { peerId, publicKey, secretKey },
  capabilities: { webrtc: true, bulk_transfer: true, version: '0.1.0' },
  reconnect: { baseDelayMs: 1000, maxAttempts: 6 }
});

client.on('state_change', (newState, oldState) => {
  console.log(`${oldState} → ${newState}`);
});

client.on('signal_in', (msg) => {
  // 处理 WebRTC SDP 信令
  handleWebRTCSignal(msg.from, msg.payload);
});

client.on('notify_in', (msg) => {
  // 解密 sealed box，提取 sender_peer_id、room_id 等
  handleOfflineNotify(msg.sealed_box);
});

await client.connect();  // 等待 'ready'

const result = await client.lookup('PB-BOB-...');
if (result.found) {
  client.signal('PB-BOB-...', encryptedSDP);
}

client.disconnect();  // 同步返回，立即断开
```

---

## §3 在白名单内找不到答案、靠推断填的空

以下每一项标注了推断方向和理由。这些是 BACKLOG 候选。

### I-1: WebSocket close code → fatal vs retryable 分类

**telos 说了什么**: `signaling-client-fsm.md` 说 "involuntary close from 'ready'" 触发 reconnect，但**没有定义哪些 close code 是 "involuntary"**。`signaling-message-fields.md` §Error transport 枚举了 server 发射的 close code（1008/1011/1013/1000）以及触发条件，但**没有标注 client 应如何响应每个 code**。

**推断**:

- `1000` → fatal（正常关闭 = 用户主动或 server 主动拒绝）
- `1008` → fatal（Policy violation：签名失败、格式错。重试不会改变结果）
- `1011` → retryable（Server error：可能是瞬态，退避后重试）
- `1013` → retryable（Server full / rate limited：资源约束通常是暂时的）
- `1006` → retryable（异常关闭：网络中断）

**置信度**: 中等。`1011` vs `1008` 的区分基于语义推理 — 签名失败属于 client 身份问题不可能自行恢复，server 崩溃则可能。

### I-2: 请求方法的 Promise 返回类型（resolve vs reject 策略）

**telos 说了什么**: `protocol.md` §1 和 `signaling-message-fields.md` 定义了 `invite_result` 带可选 `error` 字段。但没有指定 client API 是 resolve `{ error: "not_found" }` 还是 reject Promise。

**推断**: 两种方案都合理：

- (a) 始终 resolve Promise，caller 检查 `result.error` — 语义：server 正确处理了请求，返回了结果
- (b) reject Promise when `error` field present — 语义：操作"失败"

我选了 (a) resolve with error field。理由: `invite_result` 始终是 server 的有效响应（不是协议错误），`error` 是业务层结果。类比 HTTP 200 with error body vs 4xx。但 telos 没有给出方向性提示。

**置信度**: 低。纯工程直觉。

### I-3: fire-and-forget 方法在非 ready 状态的行为

**telos 说了什么**: `signaling-client-fifo-queue-wait.md` Boundaries 说 fire-and-forget 方法 bypass FIFO。`signaling-client-fsm.md` Boundaries 说请求不能在 `'disconnected'` 或 `'reconnecting'` 状态发送。但没有明确 fire-and-forget 方法在这些状态下的行为。

**推断**: 在 `'disconnected'` 或 `'reconnecting'` 状态下调用 `signal()` / `notify()` → 静默丢弃（或抛出）。理由：

- fire-and-forget 没有返回 Promise，caller 无法等待
- 离线期间积压 signal frame 没有意义（signal 是实时转发，server 无缓存）
- notify 有 server 端的 `offline_notifications` 队列，但 caller 需要先在线才能发送

**置信度**: 中等。`signal` 明确是 "fire-and-forget" — 在 offline 时丢弃是自然结论。`notify` 有离线缓存但 sender 必须在线发送。

### I-4: signal_in 和 notify_in 的事件名称

**telos 说了什么**: `signaling-client-fsm.md` 定义了 `state_change`、`reconnect`、`reconnect_failed` 三个 event。没有定义 push 消息的事件接口。`protocol.md` 说 signal_in/notify_in 被 server 推送到 client，但没说 client 如何暴露给上层。

**推断**: 命名为 `'signal_in'` 和 `'notify_in'`，直接映射消息 type。payload 与 server 消息字段一一对应。

**置信度**: 高。命名是机械映射（消息 type → 事件名），这是 EventEmitter 风格代码的常见 convention。

### I-5: 连接超时值

**telos 说了什么**: `signaling-client-fsm.md` 给出了 reconnect backoff schedule（1s, 2s, 4s, 8s, 16s, 32s），但这是**重连间隔**，不是**初始连接超时**。没有定义 `connecting` 状态的超时 — WS `new WebSocket(url)` 卡住时多长时间放弃。

**推断**: 使用平台默认值（Node.js WebSocket 的默认 connect timeout 或 HTTP agent timeout）。不在 client 代码中设置显式超时。理由: M2 是 CLI 直连模式（`m2-cli-bypasses-daemon.md`），用户按住 Ctrl+C 即可中断。更精确的超时可以后续添加。

**置信度**: 低。没有 telos 指导。在 M4 daemon 持久连接场景下需要重新审视。

### I-6: register timeout

**telos 说了什么**: 没有定义 `registering` 状态的超时 — client 发送 register 后 server 迟迟不回应（server 过载、网络慢等）时 client 等多久。

**推断**: 30 秒超时。如果 30s 内未收到 `register_ok`（或 `notify_in`），视为连接失败，关闭 WS 并进入 reco

**置信度**: 低。纯工程直觉。30s 是一个常见的"合理等待"值。

### I-7: notify_in 在 reconnecting 期间的处理

**telos 说了什么**: `signaling-message-fields.md` 说 `notify_in` 在 `register_ok` 之前到达。但没说如果在 `'reconnecting'` 状态期间 server 推送了 `notify_in` 怎么办 — 实际上不可能（`'reconnecting'` 状态没有活跃 WS 连接），但概念上 caller 可能在断开时持有未消费的 `notify_in` 引用。

**推断**: `'reconnecting'` 状态没有 WS 连接，所以不会收到新 `notify_in`。之前收到的 `notify_in` 已通过事件 emit 给 caller。重连后 server 会重新推送 `offline_notifications` 中的所有消息（包括之前已推过但 caller 可能未消费的）。Caller 需自行去重（通过 sealed-box 内容中的 nonce + timestamp）。

**置信度**: 高。这是重连模型 + 通知队列模型的直接逻辑结论。

---

## §4 telos 没明说的工程决定（M2 升级条款）

> 对每一个不得不决定但 telos 没提供明确指导的点，描述决定、选择的方案、被排除的替代方案、选择理由。

---

### E-1: WebSocket close code → fatal/retryable 分类策略

**问题**: 当 WS 以 code `1008`（policy violation）关闭时，client 应该 fatal-disconnect 还是退避重连？

**选择的方案**: 分层策略:

- `1000` → fatal（不重连）。理由：正常关闭。
- `1008` → fatal 如果发生在 `'registering'` 阶段（签名被服务器拒绝，重试不会改变签名）；retryable 如果发生在 `'ready'` 阶段后（可能是临时的 server 端 auth 问题）。
  - _简化实现_: M2 中一律按 fatal 处理 `1008`。理由: M2 没有能改变签名的场景（peer identity 在启动时固定），重试无意义。
- `1011` → retryable（server 内部错误，退避后可能恢复）
- `1013` → retryable（server 满 / rate limited，退避后可能恢复）
- `1006` → retryable（异常断开，可能是网络瞬断）

**被排除的替代方案**:

- (A) 所有非 1000 的 close code 都重连 — 过于激进，1008 签名失败会反复重连浪费资源
- (B) 所有非 1000 的 close code 都 fatal — 过于保守，网络抖动会导致用户频繁手动重连

**选择理由**: telos 给了方向性提示 — `disconnect-immediate-offline.md` 和 `reconnect-requires-reregister.md` 反复强调 server 端是"连接丢失即状态丢失"模型，暗示 client 端应自行管理重连判断。但具体的 code→category 映射 telos 完全没说。决定基于工程直觉：可恢复 vs 不可恢复的二分。

**telos 是否覆盖**: 部分。`signaling-message-fields.md` §Error transport 给出了 close code 枚举和含义，给了 client 端做决策的素材。但没有给出 client 端的决策规则。

---

### E-2: `invite_result` 的 Promise resolve vs reject 策略

**问题**: 当 `invite_result` 携带 `error: "not_found"` 时，client 是 resolve Promise（caller 检查 `result.error`）还是 reject Promise？

**选择的方案**: **resolve Promise** 始终。`invite_result` 是 server 返回的有效响应（不管内容）。Caller 通过检查 `result.error` 是否存在来判断失败。

伪代码:

```typescript
type InviteResult =
  | { peer_id: string; pubkey: string }
  | { error: string };

inviteCreate(params): Promise<InviteResult>
```

**被排除的替代方案**:

- (A) reject Promise when `error` present — 语义更符合 JS 惯例（"操作失败"），但与 `invite_result` 的 "server 已正确处理请求只是结果是否" 语境不完全匹配
- (B) 始终 resolve，但返回 `{ ok: boolean, peer_id?, pubkey?, error? }` — 多一层包装，不必要。`error` 存在本身即可表示失败

**选择理由**: `invite_result` 始终是 server 的正确响应（协议层成功），error 是 business logic 层。类比 HTTP 200 with error body。但 telos 对此完全沉默 — 这是纯 API 设计偏好。

**telos 是否覆盖**: 否。`signaling-message-fields.md` 定义了 wire 格式（`invite_result` 带 optional `error` 字段），但没规定 TypeScript API 语义。

---

### E-3: 跨重连的 signal_in / notify_in 去重责任归属

**问题**: 重连后 server 会重新推送 `offline_notifications` 中的所有 `notify_in`。如果上一次连接已经收到并 emit 过某个 `notify_in`，caller 会收到重复的 `notify_in`。谁负责去重？

**选择的方案**: **Caller 负责去重**。Client 不维护跨重连的已消费通知集合。理由：

- Client 是无状态的（per `invite-create-no-cross-reconnect-state.md` philosophy）
- `notify_in` 的去重需要 sealed-box 内部的 `nonce` + `timestamp`（来源: `sealed-box-for-offline-notify.md` "接收方验证…nonce 在过去 24 小时内未见过"）。这需要解密 sealed box，这不是 signaling client 层的工作（那是上层/daemon 层的职责）
- Client 只负责传输，解密和去重是上层语义

**被排除的替代方案**:

- (A) Client 跟踪已 emit 的 `notify_in.sealed_box` 引用（按 sealed-box 密文去重）— 密文因 ephemeral key 而每次都不同，无法按密文去重
- (B) Client 不解密封装 → 不可能去重 — 正确，所以选择 caller 负责
- (C) Client 解密 sealed box 以提取 nonce — 越权。Client 不应知道 sealed box 内部结构。密钥管理是上层的事

**选择理由**: telos 在 `sealed-box-for-offline-notify.md` 中明确将防重放责任归于接收方（"接收方验证：timestamp 在 ±5 分钟内，nonce 在过去 24 小时内未见过，sender_peer_id 在 known_peers.toml 中"）。这暗示防重放是上层的事。Signaling client 是纯传输层。

**telos 是否覆盖**: 隐含覆盖。`sealed-box-for-offline-notify.md` 的重放防护段落在描述"接收方"时，暗示接收方（上层）做去重。但未明确说明 signaling client 不应该做这件事。

---

### E-4: 构造时的参数校验范围

**问题**: `RendezvousClient` 构造函数应该校验哪些参数？telos 给出了 `peer_id` 格式（`protocol.md` §7）、`capabilities` 字段（`signaling-message-fields.md`）、但没说 client 是否应该做本地 pre-flight 校验。

**选择的方案**: 校验以下项，不校验的就留给 server 在 `register` 时拒绝:

- `url` 必须是 string（不能为空）
- `identity.peerId` 格式: 移除 `PB-` 前缀和 `-` 后长度 53，字符在 base32 字母表内（引用 `protocol.md` §7 验证步骤 1-3）
- `identity.publicKey` 长度必须为 32 bytes
- `identity.secretKey` 长度必须为 64 bytes
- `capabilities.version` 必须是 string

以下项由 server 在 register 时校验，不在构造函数校验:

- `peer_id` 的 Luhn checksum（让 server 做）
- `capabilities` 字段的语义正确性（M2 server 只记录不校验）
- 签名的有效性（每次发 register 时 server 校验）

**被排除的替代方案**:

- (A) 不在构造时做任何校验，全部 defer 到 server — 失败反馈延迟太久
- (B) 全面校验（包括 Luhn checksum）— Luhn 是字节级算法，在 client 端重复实现增加维护负担且可能漂移

**选择理由**: 最小化本地下沉 — 只校验能 static check 的项。Luhn 留 server 是自然的边界。

**telos 是否覆盖**: 否。telos 描述了 peer_id 格式和验证步骤，但没规定谁做哪个步骤。

---

### E-5: `signal()` / `notify()` 在非 `'ready'` 状态下的行为

**问题**: `signal()` 和 `notify()` 是 fire-and-forget，没有返回值。当 client 不在 `'ready'` 状态时调用它们，应该怎样？

**选择的方案**: **同步抛出** `Error("Not connected")`。

**被排除的替代方案**:

- (A) 静默丢弃 — caller 不知道发送失败，导致静默数据丢失
- (B) 队列等待直到 `'ready'` — 增加 client 复杂度，且 `signal` 是实时消息（等到重连后可能已过期）

**选择理由**: 抛出是 JS 中对无返回值函数的常用做法（caller 可以看到错误）。fire-and-forget 的语义是 "不等待 server 响应"，不是 "不在意是否发送"。

**telos 是否覆盖**: 否。这个决定纯属 API 工程惯例。

---

## 完成标准自检

- [x] §1 列出的 23 个路径全部在白名单内，未读取任何黑名单文件
- [x] §2 覆盖 8 个设计维度，每项可读且有 telos 引用
- [x] §3 列出 7 项推断（超过 3 项要求）
- [x] §4 列出 5 项 telos 没明说的工程决定（超过 2 项要求）
- [x] 未调用 git 命令
- [x] 未执行 find/grep 等探索工具（只用了 ls 在白名单目录内）
- [x] HARD CAP: 20 turns used（共 25 预算）
