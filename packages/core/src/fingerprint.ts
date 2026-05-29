// DTLS fingerprint signing for WebRTC P2P handshake authentication.
// Spec: protocol.md §3 (P2P handshake), §9 (encryption details)

import nacl from 'tweetnacl';
import { createHash } from 'node:crypto';

/**
 * Build the signed payload for DTLS fingerprint verification.
 *
 * Payload format:
 *   fingerprint_bytes (32) || peer_id_bytes (32) || timestamp_be (8) || nonce (16)
 *
 * Total: 88 bytes
 */
export function buildFingerprintPayload(
  fingerprintBytes: Uint8Array, // SHA-256 of DTLS certificate SPKI DER
  peerIdBytes: Uint8Array, // 32-byte raw Ed25519 public key
  timestamp: number, // Unix seconds
  nonce: Uint8Array, // 16 random bytes
): Uint8Array {
  if (fingerprintBytes.length !== 32) {
    throw new Error(`Fingerprint must be 32 bytes (SHA-256), got ${fingerprintBytes.length}`);
  }
  if (peerIdBytes.length !== 32) {
    throw new Error(`Peer ID bytes must be 32 bytes, got ${peerIdBytes.length}`);
  }
  if (nonce.length !== 16) {
    throw new Error(`Nonce must be 16 bytes, got ${nonce.length}`);
  }

  const tsBytes = new Uint8Array(8);
  const view = new DataView(tsBytes.buffer);
  view.setBigUint64(0, BigInt(timestamp), false); // big-endian

  const payload = new Uint8Array(32 + 32 + 8 + 16);
  payload.set(fingerprintBytes, 0);
  payload.set(peerIdBytes, 32);
  payload.set(tsBytes, 64);
  payload.set(nonce, 72);
  return payload;
}

/**
 * Sign a fingerprint payload with an Ed25519 secret key.
 * Returns 64-byte Ed25519 signature.
 */
export function signFingerprint(
  fingerprintBytes: Uint8Array,
  peerIdBytes: Uint8Array,
  timestamp: number,
  nonce: Uint8Array,
  secretKey: Uint8Array,
): Uint8Array {
  const payload = buildFingerprintPayload(fingerprintBytes, peerIdBytes, timestamp, nonce);
  return (nacl as any).sign.detached(payload, secretKey) as Uint8Array;
}

/**
 * Verify a fingerprint signature.
 *
 * @returns true if the signature is valid
 */
export function verifyFingerprint(
  fingerprintBytes: Uint8Array,
  peerIdBytes: Uint8Array,
  timestamp: number,
  nonce: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  const payload = buildFingerprintPayload(fingerprintBytes, peerIdBytes, timestamp, nonce);
  return (nacl as any).sign.detached.verify(payload, signature, publicKey) as boolean;
}

/**
 * Check if a timestamp is within a window of ±windowSeconds from now.
 */
export function isTimestampValid(timestamp: number, windowSeconds: number = 300): boolean {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - timestamp);
  return diff <= windowSeconds;
}

/**
 * Compute the SHA-256 fingerprint of a DTLS certificate's SPKI DER bytes.
 * This is what goes into the SDP fingerprint attribute.
 */
export function computeSPKIFingerprint(spkiDer: Uint8Array): Uint8Array {
  return createHash('sha256').update(spkiDer).digest();
}
