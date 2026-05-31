// PeerSession error surface — typed errors for all caller-observable failure modes.
//
// Phase 4: surfaces the 5 verification-gate failures (#1, #2) plus connection-level
// failures (#7–#9 merged as connect_timeout) as typed PeerSessionError instances.
//
// Sediment authority:
//   - .telos/decisions/datachannel-error-protocol.md (17 scenarios; Phase 4 covers #1, #2, #7–#9)
//   - .telos/facts/peerconnection-lifecycle.md (failed state, connecting → failed triggers)

/**
 * Machine-readable reason for a PeerSession failure.
 *
 * Phase 4 surface (this module):
 *   - signature_invalid     — Ed25519 verify failed (scenario #1)
 *   - peer_id_mismatch      — peer_id != expectedRemotePeerId (scenario #1 sub-case)
 *   - timestamp_invalid     — timestamp outside ±5 min window (scenario #1 sub-case)
 *   - sdp_fingerprint_mismatch — SDP a=fingerprint != envelope fingerprint (scenario #2 app-layer)
 *   - schema_invalid        — envelope field missing / wrong type / unparseable
 *   - pc_connection_failed  — PeerConnection connectionState → 'failed' (scenario #2 auto)
 *   - connect_timeout       — startOffer / waitForConnected timed out (scenarios #7/#8/#9 merged)
 *
 * Phase 8 adds: hello_version_mismatch, hello_timeout.
 */
export type PeerSessionErrorReason =
  | 'signature_invalid'
  | 'peer_id_mismatch'
  | 'timestamp_invalid'
  | 'sdp_fingerprint_mismatch'
  | 'schema_invalid'
  | 'pc_connection_failed'
  | 'connect_timeout'
  | 'hello_version_mismatch'
  | 'hello_timeout';

/**
 * Typed error thrown when a PeerSession encounters a non-recoverable failure.
 *
 * Carries a machine-readable `.reason` so callers can branch on failure mode
 * without regex-parsing the error message.
 *
 * `.code` is always 1 (per datachannel-error-protocol.md "CLI exit 1").
 */
export class PeerSessionError extends Error {
  readonly reason: PeerSessionErrorReason;
  readonly code = 1;

  constructor(reason: PeerSessionErrorReason, message?: string) {
    super(message ?? `PeerSession error: ${reason}`);
    this.name = 'PeerSessionError';
    this.reason = reason;
  }
}
