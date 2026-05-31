// P2P transport type definitions — Phase 1: skeleton types for happy-path only.
//
// Sediment authority:
//   - .telos/facts/peerconnection-lifecycle.md (5 states: idle→connecting→connected→closing→closed)
//   - .telos/facts/default-ice-servers.md (Phase 1 iceServers: [])
//   - .telos/decisions/m3-cli-p2p-bypass-daemon.md (P2PConfig in packages/p2p)

/** Configuration for PeerConnection creation and timeouts. */
export interface P2PConfig {
  /** STUN/TURN servers passed directly to node-datachannel. Phase 1 default: []. */
  iceServers: Array<{ urls: string; username?: string; credential?: string }>;
  /** Max ms to wait for PeerConnection to reach 'connected' state. Default 15_000. */
  connectTimeoutMs: number;
}

export const DEFAULT_P2P_CONFIG: P2PConfig = {
  iceServers: [],
  connectTimeoutMs: 15_000,
};

/**
 * PeerSession lifecycle states.
 *
 * Phase 1 surface: idle → connecting → connected → closing → closed.
 * Transferring and failed omitted — they belong to Phase 2 (file transfer)
 * and Phase 3 (error paths) respectively.
 */
export type PeerSessionState = 'idle' | 'connecting' | 'connected' | 'closing' | 'closed';
