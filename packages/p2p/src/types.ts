// P2P transport type definitions.
//
// Phase 4: PeerSessionState now includes 'failed' for non-recoverable connection errors.
//
// Sediment authority:
//   - .telos/facts/peerconnection-lifecycle.md (7 states incl. failed)
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
 *   idle  →  connecting  →  connected  →  closing  →  closed
 *                      ↘  failed     ↗
 *
 * 'failed' is entered when:
 *   - Ed25519 signature verification fails (signature_invalid)
 *   - peer_id doesn't match expected remote (peer_id_mismatch)
 *   - timestamp outside validity window (timestamp_invalid)
 *   - SDP a=fingerprint ≠ envelope fingerprint (sdp_fingerprint_mismatch)
 *   - Envelope missing fields or malformed (schema_invalid)
 *   - PeerConnection connectionState transitions to 'failed' (pc_connection_failed)
 *   - startOffer / waitForConnected timeout (connect_timeout)
 *
 * From 'failed' the session can be explicitly close()'d (failed → closing → closed)
 * to release resources.
 */
export type PeerSessionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'closing'
  | 'closed'
  | 'failed';
