---
id: roomfiledone-doc-types-drift
kind: tension
status: open
since: 2026-05-31
---

# Tension: room:file_done / room:file_abort `seq` field — sedimented telos vs code implementation

## The two sides

### Side A — sedimented telos (post-M3-startup amend)

`decisions/per-sender-seq-numbering.md` line 39 explicitly enumerates:

> **共享 seq**（sender-generated application messages，参与 transcript 排序）：`room:msg`、`room:file_offer`、`room:file_done`、`room:file_abort`。这些消息由发送方生成，在接收方按 `(sender_peer_id, seq)` 排序，共用同一个单调递增的 seq 空间。

`docs/protocol.md` §"room:file_done / room:file_abort" (lines 467–478) lists `seq` (CBOR key 5) as a required field for both messages, with the prose "`seq` 为 sender-generated，与 `room:msg`/`room:file_offer` 的 `seq` 语义一致".

This was the _resolution_ of an earlier tension. `audit-trails/m3-startup-sediment-plan-2026-05-30.md` lines 273–278 documented C-1 as a real conflict ("所有 room:\* 共享 seq" vs `protocol.md` §5 only msg+file_offer had `seq`). The chosen resolution was direction A+B: amend `per-sender-seq-numbering.md` to enumerate which messages share `seq`, and add `seq` to the `protocol.md` §5 field tables for `file_done`/`file_abort`. `BACKLOG.md` line 186 records this as completed in M3 Phase 1 (commit chain `2b49c4d → d862be4`).

This side is valid because:

- It is the explicit sedimented resolution of an earlier tension.
- It satisfies `decisions/transcript-jsonl-per-room.md`: transcript replay needs `seq` to order terminal rows.
- Both `docs/protocol.md` and `decisions/per-sender-seq-numbering.md` agree at the telos+spec level.

### Side B — code implementation (M3 Phase 7a/7b)

`packages/protocol/src/types.ts` lines 126–135:

```ts
export interface RoomFileDone extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_FILE_DONE;
  file_id: string;
}

export interface RoomFileAbort extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_FILE_ABORT;
  room_id: Uint8Array;
  file_id: string;
  reason: string;
}
```

`ProtoMessage` adds `type` and `ts`. Neither interface declares `seq`. `packages/protocol/src/frame.ts` encode/decode for both messages does not handle `seq`. `packages/protocol/test-vectors/cbor_frames.json` for `room:file_done` carries only `type + file_id + ts`.

Phase 7a (`5c42f56`) and Phase 7b (`9f619b0`) implementations of `FileSender`/`FileReceiver` send and receive these messages without `seq`. 7 file-transfer tests pass against this shape. The Phase 7a brief originally specified `seq + room_id` for `RoomFileDone`; the Phase 7a executor surfaced this as `assumption-bust` in its friction log and chose to follow `types.ts` over the brief — but it followed `types.ts` over the _amended_ `per-sender-seq-numbering.md` and `docs/protocol.md` §5, neither of which the executor cited.

This side is valid because:

- It is the executable, type-checked, test-vector-backed authority. `decisions/test-vectors-as-spec-not-regression.md` elevates wire-format vectors to spec status.
- The wire format actually deployed in M3 has been tested for round-trip integrity (10MB byte-level deepStrictEqual + SHA-256 in Phase 7b).

## Problem

`docs/protocol.md` §5 + `per-sender-seq-numbering.md` enumeration **disagree with** `types.ts` + `cbor_frames.json` + `frame.ts` + the M3 file-transfer implementation.

This is the structural failure mode telos SKILL warns about: "when code and telos disagree, it isn't a synchronization bug; it's the meeting itself failing to close." The M3 startup amend closed the _previous_ tension on the telos side. The implementation side never executed the corresponding code change. Phase 7a saw the drift, did not name it, and rolled forward.

The hidden cost is largest for daemon (M4): transcript replay was the original justification for putting `seq` on these messages. If M4 daemon implements transcript replay assuming `seq` is present, it will fail against the M3-deployed wire format.

## Existing clues

- `audit-trails/m3-startup-sediment-plan-2026-05-30.md` lines 396 confirmed the conflict and chose direction A+B (telos amend + protocol.md amend).
- `BACKLOG.md` line 186 records "C-1 真矛盾在 Phase 1 以 amend per-sender-seq-numbering.md + docs/protocol.md §5 关闭" — claiming closure.
- `cbor_frames.json` for `room:file_done` was NOT updated when the amend landed. This was the silent gap.
- The M3 Phase 7a executor flagged the brief-vs-types drift but did not trace upstream to find that `per-sender-seq-numbering.md` and `docs/protocol.md` §5 already named `seq` as required.
- `decisions/unique-cbor-keys-not-message-scoped.md`: `seq = key 5` is allocated globally. Adding `seq` to `RoomFileDone` does not collide.

## Trigger scenarios

- M4 daemon transcript replay reading M3-generated transcripts: if daemon expects `seq` on terminal rows, it will encounter rows without `seq`.
- Any new agent reading `docs/protocol.md` §5 or `per-sender-seq-numbering.md` to implement a peer: will write `seq`, will not interop with M3 senders.
- M3 wrap-up pass: this drift makes the closed-book agent-blind protocol's authority claim ("telos + spec are the source of truth") false, because executable code has diverged.

## Candidate directions

1. **Re-execute the original A+B resolution at the code layer.** Add `seq` to `RoomFileDone` / `RoomFileAbort` in `types.ts`. Update `frame.ts` encode/decode. Regenerate `cbor_frames.json`. Update `FileSender` to assign `seq` (per-sender, persistent) and `FileReceiver` to validate ordering. This re-aligns code with the already-resolved telos. **Cost**: types.ts + frame.ts + cbor_frames.json regen + file-sender.ts + file-receiver.ts + 7 file-transfer tests + likely 1-2 extra tests for ordering. Follows the originally-decided direction.

2. **Reverse the original resolution.** Revisit `per-sender-seq-numbering.md` and `docs/protocol.md` §5; remove `room:file_done`/`room:file_abort` from the `seq`-bearing list; document that terminal rows are ordered by `ts` or positionally. This admits the M3 implementation chose a simpler shape and the original amend was over-specified. **Cost**: telos amend + docs/protocol.md §5 amend + a new fact or addition to `transcript-jsonl-per-room.md` for terminal-row ordering. No code change. Reopens a closed sediment cycle.

3. **Defer with explicit boundary.** Mark this tension `status: open` until M4 daemon work concretely needs transcript ordering of these rows. At that point the cost-benefit of (1) vs (2) is clearer because daemon's needs will pick. **Cost**: this tension stays open; risk is forgetting it again, with the same drift recurring.

The asymmetry: direction (1) executes a previously-decided resolution that did not propagate. Direction (2) revises that resolution. Direction (3) admits we are not yet ready to choose. The cheap-and-correct move depends on whether the original A+B resolution was _correct-and-not-executed_ (then (1)) or _over-specified-given-what-implementation-revealed_ (then (2)).

## Status

open

This tension is being recorded mid-M3 (after Phases 1–8 implementation) explicitly because the SKILL workflow says "when code and telos disagree, stop and resolve explicitly". A separate decision file should pick (1), (2), or (3) before M3 wrap-up. The recommended sequencing is to resolve before any further M3 phase work, since Phase 9 (CLI integration) will deploy the current shape externally, locking in the drift.
