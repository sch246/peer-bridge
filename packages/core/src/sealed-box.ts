// NaCl sealed box encryption for offline notification payloads.
// Uses NaCl sealed box (anonymous public-key encryption).
// Spec: protocol.md §9, fact nacl-sealed-box-properties.md

import nacl from 'tweetnacl';
import type { SignKeyPair } from './identity.js';

export interface BoxKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * Convert an Ed25519 keypair to an X25519 keypair for sealed box operations.
 * Uses tweetnacl's built-in conversion functions.
 * Spec: fact ed25519-x25519-conversion.md
 */
export function ed25519ToX25519(keyPair: SignKeyPair): BoxKeyPair {
  return {
    publicKey: (nacl as any).sign.publicKey_to_curve25519(keyPair.publicKey) as Uint8Array,
    secretKey: (nacl as any).sign.secretKey_to_curve25519(keyPair.secretKey) as Uint8Array,
  };
}

/**
 * Encrypt a payload for a recipient using NaCl sealed box.
 * The sender is anonymous (ephemeral keypair is generated internally).
 *
 * @param payload - The plaintext message to encrypt
 * @param recipientX25519PublicKey - The recipient's X25519 public key (32 bytes)
 * @returns The sealed box ciphertext (payload.length + 48 bytes overhead)
 */
export function seal(payload: Uint8Array, recipientX25519PublicKey: Uint8Array): Uint8Array {
  return (nacl as any).box.seal(payload, recipientX25519PublicKey) as Uint8Array;
}

/**
 * Decrypt a sealed box ciphertext.
 *
 * @param sealed - The sealed box ciphertext
 * @param recipientX25519PublicKey - The recipient's X25519 public key (32 bytes)
 * @param recipientX25519SecretKey - The recipient's X25519 secret key (32 bytes)
 * @returns The decrypted plaintext, or null if decryption/MAC verification fails
 */
export function sealOpen(
  sealed: Uint8Array,
  recipientX25519PublicKey: Uint8Array,
  recipientX25519SecretKey: Uint8Array,
): Uint8Array | null {
  return (nacl as any).box.seal.open(
    sealed,
    recipientX25519PublicKey,
    recipientX25519SecretKey,
  ) as Uint8Array | null;
}

/**
 * Offline notification payload structure (stored inside the sealed box).
 */
export interface OfflineNotifyPayload {
  sender_peer_id: string;
  room_id: string;
  note: string;
  timestamp: number; // Unix milliseconds
  nonce: string; // base64-encoded 16-byte random
}

/**
 * Encode an offline notification payload to JSON bytes.
 */
export function encodeOfflineNotifyPayload(payload: OfflineNotifyPayload): Uint8Array {
  return Buffer.from(JSON.stringify(payload), 'utf-8');
}

/**
 * Decode an offline notification payload from JSON bytes.
 */
export function decodeOfflineNotifyPayload(data: Uint8Array): OfflineNotifyPayload {
  return JSON.parse(Buffer.from(data).toString('utf-8'));
}

/**
 * Maximum sealed box payload size (1024 - 48 overhead = 976 bytes).
 */
export const MAX_SEALED_BOX_PAYLOAD = 976;

/**
 * Maximum sealed box ciphertext size (1024 bytes).
 */
export const MAX_SEALED_BOX_SIZE = 1024;
