---
id: m2-notification-queue-unbounded
kind: decision
status: active
since: 2026-05-30
---

# Decision: M2 Notification Queue Unbounded (No Capacity Limit, Lazy TTL)

## Decision

M2 rendezvous server keeps per-peer offline notification queue
(`offline_notifications: Map<peerId, OfflineNotification[]>`) **unbounded in capacity**, with
**lazy TTL cleanup at re-registration only**. No global capacity limit, no per-peer capacity
limit, no periodic sweep.

## Why

- Server is in-memory only (per `rendezvous-server-config.md`); restart wipes all state,
  providing a natural reset.
- `notify` requires prior `register` + valid signature — there is no anonymous flood vector;
  abuse requires a registered peer that has the target's pubkey.
- Sealed-box per-message size is already bounded (1KB per `sealed-box-for-offline-notify.md`).
- Adding a bounded queue requires choosing an overflow strategy (drop-oldest vs reject-new),
  which is itself a forward-compat hazard (changing it later affects observable client
  behavior). Defer the choice until M4 daemon persistence makes it natural.

## Implications

- Memory grows for peers that never re-register. In practice bounded by `max_peers` ×
  per-peer storage, but slow leak in adversarial cases.
- TTL cleanup happens only when peer re-registers
  (`packages/rendezvous/src/handlers/register.ts:82-84` filters expired entries on register).
- Operators can mitigate by restarting the server periodically.

## Boundaries

- Applies M2 only. Re-evaluate at M4 when daemon adds persistence.
- Does NOT apply to `invite_records` (separate Map with periodic 60s sweep —
  `server.ts:141-148`).
- The decision says "no bound for M2"; revisit if production telemetry shows queue depth
  runaway.

## Reference

- Investigation: `.telos/audit-trails/m2-exit-investigation-2026-05-30.md` §T-7, §T-8, §A2.
- Code: `packages/rendezvous/src/handlers/notify.ts:59-68` (insertion);
  `register.ts:80-84` (lazy TTL cleanup).
