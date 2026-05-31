---
id: roomfiledone-doc-types-drift
kind: tension
status: open
since: 2026-05-31
revised: 2026-05-31
---

# Tension: terminal-message transcript ordering needs per-message `seq` (questioned premise of `per-sender-seq-numbering`)

## Target

[per-sender-seq-numbering](../decisions/per-sender-seq-numbering.md) line 39 — the enumeration

> **共享 seq**（sender-generated application messages，参与 transcript 排序）：`room:msg`、`room:file_offer`、`room:file_done`、`room:file_abort`。

specifically the inclusion of `room:file_done` and `room:file_abort` in the seq-bearing list, plus `docs/protocol.md` §"room:file_done / room:file_abort" (lines 467–478) listing `seq` (CBOR key 5) as a required field for both messages.

## Suspect premise

> Terminal file-transfer messages (`room:file_done`, `room:file_abort`) require their own per-message `seq` to be ordered correctly within a transcript.

This is the load-bearing assumption that justified the Phase 1 doc amend (commit `2b49c4d`) and the inclusion of these two message types in the seq-bearing list.

The premise may not hold: terminal messages may be orderable _positionally_ — `file_done` is "the row immediately after the last `file_chunk` for that `file_id`", `file_abort` is "the row that terminated the transfer for that `file_id`" — without needing a per-message `seq`. Under positional ordering, the `(timestamp, sender_peer_id)` tuple plus the `file_id` association is enough; per-message `seq` is over-specification.

## What changes if it falls

If positional ordering turns out to suffice (premise falls):

- **`per-sender-seq-numbering.md` line 39** — `room:file_done` and `room:file_abort` move from "shared seq" to "no seq (positionally ordered)".
- **`docs/protocol.md` §"room:file_done / room:file_abort"** (lines 467–478) — the `seq` row is removed from both tables; the prose comparing to `room:msg`/`room:file_offer` seq semantics becomes incorrect.
- **`packages/protocol/test-vectors/cbor_frames.json`** — already matches the no-seq shape; no change required.
- **`packages/protocol/src/types.ts`** — `RoomFileDone` and `RoomFileAbort` already lack `seq`; no change required.
- **`packages/p2p/src/file-sender.ts` + `file-receiver.ts`** — already implemented without seq; no change required.
- **`decisions/transcript-jsonl-per-room.md`** — would need explicit positional-ordering rule for terminal rows. Currently silent on this point.

If the premise holds (premise survives):

- All five files above need the _opposite_ change: code must be retrofitted with seq generation/validation, test vectors regenerated, `FileSender` wired to a per-sender persistent counter, `FileReceiver` adding seq-gap detection on terminal rows.

The asymmetry here is significant: M3 implementation (Phases 7a/7b/8) is already in the no-seq shape and passing 10MB byte-level + SHA-256 round-trip integrity tests. So "premise falls" is the cheap direction; "premise holds" requires retrofit + 7 test updates.

## Trigger scenarios

Surfacing evidence:

- **Phase 1 amend commit `2b49c4d`** explicitly scoped itself to the doc layer: "Note: types.ts RoomFileDone and RoomFileAbort currently lack seq — to be updated in M3 implementation, not in this doc-only amend." The commit author held the premise then. The deferred code work was never picked up.
- **`BACKLOG.md` line 186** misreports the closure as complete; the doc layer closed, the code layer was deferred.
- **Phases 7a/7b/8 implementation** independently arrived at the no-seq shape. The Phase 7a executor flagged a brief-vs-types drift but did not trace upstream to the amended telos. **Crucially**: implementation worked end-to-end without `seq` on these messages, including 10MB byte-level integrity, 4 error scenarios, and dual-channel sequencing. This is a signal that under M3-scope use cases, the premise was not load-bearing.

What would falsify the premise:

- M4 daemon's transcript replay implementation tries to reconstruct file-transfer history and finds positional ordering is unambiguous (premise falls), or finds it ambiguous and needs explicit `seq` (premise holds).
- A multi-concurrent-transfer scenario (Phase 9+ or M4) where two `file_done` messages from the same sender for different `file_id` interleave with chunks: positional ordering may or may not still resolve unambiguously depending on implementation.

Until one of those scenarios runs, the premise is genuinely undecidable from M3-scope evidence.

## Status

open

Resolve at: M4 daemon transcript replay implementation. At that point the premise is concretely testable — either positional ordering reconstructs the transfer history correctly (write a decision retiring the seq field for these messages, amend `per-sender-seq-numbering.md` and `docs/protocol.md` §5), or it doesn't (write a decision executing the deferred Phase 1 code work, retrofit `types.ts` + `frame.ts` + `cbor_frames.json` + FileSender/FileReceiver).

Until then, M3 ships with the no-seq shape; M4 daemon work owns the resolution.

## Notes for the resolution-writer

The original Phase 1 sediment plan picked direction A+B (telos+spec amend) under the premise being assumed-true. Whoever resolves this tension at M4 should explicitly weigh the M3 execution-side evidence (no-seq shape worked) before re-defaulting to the original pick. The cheap-and-correct move depends on what M4 transcript replay actually needs, not on which side has more existing telos/code weight.
