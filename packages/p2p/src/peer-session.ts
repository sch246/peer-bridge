// PeerSession — wraps a single node-datachannel PeerConnection plus one control DataChannel.
//
// Phase 6: dual-channel support. Adds optional bulk DataChannel for file_chunk transport.
// Control channel still gates connected state. Bulk failure is graceful — control alone
// remains usable. Sediment authority for bulk: datachannel-negotiation-two-channels.md.
//
// Phase 4 lineage: error surface — onError callback + fail() method + PC connectionState=failed
// listener + typed timeout reject. Verification-gate failures (rendezvous-relay) and
// PC-level failures are caller-observable via PeerSessionError.
//
// Sediment authority:
//   - .telos/facts/peerconnection-lifecycle.md (7-state FSM incl. failed)
//   - .telos/decisions/datachannel-negotiation-two-channels.md (control + bulk, non-negotiated)
//   - .telos/decisions/datachannel-error-protocol.md (scenarios #1, #2, #7–#9)

import nodeDataChannel from 'node-datachannel';
import type { P2PConfig, PeerSessionState } from './types.js';
import { PeerSessionError } from './errors.js';
import type { PeerSessionErrorReason } from './errors.js';

/** Callback for outgoing SDP descriptions (offer/answer). */
export type LocalDescriptionCallback = (sdp: string, type: 'offer' | 'answer') => void;

/** Callback for outgoing ICE candidates. */
export type LocalCandidateCallback = (candidate: string, mid: string) => void;

/** Callback for incoming control-channel string messages. */
export type MessageCallback = (message: string) => void;

/** Callback for incoming control-channel binary messages. */
export type BinaryMessageCallback = (data: Uint8Array) => void;

/** Callback for state transitions. */
export type StateChangeCallback = (state: PeerSessionState) => void;

/** Callback for non-recoverable session failures. */
export type ErrorCallback = (err: PeerSessionError) => void;

/**
 * A PeerSession owns one PeerConnection and, once connected, one control DataChannel.
 *
 * Two PeerSessions are linked through their signaling callbacks — the caller wires
 * `onLocalDescription` / `onLocalCandidate` of one session into `acceptSignal` /
 * `acceptCandidate` of the other, forming an in-process mock relay (Phase 1) or
 * a real rendezvous-backed relay (Phase 3+).
 *
 * ## Lifecycle
 *
 *   idle  ──►  connecting  ──►  connected  ──►  closing  ──►  closed
 *
 * The offerer calls `startOffer()` to create the control DataChannel and begin SDP
 * negotiation. The answerer calls `waitForConnected()` to wait for the inbound
 * DataChannel.
 */
export class PeerSession {
  readonly #pc: nodeDataChannel.PeerConnection;
  readonly #config: P2PConfig;

  #state: PeerSessionState = 'idle';
  #controlDc: nodeDataChannel.DataChannel | null = null;
  #bulkDc: nodeDataChannel.DataChannel | null = null;
  #bulkOpen = false;

  // ── Signal relay slots (set by caller) ──

  /** Outgoing SDP — wire to the other session's acceptSignal(). */
  onLocalDescription: LocalDescriptionCallback | null = null;

  /** Outgoing ICE candidate — wire to the other session's acceptCandidate(). */
  onLocalCandidate: LocalCandidateCallback | null = null;

  // ── Application callbacks ──

  /** Fires when the control DataChannel receives a string message. */
  onMessage: MessageCallback | null = null;

  /** Fires when the control DataChannel receives a binary message. */
  onBinaryMessage: BinaryMessageCallback | null = null;

  /** Fires when the bulk DataChannel receives a binary message. */
  onBulkBinaryMessage: BinaryMessageCallback | null = null;

  /** Fires on every state transition. */
  onStateChange: StateChangeCallback | null = null;

  /** Fires when the session enters 'failed' state. Receives a typed PeerSessionError. */
  onError: ErrorCallback | null = null;

  // ── Connection promise plumbing ──

  #connectResolve: (() => void) | null = null;
  #connectReject: ((err: Error) => void) | null = null;

  constructor(config: P2PConfig, label: string) {
    this.#config = { ...config };

    this.#pc = new nodeDataChannel.PeerConnection(label, {
      iceServers: this.#config.iceServers,
    });

    // ── Outbound signaling (offer/answer/candidate) ──
    this.#pc.onLocalDescription((sdp, type) => {
      if (this.onLocalDescription) {
        this.onLocalDescription(sdp, type as 'offer' | 'answer');
      }
    });

    this.#pc.onLocalCandidate((candidate, mid) => {
      if (this.onLocalCandidate) {
        this.onLocalCandidate(candidate, mid);
      }
    });

    // ── PeerConnection state monitoring ──
    this.#pc.onStateChange((state: string) => {
      if (state === 'failed' && this.#state !== 'failed' && this.#state !== 'closed') {
        this.fail('pc_connection_failed');
      }
    });

    // ── Inbound DataChannel (answerer path) ──
    // node-datachannel 0.32.3: DataChannel exposes getLabel() method, NOT a `label`
    // property. Reading `dc.label` returns undefined and silently breaks routing.
    this.#pc.onDataChannel((dc) => {
      const label = dc.getLabel();
      if (label === 'control') {
        this.#controlDc = dc;
        this.#setupDataChannel(dc);
      } else if (label === 'bulk') {
        this.#bulkDc = dc;
        this.#setupBulkDataChannel(dc);
      }
      // Unknown labels: silently ignore.
    });
  }

  // ── Public state ──

  get state(): PeerSessionState {
    return this.#state;
  }

  // ── Inbound signaling (called by relay) ──

  /** Deliver SDP from the remote peer. */
  acceptSignal(sdp: string, type: 'offer' | 'answer'): void {
    if (this.#state === 'idle') {
      this.#transition('connecting');
    }
    this.#pc.setRemoteDescription(sdp, type);
  }

  /** Deliver ICE candidate from the remote peer. */
  acceptCandidate(candidate: string, mid: string): void {
    this.#pc.addRemoteCandidate(candidate, mid);
  }

  // ── Offerer flow ──

  /**
   * Create the control DataChannel and initiate the SDP offer.
   *
   * Resolves when both the PeerConnection and the DataChannel reach 'connected'.
   * Callers must wire `onLocalDescription` / `onLocalCandidate` BEFORE calling this.
   */
  startOffer(timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? this.#config.connectTimeoutMs;
    this.#transition('connecting');

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail('connect_timeout');
      }, timeout);

      const done = () => {
        clearTimeout(timer);
        resolve();
      };

      const failFn = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };

      this.#connectResolve = done;
      this.#connectReject = failFn;

      // Create control DataChannel — this triggers SDP negotiation.
      const dc = this.#pc.createDataChannel('control');
      this.#controlDc = dc;
      this.#setupDataChannel(dc);

      // Create bulk DataChannel — graceful degrade per datachannel-negotiation-two-channels.md.
      // If creation throws, control alone remains usable; caller sees hasBulkChannel=false.
      try {
        const bulk = this.#pc.createDataChannel('bulk');
        this.#bulkDc = bulk;
        this.#setupBulkDataChannel(bulk);
      } catch {
        this.#bulkDc = null;
      }
    });
  }

  /**
   * Wait for the inbound DataChannel to open and the PeerConnection to connect.
   *
   * The answerer calls this after `acceptSignal(offer)` — the DataChannel arrives
   * via `onDataChannel` during SDP negotiation.
   */
  waitForConnected(timeoutMs?: number): Promise<void> {
    const timeout = timeoutMs ?? this.#config.connectTimeoutMs;

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail('connect_timeout');
      }, timeout);

      const done = () => {
        clearTimeout(timer);
        resolve();
      };

      const failFn = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };

      this.#connectResolve = done;
      this.#connectReject = failFn;

      // If the DataChannel already arrived (race condition), check it.
      if (this.#controlDc) {
        // onOpen may have already fired — check state.
        if (this.#state === 'connected') {
          done();
          return;
        }
        // Otherwise wait for onOpen (already registered in setupDataChannel).
      }
    });
  }

  // ── Messaging ──

  /** Send a string message on the control DataChannel. */
  sendMessage(data: string): void {
    if (!this.#controlDc || this.#state !== 'connected') {
      throw new Error('Cannot send message: PeerSession is not connected');
    }
    this.#controlDc.sendMessage(data);
  }

  /** Send a binary message (CBOR frame) on the control DataChannel. */
  sendMessageBinary(data: Uint8Array): void {
    if (!this.#controlDc || this.#state !== 'connected') {
      throw new Error('Cannot send binary message: PeerSession is not connected');
    }
    this.#controlDc.sendMessageBinary(data);
  }

  /**
   * Send a binary message (CBOR file_chunk frame) on the bulk DataChannel.
   *
   * Throws if not connected or if the bulk channel is unavailable (failed to
   * create or never opened). Callers should check `hasBulkChannel` first when
   * tolerating graceful degrade.
   */
  sendMessageBinaryBulk(data: Uint8Array): void {
    if (this.#state !== 'connected') {
      throw new Error('Cannot send bulk message: PeerSession is not connected');
    }
    if (!this.#bulkDc || !this.#bulkOpen) {
      throw new Error('Cannot send bulk message: bulk DataChannel is not available');
    }
    this.#bulkDc.sendMessageBinary(data);
  }

  /** Whether the bulk DataChannel was successfully created and opened. */
  get hasBulkChannel(): boolean {
    return this.#bulkDc !== null && this.#bulkOpen;
  }

  // ── Bulk backpressure API (Phase 7b) ──

  /**
   * Bytes currently buffered in the bulk DataChannel send queue.
   * Returns 0 if the bulk channel is unavailable.
   *
   * node-datachannel 0.32.3: bufferedAmount() is a method, not a property.
   */
  get bulkBufferedAmount(): number {
    return this.#bulkDc?.bufferedAmount() ?? 0;
  }

  /**
   * Set the low-watermark threshold for the bulk DataChannel.
   * When bufferedAmount drops below this threshold, onBulkBufferedAmountLow fires.
   * No-op if the bulk channel is unavailable.
   */
  setBulkBufferedAmountLowThreshold(threshold: number): void {
    if (this.#bulkDc) {
      this.#bulkDc.setBufferedAmountLowThreshold(threshold);
    }
  }

  /**
   * Fires once each time bufferedAmount drops below the threshold.
   * Set by the RoomSession to implement sendBulkWithBackpressure.
   */
  onBulkBufferedAmountLow: (() => void) | null = null;

  // ── Teardown ──

  /**
   * Transition the session to 'failed' with the given reason.
   *
   * Emits onError, rejects any pending startOffer/waitForConnected promise,
   * and closes the underlying PeerConnection.
   *
   * Idempotent — subsequent calls are no-ops once in 'failed' or 'closed'.
   */
  fail(reason: PeerSessionErrorReason): void {
    if (this.#state === 'failed' || this.#state === 'closed') return;

    const err = new PeerSessionError(reason);
    this.#transition('failed');

    // Emit onError callback (best-effort — user callback may throw)
    if (this.onError) {
      try {
        this.onError(err);
      } catch {
        /* user callback threw — swallow */
      }
    }

    // Reject pending connect promise so callers don't hang
    if (this.#connectReject) {
      this.#connectReject(err);
      this.#connectResolve = null;
      this.#connectReject = null;
    }

    // Close the underlying PeerConnection (best-effort — it may already be dead)
    try {
      this.#pc.close();
    } catch {
      /* already closed */
    }
  }

  /** Close the session: close DataChannel, then close PeerConnection. */
  close(): void {
    // Allow explicit cleanup from any state (including 'failed').
    if (this.#state !== 'failed') {
      this.#transition('closing');
    } else {
      // From 'failed' the PC is already closed; just move through closing → closed.
      this.#transition('closing');
    }
    try {
      this.#controlDc?.close();
    } catch {
      /* best-effort */
    }
    try {
      this.#bulkDc?.close();
    } catch {
      /* best-effort */
    }
    try {
      this.#pc.close();
    } catch {
      /* best-effort */
    }
    this.#transition('closed');
  }

  // ── Internals ──

  #transition(next: PeerSessionState): void {
    if (this.#state === next) return;
    this.#state = next;
    if (this.onStateChange) {
      this.onStateChange(next);
    }
  }

  #setupDataChannel(dc: nodeDataChannel.DataChannel): void {
    dc.onOpen(() => {
      this.#transition('connected');
      if (this.#connectResolve) {
        this.#connectResolve();
        this.#connectResolve = null;
        this.#connectReject = null;
      }
    });

    dc.onMessage((msg) => {
      if (typeof msg === 'string') {
        if (this.onMessage) {
          this.onMessage(msg);
        }
      } else {
        // Buffer or ArrayBuffer → route to binary callback
        if (this.onBinaryMessage) {
          const data = msg instanceof Uint8Array ? msg : new Uint8Array(msg.buffer ?? msg);
          this.onBinaryMessage(data);
        }
      }
    });
  }

  /**
   * Set up the bulk DataChannel — wires onOpen + onMessage but does NOT drive
   * PeerSession state transitions. The control channel alone gates `connected`.
   */
  #setupBulkDataChannel(dc: nodeDataChannel.DataChannel): void {
    dc.onOpen(() => {
      this.#bulkOpen = true;
    });

    dc.onBufferedAmountLow(() => {
      if (this.onBulkBufferedAmountLow) {
        this.onBulkBufferedAmountLow();
      }
    });

    dc.onMessage((msg) => {
      // Bulk channel is binary-only.
      if (typeof msg !== 'string' && this.onBulkBinaryMessage) {
        const data = msg instanceof Uint8Array ? msg : new Uint8Array(msg.buffer ?? msg);
        this.onBulkBinaryMessage(data);
      }
    });
  }
}
