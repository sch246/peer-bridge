## T-4: Health check response fields spec

### 1. Status in code

`packages/rendezvous/src/health.ts:8-16` — GET `/health` returns exactly three hardcoded fields:

```json
{ "peer_count": N, "federation_size": 0, "uptime_seconds": N }
```

- `peer_count` = `state.peer_registrations.size` (`state.ts:46`)
- `federation_size` = always `0` (hardcoded in `state.ts:50-52`, M2 single-server)
- `uptime_seconds` = `(Date.now() - state.started_at) / 1000` (`health.ts:10`)

No schema validation. No content-type enforcement beyond Fastify default JSON.

### 2. Status in tests

`packages/rendezvous/test/server.test.ts:852-862` — `"GET /health returns peer_count, federation_size, uptime_seconds"`:

- Asserts `res.statusCode === 200`
- Asserts `peer_count === 0`, `federation_size === 0`, `typeof uptime_seconds === 'number'`

`server.test.ts:881-918` — `"/health reflects peer count after WS registration"`: verifies `peer_count` changes after a WebSocket register.

### 3. Status in DESIGN.md / protocol.md

- **DESIGN.md §6.1** (line 475): `"健康检查：GET /health 返回 peer 数量、federation 状态。"` — mentions only 2 fields, does **not** mention `uptime_seconds`. Implementation added a third field beyond the spec.
- **protocol.md §Server Limits** (lines 186-194): table of config limits. No mention of health endpoint response shape.

### 4. Status in existing telos

`facts/rendezvous-server-config.md` covers server config surface (limits, server block, federation). Does **not** cover health endpoint response fields.

### 5. Classification recommendation

**`fact needed`** — the implementation added `uptime_seconds` beyond the DESIGN.md prose description. This is a spec-level schema decision that should be documented. Low priority (doesn't block M2 exit — the implementation already works), but `signaling-message-fields.md` style documentation of the health response envelope would close T-4.

### 6. Estimated complexity for sediment brief

**small** (<5 lines body) — one fact file recording the 3-field schema.

---

## T-7: Per-peer sealed-box notification queue — capacity upper bound + overflow strategy

### 1. Status in code

**Data structure**: `state.ts:46-48`

```typescript
readonly offline_notifications = new Map<string, OfflineNotification[]>();
```

`OfflineNotification[]` is an unbounded array per peer_id.

**Queue insertion**: `notify.ts:59-68` (`queueNotification` function):

```typescript
const existing = state.offline_notifications.get(peerId) ?? [];
existing.push(entry);
state.offline_notifications.set(peerId, existing);
```

- **No capacity check anywhere**. No per-peer or global limit on array length.
- **Overflow strategy**: **unbounded** — memory grows without bound for a peer that never re-registers and receives many notify calls.

The only size constraint is `max_offline_notify_size` (`config.ts:88` default 1024), which caps **individual** sealed-box byte length (`notify.ts:26-30`), not queue depth.

### 2. Status in tests

`packages/rendezvous/test/server.test.ts` — `handleNotify` tests (lines ~736-797):

- Tests single-entry queue for offline target (line ~748)
- Tests single-entry queue on socket write failure (line ~780)
- Tests size limit rejection (line ~762)
- **No test for multi-entry queue depth, no test for overflow, no test for capacity bound.**

### 3. Status in DESIGN.md / protocol.md

- **DESIGN.md §5.1** (line 355): `"notify: {to: peer_id, sealed_box: ≤1KB} (离线暂存)"` — mentions per-message size cap, not queue depth.
- **DESIGN.md §3.8**: decision `sealed-box-for-offline-notify.md` specifies ≤1KB per message + TTL 24h. No queue capacity.
- **protocol.md §Server Limits**: `max_offline_notify_size: 1024`, `offline_notify_ttl: 24h`. No queue depth limit.

### 4. Status in existing telos

`decisions/sealed-box-for-offline-notify.md` — defines the NaCl sealed box encryption choice and per-message constraints (≤1KB, TTL 24h). Does **not** address per-peer queue capacity or overflow strategy.

### 5. Classification recommendation

**`gap — implementation silent`** — the code has no capacity bound. This is a decision that wasn't made. The current behavior is "unbounded," which is a valid M2 choice (queues are ephemeral in-memory, restart wipes them, and there's no known DoS vector from a single sender flooding one peer because `notify` requires prior registration + valid signature). But the absence of a bound should be recorded as an explicit decision (even if "no bound for M2").

### 6. Estimated complexity for sediment brief

**small** (<5 lines body) — one decision file stating "M2: unbounded per-peer queue, no overflow strategy. Defer capacity bound to M4 when daemon persistence model adds a natural backpressure point."

---

## T-8: Notification queue TTL cleanup schedule

### 1. Status in code

TTL cleanup occurs in **exactly one place**: `register.ts:82-84` during `handleRegister`:

```typescript
const ttlCutoff = now - limits.offline_notify_ttl_hours * 3600 * 1000;
const active = queued.filter((n) => new Date(n.queued_at).getTime() > ttlCutoff);
```

- Cleanup is **lazy on delivery** — triggered only when the peer_id re-registers.
- After filtering, the whole `offline_notifications` key for that peer_id is deleted (`register.ts:80`).
- **No periodic/cron cleanup** of `offline_notifications` exists. Compare with `invite_records`: there is a `setInterval(..., 60_000)` loop (`server.ts:141-148`) that iterates all invite records and deletes expired ones. Nothing similar for `offline_notifications`.
- **Consequence**: entries for peers who **never re-register** after TTL expires remain in the `offline_notifications` Map forever — a slow memory leak.

### 2. Status in tests

`packages/rendezvous/test/server.test.ts:390-409` — `"drops expired offline notifications on delivery"`:

- Queues one fresh + one expired notification
- Registers the peer, verifies only the fresh one is delivered
- Implicitly verifies the expired one is dropped during delivery

**No test for**: periodic cleanup (because there is none), or verifying that notification keys for never-re-registering peers are eventually purged.

### 3. Status in DESIGN.md / protocol.md

- **DESIGN.md §3.8** / **protocol.md §Server Limits**: `offline_notify_ttl: 24h` — states the TTL value but does **not** specify when cleanup runs.
- DESIGN.md is silent on cleanup schedule: "lazy on lookup" vs "periodic sweep" vs "never — memory only."

### 4. Status in existing telos

`decisions/sealed-box-for-offline-notify.md`: mentions "TTL 24h" as a constraint but does **not** specify cleanup timing.

`facts/rendezvous-server-config.md`: records `offline_notify_ttl_hours = 24` as a config value. No cleanup schedule.

### 5. Classification recommendation

**`gap — implementation silent`** — the implementation does lazy-clean-at-delivery but has no periodic sweep, creating a memory leak for entries of peers that never re-register. The code's comment in `rate-limit.ts` even notes `TODO: BACKLOG T-12` for rate limits but nothing is flagged for notification cleanup. This needs a decision: (a) add periodic sweep in M2, or (b) accept memory leak as M2 scope (ephemeral in-memory, restart clears). **Recommendation**: accept as M2 scope — reconcile later in M4 when daemon persistence model is introduced.

Coupled with T-7: both are about the notification queue.

### 6. Estimated complexity for sediment brief

**small** (<5 lines body) — could even be a joint brief with T-7 ("notification queue: no capacity bound, lazy TTL cleanup, no periodic sweep — accept for M2"). One decision file.

---

## T-10: Register deduplication strategy

### 1. Status in code

`packages/rendezvous/src/handlers/register.ts:39-57`:

When the same `peer_id` calls `register` again (e.g., reconnect, or parallel second connection):

1. **Max peers bypass** (line 39-41): if `peer_registrations` already has this peer_id, the `max_peers` limit is NOT checked — the peer gets a free "reconnection slot" even when the server is full.
2. **Old socket mapping cleanup** (line 44-46): `state.socket_to_peer.delete(existing.ws)` — removes the old socket from the reverse lookup. The old socket is **not actively closed** by the server.
3. **Registration replaced** (line 49-55): new `PeerRegistration` overwrites the old one. New socket → peer_id mapping registered (line 58).

**Strategy**: **Replace-then-orphan-old-socket**. The new registration wins. The old socket becomes unauthenticated — its subsequent messages will be rejected at the "Not registered" check (`server.ts:107-110`) because `socket_to_peer.get(oldSocket)` returns `undefined`. The old socket's eventual `close` event won't delete the new registration (the reverse mapping was already removed).

The old socket is never explicitly closed with a "kicked" code — it just suddenly stops being able to send authenticated messages.

### 2. Status in tests

`packages/rendezvous/test/server.test.ts:357-370` — `"D3: reconnect replaces registration"`:

- Creates two mock sockets for the same peer_id
- Verifies `peerCount() === 1` after second register
- Verifies `socket_to_peer` has new socket, not old socket
- This test covers the reconnect case (new socket after old one is still "open" in mock)

No test for: whether the old socket is actively closed by the server (it isn't), or what happens when both sockets send authenticated messages concurrently (impossible — only new socket is in the reverse map).

### 3. Status in DESIGN.md / protocol.md

- **DESIGN.md §5.1**: register message definition. No mention of deduplication semantics.
- **protocol.md §1 register**: defines `register` and `register_ok` shapes. No dedup discussion.

Both are silent on this question.

### 4. Status in existing telos

**`decisions/reconnect-requires-reregister.md`** (D3): states "reconnect = fresh session, replace old entry." This covers the _reconnect_ scenario (old socket closed → new socket → re-register). But the implementation handles a broader case: **simultaneous** second socket from the same peer (old socket not yet closed). The telos D3 doesn't address the "old socket still alive" edge.

**`decisions/disconnect-immediate-offline.md`** (D1): says WS close → immediate eviction. But the register dedup scenario means the old registration is evicted at **re-register time**, not at old-socket-close time. The old socket close becomes a no-op (reverse mapping already removed).

### 5. Classification recommendation

**`already covered`** — D3 already establishes "replace old entry on reconnect." The fact that the code handles simultaneous sockets (old not yet closed) by orphaning them is a corollary of D3. The replace-on-reregister behavior IS the de facto dedup strategy. However, a brief clarification decision stating "old socket is orphaned, not actively closed" would be helpful to close the edge case formally.

### 6. Estimated complexity for sediment brief

**small** (<5 lines body) — amend D3 or add a short sibling decision noting the orphan-socket edge case.

---

## T-12: Per-IP rate limit thresholds beyond invite_create

### 1. Status in code

`packages/rendezvous/src/rate-limit.ts:1-4` (comment at top of file):

```
// Rate limiter — sliding window for invite_create per IP.
//
// Only max_invites_per_ip_per_hour is config-specified.
// Other rate limits (register, lookup, invite_redeem, notify): no thresholds yet.
// TODO: BACKLOG T-12 "M2 known unknowns #4: rate limit thresholds"
```

**What IS rate-limited**: only `invite_create` per IP, using a 1-hour sliding window.

- Triggered in `server.ts:202-210` (`dispatchInviteCreate`): calls `rateLimiter.check(ip)`, closes with WS 1013 "Rate limited" if exceeded.
- Default threshold: `20 per hour` (`config.ts:84`).

**What has NO rate limiting**:

- `register` — no rate check. DOS vector: register flood from same IP.
- `lookup` — no rate check. Despite DESIGN.md §12 mentioning "invite/lookup 速率限制", only invite is implemented.
- `invite_redeem` — no rate check.
- `signal` — no rate check.
- `notify` — no rate check (beyond per-message size cap).

**Rate limiter algorithm** (`rate-limit.ts:19-49`): sliding window with 1-hour buckets. Reset via `Math.random() < 0.01` stochastic cleanup (1% chance per check). Per-IP counters in `Map<string, {windowStart, count}>`. No peer_id-based rate limiting at all.

### 2. Status in tests

`packages/rendezvous/test/server.test.ts:253-284` — RateLimiter unit tests:

- Tests 20-request allowed, 21st blocked
- Tests per-IP independence
- Tests reset
- **No integration test** exercises rate limiting through the server's WebSocket dispatch (no test sends invite_create >20 times and verifies 1013 close).

### 3. Status in DESIGN.md / protocol.md

- **DESIGN.md §12** (line 925): `"rendezvous 对单 IP 的 invite/lookup 速率限制"` — says lookup rate limiting is required, but it's not implemented.
- **DESIGN.md §6.1** (line 466): config shows `max_invites_per_ip_per_hour = 20` — only config value enumerated.
- **protocol.md §Server Limits**: same config table, no per-operation rate limit thresholds beyond the config values.

### 4. Status in existing telos

`facts/rendezvous-server-config.md`: records the config surface. Explicitly notes (in Boundaries): "其他维度（register、lookup、invite_redeem 的 per-IP limit）未在 DESIGN.md 中枚举，属于 BACKLOG known-unknown #4 的未解决部分。"

### 5. Classification recommendation

**`gap — implementation silent`** — the code explicitly acknowledges the gap with a TODO comment. For M2: accept invite_create-only rate limiting. DESIGN.md §12 says lookup should also be rate-limited; this is a spec-code mismatch. Either (a) implement lookup rate limiting in a follow-up brief, or (b) decide that M2 doesn't need it and defer to M3+.

### 6. Estimated complexity for sediment brief

**small** (<5 lines body) — decision file: "M2 rate-limits only invite_create per IP. register, lookup, invite_redeem, signal, notify are unbounded for M2. Tune in production." Or, if implementing the missing lookup rate limit: **medium** (~20 lines — add `rateLimiter.check(ip)` to `dispatchLookup` + tests).

---

## T-13: Error response envelope completeness

### 1. Status in code

The server emits errors through **three different channels**, not a unified envelope:

**Channel A — `invite_result.error` string field:**

| Error value         | Emitted in                                        | File:line             |
| ------------------- | ------------------------------------------------- | --------------------- |
| `"not_found"`       | `invite_redeem` fails (code_hash unknown/expired) | `invite-redeem.ts:91` |
| `"invalid_request"` | `invite_create` fails (missing/empty fields)      | `invite-create.ts:88` |

**Channel B — WebSocket close codes (most errors):**

| Code   | Meaning          | When                                                                                | File:line                                          |
| ------ | ---------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------- |
| `1008` | Policy violation | Invalid JSON, missing envelope fields, invalid peer_id, invalid sig, not registered | `server.ts:80,84,107,110,117`; `register.ts:24,31` |
| `1011` | Server error     | Generic fallback for register failures (no specific reason)                         | `server.ts:189`                                    |
| `1013` | Too large / full | Server full (max_peers), rate limited                                               | `register.ts:42`; `server.ts:206`                  |
| `1000` | Normal           | Client-initiated disconnect                                                         | (not server code)                                  |

**Channel C — HTTP error for federation stubs:**

| Status | Body shape       | When                 | File:line         |
| ------ | ---------------- | -------------------- | ----------------- |
| `501`  | `{error: "..."}` | federation endpoints | `server.ts:64,68` |

**Channel D — `{type: "error", code, message}` that exists in client code but is NOT emitted by the server:**

`packages/core/src/signaling.ts:266-273` — the client has a handler for `msg.type === 'error'` that reads `msg.code` and `msg.message`. The signaling client test (`signaling.test.ts:723-748`) exercises this by having a mock server send `{type: "error", code: "malformed", message: "bad request"}`. **But the actual rendezvous server never sends `{type: "error", ...}`.** This is a dead code path on the server side — the shape exists in the client contract but has no server-side producer.

### 2. Status in tests

- `server.test.ts:482-489`: `invite_result` with `error: "invalid_request"` tested
- `server.test.ts:538-545`: `invite_result` with `error: "not_found"` tested
- `server.test.ts:853-862`: federation 501 tested
- `signaling.test.ts:723`: client-side error envelope `${type: "error", ...}` tested — but against a mock, not the real server
- **No test** for: list of all WS close codes the server can emit, or whether the client handles all of them correctly.

### 3. Status in DESIGN.md / protocol.md

- **DESIGN.md §5.1**: `invite_result` with optional `error` field. No enumeration of error values. No mention of unified error envelope.
- **protocol.md §1**: `invite_result.error: "not_found"` is the only error value shown in protocol examples (line 135).

### 4. Status in existing telos

`facts/signaling-message-fields.md` — has an **"invite_result.error 取值"** table that enumerates 4 possible error values: `not_found`, `expired`, `already_redeemed`, `invalid_request`. But it also notes: "当前 M2 行为: `expired` 和 `already_redeemed` 在当前 M2 server 中均 collapse 为 `not_found`." The fact file is partially accurate — it documents the _contract_ (what values could exist) and notes the implementation's current subset.

The fact file does **not** cover:

- WS close code semantics (what does 1008 vs 1013 mean?)
- Whether `{type: "error", ...}` is a server-emitted shape or client-only expectation
- Federation endpoint error shapes

### 5. Classification recommendation

**`fact needed`** — the existing `signaling-message-fields.md` partially covers invite_result.error values. What's missing:

1. A definitive table of WS close codes the server emits and their meanings
2. Decision on whether `{type: "error", code, message}` should be emitted by server (resolving the dead-code mismatch) or removed from client
3. Federation error envelope shape for M6

### 6. Estimated complexity for sediment brief

**medium** (~20 lines) — update `signaling-message-fields.md` with a §Error Codes table covering WS close codes, invite_result.error strings, and the `{type: "error"}` envelope question.

---

## Q7: Invite_record deletion criteria

### 1. Status in code

Invite records (`state.ts:35-39`, `Map<code_hash, InviteRecord>`) are deleted via **three code paths**:

| Deletion trigger                  | File:line                | Behavior                                                                                                  |
| --------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Successful redeem**             | `invite-redeem.ts:45`    | `state.invite_records.delete(code_hash)` — one-time use. Immediate.                                       |
| **Redeem of expired record**      | `invite-redeem.ts:38-39` | If `record.expires_at <= Date.now()`, delete and return not_found. Lazy-clean on lookup.                  |
| **Periodic sweep (every 60s)**    | `server.ts:141-148`      | Iterates ALL invite_records, deletes expired ones. Cron-style.                                            |
| **Prevention: expired at create** | `invite-create.ts:47-49` | If `expires_at <= Date.now()`, don't store (reject). Not really deletion — it's creation-time validation. |

**NOT deleted on**:

- **Inviter disconnect** — records survive (`state.ts` design: keyed by `code_hash`, not by inviter's WS). Verified by test (see below).
- **Explicit cancel** — no `invite_cancel` message type exists. Invites can't be cancelled once created.
- **Server restart** — all in-memory state lost (by design per §6.1).

### 2. Status in tests

- `server.test.ts:115-133` — `"invite_records survive inviter disconnect (not keyed by WS)"`: creates invite, disconnects inviter, verifies invite still exists.
- `server.test.ts:488-506` — `"redeems existing invite and deletes it (one-time use)"`: verifies `invite_records.has('abc123')` is false after redeem.
- `server.test.ts:514-525` — `"returns not_found for expired invite"`: verifies expired invite returns not_found and is cleaned up.
- **No test** for periodic cleanup — the 60s interval is not directly tested. It could be hit by timing-dependent integration tests but isn't explicitly asserted.

### 3. Status in DESIGN.md / protocol.md

- **DESIGN.md §12** (line 924): `"邀请码一次性、限时"` — says invites are one-time and time-limited. No explicit enumeration of deletion criteria.
- **DESIGN.md §5.1**: `invite_redeem` consumes the invite. No mention of expiry cleanup mechanics.
- **protocol.md §1**: `invite_ttl: 10 minutes` in Server Limits table. No deletion criteria discussion beyond that.

### 4. Status in existing telos

`decisions/disconnect-immediate-offline.md` (D1): explicitly notes that `invite_records` are NOT evicted on inviter disconnect (they're keyed by `code_hash`, not WS). This is one deletion non-path confirmed as deliberate.

No other telos file covers invite_record lifecycle.

### 5. Classification recommendation

**`already covered`** — the three deletion paths are straightforward and well-tested:

1. One-time use (redeem consumes)
2. Expiry (lazy check on redeem + periodic sweep every 60s)
3. Rejected at create if already expired

The "not deleted on inviter disconnect" is already documented in D1. The "no explicit cancel" is a deliberate omission (no cancel message type). This doesn't need a new telos file — it's already implicit in the implementation and existing D1. If anything, a one-line note in BACKLOG.md confirming "Q7 closed: invite records are deleted on redeem, on redeem-of-expired, and via 60s periodic sweep" would suffice.

### 6. Estimated complexity for sediment brief

**small** (<5 lines) — just close Q7 in BACKLOG.md. No new telos file needed.

---

## §8 Anomalies / out-of-scope findings

### A1. `{type: "error", code, message}` is a dead client code path

`packages/core/src/signaling.ts:266-273` handles `msg.type === 'error'` and reads `msg.code` / `msg.message`. `signaling.test.ts:723` exercises this with a mock. **But no code in `packages/rendezvous/src/` ever sends `{type: "error", ...}`.** The real server uses WS close codes or `invite_result.error` strings instead. This is either:

- Forward-compat scaffolding (server may add it later), or
- Dead code that should be removed from client to avoid confusion.

### A2. `offline_notifications` map has no periodic cleanup (memory leak)

`server.ts` has a `setInterval` (60s) that sweeps expired `invite_records`. No equivalent sweep exists for `offline_notifications`. Entries for peer_ids that never re-register persist forever — a slow memory leak. The rate-limiter module (`rate-limit.ts:49-55`) even has a stochastic cleanup for its own counters, but the notification store doesn't. This is a known gap (see T-8 above).

### A3. DESIGN.md §12 promises lookup rate limiting, not implemented

DESIGN.md §12 line 925: "rendezvous 对单 IP 的 invite/lookup 速率限制". The code only rate-limits `invite_create`. `lookup` has no rate limit. This is a spec-code mismatch — either the spec is aspirational or the implementation is incomplete.

### A4. Server doesn't actively close old socket on duplicate register

When the same `peer_id` calls register on a second socket, the old socket is orphaned (reverse mapping removed) but not actively closed. The old socket can sit open indefinitely until the client or network closes it. This is mostly harmless (the socket is effectively dead — subsequent messages fail auth), but it leaves a dangling connection. Should the server close the old socket with a specific code (e.g., 1008 "Session replaced")? Currently silent.

### A5. Rate limiter integration test gap

The `RateLimiter` class is unit-tested, but there's no integration test that exercises rate limiting through the full server dispatch pipeline (i.e., open WS, send 21 invite_create frames, verify 1013 close). The integration tests in `server.test.ts` don't test rate limiting at all.

---

## §9 Suggested order of sediment

### Truly independent — one brief each, no coupling

| Item | Classification  | Brief complexity | Description                                                                             |
| ---- | --------------- | ---------------- | --------------------------------------------------------------------------------------- |
| T-4  | fact needed     | small            | Health endpoint response fields fact                                                    |
| Q7   | already covered | small            | Close Q7 in BACKLOG.md with deletion-path summary                                       |
| T-13 | fact needed     | medium           | Complete error envelope fact (WS codes + invite_result.error + {type:"error"} question) |

### Coupled — combine into one brief

| Items   | Classification              | Brief complexity | Description                                                                                                                                                                               |
| ------- | --------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T-7+T-8 | gap — implementation silent | small            | Notification queue: unbounded capacity + lazy-at-delivery TTL cleanup. One decision file covering both ("M2 notification queue: unbounded, lazy TTL, no periodic sweep — accept for M2"). |
| T-10    | already covered             | small            | Register dedup is already covered by D3. Optionally amend D3 with "orphan old socket" edge note, or just note in BACKLOG.                                                                 |
| T-12    | gap — implementation silent | small            | Rate limit scope: invite_create only. Decision file stating M2 limits are invite_create-only; lookup rate limit deferred (or implement it).                                               |

### Recommended execution order

1. **T-7+T-8** (joint brief) — notification queue behavior is the most architecturally novel decision; defines a pattern for M2's stateless-in-memory philosophy.
2. **T-12** — rate limit scope; closely related to T-7+T-8 (both are about M2's "accept unbounded" stance).
3. **T-13** — error envelope fact; depends on understanding what the server actually emits (now known from T-7/T-8/T-12 investigation).
4. **T-4** — health endpoint fact; trivial, can be done concurrently with any of the above.
5. **T-10** — register dedup; already-covered, just BACKLOG note or D3 amendment.
6. **Q7** — invite_record lifecycle; already-covered, just BACKLOG note.
