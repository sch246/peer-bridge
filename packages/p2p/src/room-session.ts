// RoomSession — thin wrapper over PeerSession that sends/receives CBOR-encoded
// RoomMessage frames instead of raw strings.
//
// Phase 5: binary frame transport. Uses encodeFrame / decodeFrame from
// @peer-bridge/protocol to convert between RoomMessage objects and
// length-prefixed CBOR frames sent over the control DataChannel.
//
// Sediment authority:
//   - .telos/decisions/datachannel-negotiation-two-channels.md (control channel, non-negotiated)
//   - docs/protocol.md §4 (CBOR frame format)

import type { PeerSession } from './peer-session.js';
import { encodeFrame, decodeFrame, type RoomMessage } from '@peer-bridge/protocol';

/** Callback receiving a decoded RoomMessage from the remote peer. */
export type RoomMessageCallback = (msg: RoomMessage) => void;

/**
 * A RoomSession wraps a PeerSession to provide RoomMessage-level send/recv.
 *
 * It takes ownership of the PeerSession's binary messaging path (onBinaryMessage,
 * sendMessageBinary) and automatically encodes/decodes CBOR frames so that
 * callers work with typed RoomMessage objects.
 *
 * The underlying PeerSession string path (onMessage, sendMessage) is left
 * untouched — callers can still use it independently for non-frame traffic.
 */
export class RoomSession {
  readonly #session: PeerSession;

  /** Fires when a decoded RoomMessage arrives from the remote peer. */
  onRoomMessage: RoomMessageCallback | null = null;

  constructor(session: PeerSession) {
    this.#session = session;

    // Wire the control binary message path to decode incoming CBOR frames.
    this.#session.onBinaryMessage = (data: Uint8Array) => {
      if (this.onRoomMessage) {
        this.onRoomMessage(decodeFrame(data));
      }
    };

    // Wire the bulk binary message path — unified into onRoomMessage.
    // Callers can dispatch on msg.type === 'room:file_chunk' to distinguish.
    this.#session.onBulkBinaryMessage = (data: Uint8Array) => {
      if (this.onRoomMessage) {
        this.onRoomMessage(decodeFrame(data));
      }
    };
  }

  /** Send a typed RoomMessage as a CBOR-encoded frame on the control channel. */
  send(msg: RoomMessage): void {
    const frame = encodeFrame(msg);
    this.#session.sendMessageBinary(frame);
  }

  /**
   * Send a typed RoomMessage as a CBOR-encoded frame on the bulk channel.
   *
   * Intended for room:file_chunk messages. Callers should check `hasBulkChannel`
   * before sending to handle graceful degrade (per
   * .telos/decisions/datachannel-negotiation-two-channels.md).
   */
  sendBulk(msg: RoomMessage): void {
    const frame = encodeFrame(msg);
    this.#session.sendMessageBinaryBulk(frame);
  }

  /**
   * Send a CBOR frame on the bulk channel, blocking until bufferedAmount drops
   * below `opts.threshold` (default 256 KiB) before sending. Rejects after
   * `opts.timeoutMs` (default 5000) of waiting if the low event never fires.
   *
   * Caller MUST check hasBulkChannel before invoking.
   *
   * [choice] Serial caller pattern: each invocation overwrites the previous
   * onBulkBufferedAmountLow callback. Concurrent calls are NOT supported —
   * FileSender's chunk loop is serial (await each chunk), so this suffices
   * for Phase 7b.
   */
  sendBulkWithBackpressure(
    msg: RoomMessage,
    opts?: { threshold?: number; timeoutMs?: number },
  ): Promise<void> {
    const threshold = opts?.threshold ?? 256 * 1024; // 256 KiB
    const timeoutMs = opts?.timeoutMs ?? 5000;

    return new Promise<void>((resolve, reject) => {
      const doSend = () => {
        try {
          this.sendBulk(msg);
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      // If buffer is already below threshold, send immediately
      if (this.#session.bulkBufferedAmount <= threshold) {
        doSend();
        return;
      }

      // Wait for bufferedAmount to drop below threshold
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.#session.onBulkBufferedAmountLow = null;
          reject(new Error('backpressure_timeout'));
        }
      }, timeoutMs);

      this.#session.onBulkBufferedAmountLow = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          this.#session.onBulkBufferedAmountLow = null;
          doSend();
        }
      };
    });
  }

  /** Whether the underlying PeerSession has a working bulk DataChannel. */
  get hasBulkChannel(): boolean {
    return this.#session.hasBulkChannel;
  }

  /** Underlying PeerSession — passthrough for state / lifecycle. */
  get session(): PeerSession {
    return this.#session;
  }
}
