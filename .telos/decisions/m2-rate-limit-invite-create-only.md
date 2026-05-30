---
id: m2-rate-limit-invite-create-only
kind: decision
status: active
since: 2026-05-30
---

# Decision: M2 Rate Limits Invite Create Only

## Decision

M2 rendezvous server rate-limits ONLY `invite_create` per source IP. `register`, `lookup`,
`invite_redeem`, `signal`, `notify` are unbounded.

## Why

- DESIGN.md §12 promises "invite/lookup 速率限制" but the implementation only covers
  `invite_create`. This is a deliberate scope cut: `invite_create` is the most expensive
  operation (creates persistent state) and the most abuse-attractive (unsolicited code
  generation). Other operations are cheap and either require auth (`register`, `signal`,
  `notify`) or are read-only on transient state (`lookup`, `invite_redeem`).
- `lookup` rate limiting was deferred because it would require coupling the rate limiter to
  `peer_id` (anonymous lookups don't exist in M2) — adding `peer_id`-scoped rate limit is
  not justified for M2.

## Implications

- DESIGN.md §12 spec-code mismatch documented (spec says "invite/lookup", code says
  `invite_create` only). This is acknowledged technical debt; defer enforcement until
  production observation.
- All other endpoints rely on auth + per-message size cap as their abuse mitigation.

## Boundaries

- M2 scope only. Production deployment may require per-IP `lookup` and per-peer-id `notify`
  limits — re-decide at M5.
- Does NOT change the threshold for `invite_create` (still 20/hr default, configurable).

## Reference

- `packages/rendezvous/src/rate-limit.ts:1-4` (the TODO comment acknowledging the gap)
- DESIGN.md §12 line 925 (the spec promise)
- Investigation: `m2-exit-investigation.md` §T-12, §A3.
