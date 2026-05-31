// RoomSession — thin wrapper over PeerSession that sends/receives CBOR-encoded
// RoomMessage frames instead of raw strings.
//
// Phase 5: binary frame transport. Uses encodeFrame / decodeFrame from
// @peer-bridge/protocol to convert between RoomMessage objects and
// length-prefixed CBOR frames sent over the control DataChannel.
//
// Phase 8: room:hello handshake + version negotiation + capabilities exchange.
// Opt-in via RoomSessionOptions.autoHello (default false for backward compat).
//
// Sediment authority:
//   - .telos/decisions/datachannel-negotiation-two-channels.md (control channel, non-negotiated)
//   - .telos/decisions/datachannel-error-protocol.md (scenarios #5, #6)
//   - .telos/audit-trails/m3-blind-design-2026-05-30.md §2.4
//   - docs/protocol.md §4 (CBOR frame format), §5 (room:hello)

import type { PeerSession } from './peer-session.js';
import {
  encodeFrame,
  decodeFrame,
  PROTOCOL_VERSION,
  type RoomMessage,
  type RoomHello,
} from '@peer-bridge/protocol';

/** Callback receiving a decoded RoomMessage from the remote peer. */
export type RoomMessageCallback = (msg: RoomMessage) => void;

/** Options for the room:hello application-layer handshake. */
export interface RoomSessionOptions {
  /**
   * If true, automatically perform the room:hello handshake on PeerSession 'connected'.
   * Sends room:hello and waits for the peer's hello before emitting 'ready'.
   *
   * Default: false (backward-compatible — Phase 1-7b tests don't expect handshake).
   */
  autoHello?: boolean;

  /**
   * Local protocol version sent in room:hello. Default: PROTOCOL_VERSION from
   * @peer-bridge/protocol.
   */
  localVersion?: string;

  /**
   * Local capabilities sent in room:hello.
   * Default: { webrtc: true, bulk_transfer: true }
   */
  localCapabilities?: Record<string, boolean>;

  /**
   * Hello handshake timeout in ms. Default: 5000.
   * If peer's hello not received within this window after PeerSession reaches
   * 'connected', session fails with reason 'hello_timeout'.
   */
  helloTimeoutMs?: number;
}

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
  readonly #autoHello: boolean;
  readonly #helloTimeoutMs: number;

  // ── Public surface for autoHello handshake ──

  /** Resolves once both sides have exchanged room:hello and version is compatible. */
  readonly ready: Promise<void>;

  /** Local hello details (sent on connect). */
  readonly localVersion: string;
  readonly localCapabilities: Record<string, boolean>;

  /** Remote hello details (populated after peer's hello arrives). */
  remoteVersion: string | null = null;
  remoteCapabilities: Record<string, boolean> | null = null;

  /** Fires once after handshake succeeds. */
  onReady: (() => void) | null = null;

  // ── Internal handshake state ──
  #readyResolve: (() => void) | null = null;
  #readyReject: ((err: Error) => void) | null = null;
  #helloReceived = false;
  #helloTimer: ReturnType<typeof setTimeout> | null = null;

  /** Fires when a decoded RoomMessage arrives from the remote peer. */
  onRoomMessage: RoomMessageCallback | null = null;

  constructor(session: PeerSession, options?: RoomSessionOptions) {
    this.#session = session;
    this.#autoHello = options?.autoHello ?? false;
    this.#helloTimeoutMs = options?.helloTimeoutMs ?? 5000;
    this.localVersion = options?.localVersion ?? PROTOCOL_VERSION;
    this.localCapabilities = options?.localCapabilities ?? { webrtc: true, bulk_transfer: true };

    // ── ready Promise ──
    if (!this.#autoHello) {
      // Backward-compatible: immediately resolved.
      this.ready = Promise.resolve();
    } else {
      // Pending — resolved after hello handshake succeeds, rejected on failure.
      this.ready = new Promise<void>((resolve, reject) => {
        this.#readyResolve = resolve;
        this.#readyReject = reject;
      });
    }

    // ── Chain onStateChange (don't overwrite existing caller listener) ──
    const prevOnStateChange = this.#session.onStateChange;
    this.#session.onStateChange = (state) => {
      // [choice] Chain: call previous listener first, then our logic.
      if (prevOnStateChange) {
        prevOnStateChange(state);
      }
      if (this.#autoHello && state === 'connected') {
        this.#sendHello();
      }
    };

    // ── Wire the control binary message path to decode incoming CBOR frames ──
    this.#session.onBinaryMessage = (data: Uint8Array) => {
      const msg = decodeFrame(data);

      // [choice] Intercept room:hello during pending autoHello handshake.
      // Do NOT forward to caller's onRoomMessage — it's protocol-level, not app-level.
      if (this.#autoHello && !this.#helloReceived && msg.type === 'room:hello') {
        this.#handlePeerHello(msg as RoomHello);
        return;
      }

      if (this.onRoomMessage) {
        this.onRoomMessage(msg);
      }
    };

    // ── Wire the bulk binary message path — unified into onRoomMessage ──
    // Callers can dispatch on msg.type === 'room:file_chunk' to distinguish.
    this.#session.onBulkBinaryMessage = (data: Uint8Array) => {
      if (this.onRoomMessage) {
        this.onRoomMessage(decodeFrame(data));
      }
    };
  }

  // ── Auto-hello internals ──

  /** Send our room:hello on the control channel. */
  #sendHello(): void {
    const hello: RoomHello = {
      type: 'room:hello' as const,
      version: this.localVersion,
      capabilities: this.localCapabilities,
      ts: Date.now(),
    };
    const frame = encodeFrame(hello);
    this.#session.sendMessageBinary(frame);

    // Start the response timer.
    this.#helloTimer = setTimeout(() => {
      this.#readyReject?.(new Error('hello_timeout'));
      this.#session.fail('hello_timeout');
    }, this.#helloTimeoutMs);
  }

  /** Handle the peer's room:hello response. */
  #handlePeerHello(hello: RoomHello): void {
    this.#helloReceived = true;

    // Clear the timer.
    if (this.#helloTimer) {
      clearTimeout(this.#helloTimer);
      this.#helloTimer = null;
    }

    // Record remote details.
    this.remoteVersion = hello.version;
    this.remoteCapabilities = hello.capabilities;

    // [choice] Parse major version with simple split — no semver npm package.
    const localMajor = this.#parseMajor(this.localVersion);
    const remoteMajor = this.#parseMajor(hello.version);

    if (localMajor === null || remoteMajor === null || localMajor !== remoteMajor) {
      // Major mismatch (or unparseable) — per scenario #5.
      const errMsg =
        localMajor === null || remoteMajor === null
          ? `version_mismatch: invalid semver (local=${this.localVersion}, remote=${hello.version})`
          : `version_mismatch: local ${this.localVersion} peer ${hello.version}`;
      this.#readyReject?.(new Error(errMsg));
      this.#session.fail('hello_version_mismatch');
      return;
    }

    // [choice] Major matches — accept regardless of minor/patch diff (scenario #6).
    this.#readyResolve?.();
    this.#readyResolve = null;
    this.#readyReject = null;
    if (this.onReady) {
      this.onReady();
    }
  }

  /**
   * [choice] Extract major version as string. Returns null for invalid SemVer.
   *
   * Simple split: version.split('.')[0] → major part.
   * If version doesn't match 'N.N.N' pattern, returns null (treated as mismatch).
   */
  #parseMajor(version: string): string | null {
    const parts = version.split('.');
    if (parts.length < 2) return null;
    const major = Number(parts[0]);
    if (!Number.isFinite(major)) return null;
    return String(major);
  }

  // ── Messaging ──

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
