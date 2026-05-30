// NaCl sealed box encryption for offline notification payloads.
// Uses libsodium-wrappers (crypto_box_seal / crypto_box_seal_open).
// Spec: protocol.md §9, fact nacl-sealed-box-properties.md

import sodium from 'libsodium-wrappers';
import { initCrypto } from './crypto-init.js';
import type { SignKeyPair } from './identity.js';

export interface BoxKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * Convert an Ed25519 keypair to an X25519 keypair for sealed box operations.
 * Uses libsodium crypto_sign_ed25519_*_to_curve25519.
 * Spec: fact ed25519-x25519-conversion.md
 */
export async function ed25519ToX25519(keyPair: SignKeyPair): Promise<BoxKeyPair> {
  await initCrypto();
  return {
    publicKey: sodium.crypto_sign_ed25519_pk_to_curve25519(keyPair.publicKey),
    secretKey: sodium.crypto_sign_ed25519_sk_to_curve25519(keyPair.secretKey),
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
export async function seal(
  payload: Uint8Array,
  recipientX25519PublicKey: Uint8Array,
): Promise<Uint8Array> {
  await initCrypto();
  return sodium.crypto_box_seal(payload, recipientX25519PublicKey);
}

/**
 * Decrypt a sealed box ciphertext.
 *
 * @param sealed - The sealed box ciphertext
 * @param recipientX25519PublicKey - The recipient's X25519 public key (32 bytes)
 * @param recipientX25519SecretKey - The recipient's X25519 secret key (32 bytes)
 * @returns The decrypted plaintext, or null if decryption/MAC verification fails
 */
export async function sealOpen(
  sealed: Uint8Array,
  recipientX25519PublicKey: Uint8Array,
  recipientX25519SecretKey: Uint8Array,
): Promise<Uint8Array | null> {
  await initCrypto();
  try {
    return sodium.crypto_box_seal_open(sealed, recipientX25519PublicKey, recipientX25519SecretKey);
  } catch {
    return null;
  }
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
