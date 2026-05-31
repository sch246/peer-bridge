---
id: node-datachannel-api-quirks
kind: fact
status: stable
since: 2026-05-31
---

# Fact: node-datachannel 0.32.3 API quirks and silent-corruption boundaries

## Content

`node-datachannel@0.32.3` is the WebRTC binding the M3 p2p layer compiles against. It departs from the browser DataChannel API in three ways that have already cost implementation time, and one way that produces native heap corruption rather than a JS-level error.

### Q1: All channel state is method-call, not property-access

The browser DataChannel exposes `dc.label`, `dc.bufferedAmount`, `dc.readyState` as readonly properties. node-datachannel's `Channel` interface (file `node_modules/node-datachannel/dist/types/lib/types.d.ts`) declares these as **methods** that must be invoked:

```ts
interface Channel {
  isOpen(): boolean;
  bufferedAmount(): number;
  maxMessageSize(): number;
  // setBufferedAmountLowThreshold takes the threshold:
  setBufferedAmountLowThreshold(newSize: number): void;
  // ...callbacks registered as methods, not assigned as properties:
  onOpen(cb: () => void): void;
  onClosed(cb: () => void): void;
  onError(cb: (err: string) => void): void;
  onBufferedAmountLow(cb: () => void): void;
  onMessage(cb: (msg: string | Buffer | ArrayBuffer) => void): void;
}
```

`PeerConnection` has the same shape: `onLocalDescription`, `onLocalCandidate`, `onStateChange`, `onDataChannel`, `getLabel`, `bufferedAmount` are all methods.

**Common failure mode**: `dc.label` returns `undefined` in JavaScript (no error, just `undefined`), so a label-routing dispatch that does `if (dc.label === 'control')` silently routes nothing. The `getLabel()` form returns the actual label string. Discovered during M3 Phase 6 (commit `a3a5ba7`) when the first dispatch attempt for the bulk DataChannel failed silently.

### Q2: Empty raw send on a CBOR-framed channel crashes the native stack

If `sendMessageBinary(new Uint8Array(0))` is called on a channel whose receive side runs `decodeFrame()` synchronously inside `onMessage`, the receiver throws on 0-byte CBOR input. The throw propagates back through node-datachannel's native callback chain and corrupts the C++ side of the binding.

Symptom on Windows: process exits with `STATUS_STACK_BUFFER_OVERRUN (0xC0000409)`. Discovered during M3 Phase 7b (commit `9f619b0`) when a stray raw-zero-byte send in a test setup crashed the native runtime.

**Implication**: a single channel must use _one_ framing scheme for binary sends. Mixing raw `sendMessageBinary` with framed `sendMessageBinary(encodeFrame(msg))` on the same channel is a silent-corruption hazard if the receiver assumes the framed shape.

### Q3: Cross-channel re-entrant send works but is undocumented

Calling `controlDc.sendMessage(msg)` from inside `bulkDc.onMessage(...)` callback (i.e. sending on channel A from channel B's receive callback) works correctly with 0.32.3. node-datachannel's docs do not formally guarantee this. Phase 7b's `FileReceiver.#sendAbort()` relies on this pattern: chunk-handler callback on the bulk channel synchronously sends a `room:file_abort` on the control channel.

**Implication**: any version bump of node-datachannel must regression-test this pattern, or refactor the abort-send to be queued rather than synchronous.

### Q4: Ordered+reliable is the default mode but unstated in callsites

`createDataChannel(label, init)` defaults to ordered+reliable when `init` is `{}` or omitted. peer-bridge relies on this default for both control and bulk channels. The library does not warn or fail loudly if `unordered: true` or `maxRetransmits: N` is misconfigured — the channel simply behaves differently. Sender-side `seq_num` reordering / chunk-gap detection in M3 Phase 7b assumes the ordered+reliable default.

## Source

`native — observed under M3 implementation against node-datachannel@0.32.3 on Windows + Linux (CI matrix). Quirks Q1, Q2, Q3 manifested during specific M3 phases (Phase 6, Phase 7b, Phase 7b respectively); Q4 is implicit in every M3 channel creation.`

If node-datachannel ever ships a version that:

- migrates to property-access for channel state (Q1 reversal), or
- adds defensive zero-length filtering on the native send path (Q2 mitigation), or
- documents cross-channel callback re-entry (Q3 promotion to API contract), or
- changes the createDataChannel default (Q4 inversion),

— this fact must be re-examined. Until then, every callsite touching `node-datachannel` must respect Q1–Q4.

Evidence:

- Q1: `node_modules/node-datachannel/dist/types/lib/types.d.ts` `interface Channel` lines 1–14; commit `a3a5ba7` recovery diff in `m3-phase6-handoff.md`.
- Q2: `m3-phase7b-execute.md` §6 `assumption-bust` entry; the stray send was `alice.session.sendMessageBinaryBulk(new Uint8Array(0))` in a chunk_gap test setup, fixed before commit `9f619b0`.
- Q3: `packages/p2p/src/file-receiver.ts:277` (`#sendAbort` calling `roomSession.send` from inside bulk channel's chunk handler); `m3-phase7b-execute.md` §6 second `assumption-bust`.
- Q4: `packages/p2p/src/peer-session.ts:#setupBulkDataChannel` calls `pc.createDataChannel('bulk')` with no `init`; relied on by `FileReceiver` chunk_gap detection at `file-receiver.ts:#expectedSeq` tracking.

## Boundaries

This fact applies to:

- `node-datachannel@0.32.x` only. Other versions, especially ≥1.0, must be re-verified against Q1–Q4.
- The Node.js binding. Browser-native `RTCDataChannel` does not have these quirks; cross-platform code (e.g. a future browser-side peer) must use a separate adapter rather than treat these as universal.

It does NOT cover:

- The peer-bridge protocol layer (frame format, CBOR keys) — those are spec-level and live in `docs/protocol.md` + `decisions/unique-cbor-keys-not-message-scoped.md`.
- Application-level error semantics (which abort `reason` to send when) — those live in `decisions/datachannel-error-protocol.md`.
- libdatachannel (the C++ library underlying node-datachannel). Quirks here are the JS binding's surface, not the C++ library's behavior — though Q2 specifically reveals binding-level fragility, not application protocol error.
