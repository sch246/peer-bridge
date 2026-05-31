// FileReceiver — receives a file transfer from the remote peer over the RoomSession.
//
// Phase 7a: happy-path only. Listens for file_offer, delegates accept/reject
// decision to caller-supplied callback, writes incoming chunks to a .part file,
// verifies SHA-256 on file_done, and renames .part to the final path.
//
// Scope out (Phase 7b): file_abort on SHA-256 mismatch, chunk gap detection,
// bufferedAmount backpressure, >500MiB rejection, concurrent transfers.
//
// Sediment authority:
//   - .telos/decisions/datachannel-negotiation-two-channels.md (bulk channel)
//   - .telos/facts/webrtc-datachannel-limits.md (SCTP 64KiB ceiling)
//   - packages/protocol/src/types.ts (RoomFileOffer/Chunk/Done)

import crypto from 'node:crypto';
import fs from 'node:fs';
import type {
  RoomFileOffer,
  RoomFileAccept,
  RoomFileReject,
  RoomFileChunk,
  RoomFileDone,
  RoomMessage,
} from '@peer-bridge/protocol';
import type { RoomSession } from './room-session.js';

// ── Config & state ──

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export type FileReceiverConfig = {};

export type FileReceiverState =
  | 'idle'
  | 'awaiting_decision'
  | 'receiving'
  | 'verifying'
  | 'done'
  | 'failed';

/**
 * Callback invoked when a room:file_offer arrives.
 *
 * Return { accept: true, savePath } to accept the transfer and start
 * receiving chunks. Return { accept: false, reason } to reject.
 *
 * savePath is the final destination path; chunks are written to
 * `${savePath}.part` and renamed on SHA-256 verification.
 */
export type FileOfferCallback = (
  offer: RoomFileOffer,
) => Promise<{ accept: true; savePath: string } | { accept: false; reason: string }>;

// ── FileReceiver ──

export class FileReceiver {
  readonly #roomSession: RoomSession;

  #state: FileReceiverState = 'idle';

  // Active transfer state
  #currentFileId: string | null = null;
  #expectedSha256: Uint8Array | null = null;
  #expectedSize = 0;
  #bytesReceived = 0;
  #hash: crypto.Hash | null = null;
  #writeStream: fs.WriteStream | null = null;
  #savePath: string | null = null;
  #partPath: string | null = null;

  // Wait-for-done promise plumbing
  #doneResolve: ((result: { savePath: string; sha256: Uint8Array; size: number }) => void) | null =
    null;
  #doneReject: ((err: Error) => void) | null = null;
  #donePromise: Promise<{ savePath: string; sha256: Uint8Array; size: number }> | null = null;
  #failReason: string | null = null;

  // [choice] callback wrapping — see Phase 7a §10
  #originalOnRoomMessage: typeof RoomSession.prototype.onRoomMessage;

  /**
   * Caller-provided callback for file_offer decisions.
   *
   * Set before the remote peer sends file_offer. When null (default),
   * incoming offers are auto-rejected with reason 'auto_rejected'.
   */
  onFileOffer: FileOfferCallback | null = null;

  constructor(roomSession: RoomSession) {
    this.#roomSession = roomSession;

    // [choice] Wrap onRoomMessage in constructor (not lazily) so the
    // receiver is always ready to intercept file_offer / file_chunk / file_done
    // messages. The original callback (if any) is chained after our handler.
    this.#originalOnRoomMessage = roomSession.onRoomMessage;
    roomSession.onRoomMessage = (msg: RoomMessage) => {
      this.#handleMessage(msg);
      if (this.#originalOnRoomMessage) {
        this.#originalOnRoomMessage(msg);
      }
    };
  }

  // ── Public accessors ──

  get state(): FileReceiverState {
    return this.#state;
  }

  get currentFileId(): string | null {
    return this.#currentFileId;
  }

  // ── waitForDone ──

  /**
   * Returns a promise that resolves when a complete file lands on disk
   * (SHA-256 verified and renamed from .part). For test convenience.
   *
   * If the transfer already completed ('done' state), resolves immediately.
   * If already failed, rejects immediately.
   */
  waitForDone(): Promise<{ savePath: string; sha256: Uint8Array; size: number }> {
    if (this.#state === 'done') {
      return Promise.resolve({
        savePath: this.#savePath!,
        sha256: this.#expectedSha256!,
        size: this.#expectedSize,
      });
    }
    if (this.#state === 'failed') {
      return Promise.reject(new Error(this.#failReason ?? 'File transfer failed'));
    }
    if (!this.#donePromise) {
      this.#donePromise = new Promise((resolve, reject) => {
        this.#doneResolve = resolve;
        this.#doneReject = reject;
      });
    }
    return this.#donePromise;
  }

  // ── Message dispatch ──

  async #handleMessage(msg: RoomMessage): Promise<void> {
    switch (msg.type) {
      case 'room:file_offer':
        await this.#handleFileOffer(msg);
        break;
      case 'room:file_chunk':
        this.#handleFileChunk(msg);
        break;
      case 'room:file_done':
        await this.#handleFileDone(msg);
        break;
      default:
        // Pass through to original callback (already called after this)
        break;
    }
  }

  // ── file_offer handler ──

  async #handleFileOffer(msg: RoomFileOffer): Promise<void> {
    // [choice] Ignore subsequent offers while a transfer is in progress.
    // Phase 7a does not support concurrent transfers.
    if (this.#state !== 'idle') return;

    this.#state = 'awaiting_decision';

    const cb = this.onFileOffer;
    if (!cb) {
      // Default: auto-reject
      const rejectMsg: RoomFileReject = {
        type: 'room:file_reject',
        room_id: msg.room_id,
        file_id: msg.file_id,
        reason: 'auto_rejected',
        ts: Date.now(),
      };
      this.#roomSession.send(rejectMsg);
      this.#state = 'failed';
      this.#failReason = 'auto_rejected';
      return;
    }

    try {
      const decision = await cb(msg);
      if (decision.accept) {
        // ── Accept ──
        this.#currentFileId = msg.file_id;
        this.#expectedSha256 = msg.sha256;
        this.#expectedSize = msg.size;
        this.#bytesReceived = 0;
        this.#hash = crypto.createHash('sha256');
        this.#savePath = decision.savePath;
        this.#partPath = decision.savePath + '.part';

        // Open write stream for partial file
        this.#writeStream = fs.createWriteStream(this.#partPath);

        const acceptMsg: RoomFileAccept = {
          type: 'room:file_accept',
          room_id: msg.room_id,
          file_id: msg.file_id,
          ts: Date.now(),
        };
        this.#roomSession.send(acceptMsg);
        this.#state = 'receiving';
      } else {
        // ── Reject ──
        const rejectMsg: RoomFileReject = {
          type: 'room:file_reject',
          room_id: msg.room_id,
          file_id: msg.file_id,
          reason: decision.reason,
          ts: Date.now(),
        };
        this.#roomSession.send(rejectMsg);
        this.#state = 'failed';
        this.#failReason = `File rejected: ${decision.reason}`;
        this.#doneReject?.(new Error(this.#failReason));
      }
    } catch (err) {
      this.#state = 'failed';
      this.#failReason = err instanceof Error ? err.message : 'Unknown error';
      this.#doneReject?.(err as Error);
    }
  }

  // ── file_chunk handler ──

  #handleFileChunk(msg: RoomFileChunk): void {
    if (this.#state !== 'receiving') return;
    if (msg.file_id !== this.#currentFileId) return; // [choice] silent ignore for stray chunks
    if (!this.#writeStream || !this.#hash) return;

    this.#writeStream.write(Buffer.from(msg.data));
    this.#hash.update(msg.data);
    this.#bytesReceived += msg.data.byteLength;
  }

  // ── file_done handler ──

  async #handleFileDone(msg: RoomFileDone): Promise<void> {
    if (this.#state !== 'receiving') return;
    if (msg.file_id !== this.#currentFileId) return;
    if (
      !this.#writeStream ||
      !this.#hash ||
      !this.#expectedSha256 ||
      !this.#savePath ||
      !this.#partPath
    )
      return;

    this.#state = 'verifying';

    // Close the write stream
    await new Promise<void>((resolve, reject) => {
      this.#writeStream!.end(() => resolve());
      this.#writeStream!.on('error', reject);
    });
    this.#writeStream = null;

    // Compute SHA-256 digest
    const digest = new Uint8Array(this.#hash.digest());
    this.#hash = null;

    // Compare with expected hash
    if (Buffer.from(digest).equals(Buffer.from(this.#expectedSha256))) {
      // SHA-256 matches — rename .part → final path
      await fs.promises.rename(this.#partPath, this.#savePath);
      this.#state = 'done';
      this.#doneResolve?.({
        savePath: this.#savePath,
        sha256: digest,
        size: this.#expectedSize,
      });
    } else {
      // SHA-256 mismatch — fail silently (file_abort sending is Phase 7b)
      this.#state = 'failed';
      this.#failReason = 'SHA-256 mismatch';
      try {
        await fs.promises.unlink(this.#partPath);
      } catch {
        /* best-effort cleanup */
      }
      this.#doneReject?.(new Error('SHA-256 mismatch'));
    }
  }
}
