// rendezvous-relay — wires a PeerSession's signaling callbacks to a RendezvousClient.
//
// Phase 2: real SDP/ICE exchange through rendezvous server. No signature/fingerprint
// verification (Phase 3). No error handling beyond malformed-payload ignore (Phase 4).
//
// Sediment authority:
//   - .telos/facts/p2p-signal-payload-format.md (3 subtypes: webrtc_offer/webrtc_answer/ice_candidate)
//   - packages/core/src/signaling.ts (client.signal / signal_in event contract)

import type { RendezvousClient } from '@peer-bridge/core';
import type { PeerSession } from './peer-session.js';

/**
 * Sub-envelope for signal payloads sent over the rendezvous channel.
 *
 * Phase 2: no signed_payload field — left for Phase 3 fingerprint signing.
 * Phase 2: no fingerprint/signature/peer_id/timestamp/nonce — all Phase 3 additions.
 */
interface SignalPayload {
  subtype: 'webrtc_offer' | 'webrtc_answer' | 'ice_candidate';
  sdp?: string;
  candidate?: string;
  mid?: string;
}

/**
 * Wire a PeerSession's signaling callbacks to a RendezvousClient.
 *
 * Outbound: session.onLocalDescription / onLocalCandidate → client.signal(peerId, ...)
 * Inbound:  client.on('signal_in', ...) → session.acceptSignal / acceptCandidate
 *
 * Returns an unsubscribe function that removes all listeners — useful for test teardown.
 *
 * @param session  The PeerSession whose signaling callbacks will be wired.
 * @param client   A RendezvousClient in 'ready' state.
 * @param peerId   The target peer's ID (PB-... format).
 * @returns        A cleanup function: call to disconnect and restore defaults.
 */
export function wireSessionToRendezvous(
  session: PeerSession,
  client: RendezvousClient,
  peerId: string,
): () => void {
  // ── Outbound: session callbacks → client.signal() ──────────────────────

  session.onLocalDescription = (sdp: string, type: 'offer' | 'answer') => {
    const payload: SignalPayload = {
      subtype: `webrtc_${type}` as 'webrtc_offer' | 'webrtc_answer',
      sdp,
    };
    client.signal(peerId, JSON.stringify(payload));
  };

  session.onLocalCandidate = (candidate: string, mid: string) => {
    const payload: SignalPayload = {
      subtype: 'ice_candidate',
      candidate,
      mid,
    };
    client.signal(peerId, JSON.stringify(payload));
  };

  // ── Inbound: client.on('signal_in') → session.acceptSignal/acceptCandidate ──

  const onSignalIn = (from: string, rawPayload: string) => {
    let msg: SignalPayload;
    try {
      msg = JSON.parse(rawPayload) as SignalPayload;
    } catch {
      console.warn(`[rendezvous-relay] Failed to parse signal_in payload from ${from}`);
      return;
    }

    switch (msg.subtype) {
      case 'webrtc_offer':
        if (!msg.sdp) {
          console.warn(`[rendezvous-relay] webrtc_offer missing sdp from ${from}`);
          return;
        }
        session.acceptSignal(msg.sdp, 'offer');
        break;

      case 'webrtc_answer':
        if (!msg.sdp) {
          console.warn(`[rendezvous-relay] webrtc_answer missing sdp from ${from}`);
          return;
        }
        session.acceptSignal(msg.sdp, 'answer');
        break;

      case 'ice_candidate':
        if (!msg.candidate) {
          console.warn(`[rendezvous-relay] ice_candidate missing candidate from ${from}`);
          return;
        }
        session.acceptCandidate(msg.candidate, msg.mid ?? '0');
        break;

      default:
        // [choice] Unknown subtype: warn and ignore. Phase 4 could add error protocol.
        console.warn(
          `[rendezvous-relay] Unknown signal subtype "${(msg as SignalPayload).subtype}" from ${from}`,
        );
    }
  };

  client.on('signal_in', onSignalIn);

  // ── Unsubscribe ────────────────────────────────────────────────────────

  return () => {
    session.onLocalDescription = null;
    session.onLocalCandidate = null;
    client.off('signal_in', onSignalIn);
  };
}
