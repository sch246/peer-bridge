// Client message authentication — Ed25519 signature verification.
//
// All C→S messages carry {payload, sig, ts} per DESIGN.md §5.1.
// sig = Ed25519(SHA-256(JSON.stringify(payload) || ts), longterm_sk)
//
// @telos facts/signaling-message-fields.md (authoritative field inventory)
// @telos facts/crypto-library-mapping.md (libsodium-wrappers, NOT tweetnacl)

import { createHash } from 'node:crypto';
import sodium from 'libsodium-wrappers';
import { decodePeerId } from '@peer-bridge/protocol';

/** Initialize libsodium. Must be called before any auth operation. */
export async function initCrypto(): Promise<void> {
  await sodium.ready;
}

/** Timestamp validity window in seconds (±5 minutes). */
const TS_WINDOW_SECONDS = 300;

/**
 * Verify a client WebSocket message signature.
 *
 * @param payload - the parsed payload object (NOT stringified)
 * @param sigBase64 - base64-encoded Ed25519 signature
 * @param ts - ISO8601 timestamp string
 * @param pubkey - 32-byte Ed25519 public key
 * @returns true if signature is valid and timestamp is within window
 */
export function verifySignature(
  payload: Record<string, unknown>,
  sigBase64: string,
  ts: string,
  pubkey: Uint8Array,
): boolean {
  // Check timestamp freshness
  const now = Math.floor(Date.now() / 1000);
  const msgTime = Math.floor(new Date(ts).getTime() / 1000);
  if (isNaN(msgTime)) return false;
  if (Math.abs(now - msgTime) > TS_WINDOW_SECONDS) return false;

  // Compute SHA-256(JSON.stringify(payload) || ts)
  const payloadJson = JSON.stringify(payload);
  const messageBytes = Buffer.from(payloadJson + ts, 'utf-8');
  const hash = createHash('sha256').update(messageBytes).digest();

  // Verify detached signature
  let sigBytes: Uint8Array;
  try {
    sigBytes = Buffer.from(sigBase64, 'base64');
  } catch {
    return false;
  }

  if (sigBytes.length !== 64) return false;

  return sodium.crypto_sign_verify_detached(sigBytes, hash, pubkey);
}

/**
 * Decode a peer_id into its 32-byte Ed25519 public key.
 */
export function decodePeerIdSafe(peerId: string): Uint8Array | null {
  try {
    return decodePeerId(peerId);
  } catch {
    return null;
  }
}

/**
 * Verify an ISO8601 timestamp string is within the allowed window.
 */
export function isTimestampValid(ts: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const msgTime = Math.floor(new Date(ts).getTime() / 1000);
  if (isNaN(msgTime)) return false;
  return Math.abs(now - msgTime) <= TS_WINDOW_SECONDS;
}
