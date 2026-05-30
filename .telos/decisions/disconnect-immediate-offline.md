---
id: disconnect-immediate-offline
kind: decision
status: stable
since: 2026-05-30
---

# Decision: Immediate Offline on WebSocket Close (No Grace Period)

## Content

When a peer's WebSocket connection closes mid-session, the rendezvous server **immediately** marks them offline. No grace period for reconnect with the same `peer_id`.

**Server behavior**: the WS `close` handler removes the entry from `peer_registrations` **synchronously**, before yielding to the event loop. A subsequent `lookup` for that `peer_id` returns `{found: false}` until the peer sends `register` on a new connection.

**Piggyback state that is NOT evicted**:
- `invite_records` — keyed by `code_hash`, not by inviter's WS connection. Pending invites survive the inviter's disconnect.
- `offline_notifications` — keyed by target `peer_id`, not by the sender's connection. Queued `notify_in` wait for the peer to re-register (see [reconnect-requires-reregister](./reconnect-requires-reregister.md)).

## Source

- DESIGN.md §6.1 — "运行时数据全内存，重启丢失可接受"。WS close 导致的注册丢失是同一哲学的自然延伸：连接丢失即状态丢失。
- DESIGN.md §3.9 — "保持长连直到关闭"。不预留 reconnect 窗口；长连断开即终止。
- Fact: [rendezvous-server-config](../facts/rendezvous-server-config.md) — in-memory 模型，无 persistence 层承载 timer 状态。

## Boundaries

- Applies only to rendezvous server's WebSocket session lifecycle. P2P DataChannel reconnect (M3+) is out of scope.
- Does not address WebSocket keepalive (ping/pong intervals) — that remains BACKLOG known-unknown T-9.
- "Immediate" = synchronous within the close handler, before any other peer's `lookup` could observe stale state.

## Why

**动机**：保持 server 为简单 stateless 模型。WS close 事件是自然的生命周期边界，添加计时器追踪"幽灵注册"会引入状态管理复杂度，与 §6.1 "全内存 + 简单丢失" 哲学冲突。

### 替代方案与否决理由：

#### A. Grace period（如 30s 重连窗口）（❌ 已否决）

WS 关闭后保留注册 30s，期间同 `peer_id` 的新连接无需重新 `register`。

否决理由：(a) 需要在 `peer_registrations` 中引入 timer 状态（`disconnected_at`、`grace_deadline`），违反 "全内存 + 简单丢失" 模型；(b) DESIGN.md §3.9 "保持长连直到关闭" 不预留 reconnect 窗口；(c) grace 期间 `lookup_result.found` 语义模糊——peer 在 "connected? disconnected? reconnecting?" 的中间态，调用方无法做决策。

#### B. Heartbeat-based offline detection（❌ 已否决）

不依赖 WS close，改用应用层心跳超时判定离线。

否决理由：WebSocket 协议已提供 close 事件机制；添加应用层心跳 over WS-level ping/pong 是机制重复。且 heartbeat 超时引入滞后——grace 窗口后还要等 heartbeat 超时才判定离线，延长了 "真正离线 → lookup 返回 found: false" 的延迟。

**git 历史**：`git log --oneline -- DESIGN.md` 仅返回 `488dc15 Initial commit`。no prior alternatives in commit history；constraint is original to DESIGN.md。

## Consequences

| 正面                             | 负面                                   |
| -------------------------------- | -------------------------------------- |
| Server 无 timer 状态，实现简单   | Client 必须每断必重注册（一次往返）    |
| `lookup` 语义无歧义              | 网络抖动导致频繁 register（可客户端重试吸收） |
| 符合 §6.1 全内存哲学             | 离线通知 sender 无法提前知道 peer 离线 |

## Related

- Decision: [reconnect-requires-reregister](./reconnect-requires-reregister.md) — D3 基于 D1 的前提（连接断开即注册消失，重连必须重注册）。
- DESIGN.md §3.9, §6.1
