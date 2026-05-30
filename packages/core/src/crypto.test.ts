// Runtime round-trip tests for cryptographic primitives.
// These tests verify that the actual libsodium-wrappers calls work at runtime,
// not just that the types compile.
// Run with: node --import tsx --test src/crypto.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  generateKeyPair,
  sign,
  verify,
  encodePrivateKey,
  decodePrivateKey,
  encodePublicKey,
  decodePublicKey,
  getPeerId,
} from './identity.js';

import {
  ed25519ToX25519,
  seal,
  sealOpen,
  encodeOfflineNotifyPayload,
  decodeOfflineNotifyPayload,
  MAX_SEALED_BOX_SIZE,
} from './sealed-box.js';

import {
  signFingerprint,
  verifyFingerprint,
  computeSPKIFingerprint,
  isTimestampValid,
} from './fingerprint.js';

// ── Identity tests ──

describe('Identity (Ed25519 via libsodium)', () => {
  it('generateKeyPair produces valid keys', async () => {
    const kp = await generateKeyPair();
    assert.strictEqual(kp.publicKey.length, 32);
    assert.strictEqual(kp.secretKey.length, 64); // libsodium returns 64-byte secret (seed + pk)
  });

  it('sign + verify round-trip', async () => {
    const kp = await generateKeyPair();
    const message = new Uint8Array(Buffer.from('hello peer-bridge'));

    const sig = await sign(message, kp.secretKey);
    assert.strictEqual(sig.length, 64);

    const ok = await verify(message, sig, kp.publicKey);
    assert.strictEqual(ok, true);
  });

  it('verify rejects wrong message', async () => {
    const kp = await generateKeyPair();
    const msg = new Uint8Array(Buffer.from('hello'));
    const wrongMsg = new Uint8Array(Buffer.from('h3llo'));

    const sig = await sign(msg, kp.secretKey);
    const ok = await verify(wrongMsg, sig, kp.publicKey);
    assert.strictEqual(ok, false);
  });

  it('verify rejects wrong key', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const msg = new Uint8Array(Buffer.from('hello'));

    const sig = await sign(msg, kp1.secretKey);
    const ok = await verify(msg, sig, kp2.publicKey);
    assert.strictEqual(ok, false);
  });

  it('PEM encode/decode round-trip', async () => {
    const kp = await generateKeyPair();
    const pem = encodePrivateKey(kp);
    const decoded = decodePrivateKey(pem);

    assert.deepStrictEqual(decoded.publicKey, kp.publicKey);
    assert.deepStrictEqual(decoded.secretKey, kp.secretKey);
  });

  it('public key PEM encode/decode', async () => {
    const kp = await generateKeyPair();
    const pem = encodePublicKey(kp.publicKey);
    const { publicKey, peerId } = decodePublicKey(pem);

    assert.deepStrictEqual(publicKey, kp.publicKey);
    assert.strictEqual(peerId, getPeerId(kp.publicKey));
    assert.match(peerId, /^PB-/);
  });
});

// ── Sealed box tests ──

describe('Sealed box (NaCl via libsodium)', () => {
  it('ed25519→x25519 conversion produces valid keys', async () => {
    const signKP = await generateKeyPair();
    const boxKP = await ed25519ToX25519(signKP);

    assert.strictEqual(boxKP.publicKey.length, 32);
    assert.strictEqual(boxKP.secretKey.length, 32);
  });

  it('seal + sealOpen round-trip', async () => {
    const signKP = await generateKeyPair();
    const boxKP = await ed25519ToX25519(signKP);
    const payload = new Uint8Array(Buffer.from('secret message'));

    const sealed = await seal(payload, boxKP.publicKey);
    assert.strictEqual(sealed.length, payload.length + 48); // 48-byte overhead

    const decrypted = await sealOpen(sealed, boxKP.publicKey, boxKP.secretKey);
    assert.ok(decrypted !== null);
    assert.deepStrictEqual(decrypted!, payload);
  });

  it('sealOpen fails with wrong key', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const boxKP1 = await ed25519ToX25519(kp1);
    const boxKP2 = await ed25519ToX25519(kp2);
    const payload = new Uint8Array(Buffer.from('secret'));

    const sealed = await seal(payload, boxKP1.publicKey);
    // Try to decrypt with wrong key
    const decrypted = await sealOpen(sealed, boxKP2.publicKey, boxKP2.secretKey);
    assert.strictEqual(decrypted, null);
  });

  it('sealOpen fails with tampered ciphertext', async () => {
    const kp = await generateKeyPair();
    const boxKP = await ed25519ToX25519(kp);
    const payload = new Uint8Array(Buffer.from('secret'));

    const sealed = await seal(payload, boxKP.publicKey);
    // Tamper with the ciphertext
    sealed[sealed.length - 1] ^= 0xff;

    const decrypted = await sealOpen(sealed, boxKP.publicKey, boxKP.secretKey);
    assert.strictEqual(decrypted, null);
  });

  it('offline notify payload encode/decode', () => {
    const payload = {
      sender_peer_id: 'PB-DEYDCM-RTGQYT-ANJQGA',
      room_id: '550e8400-e29b-41d4-a716-446655440000',
      note: 'alice 想给你发文件',
      timestamp: 1736937600000,
      nonce: 'YWJjZGVmMDEyMzQ1Njc4',
    };

    const encoded = encodeOfflineNotifyPayload(payload);
    const decoded = decodeOfflineNotifyPayload(encoded);

    assert.deepStrictEqual(decoded, payload);
  });

  it('sealed box respects size limits', async () => {
    const kp = await generateKeyPair();
    const boxKP = await ed25519ToX25519(kp);
    // Max-size payload (976 bytes)
    const payload = new Uint8Array(Buffer.from('A'.repeat(976)));

    const sealed = await seal(payload, boxKP.publicKey);
    assert.ok(sealed.length <= MAX_SEALED_BOX_SIZE);

    const decrypted = await sealOpen(sealed, boxKP.publicKey, boxKP.secretKey);
    assert.ok(decrypted !== null);
    assert.strictEqual(decrypted!.length, 976);
  });
});

// ── Fingerprint tests ──

describe('Fingerprint signing (Ed25519 via libsodium)', () => {
  it('signFingerprint + verifyFingerprint round-trip', async () => {
    const kp = await generateKeyPair();
    const fingerprint = computeSPKIFingerprint(new Uint8Array(Buffer.from('fake-spki-der')));
    const nonce = new Uint8Array(Buffer.from('0123456789abcdef'));

    const sig = await signFingerprint(
      fingerprint, kp.publicKey, 1736937600, nonce, kp.secretKey,
    );
    assert.strictEqual(sig.length, 64);

    const ok = await verifyFingerprint(
      fingerprint, kp.publicKey, 1736937600, nonce, sig, kp.publicKey,
    );
    assert.strictEqual(ok, true);
  });

  it('verifyFingerprint rejects tampered fingerprint', async () => {
    const kp = await generateKeyPair();
    const fp = computeSPKIFingerprint(new Uint8Array(Buffer.from('real-spki')));
    const fp2 = computeSPKIFingerprint(new Uint8Array(Buffer.from('fake-spki')));
    const nonce = new Uint8Array(Buffer.from('0123456789abcdef'));

    const sig = await signFingerprint(fp, kp.publicKey, 1736937600, nonce, kp.secretKey);
    const ok = await verifyFingerprint(fp2, kp.publicKey, 1736937600, nonce, sig, kp.publicKey);
    assert.strictEqual(ok, false);
  });

  it('isTimestampValid checks window', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.strictEqual(isTimestampValid(now), true);
    assert.strictEqual(isTimestampValid(now - 200), true);
    assert.strictEqual(isTimestampValid(now + 200), true);
    assert.strictEqual(isTimestampValid(now - 301), false);
    assert.strictEqual(isTimestampValid(now + 301), false);
  });
});
