// rendezvous-relay — wires a PeerSession's signaling callbacks to a RendezvousClient.
//
// Phase 3: Ed25519 fingerprint signing on offer/answer envelopes.
// Verifies peer_id, timestamp, signature, and envelope↔SDP fingerprint consistency
// before accepting inbound signals. Rejects forged/mismatched envelopes.
//
// ICE candidates are not signed (sediment §"ICE candidate 不签名的理由").
// Because signature verification is async, ICE candidates arriving during
// verification are buffered and flushed after the offer/answer is accepted.
//
// Sediment authority:
//   - .telos/facts/p2p-signal-payload-format.md (sub-envelope schema: 6 fields + ice_candidate)
//   - packages/core/src/fingerprint.ts (signFingerprint / verifyFingerprint / isTimestampValid)
//   - packages/core/src/identity.ts (SignKeyPair)

import type { RendezvousClient } from '@peer-bridge/core';
import { signFingerprint, verifyFingerprint, isTimestampValid } from '@peer-bridge/core';
import { decodePeerId } from '@peer-bridge/protocol';
import { randomBytes } from 'node:crypto';
import type { PeerSession } from './peer-session.js';
import { extractSDPFingerprint } from './sdp-fingerprint.js';
import type { SignKeyPair } from '@peer-bridge/core';

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Authentication material for fingerprint signing on the rendezvous relay.
 *
 * Both sides must supply their own keypair and the peer_id they expect
 * from the remote side.  The relay will reject any offer/answer whose
 * signature does not verify against the expected peer_id.
 */
export interface RelayAuthOptions {
  /** The local Ed25519 keypair (used for signing outbound offers/answers). */
  keyPair: SignKeyPair;
  /** The local peer_id in PB-... format (included in the signed payload). */
  localPeerId: string;
  /** The expected remote peer_id in PB-... format (verified on inbound). */
  expectedRemotePeerId: string;
}

// ── Sub-envelope types (sediment §p2p-signal-payload-format) ─────────────

interface OfferAnswerPayload {
  subtype: 'webrtc_offer' | 'webrtc_answer';
  sdp: string;
  fingerprint: string; // 32-byte hex (64 chars)
  signature: string; // base64, 64 bytes → 88 chars
  peer_id: string; // PB-...
  timestamp: number; // Unix sec
  nonce: string; // base64, 16 bytes → 24 chars
}

interface IceCandidatePayload {
  subtype: 'ice_candidate';
  candidate: string;
  sdp_mid: string;
  sdp_mline_index: number;
}

type SignalPayload = OfferAnswerPayload | IceCandidatePayload;

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Wire a PeerSession's signaling callbacks to a RendezvousClient.
 *
 * Outbound: session.onLocalDescription / onLocalCandidate → client.signal(peerId, ...)
 *   - offer/answer are signed with the local keypair
 * Inbound:  client.on('signal_in', ...) → verify then session.acceptSignal / acceptCandidate
 *   - offer/answer must pass all verification checks or they are silently dropped
 *   - ICE candidates are buffered until the offer/answer from the same peer is accepted
 *
 * Returns an unsubscribe function that removes all listeners — useful for test teardown.
 *
 * @param session  The PeerSession whose signaling callbacks will be wired.
 * @param client   A RendezvousClient in 'ready' state.
 * @param peerId   The target peer's ID (PB-... format) — used for client.signal() routing.
 * @param auth     Local keypair and expected peer identities for signing/verification.
 * @returns        A cleanup function: call to disconnect and restore defaults.
 */
export function wireSessionToRendezvous(
  session: PeerSession,
  client: RendezvousClient,
  peerId: string,
  auth: RelayAuthOptions,
): () => void {
  // ── Outbound: session callbacks → client.signal() ──────────────────────

  session.onLocalDescription = async (sdp: string, type: 'offer' | 'answer') => {
    try {
      const fpBytes = extractSDPFingerprint(sdp);
      const timestamp = Math.floor(Date.now() / 1000);
      const nonceBytes = new Uint8Array(randomBytes(16));

      const sigBytes = await signFingerprint(
        fpBytes,
        decodePeerId(auth.localPeerId),
        timestamp,
        nonceBytes,
        auth.keyPair.secretKey,
      );

      const payload: OfferAnswerPayload = {
        subtype: `webrtc_${type}` as 'webrtc_offer' | 'webrtc_answer',
        sdp,
        fingerprint: Buffer.from(fpBytes).toString('hex'),
        signature: Buffer.from(sigBytes).toString('base64'),
        peer_id: auth.localPeerId,
        timestamp,
        nonce: Buffer.from(nonceBytes).toString('base64'),
      };
      client.signal(peerId, JSON.stringify(payload));
    } catch (err) {
      console.warn('[rendezvous-relay] Failed to sign outbound signal', err);
    }
  };

  session.onLocalCandidate = (candidate: string, mid: string) => {
    const payload: IceCandidatePayload = {
      subtype: 'ice_candidate',
      candidate,
      sdp_mid: mid,
      // [choice] sdp_mline_index always 0 — node-datachannel onLocalCandidate
      // callback only provides (candidate, mid), not the m-line index.
      // With a single DataChannel there is only one m-line (index 0).
      sdp_mline_index: 0,
    };
    client.signal(peerId, JSON.stringify(payload));
  };

  // ── Inbound: client.on('signal_in') → verify → session ────────────────
  //
  // ICE candidates are buffered until acceptSignal has been called at least
  // once (i.e. the first remote description has been set).  This prevents
  // "remote candidate without remote description" errors caused by:
  //   - async signature verification delaying acceptSignal()
  //   - trickle-ICE reordering (candidates arriving before the offer/answer)

  let remoteDescSet = false;
  let pendingIceCandidates: { candidate: string; sdp_mid: string }[] = [];

  const flushIceCandidates = () => {
    const pending = pendingIceCandidates;
    pendingIceCandidates = [];
    for (const ic of pending) {
      try {
        session.acceptCandidate(ic.candidate, ic.sdp_mid);
      } catch {
        // best-effort — if the session is already closed, drop silently
      }
    }
  };

  const onSignalIn = (from: string, rawPayload: string) => {
    let msg: SignalPayload;
    try {
      msg = JSON.parse(rawPayload) as SignalPayload;
    } catch {
      console.warn(`[rendezvous-relay] Failed to parse signal_in payload from ${from}`);
      return;
    }

    switch (msg.subtype) {
      // ── offer / answer: full verification ──────────────────────────
      case 'webrtc_offer':
      case 'webrtc_answer': {
        const oa = msg as OfferAnswerPayload;

        // (a) Schema completeness: all 6 fields must be present
        if (
          typeof oa.sdp !== 'string' ||
          typeof oa.fingerprint !== 'string' ||
          typeof oa.signature !== 'string' ||
          typeof oa.peer_id !== 'string' ||
          typeof oa.timestamp !== 'number' ||
          typeof oa.nonce !== 'string'
        ) {
          console.warn(`[rendezvous-relay] ${oa.subtype} from ${from} missing required fields`);
          return;
        }

        // (b) Peer ID must match expected remote
        if (oa.peer_id !== auth.expectedRemotePeerId) {
          console.warn(
            `[rendezvous-relay] ${oa.subtype} from ${from}: ` +
              `peer_id "${oa.peer_id}" does not match expected "${auth.expectedRemotePeerId}"`,
          );
          return;
        }

        // (c) Timestamp within ±5 min window
        if (!isTimestampValid(oa.timestamp, 300)) {
          console.warn(
            `[rendezvous-relay] ${oa.subtype} from ${from}: ` +
              `timestamp ${oa.timestamp} outside validity window`,
          );
          return;
        }

        // Decode envelope fields for verification
        let fpBytes: Uint8Array;
        try {
          fpBytes = new Uint8Array(Buffer.from(oa.fingerprint, 'hex'));
          if (fpBytes.length !== 32) throw new Error('short');
        } catch {
          console.warn(`[rendezvous-relay] ${oa.subtype} from ${from}: invalid fingerprint hex`);
          return;
        }

        let sigBytes: Uint8Array;
        try {
          sigBytes = new Uint8Array(Buffer.from(oa.signature, 'base64'));
        } catch {
          console.warn(`[rendezvous-relay] ${oa.subtype} from ${from}: invalid signature base64`);
          return;
        }

        let nonceBytes: Uint8Array;
        try {
          nonceBytes = new Uint8Array(Buffer.from(oa.nonce, 'base64'));
        } catch {
          console.warn(`[rendezvous-relay] ${oa.subtype} from ${from}: invalid nonce base64`);
          return;
        }

        // (d) Signature verification (async)
        const remotePubKey = decodePeerId(oa.peer_id);
        void verifyFingerprint(
          fpBytes,
          remotePubKey,
          oa.timestamp,
          nonceBytes,
          sigBytes,
          remotePubKey,
        ).then((valid) => {
          if (!valid) {
            console.warn(
              `[rendezvous-relay] ${oa.subtype} from ${from}: signature verification failed`,
            );
            // Discard buffered candidates — they matched the rejected offer/answer
            pendingIceCandidates = [];
            return;
          }

          // (e) SDP fingerprint must match envelope fingerprint
          let sdpFp: Uint8Array;
          try {
            sdpFp = extractSDPFingerprint(oa.sdp);
          } catch (err) {
            console.warn(
              `[rendezvous-relay] ${oa.subtype} from ${from}: ` +
                `failed to extract SDP fingerprint: ${(err as Error).message}`,
            );
            pendingIceCandidates = [];
            return;
          }
          if (Buffer.from(sdpFp).toString('hex') !== oa.fingerprint) {
            console.warn(
              `[rendezvous-relay] ${oa.subtype} from ${from}: ` +
                'SDP fingerprint does not match envelope fingerprint',
            );
            pendingIceCandidates = [];
            return;
          }

          // All checks passed — deliver to session, then flush buffered ICE candidates
          session.acceptSignal(oa.sdp, oa.subtype === 'webrtc_offer' ? 'offer' : 'answer');
          remoteDescSet = true;
          flushIceCandidates();
        });

        break;
      }

      // ── ICE candidate: no signing, buffer while offer/answer is pending ──
      case 'ice_candidate': {
        const ic = msg as IceCandidatePayload;
        if (!ic.candidate) {
          console.warn(`[rendezvous-relay] ice_candidate missing candidate from ${from}`);
          return;
        }
        if (!remoteDescSet) {
          pendingIceCandidates.push({
            candidate: ic.candidate,
            sdp_mid: ic.sdp_mid ?? '0',
          });
        } else {
          session.acceptCandidate(ic.candidate, ic.sdp_mid ?? '0');
        }
        break;
      }

      default:
        // [choice] Unknown subtype: warn and ignore.
        // Phase 4 could add error protocol with error envelope types.
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
