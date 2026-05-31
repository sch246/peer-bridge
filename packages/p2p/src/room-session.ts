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

    // Wire the binary message path to decode incoming CBOR frames.
    this.#session.onBinaryMessage = (data: Uint8Array) => {
      if (this.onRoomMessage) {
        this.onRoomMessage(decodeFrame(data));
      }
    };
  }

  /** Send a typed RoomMessage as a CBOR-encoded frame. */
  send(msg: RoomMessage): void {
    const frame = encodeFrame(msg);
    this.#session.sendMessageBinary(frame);
  }

  /** Underlying PeerSession — passthrough for state / lifecycle. */
  get session(): PeerSession {
    return this.#session;
  }
}
