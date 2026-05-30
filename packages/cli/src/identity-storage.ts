// identity-storage.ts — wrap core's identity primitives for filesystem persistence.
//
// Uses @peer-bridge/core's encodePrivateKey / decodePrivateKey / encodePublicKey
// for the PEM-like format — this module is a thin filesystem wrapper, not a
// reimplementation of the crypto layer.
//
// CHOICE (brief #3a): Windows identity.key is write-only (no NTFS ACL check).
//                     DESIGN line 314: daemon validates ACL at startup in M4.
// CHOICE (brief #3a): Atomic write via .tmp + rename for each file individually.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import {
  decodePrivateKey,
  encodePrivateKey,
  encodePublicKey,
  getPeerId,
  type SignKeyPair,
} from '@peer-bridge/core';

/**
 * Load identity from data_dir. Returns null if identity.key is missing.
 * On parse error, throws (caller should handle).
 */
export async function loadIdentity(
  dataDir: string,
): Promise<{ keyPair: SignKeyPair; peerId: string } | null> {
  const keyPath = path.join(dataDir, 'identity.key');

  let pem: string;
  try {
    pem = await fs.readFile(keyPath, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }

  const keyPair = decodePrivateKey(pem);
  const peerId = getPeerId(keyPair.publicKey);
  return { keyPair, peerId };
}

/**
 * Save identity.key + identity.pub atomically.
 *
 * - identity.key: PEM with private + public key (mode 0600 on Unix)
 * - identity.pub: PEM with public key + peer_id
 *
 * Each file is written to a .tmp sibling then renamed — this prevents
 * partial writes from leaving corrupted identity files.
 */
export async function saveIdentity(dataDir: string, keyPair: SignKeyPair): Promise<void> {
  await fs.mkdir(dataDir, { recursive: true });

  const keyPath = path.join(dataDir, 'identity.key');
  const pubPath = path.join(dataDir, 'identity.pub');
  const keyTmp = keyPath + '.tmp';
  const pubTmp = pubPath + '.tmp';

  const keyPem = encodePrivateKey(keyPair);
  const pubPem = encodePublicKey(keyPair.publicKey);

  // Write identity.key atomically
  await fs.writeFile(keyTmp, keyPem, 'utf-8');

  // Unix: tighten permissions on the temp file before renaming (atomic mode set)
  // Windows: fs.chmod is a no-op (or throws); skip per DESIGN line 314 — daemon validates ACL.
  if (process.platform !== 'win32') {
    // 0o600 = owner read+write only
    await fs.chmod(keyTmp, 0o600);
  }

  await fs.rename(keyTmp, keyPath);

  // Write identity.pub atomically
  await fs.writeFile(pubTmp, pubPem, 'utf-8');
  await fs.rename(pubTmp, pubPath);
}
