// M0 cryptographic test vectors — byte-level deterministic validation.
//
// Per decision test-vectors-as-spec-not-regression.md: cryptographic primitives
// (Ed25519 sign, sealed box decrypt, key conversion) have deterministic byte
// outputs given fixed inputs. These vectors are the SPEC; implementations must
// match them byte-for-byte. Cross-language implementations (Rust, Go, etc.) can
// be validated against the same files.
//
// Sealed box encrypt is NOT tested byte-for-byte because nacl.box.seal uses an
// ephemeral keypair (random per call). The decrypt path IS deterministic given
// pre-sealed bytes, so vectors carry sealed_hex and we round-trip.

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ed25519ToX25519,
  sealOpen,
} from './sealed-box.js';
import {
  buildFingerprintPayload,
  signFingerprint,
  verifyFingerprint,
} from './fingerprint.js';
import type { SignKeyPair } from './identity.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const vectorsDir = resolve(__dirname, '../../protocol/test-vectors');

function loadVectors<T>(filename: string): T {
  return JSON.parse(readFileSync(resolve(vectorsDir, filename), 'utf-8')) as T;
}

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    out[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return out;
};

const bytesToHex = (b: Uint8Array): string =>
  Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

// ── Sealed box vectors ──

interface SealedBoxVector {
  name: string;
  input: {
    ed25519_secret_key_hex: string;
    ed25519_public_key_hex: string;
    sealed_hex: string;
  };
  expected: {
    x25519_public_key_hex?: string;
    x25519_secret_key_hex?: string;
    decrypted_utf8?: string;
    decrypted_byte?: number;
    decrypted_length?: number;
    sealed_size?: number;
  };
}

describe('Sealed box vectors (decrypt path, byte-deterministic)', () => {
  const data = loadVectors<{ vectors: SealedBoxVector[] }>('sealed_box.json');

  for (const v of data.vectors) {
    it(v.name, async () => {
      const signKP: SignKeyPair = {
        secretKey: hexToBytes(v.input.ed25519_secret_key_hex),
        publicKey: hexToBytes(v.input.ed25519_public_key_hex),
      };
      const boxKP = await ed25519ToX25519(signKP);

      // If expected gives x25519 keys, byte-match the conversion.
      if (v.expected.x25519_public_key_hex) {
        assert.strictEqual(
          bytesToHex(boxKP.publicKey),
          v.expected.x25519_public_key_hex,
          'X25519 public key (Ed25519→X25519 conversion) must be byte-deterministic',
        );
      }
      if (v.expected.x25519_secret_key_hex) {
        assert.strictEqual(
          bytesToHex(boxKP.secretKey),
          v.expected.x25519_secret_key_hex,
          'X25519 secret key (Ed25519→X25519 conversion) must be byte-deterministic',
        );
      }

      // Decrypt the pre-sealed ciphertext.
      const sealed = hexToBytes(v.input.sealed_hex);
      if (v.expected.sealed_size !== undefined) {
        assert.strictEqual(sealed.length, v.expected.sealed_size, 'sealed_size matches');
      }
      const decrypted = await sealOpen(sealed, boxKP.publicKey, boxKP.secretKey);
      assert.ok(decrypted !== null, 'sealed box decrypt must succeed');

      if (v.expected.decrypted_utf8 !== undefined) {
        assert.strictEqual(
          Buffer.from(decrypted!).toString('utf-8'),
          v.expected.decrypted_utf8,
        );
      }
      if (v.expected.decrypted_length !== undefined) {
        assert.strictEqual(decrypted!.length, v.expected.decrypted_length);
      }
      if (v.expected.decrypted_byte !== undefined) {
        // All bytes equal this value
        for (let i = 0; i < decrypted!.length; i++) {
          if (decrypted![i] !== v.expected.decrypted_byte) {
            assert.fail(`byte ${i} = 0x${decrypted![i].toString(16)}, expected 0x${v.expected.decrypted_byte.toString(16)}`);
          }
        }
      }
    });
  }
});

// ── Fingerprint signature vectors ──

interface FingerprintVector {
  name: string;
  input: {
    ed25519_public_key_hex: string;
    ed25519_secret_key_hex: string;
    fingerprint_hex: string;
    timestamp: number;
    nonce_hex: string;
  };
  expected: {
    signed_payload_hex: string;
    signature_hex: string;
  };
}

describe('Fingerprint signature vectors (byte-deterministic)', () => {
  const data = loadVectors<{ vectors: FingerprintVector[] }>('fingerprint_sig.json');

  for (const v of data.vectors) {
    it(v.name, async () => {
      const pk = hexToBytes(v.input.ed25519_public_key_hex);
      const sk = hexToBytes(v.input.ed25519_secret_key_hex);
      const fp = hexToBytes(v.input.fingerprint_hex);
      const nonce = hexToBytes(v.input.nonce_hex);

      // 1. Payload concat is deterministic — byte-match.
      const payload = buildFingerprintPayload(fp, pk, v.input.timestamp, nonce);
      assert.strictEqual(
        bytesToHex(payload),
        v.expected.signed_payload_hex,
        'signed payload concat must be byte-deterministic',
      );

      // 2. Ed25519 detached signature is deterministic per RFC 8032 — byte-match.
      const sig = await signFingerprint(fp, pk, v.input.timestamp, nonce, sk);
      assert.strictEqual(
        bytesToHex(sig),
        v.expected.signature_hex,
        'Ed25519 signature must match (RFC 8032 determinism)',
      );

      // 3. Verify with the public key — should succeed.
      const ok = await verifyFingerprint(fp, pk, v.input.timestamp, nonce, sig, pk);
      assert.strictEqual(ok, true, 'verify round-trip');
    });
  }
});
