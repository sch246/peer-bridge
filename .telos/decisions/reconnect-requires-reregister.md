---
id: reconnect-requires-reregister
kind: decision
status: stable
since: 2026-05-30
---

# Decision: Reconnect = Fresh Session, Requires Re-register

## Content

When a signaling client's WebSocket reconnects after a close, the rendezvous server treats it as a **fresh session**. Client MUST send `register` immediately after WebSocket reopens. Server preserves NO session state across reconnects.

**Reconnect sequence**（client side）：

1. WS reopens（new TCP + TLS handshake）
2. Send `register { peer_id, capabilities }`（fresh, with `sig` + `ts`）
3. Await `register_ok { server_id, federation_size }`
4. Resume normal operation

**Server-side invariants**：

- `peer_registrations` entry was removed at WS close（per [disconnect-immediate-offline](./disconnect-immediate-offline.md)）
- The new WS connection is a stranger until `register` succeeds — no implicit identity binding
- Pending `invite_records`（keyed by `code_hash`）DO survive reconnect — not tied to inviter's WS connection
- Queued `notify_in` for this `peer_id` DO survive reconnect — keyed by `peer_id` in `offline_notifications`, not by connection. Server delivers them after `register` succeeds.

## Source

- DESIGN.md §6.1 — "运行时数据全内存，重启丢失可accept"。连接丢失 = 注册丢失 = 重建无残留。
- Decision: [disconnect-immediate-offline](./disconnect-immediate-offline.md) — D1 建立了前提：WS close → 立即移除注册。一旦 D1 清除了注册信息，reconnect 只能重建，不能恢复。
- Decision: [m2-cli-bypasses-daemon](./m2-cli-bypasses-daemon.md) — M2 CLI 直接使用 `core/signaling.ts`，其 reconnect 逻辑必须遵循本 decision（无 daemon 代为管理重连状态）。

## Boundaries

- Applies only to rendezvous WebSocket reconnect。
- P2P DataChannel reconnect semantics（M3+）are independent — DataChannel may have its own resume protocol（see [per-sender-seq-numbering](./per-sender-seq-numbering.md) for cross-reconnect seq persistence）。
- Does not specify the client's reconnect retry logic（backoff、max attempts、exponential vs fixed）— those are signaling-client implementation choices（BACKLOG T-9 may inform keepalive timing）。
- Pending invite codes（created via `invite_create` before disconnect）survive — they live in `invite_records`, keyed by `code_hash`。
- Offline notifications queued for this peer survive — they live in `offline_notifications`, keyed by `peer_id`。

## Why

**动机**：简单性。Server 无 resume-token 机制；in-memory state model 意味着无可持久化的 session 数据。Client 的 reconnect 是严格的三步：WS reopen → register → register_ok → 恢复正常。

### 替代方案与否决理由：

#### A. Server preserves session keyed by peer_id across reconnect（❌ 已否决）

Server 在 WS close 后保留 `peer_registrations` 条目（如设置 `status: "ghost"` + timer），客户端重连时无需重新 `register`。

否决理由：(a) 需要在 server 端引入 ghost timer 维持 "无连接但已注册" 的状态，违反 D1 [disconnect-immediate-offline](./disconnect-immediate-offline.md) 的 immediate-offline 规则和 §6.1 "全内存 + 重启丢失可接受" 哲学；(b) 两个 reconnect 同时到达时 ambiguity：哪一个 "赢"？(c) session preservation 恰恰是 §6.1 说 "可接受丢失" 的那类状态。

#### B. Resume token（cookie-style）（❌ 已否决）

`register_ok` 返回 `resume_token`，Client 重连时在 `register` payload 中携带，Server 用 token 恢复之前的注册状态。

否决理由：(a) 引入新字段 `resume_token`（在 `register_ok` 和 `register` 中），违反 [signaling-message-fields](../facts/signaling-message-fields.md)；(b) token 需要 server-side storage with TTL，将 in-memory 模型扩展为需要 token 表，增加复杂度；(c) 实际收益微小——re-register 只需一次额外往返，trivial。

#### C. Implicit re-registration on first message after reconnect（❌ 已否决）

Server 在 WS reopen 时将连接绑定到之前注册过的 `peer_id`（基于 IP 或其他特征），第一个信令消息自动视为该 peer 的操作。

否决理由：无法安全识别 peer 身份——没有 `register` 消息时 server 无法获取 `sig` 签名验证。基于 IP 绑定不安全（CGNAT 后多 peer 共享 IP，或 peer 更换网络）。这破坏了 §5.1 的认证模型（每条 C→S 消息需签名，而 `register` 是初始的签名载体）。

**git 历史**：`git log --oneline -- DESIGN.md` 仅返回 `488dc15 Initial commit`。no prior alternatives in commit history；constraint is original to DESIGN.md。

## Consequences

| 正面                        | 负面                                                                         |
| --------------------------- | ---------------------------------------------------------------------------- |
| Server 无 session 恢复逻辑  | 每次重连需 `register` 往返（one extra RTT）                                  |
| 无 token 存储/过期/重放问题 | 网络不稳定时频繁 register（可客户端退避吸收）                                |
| 与 D1 一致（close = gone）  | `invite_create` 后立刻断连：invite 存活但 inviter 需重注册才能收 `signal_in` |

## Edge case: orphan old socket on reconnect-while-open

When the same `peer_id` registers on a second socket while the old socket is still open, the implementation **replaces** the registration in `peer_registrations` and **removes** the old socket from the `socket_to_peer` reverse map (`packages/rendezvous/src/handlers/register.ts:39-57`). The old socket is **not actively closed by the server**; it remains open until the client or network closes it. Subsequent messages on the old socket fail authentication ("Not registered") because the reverse mapping was removed.

Source: `.telos/audit-trails/m2-exit-investigation-2026-05-30.md` §T-10, §A4.

## Related

- Decision: [disconnect-immediate-offline](./disconnect-immediate-offline.md) — D1（WS close 立即离线）是本 decision 的前提。
- Decision: [m2-cli-bypasses-daemon](./m2-cli-bypasses-daemon.md) — M2 CLI 直连模式须遵循此 reconnect 规则。
- Fact: [signaling-message-fields](../facts/signaling-message-fields.md) — 字段清单约束为何不引入 `resume_token`。
- DESIGN.md §5.1, §6.1
