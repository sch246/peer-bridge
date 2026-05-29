// Invite code creation and redemption at the core level.
// Uses the protocol-level invite code generation and wraps with identity/known-peers.

import { generateRandomInviteCode, hashInviteCode } from '@peer-bridge/protocol';
import type { KnownPeer } from './known-peers.js';
import { findPeer } from './known-peers.js';

/**
 * Result of creating an invitation.
 */
export interface InviteResult {
  code: string; // 4-word invite code (e.g. "cobra-sapphire-lighthouse-tango-a1b2")
  codeHash: string; // SHA-256 hex of the code
  expiresAt: Date; // 10 minutes from creation
  peerId: string;
  publicKey: Uint8Array;
}

/**
 * Create an invitation to share your identity with another peer.
 */
export function createInvite(peerId: string, publicKey: Uint8Array): InviteResult {
  const { code, codeHash } = generateRandomInviteCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  return { code, codeHash, expiresAt, peerId, publicKey };
}

/**
 * Accept an invitation from another peer.
 * Validates the invite code and adds the peer to known_peers if confirmed.
 */
export interface AcceptInviteResult {
  peerId: string;
  publicKey: Uint8Array; // retrieved from rendezvous after redeeming code
  alias: string;
}

/**
 * Build the rendezvous request payload for creating an invite.
 */
export function buildInviteCreatePayload(invite: InviteResult): {
  code_hash: string;
  pubkey: string;
  peer_id: string;
  expires_at: string;
} {
  return {
    code_hash: invite.codeHash,
    pubkey: Buffer.from(invite.publicKey).toString('base64'),
    peer_id: invite.peerId,
    expires_at: invite.expiresAt.toISOString(),
  };
}

/**
 * Build the rendezvous request payload for redeeming an invite.
 */
export function buildInviteRedeemPayload(code: string): { code_hash: string } {
  return { code_hash: hashInviteCode(code) };
}

/**
 * Add a peer to the known peers list after invite acceptance.
 */
export function addPeerFromInvite(
  peers: KnownPeer[],
  peerId: string,
  alias: string,
  homeRendezvous: string,
): KnownPeer[] {
  // Don't add duplicates
  if (findPeer(peers, peerId)) {
    return peers;
  }

  const newPeer: KnownPeer = {
    alias,
    peer_id: peerId,
    added_at: new Date().toISOString(),
    trust: 'tofu', // starts as TOFU until user confirms fingerprint
    home_rendezvous: homeRendezvous,
  };

  return [...peers, newPeer];
}

/**
 * Verify a peer's fingerprint and upgrade trust level.
 */
export function verifyPeerTrust(peers: KnownPeer[], peerId: string): KnownPeer[] {
  return peers.map((p) => {
    if (p.peer_id === peerId) {
      return { ...p, trust: 'verified' as const };
    }
    return p;
  });
}
