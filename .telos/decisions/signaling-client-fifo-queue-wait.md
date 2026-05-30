---
id: signaling-client-fifo-queue-wait
kind: decision
status: stable
since: 2026-05-30
parent: signaling-fifo-no-request-id
---

# Decision: Signaling Client Uses Queue-Wait Discipline for Concurrent Request Calls

## Content

The signaling client (`RendezvousClient`) implements **queue-wait** semantics for its request methods (`lookup`, `invite_create`, `invite_redeem`): when `_pendingRequest` is already set and a second request method is called before the first settles, the second call **awaits the previous request's settlement** before sending its own frame — rather than rejecting immediately.

Implementation: a single `_pendingRequest` chain with `_fifoQueue` tail Promise. Each request call atomically appends to the chain; the chain drains serially.

### Observable behavior

- Callers never see a "busy" error from concurrent invocations of request methods. Instead, the second call silently waits for the first to complete, then proceeds.
- Wire-level serialization is preserved — only one request frame is in flight at any time (verifying D2's "at-most-one-in-flight" constraint at the transport level).
- Verified by test 19 in `packages/core/src/signaling.test.ts`: second frame not sent until first resolves.

## Source

- Decision: [signaling-fifo-no-request-id](./signaling-fifo-no-request-id.md) (D2) — establishes at-most-one-in-flight as the wire-level contract. This decision refines D2 by specifying the **client-side** behavior when callers violate the "one at a time" convention.
- Implementation: `packages/core/src/signaling.ts` `_sendRequest()` helper, commits bc83c0b + 093510e + 42903e9.

## Boundaries

- Applies **only** to client→server request methods: `lookup`, `invite_create`, `invite_redeem`. These are the methods that await a server response and participate in `_pendingRequest` tracking.
- **Push messages** (`signal_in`, `notify_in`) bypass FIFO entirely — they arrive on the incoming side regardless of pending request state.
- **Fire-and-forget** methods (`signal`, `notify`) bypass FIFO entirely — they have no response and do not enter the `_pendingRequest` chain.
- This is a signaling-client-layer decision. Does **not** constrain server-side behavior (server may still process requests in any order — D2 says server behavior on concurrent requests is unspecified).

## Why

**动机**：Centralize retry/queuing complexity in one place (the signaling client) rather than forcing every caller to implement its own retry loop.

### 替代方案与否决理由

#### Option (b): Fail-fast — second concurrent call rejects immediately with "busy" error（❌ 已否决）

When `_pendingRequest` is already set, the second request call immediately throws/rejects with a "busy" error.

**否决理由**：

1. Forces every caller (CLI commands, future daemon code) to implement its own retry loop externally. The "busy" error is transient and retryable by nature — pushing retry to callers duplicates complexity.
2. Queue-wait keeps the serialization guarantee of D2 while providing a caller-friendly API surface. Callers interact with the client as if it were always available.
3. The client is a single-connection, single-threaded resource — it's natural to queue rather than reject.

**git 历史**：`git log --oneline -- packages/core/src/signaling.ts` shows the FIFO implementation evolved across bc83c0b → 093510e → 42903e9. No prior fail-fast implementation was committed; the queue-wait approach was chosen during implementation of brief #2b and refined in #2c.

## Related

- Decision: [signaling-fifo-no-request-id](./signaling-fifo-no-request-id.md) (D2) — parent decision, wire-level FIFO contract.
- Fact: [signaling-client-fsm](../facts/signaling-client-fsm.md) — the queue-wait behavior interacts with FSM state transitions (requests cannot be sent in `'disconnected'` or `'reconnecting'` states).
