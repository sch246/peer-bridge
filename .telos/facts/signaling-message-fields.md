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

| Message Type | Required Fields | Optional Fields | Notes |
|---|---|---|---|
| `register` | `peer_id`, `capabilities` | — | `sig` + `ts` 附加于外层 |
| `lookup` | `peer_id` | — | |
| `invite_create` | `code_hash`, `pubkey`, `peer_id`, `expires_at` | — | |
| `invite_redeem` | `code_hash` | — | |
| `signal` | `to`, `payload` | — | `payload` 为加密 binary |
| `notify` | `to`, `sealed_box` | — | `sealed_box` ≤ 1KB |

### Server → Client

| Message Type | Required Fields | Optional Fields | Notes |
|---|---|---|---|
| `register_ok` | `server_id`, `federation_size` | — | **不包含** `origin_server`。`origin_server` 仅在 §5.2 联邦 `proxy_signal` 中出现 |
| `lookup_result` | `found` | `home` | `home` 仅在 `found: true` 时存在 |
| `invite_result` | — | `peer_id`, `pubkey`, `error` | 成功时 `{peer_id, pubkey}`；失败时 `{error: "not_found"}` |
| `signal_in` | `from`, `payload` | — | |
| `notify_in` | `sealed_box`, `queued_at` | — | |

### 字段验证规则

- 任何 required field 缺失 → 消息无效。server 关闭 WS（code 1008）或返回 `{type: "error", ...}`。
- 额外字段 → 容忍（forward-compat 保留），不因多余字段 reject。
- 字段类型不符 → 同缺失处理。

### agent-blind 报告中的错误字段（不在本 spec 中）

以下字段在 M2 agent-blind 报告中出现，但**不是** DESIGN.md §5.1 规定的字段：
- `origin_server: null` in `register_ok` — `origin_server` 仅在 §5.2 联邦 `proxy_signal` 中出现，不在 `register_ok` 中。
- `origin_server: null` in `invite_result` — 同上。
- `{type: "register_error", ...}` — 注册失败以 WS close code 表示，不在 payload 中返回 error envelope。

## Source

derived from DESIGN.md §5.1

- DESIGN.md §5.1 — 信令消息字段表（C→S 和 S→C 两表），覆盖全部 10 种消息类型的字段定义。
- 本 fact 是 JSON 信令层的字段 inventory，对应 CBOR 二进制帧的 [cbor-key-allocation](../facts/cbor-key-allocation.md)。两者约束同一原则：字段清单即 spec，不允许实现层自行发明字段。

## Boundaries

- 仅覆盖 client ↔ rendezvous 的 JSON-over-WebSocket 信令消息。
- 联邦协议（§5.2 `federation/query`、`federation/proxy_signal`）在 M6 范围，不在本 fact 中。
- P2P DataChannel 消息（§5.4 room:msg、room:file_offer、room:system 等）由 `cbor-key-allocation.md` 约束，不在本 fact 中。
- 不枚举 `error` 值的完整 taxonomy —— DESIGN.md §5.1 仅定义了 `invite_result.error: "not_found"` 一个错误值。其他错误码和 `{type, error, detail, retry_after}` envelope 形状仍属于 BACKLOG known-unknown。
