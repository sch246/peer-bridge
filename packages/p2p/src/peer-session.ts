// PeerSession — wraps a single node-datachannel PeerConnection plus one control DataChannel.
//
// Phase 1: happy path only. No Ed25519 verify, no fingerprint check, no bulk channel,
// no idle timeout, no error recovery.
//
// Sediment authority:
//   - .telos/facts/peerconnection-lifecycle.md (5-state FSM)
//   - .telos/decisions/datachannel-negotiation-two-channels.md (control channel, non-negotiated)
//   - .telos/facts/p2p-signal-payload-format.md (Phase 1 uses in-memory object relay, no JSON)

import nodeDataChannel from 'node-datachannel';
import type { P2PConfig, PeerSessionState } from './types.js';

/** Callback for outgoing SDP descriptions (offer/answer). */
export type LocalDescriptionCallback = (sdp: string, type: 'offer' | 'answer') => void;

/** Callback for outgoing ICE candidates. */
export type LocalCandidateCallback = (candidate: string, mid: string) => void;

/** Callback for incoming control-channel messages. */
export type MessageCallback = (message: string) => void;

/** Callback for state transitions. */
export type StateChangeCallback = (state: PeerSessionState) => void;

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

  // ── Signal relay slots (set by caller) ──

  /** Outgoing SDP — wire to the other session's acceptSignal(). */
  onLocalDescription: LocalDescriptionCallback | null = null;

  /** Outgoing ICE candidate — wire to the other session's acceptCandidate(). */
  onLocalCandidate: LocalCandidateCallback | null = null;

  // ── Application callbacks ──

  /** Fires when the control DataChannel receives a message. */
  onMessage: MessageCallback | null = null;

  /** Fires on every state transition. */
  onStateChange: StateChangeCallback | null = null;

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

    // ── Inbound DataChannel (answerer path) ──
    this.#pc.onDataChannel((dc) => {
      this.#controlDc = dc;
      this.#setupDataChannel(dc);
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
        reject(new Error(`PeerSession startOffer timed out after ${timeout}ms`));
      }, timeout);

      const done = () => {
        clearTimeout(timer);
        resolve();
      };

      const fail = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };

      this.#connectResolve = done;
      this.#connectReject = fail;

      // Create control DataChannel — this triggers SDP negotiation.
      const dc = this.#pc.createDataChannel('control');
      this.#controlDc = dc;
      this.#setupDataChannel(dc);
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
        reject(new Error(`PeerSession waitForConnected timed out after ${timeout}ms`));
      }, timeout);

      const done = () => {
        clearTimeout(timer);
        resolve();
      };

      const fail = (err: Error) => {
        clearTimeout(timer);
        reject(err);
      };

      this.#connectResolve = done;
      this.#connectReject = fail;

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

  // ── Teardown ──

  /** Close the session: close DataChannel, then close PeerConnection. */
  close(): void {
    this.#transition('closing');
    try {
      this.#controlDc?.close();
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
      if (this.onMessage) {
        this.onMessage(String(msg));
      }
    });
  }
}
