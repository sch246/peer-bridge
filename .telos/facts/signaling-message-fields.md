---
id: signaling-message-fields
kind: fact
status: stable
since: 2026-05-30
---

# Signaling Message Field Inventory

## Content

Client ↔ rendezvous WebSocket 信令消息的字段 catalog。DESIGN.md §5.1 为权威来源。

所有 C→S 消息附 `{sig, ts}`，sig = Ed25519(SHA-256(JSON(payload) || ts))。

### Client → Server

| Message Type    | Required Fields                                | Optional Fields | Notes                   |
| --------------- | ---------------------------------------------- | --------------- | ----------------------- |
| `register`      | `peer_id`, `capabilities`                      | —               | `sig` + `ts` 附加于外层 |
| `lookup`        | `peer_id`                                      | —               |                         |
| `invite_create` | `code_hash`, `pubkey`, `peer_id`, `expires_at` | —               |                         |
| `invite_redeem` | `code_hash`                                    | —               |                         |
| `signal`        | `to`, `payload`                                | —               | `payload` 为加密 binary |
| `notify`        | `to`, `sealed_box`                             | —               | `sealed_box` ≤ 1KB      |

### Server → Client

| Message Type    | Required Fields                | Optional Fields              | Notes                                                                                                                                                                                                                 |
| --------------- | ------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register_ok`   | `server_id`, `federation_size` | —                            | **不包含** `origin_server`。`origin_server` 仅在 §5.2 联邦 `proxy_signal` 中出现                                                                                                                                      |
| `lookup_result` | `found`                        | `home`                       | `home` 仅在 `found: true` 时存在                                                                                                                                                                                      |
| `invite_result` | —                              | `peer_id`, `pubkey`, `error` | 同时作为 `invite_create` 和 `invite_redeem` 的响应 envelope。invite_create 成功时返回 creator 身份（确认），失败时 `{error: "invalid_request"}`。invite_redeem 成功时返回 inviter 身份，失败时 `{error: "not_found"}` |
| `signal_in`     | `from`, `payload`              | —                            |                                                                                                                                                                                                                       |
| `notify_in`     | `sealed_box`, `queued_at`      | —                            |                                                                                                                                                                                                                       |

### 字段验证规则

- 任何 required field 缺失 → 消息无效。server 关闭 WS（code 1008）或返回 `{type: "error", ...}`。
- 额外字段 → 容忍（forward-compat 保留），不因多余字段 reject。
- 字段类型不符 → 同缺失处理。
- `signal` 和 `notify` 是 fire-and-forget（C→S 层）。若 `signal` 发送时目标 peer 不在线，server 静默丢弃（无 error response）。重试由 sender 自行负责。（`notify` 的 sealed-box 消息在 `offline_notifications` 中排队 — 见 `decisions/sealed-box-for-offline-notify.md`。）
- `register_ok` 是 register 成功的最终响应，但 server MAY 在 `register_ok` 之前推送 0 或多个 `notify_in`（offline 队列中积压的 sealed-box 消息）。client 必须能处理 `notify_in` 在 `register_ok` 之前到达的情况。理由：保证 offline 消息在 client 假设已注册之前先送达，避免 client 在 register_ok 后立即断开导致消息丢失。Source: `packages/rendezvous/src/handlers/register.ts:20-21` (commit 3f192e7)。
- 上述 `notify_in`-before-`register_ok` 排序规则在**每次 register 时均生效**，包括 reconnect 触发的 re-registration（D3 fresh session）。每次 reconnect cycle 是独立的 `register` → `notify_in`（如有）→ `register_ok` 序列。brief #2d reconnect 测试通过 `connecting → registering → ready` 状态转换隐式验证了这一点。Source: commit 42903e9。

### agent-blind 报告中的错误字段（不在本 spec 中）

以下字段在 M2 agent-blind 报告中出现，但**不是** DESIGN.md §5.1 规定的字段：

- `origin_server: null` in `register_ok` — `origin_server` 仅在 §5.2 联邦 `proxy_signal` 中出现，不在 `register_ok` 中。
- `origin_server: null` in `invite_result` — 同上。
- `{type: "register_error", ...}` — 注册失败以 WS close code 表示，不在 payload 中返回 error envelope。

### invite_result.error 取值

`invite_result.error` 是 string。以下是所有预期取值：

| Value              | When emitted                                                                               | Spec source                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `not_found`        | `invite_redeem` 的 code_hash 从未存在过 OR 已被 consume 并删除                             | DESIGN.md §5.1（唯一 spec 定义值）                                                                                                              |
| `expired`          | `invite_redeem` 收到 `expires_at < now` 的 code_hash                                       | brief #1 implementer choice（自 commit 3f192e7 沉积）                                                                                           |
| `already_redeemed` | `invite_redeem` 收到曾经有效但已被 consume 的 code_hash（竞态）                            | brief #1 implementer choice — 语义上区别于 `not_found`，但若已 redeem 的 invite 已从 `invite_records` 删除，server 可能 collapse 为 `not_found` |
| `invalid_request`  | `invite_create` 或 `invite_redeem` 缺少/格式错误 required fields（如 missing `code_hash`） | brief #1 implementer choice                                                                                                                     |

> **Note (当前 M2 行为):** `expired` 和 `already_redeemed` 在当前 M2 server 中均 collapse 为 `not_found` — `handleInviteRedeem` 对所有非成功路径统一返回 `{ found: false }`，`sendInviteRedeemResult` 映射为 `error: "not_found"`。未来实现可选择保留短暂 "tombstone" 以区分 `expired`/`already_redeemed`，或继续 collapse。本枚举是 contract，M2 的实际 emit 是其子集。

## Source

derived from DESIGN.md §5.1

- DESIGN.md §5.1 — 信令消息字段表（C→S 和 S→C 两表），覆盖全部 10 种消息类型的字段定义。
- 本 fact 是 JSON 信令层的字段 inventory，对应 CBOR 二进制帧的 [cbor-key-allocation](../facts/cbor-key-allocation.md)。两者约束同一原则：字段清单即 spec，不允许实现层自行发明字段。

## Boundaries

- 仅覆盖 client ↔ rendezvous 的 JSON-over-WebSocket 信令消息。
- 联邦协议（§5.2 `federation/query`、`federation/proxy_signal`）在 M6 范围，不在本 fact 中。
- P2P DataChannel 消息（§5.4 room:msg、room:file_offer、room:system 等）由 `cbor-key-allocation.md` 约束，不在本 fact 中。
- 不枚举 `error` 值的完整 taxonomy —— DESIGN.md §5.1 仅定义了 `invite_result.error: "not_found"` 一个错误值。其他错误码和 `{type, error, detail, retry_after}` envelope 形状仍属于 BACKLOG known-unknown。

## Error transport

M2 server 通过三个渠道发射错误，不是统一的 envelope。逐一记录如下。

### Channel A — `invite_result.error` string 字段

| Value               | Handler              | File:line                                              |
| ------------------- | -------------------- | ------------------------------------------------------ |
| `"not_found"`       | `invite_redeem` 失败 | `packages/rendezvous/src/handlers/invite-redeem.ts:91` |
| `"invalid_request"` | `invite_create` 失败 | `packages/rendezvous/src/handlers/invite-create.ts:88` |

值 `"expired"` 和 `"already_redeemed"` 由 contract 保留（见上方 `invite_result.error` 取值表），
但 M2 实现将其 collapse 为 `"not_found"`（已在表中注明）。

### Channel B — WebSocket close codes

| Code   | Meaning              | When                                                        | File:line                                          |
| ------ | -------------------- | ----------------------------------------------------------- | -------------------------------------------------- |
| `1008` | Policy violation     | 无效 JSON、缺少 envelope、invalid peer_id、签名失败、未注册 | `server.ts:80,84,107,110,117`; `register.ts:24,31` |
| `1011` | Server error         | register 通用 fallback                                      | `server.ts:189`                                    |
| `1013` | Too large / overload | server 满（`max_peers`）; rate-limited                      | `register.ts:42`; `server.ts:206`                  |
| `1000` | Normal closure       | client 发起断开                                             | (client-side)                                      |

### Channel C — HTTP `501` with `{error: "..."}` body

Federation 端点：`server.ts:64,68`。M6 will replace this with real federation response shapes.

### Channel D — `{type: "error", code, message}` (reserved forward-compat)

Client 定义了 handler（`packages/core/src/signaling.ts:489-499`）并通过 mock 测试
（`packages/core/src/signaling.test.ts:723-748`），**但 M2 rendezvous server 不发射此 shape**。

视为 forward-compat 预留：未来需要流过 WS message envelope（而非 close code）的错误类型将使用
此 shape。Client handler 是正确的；server 当前只是不需要它。NOT dead code — it's reserved.

### 边界

以上枚举仅限 M2。M3+ 可能增加新的 close code（如 federation routing 失败），届时重新记录。
