---
id: signaling-client-fsm
kind: fact
status: stable
since: 2026-05-30
---

# Fact: Signaling Client 5-State FSM Contract

## Content

`RendezvousClient` exposes a 5-state finite state machine observable to callers via `state_change` events. The states and transitions form a **contract**, not an implementation detail — downstream code (CLI, daemon) depends on these exact state names and transition semantics.

### States

| State            | Meaning                                                                        |
| ---------------- | ------------------------------------------------------------------------------ |
| `'disconnected'` | No connection. Initial state and terminal state after explicit `disconnect()`. |
| `'connecting'`   | WebSocket opening, TCP+TLS handshake in progress.                              |
| `'registering'`  | WebSocket open, `register` frame sent, awaiting `register_ok`.                 |
| `'ready'`        | Fully connected and registered. Can send/receive signaling messages.           |
| `'reconnecting'` | Involuntary close from `'ready'` state. Backoff timer running.                 |

### Transitions

**Normal connect (user-initiated):**

```
disconnected → connecting → registering → ready
```

**Involuntary close from ready:**

```
ready → reconnecting → connecting → registering → ready
```

or, if max attempts exhausted:

```
reconnecting → disconnected
```

**Explicit disconnect (user-initiated):**

```
ready → disconnected     (or connecting|registering|reconnecting → disconnected)
```

Explicit `disconnect()` always terminates to `'disconnected'` and **cancels any pending backoff timer**.

### Observable events

Callers subscribe to `client.on('state_change', (newState, oldState) => ...)`:

- Emitted on every state transition, including reconnect cycle states.
- `'reconnect'` event carries `(attempt: number, delayMs: number)` — emitted when a backoff timer is scheduled.
- `'reconnect_failed'` event carries `(attempts: number)` — emitted when max attempts exhausted and terminal `'disconnected'` is reached.

## Backoff Schedule

The `reconnecting → connecting` transition timing follows an exponential backoff schedule:

| Attempt | Delay      |
| ------- | ---------- |
| 1       | 1 second   |
| 2       | 2 seconds  |
| 3       | 4 seconds  |
| 4       | 8 seconds  |
| 5       | 16 seconds |
| 6       | 32 seconds |

- **Default**: `baseDelayMs = 1000`, `maxAttempts = 6` (total max wait ~63s).
- **Configurable**: `ReconnectOptions.baseDelayMs` and `.maxAttempts` allow test scaling and environment tuning.
- Backoff formula: `delay = baseDelayMs * 2^(attempt - 1)`.
- On explicit `disconnect()`, the pending backoff timer is cancelled and `maxAttempts` counter is reset.

### Rejected alternatives for backoff schedule

These were considered during implementation (brief #2d):

- **Fixed delay** (e.g., 5s × N): rejected because it doesn't accommodate bursty failures — all clients hammer the server in lockstep at fixed intervals.
- **Linear backoff** (e.g., 1s, 2s, 3s, 4s…): rejected because it doesn't shed load fast enough on shared-backend crowding — the server sees growing rather than decaying retry traffic.

**git 历史**: `git log --oneline -- packages/core/src/signaling.ts` shows the backoff was implemented as part of the reconnect feature in commit 42903e9. No prior backoff implementations existed; these alternatives were considered at design time during brief #2d.

## Source

- Decision: [reconnect-requires-reregister](../decisions/reconnect-requires-reregister.md) (D3) — establishes that reconnect is a fresh session requiring re-register. The FSM's `connecting → registering → ready` cycle per reconnect is a direct consequence.
- Implementation: `packages/core/src/signaling.ts` `_scheduleReconnect()` + `_doReconnect()`, constants `DEFAULT_BASE_DELAY_MS = 1000` and `DEFAULT_MAX_ATTEMPTS = 6`, commit 42903e9.

## Boundaries

- This is the **client-side observable contract**. Does not constrain server-side state machine (which has its own connection lifecycle per [disconnect-immediate-offline](../decisions/disconnect-immediate-offline.md)).
- The backoff schedule describes the `reconnecting → connecting` delay. It does not cover WebSocket-level timeouts (connection timeout, idle timeout) — those are implementation-level platform behaviors.
- `'reconnecting'` state exists only when the close was **involuntary** from `'ready'`. Closes from `'connecting'` or `'registering'` (i.e., before reaching `'ready'`) are not covered by this contract — the client may re-attempt connect or fail immediately depending on the error.

## Related

- Decision: [reconnect-requires-reregister](../decisions/reconnect-requires-reregister.md) (D3)
- Decision: [invite-create-no-cross-reconnect-state](../decisions/invite-create-no-cross-reconnect-state.md) (Q-N4) — cross-reconnect pending state is dropped, interacting with the `ready → reconnecting` transition.
- Decision: [signaling-client-fifo-queue-wait](../decisions/signaling-client-fifo-queue-wait.md) — queue-wait interacts with FSM: requests cannot be sent in `'disconnected'` or `'reconnecting'` states.
