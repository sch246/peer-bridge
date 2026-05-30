---
id: rendezvous-health-endpoint
kind: fact
status: active
since: 2026-05-30
---

# Rendezvous Health Endpoint Response Schema

## What

`GET /health` 返回一个 JSON 对象，包含恰好三个字段。无认证要求，无查询参数。

## Schema

```json
{
  "peer_count": "<integer, count of registered peers>",
  "federation_size": "<integer, 0 in M2 single-server>",
  "uptime_seconds": "<number, seconds since server start>"
}
```

- `peer_count` = `state.peer_registrations.size`（`packages/rendezvous/src/state.ts:46`）
- `federation_size` = 固定 `0`（硬编码于 `state.ts:50-52`，M2 单 server 无联邦）
- `uptime_seconds` = `(Date.now() - state.started_at) / 1000`（`packages/rendezvous/src/health.ts:10`）

## Implementation

- `packages/rendezvous/src/health.ts:8-16` — `registerHealthRoute()`，Fastify route handler，无 schema 验证，直接返回 JSON。
- `packages/rendezvous/src/state.ts:46,50-52` — `peerCount()` 和 `federationSize()` 的源头。

## Beyond the spec

DESIGN.md §6.1（line 475）仅描述了两个字段：

> "健康检查：GET /health 返回 peer 数量、federation 状态。"

实现新增了第三个字段 `uptime_seconds`。本 fact 记录实现的当前状态；是否更新 DESIGN.md 以对齐实现不属于本 fact 的范围。

## Boundaries

- M2 schema only。M3+ 可能新增字段（如 WebSocket 连接数、lookup 吞吐量）。当前 3 字段集合是 M2 的契约。
- 无 content-type 强制（Fastify 默认 JSON）。无 schema 验证。
- 不覆盖 Prometheus/OpenMetrics 导出端点（不在 M2 范围内）。

## Source

- Audit trail: `.telos/audit-trails/m2-exit-investigation-2026-05-30.md` §T-4
- Code: `packages/rendezvous/src/health.ts:8-16`
- Spec: DESIGN.md §6.1 line 475
- Related fact: `facts/rendezvous-server-config.md`
