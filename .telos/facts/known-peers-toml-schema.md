---
id: known-peers-toml-schema
kind: fact
status: stable
since: 2026-05-30
---

# Known Peers TOML Schema

## Content

`known_peers.toml` 使用 TOML table-array 语法 `[[peer]]`（singular），每条记录包含 5 个字段：

```toml
[[peer]]
alias = "alice"
peer_id = "PB-..."
added_at = "2025-01-15T10:30:00Z"
trust = "verified"  # verified | tofu
home_rendezvous = "wss://rdv.example.com"
```

字段：
- `alias`: string — 用户为该 peer 指定的本地别名。
- `peer_id`: string — 对方的 peer identifier（`PB-...` 格式）。
- `added_at`: string — ISO 8601 UTC timestamp。
- `trust`: enum — `"verified"`（手动确认 fingerprint 后添加）或 `"tofu"`（信任首次使用，未人工确认）。
- `home_rendezvous`: string — 该 peer 的 home rendezvous URL（`wss://` 或 `ws://`）。

**不是** `[[peers]]`（复数）、`name` 字段（不是 `alias`）、`trust = "trusted"`（不在 enum 中）。

## Source

native: observed directly from code and design document

- `packages/core/src/known-peers.ts:15-21` — `KnownPeer` interface 实现此 schema，parse 逻辑按 `[[peer]]` 格式。
- DESIGN.md §4 — `known_peers.toml` 完整示例。

## Boundaries

- M1+ schema。v1 范围。
- 不包含 multi-device 场景的扩展字段（如 device 列表）—— 如需支持 multi-device，本 schema 会增长。
- 不规定 `alias` 的唯一性约束 —— DESIGN.md 未规定，实现层由 `parseKnownPeers` 按出现顺序处理。
- 不规定 `home_rendezvous` 的 URL 格式验证规则 —— 实现层决定是否校验 `wss://` scheme。
