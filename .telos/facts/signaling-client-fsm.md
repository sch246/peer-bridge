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

| Event                | Payload                                        | When                                                                                                                             | Cite                   |
| -------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `'state_change'`     | `(newState, oldState)`                         | On every state transition, including reconnect cycle states.                                                                     | —                      |
| `'reconnect'`        | `(attempt: number, delayMs: number)`           | When a backoff timer is scheduled.                                                                                               | —                      |
| `'reconnect_failed'` | `(attempts: number)`                           | When max attempts exhausted and terminal `'disconnected'` is reached.                                                            | —                      |
| `'registered'`       | `(server_id: string, federation_size: number)` | After receiving `register_ok`, before `state_change` to `'ready'`. Carries server identity for fingerprint pinning.              | `signaling.ts:447`     |
| `'disconnect'`       | `(code: number, reason: string)`               | After WS close. Provides close code + reason from the WS layer; precedes `state_change` to `'reconnecting'` or `'disconnected'`. | `signaling.ts:567,248` |

## Close-code response strategy

When the WebSocket closes, the FSM transition depends on cause, not specifically on close code. The implementation's strategy (`signaling.ts:533-590` close handler):

- **Explicit `disconnect()` call**: transitions to `'disconnected'` with no reconnect.
- **Server close from `'ready'` or `'reconnecting'`**: transitions to `'reconnecting'` and schedules backoff reconnect, regardless of close code (`1000`, `1008`, `1011`, `1013`, `1006`).
- **Close from `'connecting'` or `'registering'` while `_reconnectAttempt > 0`** (mid-reconnect-cycle): continues the reconnect cycle — the close handler transitions to `'reconnecting'` and schedules the next attempt.
- **Close from `'connecting'` or `'registering'` on first attempt** (`_reconnectAttempt === 0`): rejects the `connect()` Promise with `'register_failed'` or `'ws_open_failed'`; no auto-reconnect. The caller must re-invoke `connect()`.

**M2 does NOT discriminate close codes** for retry/fatal classification. All non-explicit closes from established states are treated as recoverable. This is a deliberate M2 simplification — close-code-aware retry policies (e.g., `1008` → fatal, `1013` → backoff longer) are deferred until production observation justifies them.

See `signaling-message-fields.md` §Error transport channel B for the close-code semantic table; this fact does not duplicate that.

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
- Closes from `'connecting'` or `'registering'` are handled per the close-code response strategy above: mid-reconnect-cycle retries continue, but a first-attempt failure rejects `connect()`. The Backoff schedule applies only to `'reconnecting'` → `'connecting'` transitions, not to WebSocket-level connection or idle timeouts (those are platform behaviors).

## Related

- Decision: [reconnect-requires-reregister](../decisions/reconnect-requires-reregister.md) (D3)
- Decision: [invite-create-no-cross-reconnect-state](../decisions/invite-create-no-cross-reconnect-state.md) (Q-N4) — cross-reconnect pending state is dropped, interacting with the `ready → reconnecting` transition.
- Decision: [signaling-client-fifo-queue-wait](../decisions/signaling-client-fifo-queue-wait.md) — queue-wait interacts with FSM: requests cannot be sent in `'disconnected'` or `'reconnecting'` states.
