// FileSender — sends a local file to the remote peer over the RoomSession.
//
// Phase 7a: happy-path only. Streams the file, computes SHA-256, sends
// file_offer on control channel, waits for file_accept, then chunks the
// file over the bulk channel. Sends file_done on completion.
//
// Scope out (Phase 7b): bufferedAmount flow control, file_abort handling,
// chunk gap detection, retry logic, >500MiB rejection.
//
// Sediment authority:
//   - .telos/decisions/datachannel-negotiation-two-channels.md (bulk channel)
//   - .telos/facts/webrtc-datachannel-limits.md (SCTP 64KiB ceiling)
//   - packages/protocol/src/types.ts (RoomFileOffer / RoomFileChunk / RoomFileDone)

import crypto from 'node:crypto';
import fs from 'node:fs';
import type {
  RoomFileOffer,
  RoomFileChunk,
  RoomFileDone,
  RoomMessage,
} from '@peer-bridge/protocol';
import type { RoomSession } from './room-session.js';

// ── Config & state ──

export interface FileSenderConfig {
  /** Absolute or relative path to the local file to send. */
  filePath: string;
  /** Protocol-layer file name (may differ from basename). */
  name: string;
  /** 16-byte room identifier. */
  roomId: Uint8Array;
  /** 32-byte sender peer identifier for the file_offer. */
  senderPeerId: Uint8Array;
  /** Starting seq number. file_offer uses seq, file_done does not carry seq. */
  seq: number;
  /** Chunk payload size in bytes. Default 60 * 1024 = 61440. */
  chunkSize?: number;
}

export type FileSenderState = 'idle' | 'awaiting_accept' | 'sending' | 'done' | 'failed';

// ── FileSender ──

export class FileSender {
  readonly #roomSession: RoomSession;
  readonly #config: Required<FileSenderConfig>;

  #state: FileSenderState = 'idle';
  readonly #fileId: string;
  #bytesSent = 0;
  #totalBytes = 0;

  // Promise plumbing for send()
  #sendResolve: (() => void) | null = null;
  #sendReject: ((err: Error) => void) | null = null;

  // [choice] callback wrapping — see Phase 7a §10
  #originalOnRoomMessage: typeof RoomSession.prototype.onRoomMessage = null;

  constructor(roomSession: RoomSession, config: FileSenderConfig) {
    this.#roomSession = roomSession;
    this.#config = { chunkSize: 60 * 1024, ...config };
    this.#fileId = crypto.randomUUID();
  }

  // ── Public accessors ──

  get state(): FileSenderState {
    return this.#state;
  }

  get fileId(): string {
    return this.#fileId;
  }

  get bytesSent(): number {
    return this.#bytesSent;
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }

  // ── send() — main entry point ──

  /**
   * Start the file transfer. Computes SHA-256, sends file_offer, and waits
   * for the remote peer to accept. Then chunks the file over the bulk channel.
   *
   * Resolves when file_done has been sent. Rejects on reject, read error,
   * or send failure.
   */
  send(): Promise<void> {
    if (this.#state !== 'idle') {
      return Promise.reject(new Error('FileSender already started'));
    }

    this.#state = 'awaiting_accept';

    return new Promise<void>(async (resolve, reject) => {
      this.#sendResolve = resolve;
      this.#sendReject = reject;

      try {
        // ── 1. Compute SHA-256 and get file size ──
        const { sha256, size } = await this.#computeHashAndSize();
        this.#totalBytes = size;

        // ── 2. Wrap onRoomMessage to listen for accept/reject ──
        // [choice] callback wrapping — save original, chain after our handler
        this.#originalOnRoomMessage = this.#roomSession.onRoomMessage;
        const self = this;
        this.#roomSession.onRoomMessage = (msg: RoomMessage) => {
          self.#handleMessage(msg);
          if (self.#originalOnRoomMessage) {
            self.#originalOnRoomMessage(msg);
          }
        };

        // ── 3. Send file_offer on control channel ──
        const offerMsg: RoomFileOffer = {
          type: 'room:file_offer',
          room_id: this.#config.roomId,
          file_id: this.#fileId,
          sender_peer_id: this.#config.senderPeerId,
          name: this.#config.name,
          size,
          sha256,
          seq: this.#config.seq,
          ts: Date.now(),
        };
        this.#roomSession.send(offerMsg);
      } catch (err) {
        this.#state = 'failed';
        this.#cleanup();
        reject(err);
      }
    });
  }

  // ── Internals ──

  /**
   * Stream-read the file and compute SHA-256 hash.
   * Returns the digest as Uint8Array and the file size from stat.
   */
  async #computeHashAndSize(): Promise<{ sha256: Uint8Array; size: number }> {
    const stat = await fs.promises.stat(this.#config.filePath);
    const hash = crypto.createHash('sha256');

    const readStream = fs.createReadStream(this.#config.filePath);
    for await (const chunk of readStream) {
      hash.update(chunk as Buffer);
    }

    return {
      sha256: new Uint8Array(hash.digest()),
      size: stat.size,
    };
  }

  /**
   * Handle incoming control-channel messages during the transfer.
   * Only file_accept and file_reject are relevant; everything else
   * passes through to the original callback (if any).
   */
  #handleMessage(msg: RoomMessage): void {
    if (this.#state !== 'awaiting_accept') {
      return; // Not expecting any control messages once sending starts
    }

    if (msg.type === 'room:file_accept' && msg.file_id === this.#fileId) {
      this.#state = 'sending';
      this.#startChunking();
    } else if (msg.type === 'room:file_reject' && msg.file_id === this.#fileId) {
      this.#state = 'failed';
      const reason = (msg as { reason: string }).reason || 'unknown';
      this.#cleanup();
      this.#sendReject?.(new Error(`File rejected: ${reason}`));
    }
    // [choice] Ignore non-matching file_id messages — they are for a
    // different transfer or from a stale session (Phase 7a assumes single
    // transfer at a time).
  }

  /**
   * Read the file in chunks and send each over the bulk channel.
   * Sends file_done on the control channel after the last chunk.
   */
  async #startChunking(): Promise<void> {
    const fd = await fs.promises.open(this.#config.filePath, 'r');
    let seqNum = 0;
    const chunkSize = this.#config.chunkSize;
    const buffer = Buffer.alloc(chunkSize);

    try {
      let position = 0;
      while (position < this.#totalBytes) {
        const { bytesRead } = await fd.read(buffer, 0, chunkSize, position);

        if (bytesRead === 0) break;

        const data = new Uint8Array(buffer.subarray(0, bytesRead));
        const chunkMsg: RoomFileChunk = {
          type: 'room:file_chunk',
          file_id: this.#fileId,
          seq_num: seqNum,
          data,
        };
        this.#roomSession.sendBulk(chunkMsg);
        this.#bytesSent += bytesRead;
        seqNum++;
        position += bytesRead;
      }

      // ── Send file_done on control channel ──
      const doneMsg: RoomFileDone = {
        type: 'room:file_done',
        file_id: this.#fileId,
        ts: Date.now(),
      };
      this.#roomSession.send(doneMsg);

      this.#state = 'done';
      this.#cleanup();
      this.#sendResolve?.();
    } catch (err) {
      this.#state = 'failed';
      this.#cleanup();
      this.#sendReject?.(err as Error);
    } finally {
      try {
        await fd.close();
      } catch {
        /* best-effort */
      }
    }
  }

  /**
   * Restore the original onRoomMessage callback so the FileSender does not
   * permanently monopolize the RoomSession's message listener.
   */
  #cleanup(): void {
    this.#roomSession.onRoomMessage = this.#originalOnRoomMessage;
    this.#originalOnRoomMessage = null;
  }
}
