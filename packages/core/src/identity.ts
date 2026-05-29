// Identity management: Ed25519 keypair generation, peer ID computation.
// Each node generates an independent Ed25519 long-term key stored in <data_dir>/identity.key.

import nacl from 'tweetnacl';
import { encodePeerId } from '@peer-bridge/protocol';

// tweetnacl keypair types (the runtime nacl object provides these via nacl.sign.keyPair())
export interface SignKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * Generate a new Ed25519 keypair.
 */
export function generateKeyPair(): SignKeyPair {
  return (nacl as any).sign.keyPair() as SignKeyPair;
}

/**
 * Encode a keypair to PEM-like format for storage in identity.key.
 */
export function encodePrivateKey(keyPair: SignKeyPair): string {
  const secretKey = Buffer.from(keyPair.secretKey).toString('base64');
  const publicKey = Buffer.from(keyPair.publicKey).toString('base64');
  return [
    '-----BEGIN PEER-BRIDGE PRIVATE KEY-----',
    `secret: ${secretKey}`,
    `public: ${publicKey}`,
    '-----END PEER-BRIDGE PRIVATE KEY-----',
  ].join('\n');
}

/**
 * Decode a private key from PEM-like format.
 */
export function decodePrivateKey(pem: string): SignKeyPair {
  const lines = pem.split('\n');
  let secretBase64 = '';
  let publicBase64 = '';

  for (const line of lines) {
    if (line.startsWith('secret: ')) {
      secretBase64 = line.slice('secret: '.length);
    } else if (line.startsWith('public: ')) {
      publicBase64 = line.slice('public: '.length);
    }
  }

  if (!secretBase64 || !publicBase64) {
    throw new Error('Invalid private key format: missing secret or public key');
  }

  return {
    secretKey: new Uint8Array(Buffer.from(secretBase64, 'base64')),
    publicKey: new Uint8Array(Buffer.from(publicBase64, 'base64')),
  };
}

/**
 * Encode a public key to PEM-like format for identity.pub.
 */
export function encodePublicKey(publicKey: Uint8Array): string {
  const peerId = encodePeerId(publicKey);
  const pubBase64 = Buffer.from(publicKey).toString('base64');
  return [
    '-----BEGIN PEER-BRIDGE PUBLIC KEY-----',
    `peer_id: ${peerId}`,
    `public: ${pubBase64}`,
    '-----END PEER-BRIDGE PUBLIC KEY-----',
  ].join('\n');
}

/**
 * Decode a public key from identity.pub format.
 */
export function decodePublicKey(pem: string): { publicKey: Uint8Array; peerId: string } {
  const lines = pem.split('\n');
  let publicBase64 = '';
  let peerId = '';

  for (const line of lines) {
    if (line.startsWith('peer_id: ')) {
      peerId = line.slice('peer_id: '.length);
    } else if (line.startsWith('public: ')) {
      publicBase64 = line.slice('public: '.length);
    }
  }

  const publicKey = new Uint8Array(Buffer.from(publicBase64, 'base64'));

  // Verify peer ID matches
  const derived = encodePeerId(publicKey);
  if (peerId && derived !== peerId) {
    throw new Error(`Peer ID mismatch: stored=${peerId}, derived=${derived}`);
  }

  return { publicKey, peerId: peerId || derived };
}

/**
 * Get the peer ID for a public key.
 */
export function getPeerId(publicKey: Uint8Array): string {
  return encodePeerId(publicKey);
}

/**
 * Sign a message with the Ed25519 secret key.
 */
export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return (nacl as any).sign.detached(message, secretKey) as Uint8Array;
}

/**
 * Verify an Ed25519 signature.
 */
export function verify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return (nacl as any).sign.detached.verify(message, signature, publicKey) as boolean;
}
