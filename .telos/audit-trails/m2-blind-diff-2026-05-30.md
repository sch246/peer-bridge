# M2 Blind Diff Report — RendezvousClient Behavior Contract

> **Date**: 2026-05-30 | **Source**: `m2-blind-client.md` vs `packages/core/src/signaling.ts` vs `.telos/` > **Purpose**: Classify each blind inference/decision against ground truth (implementation + telos).
> **Rule A spot-checks**: `signaling.ts` (full, 526 lines), all 8 telos files, `m2-blind-client.md` (full), `protocol.md` §1.

---

## §1: I-1 / E-1 — WS close code → fatal/retryable

1. **Blind said**: 1000→fatal, 1008→fatal, 1011→retryable, 1013→retryable, 1006→retryable. E-1 refined: 1008 fatal in 'registering', retryable in 'ready' (then simplified to always-fatal for M2).
2. **Implementation does**: Close handler at `signaling.ts:390-420` does **not inspect close code at all**. Reconnects on any non-explicit close from `ready|reconnecting`, or from `connecting|registering` if `_reconnectAttempt > 0`. Server-closed 1000, 1008, 1011, 1013, 1006 — all treated identically if reconnect is enabled.
3. **Telos says**: `signaling-client-fsm.md` "Transitions" says "involuntary close from ready → reconnect" but doesn't define which codes are involuntary. `signaling-message-fields.md` §Error transport channel B enumerates close codes 1000/1008/1011/1013 but doesn't say client response. Telos is **silent** on the mapping.
4. **Match assessment**:
   - Blind ↔ impl: **MISMATCH**. Blind categorizes codes; impl ignores them. Blind would fatal-disconnect on 1008; impl retries 6× over ~63s.
   - Telos describes impl? **No** — tells says "involuntary close" without defining it; impl treats all non-explicit closes as involuntary.
   - Would two impls diverge? **Yes** — close-code strategy is user-visible (wasteful retries on policy rejection vs giving up on recoverable errors).
5. **Classification**: **OPEN-NEEDS-SEDIMENT**.
6. **Recommended action**: Amend `signaling-client-fsm.md` with a close-code response table. The existing section "Boundaries" says connects from `connecting|registering` are out of scope, yet the impl handles them — this mismatch should also be addressed.

---

## §2: I-2 / E-2 — invite_result Promise resolve/reject

1. **Blind said**: Resolve Promise always; caller checks `result.error`. (E-2 chose this over reject-on-error.)
2. **Implementation does**: `inviteCreate()` at `signaling.ts:179-187` and `inviteRedeem()` at `signaling.ts:195-206` **reject the Promise** when `result.error` is present — throws `RendezvousError`. `_sendRequest()` at `signaling.ts:242-277` resolves with raw msg regardless of content.
3. **Telos says**: `signaling-message-fields.md` defines `invite_result` with optional `error` field, but only at the wire level. **Silent** on TypeScript API semantics.
4. **Match assessment**:
   - Blind ↔ impl: **MISMATCH**. Blind resolves-with-error-field; impl rejects.
   - Telos describes impl? **No** — silent on Promise API shape.
   - Would two impls diverge? **Yes** — caller code path differs (`try/catch` vs `.then` checking `result.error`).
5. **Classification**: **CLOSE-AS-IMPL-DETAIL**.
6. **Recommended action**: No action. The wire contract is unchanged; both styles convey the same information. Whether the caller catches or checks a field is an ergonomics preference. The protocol contract lives in `signaling-message-fields.md` and is satisfied either way.

---

## §3: I-3 / E-5 — signal()/notify() in non-'ready' state

1. **Blind said**: (I-3) undecided between silent drop and throw. (E-5) chose **synchronously throw** `Error("Not connected")`.
2. **Implementation does**: Both `signal()` at `signaling.ts:227-237` and `notify()` at `signaling.ts:247-257` call `_guardReady()` at `signaling.ts:278-284`, which throws `RendezvousError('not_ready', ...)` when `state !== 'ready'`.
3. **Telos says**: `signaling-client-fifo-queue-wait.md` Boundaries says fire-and-forget bypass FIFO. `signaling-client-fsm.md` Boundaries says requests can't be sent in `disconnected|reconnecting`. Neither says what `signal()|notify()` do in bad states. **Silent**.
4. **Match assessment**:
   - Blind ↔ impl: **MATCH** — both throw on non-ready state.
   - Telos describes impl? **No** — silent.
   - Would two impls diverge? **Yes** — silent-drop vs throw have different caller experience (silent data loss vs unhandled error crash).
5. **Classification**: **CLOSE-AS-IMPL-DETAIL**.
6. **Recommended action**: No action. Pure API design preference. The underlying constraint (can't send without a WS connection) is inherent in the FSM. Throw vs drop doesn't affect wire protocol.

---

## §4: I-4 — push event names signal_in / notify_in

1. **Blind said**: Event names `'signal_in'` and `'notify_in'`, direct mapping from message `type`.
2. **Implementation does**: `RendezvousClientEvents` interface at `signaling.ts:43-44` declares `signal_in(from, payload)` and `notify_in(sealed_box, queued_at)`. Emit at `signaling.ts:371` and `signaling.ts:376`.
3. **Telos says**: `signaling-message-fields.md` defines `signal_in` and `notify_in` as S→C message types with their field shapes. `protocol.md` §1 lists them in the "signal → signal_in" / "notify → notify_in" sections. Telos **defines these as message types** but doesn't explicitly say "the client emits events with these names."
4. **Match assessment**:
   - Blind ↔ impl: **MATCH** — exact.
   - Telos describes impl? **Implicitly** — the message types are defined; event name follows mechanically.
   - Would two impls diverge? **Unlikely** — it's the obvious convention.
5. **Classification**: **CLOSE-AS-COVERED**.
6. **Recommended action**: No sediment needed. If discoverability matters: add "Events emitted" subsection to `signaling-client-fsm.md` listing all events, or cross-link from `signaling-message-fields.md`. The answer IS in telos already.

---

## §5: I-5 — connecting timeout

1. **Blind said**: Use platform defaults (Node.js WebSocket default connect timeout). No explicit timeout in client code.
2. **Implementation does**: `connect()` at `signaling.ts:147-163` awaits WS `open`/`error` events with **no timeout**. Relies on `ws` library and OS TCP connect timeout. Same for reconnect at `signaling.ts:438-453`.
3. **Telos says**: `signaling-client-fsm.md` Boundaries explicitly: "The backoff schedule describes the reconnecting → connecting delay. It does not cover WebSocket-level timeouts (connection timeout, idle timeout) — those are implementation-level platform behaviors."
4. **Match assessment**:
   - Blind ↔ impl: **MATCH** — both defer to platform.
   - Telos describes impl? **Yes** — telos explicitly excludes this from coverage and says it's platform-level.
   - Would two impls diverge? **POSSIBLY** — but telos explicitly says this is out of scope.
5. **Classification**: **CLOSE-AS-COVERED**.
6. **Recommended action**: No action. Telos explicitly says this is implementation-level. The blind correctly identified the boundary.

---

## §6: I-6 — registering timeout

1. **Blind said**: 30 seconds. If no `register_ok` or `notify_in` within 30s → close WS, enter reconnect.
2. **Implementation does**: `_register()` at `signaling.ts:290-298` sets a timeout. Default is `DEFAULT_REGISTER_TIMEOUT_MS = 10_000` at `signaling.ts:96`. Configurable via `registerTimeoutMs` constructor option at `signaling.ts:131`.
3. **Telos says**: **Silent**. No telos file mentions a register timeout value.
4. **Match assessment**:
   - Blind ↔ impl: **MISMATCH** — blind guessed 30s; impl uses 10s (configurable).
   - Telos describes impl? **No** — silent.
   - Would two impls diverge? **Yes** — 10s vs 30s affects perceived responsiveness before reconnect.
5. **Classification**: **CLOSE-AS-IMPL-DETAIL**.
6. **Recommended action**: No action. The timeout value is a tunable parameter, exposed as `registerTimeoutMs` in the constructor. The existence of a timeout is correct; the specific default is a tuning decision that doesn't affect protocol correctness.

---

## §7: I-7 / E-3 — notify_in dedup at reconnect + caller responsibility

1. **Blind said**: Caller responsible for dedup. Client doesn't maintain cross-reconnect consumed-notify set. (I-7 and E-3 converge.)
2. **Implementation does**: `_setupLifecycle()` at `signaling.ts:373-377` emits `'notify_in'` on **every** `notify_in` message received, with no dedup tracking across reconnects. After reconnect, server re-pushes `offline_notifications` — client fires events for all of them, including duplicates from prior connection.
3. **Telos says**: `sealed-box-for-offline-notify.md` "Consequences" says "no replay protection built-in → payload 内含 timestamp + nonce，接收方验证". `reconnect-requires-reregister.md` says `notify_in` survive reconnect (keyed by `peer_id`). Telos **implicitly** assigns replay protection to the receiver (daemon/app layer), not the transport.
4. **Match assessment**:
   - Blind ↔ impl: **MATCH** — both put dedup responsibility on caller.
   - Telos describes impl? **Implicitly** — telos says receiver validates, impl is pure transport.
   - Would two impls diverge? **Unlikely** — the telos logic chain is clear (transport can't decrypt sealed-box, so can't dedup by nonce).
5. **Classification**: **CLOSE-AS-COVERED**.
6. **Recommended action**: No sediment needed. If discoverability: cross-link `reconnect-requires-reregister.md` → `sealed-box-for-offline-notify.md` to make the dedup-responsibility chain explicit.

---

## §8: E-2 — invite_result Promise API (same as I-2)

Covered in §2 above. Classification: **CLOSE-AS-IMPL-DETAIL**. No separate action.

---

## §9: E-3 — cross-reconnect notify dedup (same as I-7)

Covered in §7 above. Classification: **CLOSE-AS-COVERED**. No separate action.

---

## §10: E-4 — constructor parameter validation scope

1. **Blind said**: Validate `url` (non-empty string), `identity.peerId` (format), `identity.publicKey` (32 bytes), `identity.secretKey` (64 bytes), `capabilities.version` (string). Defer Luhn checksum to server.
2. **Implementation does**: Constructor at `signaling.ts:122-132` performs **zero validation**. `this._url = options.url` — accepts undefined/empty/any type. `this._peerId = getPeerId(options.keypair.publicKey)` — crashes if `keypair.publicKey` is wrong length, but no explicit check. `capabilities` is entirely absent from both `RendezvousClientOptions` and the constructor — the impl auto-fills an empty capabilities object at `signaling.ts:307`.
3. **Telos says**: `protocol.md` §7 defines peer_id format and validation steps. `signaling-message-fields.md` defines `register` required fields. **Silent** on whether the client or server performs each validation step.
4. **Match assessment**:
   - Blind ↔ impl: **MISMATCH** — blind validates several fields eagerly; impl validates none.
   - Telos describes impl? **No** — silent.
   - Would two impls diverge? **Yes** — fail-fast in constructor vs fail-late at connect/register with cryptic close codes.
5. **Classification**: **CLOSE-AS-IMPL-DETAIL**.
6. **Recommended action**: No action. The protocol contract is server-side register validation; where the client catches errors is a quality-of-implementation choice. Both approaches eventually surface the same errors. A constructor validation layer could be added as a polish pass without telos guidance.

---

## §11: Bonus findings

Items in the implementation that neither blind report nor telos describe:

### B-1: `'registered'` event

`signaling.ts:44` declares `registered: (server_id: string, federation_size: number) => void`. Emitted at `signaling.ts:316` on successful register. Neither blind's API surface (§2.8 events table) nor telos `signaling-client-fsm.md` observable events mention this. **Low impact** — callers can derive from `state_change` to `'ready'`, but `registered` carries `server_id` + `federation_size` that `state_change` doesn't.

### B-2: `'disconnect'` event

`signaling.ts:45` declares `disconnect: (code: number, reason: string) => void`. Emitted at `signaling.ts:397` on WS close. Neither blind nor telos FSM lists this. Blind's FSM only lists `state_change`, `reconnect`, `reconnect_failed`. The `disconnect` event carries close code + reason that `state_change` to `'disconnected'` doesn't.

### B-3: Reconnect extends beyond 'ready' state

`signaling.ts:405-409`: impl reconnects not just from `ready|reconnecting`, but also from `connecting|registering` when `_reconnectAttempt > 0` (mid-reconnect-cycle). Telos `signaling-client-fsm.md` Boundaries says "Closes from 'connecting' or 'registering' … are not covered by this contract." Blind §2.1 "提前关闭" says the same. **The impl extends the retry scope beyond what telos commits to.** This is a behavior choice that two implementors could reasonably differ on.

### B-4: No `capabilities` in constructor

Blind constructor (§2.8) has `capabilities: { webrtc, bulk_transfer, version }`. Impl constructor (`signaling.ts:115-119`) has no capabilities field. Impl sends `{ capabilities: {} }` at `signaling.ts:307`. This means the current impl **never declares capabilities to the server** — a protocol gap if future M3+ servers gate WebRTC signaling on capability flags.

---

## §12: Recommended sediment brief

### Items requiring telos amendment (OPEN-NEEDS-SEDIMENT): **1**

| Item                                              | Action                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **§1: I-1/E-1 — WS close code → fatal/retryable** | Amend `signaling-client-fsm.md` with a close-code response table. Document the impl's actual strategy (all non-explicit closes from established states → reconnect) and explicitly note that close-code discrimination is a future refinement. The existing Boundaries paragraph that excludes `connecting | registering` closes should be updated to match the impl's mid-reconnect-cycle retry behavior. |

### Items requiring no action: **9**

| Items                                           | Reason                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §2 (I-2/E-2), §3 (I-3/E-5), §6 (I-6), §10 (E-4) | CLOSE-AS-IMPL-DETAIL — API ergonomics, tunable parameters, validation layering. Protocol contract unaffected.                                           |
| §4 (I-4), §5 (I-5), §7 (I-7/E-3)                | CLOSE-AS-COVERED — telos already has the answer (implicitly or explicitly). Discoverability improvements optional (cross-link suggestions noted above). |
| §8, §9                                          | Merged duplicates of I-2 and I-7.                                                                                                                       |

### Bonus findings: **4**

| Finding                  | Recommendation                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-1 (`registered` event) | Add to `signaling-client-fsm.md` observable events table. Low priority — derivable from `state_change`.                                                                |
| B-2 (`disconnect` event) | Add to `signaling-client-fsm.md` observable events table. Carries info (`code`, `reason`) not in `state_change`.                                                       |
| B-3 (reconnect scope)    | Absorb into §1 sediment action — the same FSM amendment should cover this.                                                                                             |
| B-4 (no capabilities)    | BACKLOG entry. If M3+ WebRTC signaling gates on capability flags, the client must declare them. Current `{ capabilities: {} }` is a placeholder. Not blocking M2 exit. |

### Single sediment brief to draft:

> **Brief: Amend `signaling-client-fsm.md` with close-code response table and reconnect scope.** Covers I-1/E-1 (§1) + bonus B-3. One file edit: add a "Close-code response" subsection under Transitions, document the current state-based strategy, note the mid-reconnect-cycle retry extension, and update Boundaries paragraph. ~15 lines of prose. No new telos file needed.
