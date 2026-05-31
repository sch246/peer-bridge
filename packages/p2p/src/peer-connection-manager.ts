// PeerConnectionManager — factory for PeerSession instances.
//
// Phase 1: creates PeerSessions and exposes createOutgoing() / createIncoming().
// The caller is responsible for wiring the signaling relay between sessions.
//
// Sediment authority:
//   - .telos/decisions/m3-cli-p2p-bypass-daemon.md (PeerConnectionManager in packages/p2p)

import { PeerSession } from './peer-session.js';
import type { P2PConfig } from './types.js';
import { DEFAULT_P2P_CONFIG } from './types.js';

let sessionCounter = 0;

/**
 * Manages PeerSession creation for P2P connections.
 *
 * In Phase 1, each PeerSession is a single PeerConnection with one control
 * DataChannel. The manager is a thin factory — the caller wires signaling
 * between two sessions and drives the offer/answer flow.
 */
export class PeerConnectionManager {
  readonly #config: P2PConfig;

  constructor(config?: Partial<P2PConfig>) {
    this.#config = { ...DEFAULT_P2P_CONFIG, ...config };
  }

  /**
   * Create a PeerSession in the outgoing (offerer) role.
   *
   * The returned session is in 'idle' state. Call `startOffer()` after wiring
   * `onLocalDescription` / `onLocalCandidate` to the remote session's
   * `acceptSignal()` / `acceptCandidate()`.
   */
  createOutgoing(): PeerSession {
    const label = `out-${++sessionCounter}`;
    return new PeerSession(this.#config, label);
  }

  /**
   * Create a PeerSession in the incoming (answerer) role.
   *
   * The returned session is in 'idle' state. Wire signaling and call
   * `acceptSignal(offer)` followed by `waitForConnected()`.
   */
  createIncoming(): PeerSession {
    const label = `in-${++sessionCounter}`;
    return new PeerSession(this.#config, label);
  }
}
