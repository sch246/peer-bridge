---
id: invite-create-no-cross-reconnect-state
kind: decision
status: stable
since: 2026-05-30
parent: reconnect-requires-reregister
---

# Decision: Client Drops Pending invite_create State on Reconnect

## Content

When a signaling client's WebSocket disconnects with a pending `invite_create` request (sent but no `invite_result` received), the client **drops** that pending state. On reconnect, the client does **not** auto-resend the `invite_create`. The CLI / caller layer is responsible for re-issuing `invite_create` if the user re-runs the command.

Server-side `invite_records` created by a successful `invite_create` **survive** the inviter's disconnect — they are keyed by `code_hash`, not by connection. If the server processed the `invite_create` before the connection dropped, the invite is already valid and redeemable; the inviter simply didn't receive the confirmation. If the server did not process it, the invite was never created.

## Source

- Decision: [reconnect-requires-reregister](./reconnect-requires-reregister.md) (D3) — establishes reconnect = fresh session; cross-reconnect pending state contradicts this philosophy.
- Decision: [signaling-fifo-no-request-id](./signaling-fifo-no-request-id.md) (D2) — at most one in-flight request; no cross-reconnect request correlation.
- Decision: [sealed-box-for-offline-notify](./sealed-box-for-offline-notify.md) — server-side `invite_records` survive by `code_hash`, establishing the server side of this boundary.
- Decision: [m2-cli-bypasses-daemon](./m2-cli-bypasses-daemon.md) — M2 layering context: this decision is signaling-client-layer only. The daemon (M4) may add its own retry/persistence layer on top.

## Boundaries

- Applies **only** to `invite_create`. Other request/response pairs (`lookup`, `invite_redeem`) are at-most-one-in-flight per D2 and have no cross-reconnect state question — if disconnected mid-call, the request is simply lost and the caller observes a connection error.
- This is a signaling-client-layer decision. Does **not** cover what `daemon/src/...` (M4) does — the daemon may add its own retry / persistence layer on top.
- Does not affect `invite_records` server-side lifecycle. Invites created before disconnect remain valid per `sealed-box-for-offline-notify.md`.

## Why

**动机**: aligns with D3's "reconnect = fresh session" philosophy. Client statelessness across reconnect = simpler implementation. State management lives in CLI / daemon, not in the WebSocket transport.

**UX rationale**: the user must wait for reconnect either way. Re-running `peer-bridge invite` is a clear UX signal that something interrupted, rather than silently retrying in the background.

### 替代方案与否决理由

#### Option (b): Client buffers and re-sends pending invite_create after register_ok

Client maintains pending `invite_create` state across reconnect. After `register_ok` arrives on the new connection, client auto-resends the buffered `invite_create`.

**否决理由**:
1. Violates D3 fresh-session philosophy without compensating UX gain — the user must wait for reconnect either way.
2. Introduces cross-reconnect persistence in the signaling client (buffer management, timeout, dedup logic) for a marginal convenience.
3. If the server already processed the original `invite_create` before disconnect, the re-send is an idempotent no-op (invite already exists by `code_hash`), but the client still carries unnecessary state.
4. Keeps signaling client free of cross-reconnect persistence. State management lives in CLI / daemon, not in the WebSocket transport.

## Related

- Decision: [reconnect-requires-reregister](./reconnect-requires-reregister.md)
- Decision: [signaling-fifo-no-request-id](./signaling-fifo-no-request-id.md)
- Decision: [sealed-box-for-offline-notify](./sealed-box-for-offline-notify.md)
- Decision: [m2-cli-bypasses-daemon](./m2-cli-bypasses-daemon.md)
