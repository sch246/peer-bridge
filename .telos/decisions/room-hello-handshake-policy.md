---
id: room-hello-handshake-policy
kind: decision
status: stable
since: 2026-05-31
---

# Decision: room:hello Handshake Policy — Auto-send, Major-mismatch closes silently

## Content

`RoomSession` performs the application-layer `room:hello` handshake automatically when constructed with `autoHello: true`. The handshake runs once per session, immediately after the underlying `PeerSession` reaches `connected`. The handshake is gated by a `ready: Promise<void>` exposed on `RoomSession`; callers `await ready` before sending any application traffic.

Handshake sequencing:

1. On `PeerSession` state transition to `connected`, both peers send `{ type: 'room:hello', version: PROTOCOL_VERSION, capabilities, ts }` on the control channel.
2. Each peer's `room:hello` arrival is **intercepted at the protocol layer** (not forwarded to the caller's `onRoomMessage`). The first hello completes the handshake; subsequent room:hello messages would be ignored (out of scope for current implementation).
3. SemVer major comparison: `version.split('.')[0]` extracted from both sides. If either side cannot parse, treated as mismatch.
   - Major match (regardless of minor/patch) → `ready` resolves, `onReady` fires, peer hello details captured in `remoteVersion` / `remoteCapabilities`.
   - Major mismatch → `PeerSession.fail('hello_version_mismatch')`, `ready` rejects with `Error('version_mismatch: local <X> peer <Y>')`. **No reply hello sent.** PC closes via `PeerSession.fail()`.
4. Hello timeout (`helloTimeoutMs`, default 5000): if no peer hello arrives within the window after `connected`, `PeerSession.fail('hello_timeout')`, `ready` rejects.

`autoHello` defaults to `false` for backward compatibility with M3 Phases 1–7b, where 23 existing p2p tests do not expect a handshake. CLI integration (Phase 9) will set `autoHello: true`.

`PROTOCOL_VERSION = '0.1.0'` is exported from `@peer-bridge/protocol` as the single source of truth for the local version string.

## Source

- Design intent: [.telos/audit-trails/m3-blind-design-2026-05-30.md](../audit-trails/m3-blind-design-2026-05-30.md) §2.4 — closed-book agent's design pass on `room:hello` sequencing, version policy, and capabilities.
- Error taxonomy authority: [datachannel-error-protocol](datachannel-error-protocol.md) scenarios #5 (major mismatch → close control DataChannel; do not send other application messages; CLI exit 1) and #6 (minor mismatch → accept; capabilities negotiation).
- Telos parent: [peerconnection-lifecycle](../facts/peerconnection-lifecycle.md) — adds `connected → failed` paths for `hello_version_mismatch` and `hello_timeout` in the FSM.
- Spec: [docs/protocol.md](../../docs/protocol.md) §"room:hello" — defines the wire format (CBOR keys 0/8/9/99); does not specify mismatch behavior, which this decision fills.

Implementation: `packages/p2p/src/room-session.ts` (commit `fe0a892`, M3 Phase 8) — `RoomSessionOptions`, `ready` Promise, `#sendHello`, `#handlePeerHello`, `#parseMajor`, intercept logic at `onBinaryMessage`. New `PeerSessionErrorReason` values `hello_version_mismatch` and `hello_timeout` in `packages/p2p/src/errors.ts`.

## Boundaries

This decision covers:

- The auto-hello sequencing on `connected`.
- The major-mismatch silent-close policy.
- The hello-timeout policy.
- The `autoHello` opt-in flag and the rationale for its default.

It does NOT cover:

- The `capabilities` map's _content_ — what keys are recognized, what they mean semantically when only one side advertises a capability. Phase 8 sets a default `{ webrtc: true, bulk_transfer: true }` but the negotiation rules (e.g. fall back when peer lacks `bulk_transfer`?) are deferred to Phase 9 CLI.
- The `RoomHello` schema. CBOR fields and types live in `docs/protocol.md` §"room:hello" + `packages/protocol/src/types.ts`. This decision adds no new fields.
- Multi-version concurrent peer support. Phase 8 implements major+0 vs major+0 only; bridging across major versions is out of scope.
- Resending hello on reconnect. M3 has no reconnect — the entire `RoomSession` is one-shot. PC reconnect lifecycle is Phase 9+ if needed.
- Hello on the bulk channel. Hello is control-channel-only.

## Why

The two structural choices were "what to do on major mismatch" and "what default for `autoHello`".

**Major mismatch — alternatives considered**:

A. **Reply with hello carrying an `error: 'version_mismatch'` field, then close.** Rejected: `RoomHello` schema in `types.ts` has no `error` field. Adding one would change wire format mid-M3, would conflict with `decisions/unique-cbor-keys-not-message-scoped.md` which discourages overloaded fields, and would require both peers to know to _read_ the error field. Asymmetric implementations (one knows, one doesn't) get worse outcomes than symmetric silent close.

B. **Encode error inside `capabilities` map.** Rejected: same readability problem. Receiver-side parsers cannot know a priori which capability keys are reserved for error signals; collisions become impossible to evolve.

C. **Silent close — no reply hello, just `PeerSession.fail('hello_version_mismatch')`.** Selected. `decisions/datachannel-error-protocol.md` scenario #5 already specified exactly this: "关闭 control DataChannel; 不发其他应用消息". Both peers, if running this implementation, fail symmetrically: each peer's hello arrives at the other side, both compare, both close. The peer who never receives a hello (because the other closed first) still falls into hello_timeout symmetrically. The user-visible failure message is informative on each side: `version_mismatch: local 0.1.0 peer 1.0.0` carries enough to explain the mismatch.

The asymmetry: A and B add wire-format weight to handle a case (cross-major-version peers) that does not yet exist. C uses existing FSM machinery.

**`autoHello` default — alternatives considered**:

A. **Default `true`**. Rejected: would break 23 existing p2p tests in Phases 1–7b that do not expect a handshake. Migrating those tests would be a lateral cost without protocol-level benefit.

B. **Default `false`, opt-in via `autoHello: true`**. Selected. Phase 9 CLI integration explicitly opts in. Existing tests untouched. Future test suites can opt in selectively.

C. **No flag — handshake always on, separate `RoomSession` constructor variant for tests.** Rejected: introduces two near-identical classes, doubles the API surface for a transient migration concern.

**SemVer parsing — alternatives considered**:

A. **Use `semver` npm package.** Rejected: adding a runtime dependency for a 5-line operation is disproportionate. `version.split('.')[0]` covers our exact need; invalid strings (no dot, non-numeric major, prerelease tags like `1.0.0-beta`) all fall through to "treat as mismatch", which is the safe direction.

B. **Implement full SemVer matching in-tree.** Rejected: M3 only needs major comparison. Minor and patch are deliberately allowed to differ.

C. **Simple `split('.')`-based major extraction with null on parse failure.** Selected. The implementation is 5 lines, easy to audit, and degrades safely.

**Hello timeout — alternatives considered**:

A. **No timeout — wait forever for peer hello.** Rejected: a peer that connects but never sends hello (buggy implementation, malicious, or transport stuck) would leave `RoomSession` in a never-resolved `ready` state, blocking caller indefinitely.

B. **5s timeout matching backpressure_timeout.** Selected. Same order-of-magnitude as other application-layer timeouts (e.g. backpressure 5s in Phase 7b), matches `datachannel-error-protocol.md` scenario timeout conventions, configurable for tests via `helloTimeoutMs`.

## References

- Parent spec: [docs/protocol.md](../../docs/protocol.md) §"room:hello"
- Sibling decision: [datachannel-error-protocol](datachannel-error-protocol.md) scenarios #5/#6 (#16 for timeout convention)
- Sibling decision: [datachannel-negotiation-two-channels](datachannel-negotiation-two-channels.md) — control vs bulk channel split
- Source fact: [peerconnection-lifecycle](../facts/peerconnection-lifecycle.md) — FSM containing the new `connected → failed` paths
- Implementation: `packages/p2p/src/room-session.ts`, `packages/p2p/src/errors.ts`, `packages/protocol/src/index.ts` (commit `fe0a892`)
