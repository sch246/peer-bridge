---
id: signaling-fifo-no-request-id
kind: decision
status: stable
since: 2026-05-30
---

# Decision: FIFO Response Correlation, No request_id in Client Signaling

## Content

Client → rendezvous JSON signaling has **at-most-one in-flight request at a time**. Responses are correlated by **FIFO ordering on the single WebSocket channel + message type matching**. No `request_id` field exists in C→S or S→C signaling messages.

### Practical contract

- Client SHOULD send the next C→S request only after receiving the response to the previous one（or determining it doesn't expect a response — `signal` and `notify` are fire-and-forget）。
- For **request-response pairs**：`register → register_ok`、`lookup → lookup_result`、`invite_create → invite_result`、`invite_redeem → invite_result`。Client matches the next response of matching `type` to its pending request.
- **Server-pushed messages**：`signal_in`、`notify_in` can interleave at any time and don't consume a "request slot". Client must distinguish pushed messages from responses by `type`.
- If a client sends a second request before the first receives its response, server behavior is **unspecified**（implementation may queue, error, or close the connection）。The contract is SHOULD, not MUST — but violating it has no defined outcome.

## Source

- DESIGN.md §5.1 — 信令消息字段表（C→S 和 S→C 共 10 种消息类型）。表中无 `request_id` 字段。
- Fact: [signaling-message-fields](../facts/signaling-message-fields.md) — 字段清单 authoritative。"字段清单即 spec"的 discipline：adding `request_id` 会违反此 fact。
- DESIGN.md §5.2 — 联邦协议（`federation/query`、`federation/proxy_signal`）**确实**使用 `request_id` UUID。Client signaling 和 federation 的分野是有意设计——client 单连接单查询，federation 需并行 server-to-server 查询。

## Boundaries

- Applies only to client ↔ rendezvous JSON signaling。
- Federation server-to-server messages（§5.2）keep their `request_id` UUID。
- P2P DataChannel CBOR messages（`room:msg`、`room:file_offer` 等）have their own per-sender seq numbering — see [per-sender-seq-numbering](./per-sender-seq-numbering.md)。
- Does not constrain client implementation — a client may queue requests internally and still maintain at-most-one in-flight on the wire.

## Why

**动机**：WS 是单流 FIFO channel。在同一连接上，响应顺序自然匹配请求顺序。为每个 C→S 消息加 `request_id` 是协议 surface 膨胀，且 M2 client 层没有并行查询同一 rendezvous 的用例。

### 替代方案与否决理由：

#### A. Add `request_id` UUID to all C→S messages（❌ 已否决）

在 `register`、`lookup`、`invite_create`、`invite_redeem` 等 C→S 消息中加入 `request_id: UUID` 字段，S→C 响应原样回传。

否决理由：(a) 违反 `signaling-message-fields.md`——该 fact 已将 §5.1 字段表固化为 auth source，添加字段需要修订 fact + §5.1；(b) §5.2 已建立 precedent：federation 用 `request_id`，client signaling 不用——这是有意分野，不是疏漏；(c) M2 clients 不需要并行信令查询——它们在与一个 rendezvous 通信，关于一个 peer interaction，at a time。

#### B. Async unordered with no correlation（❌ 已否决）

不做任何关联——客户端发送多条请求后，收到的响应无顺序保证，需靠内容（如 lookup 结果中的 peer_id）匹配。

否决理由：`register → register_ok` 和 `invite_create → invite_result` 的响应不包含足够的请求识别信息；同时发出两个 `lookup`（如并发查两个 peer_id）时，仅靠响应内容无法区分哪个 `lookup_result` 对应哪个 `lookup`。

**git 历史**：`git log --oneline -- DESIGN.md` 仅返回 `488dc15 Initial commit`。no prior alternatives in commit history；constraint is original to DESIGN.md。

## Consequences

| 正面                                       | 负面                                     |
| ------------------------------------------ | ---------------------------------------- |
| 协议 surface 最小（无 request_id 字段）    | 无法并行查询——串行化客户端信令            |
| FIFO 匹配无需实现层 correlation 逻辑       | 错误实现（并发两个请求）的行为未定义       |
| 与 §5.1 字段表一致，不与 `signaling-message-fields.md` 冲突 | 未来如需要并行查询需协议升级           |

## Related

- Fact: [signaling-message-fields](../facts/signaling-message-fields.md) — 本 decision 引用的字段清单。
- Decision: [per-sender-seq-numbering](./per-sender-seq-numbering.md) — P2P DataChannel 层的 seq 关联机制（独立于信令层）。
- DESIGN.md §5.1, §5.2
