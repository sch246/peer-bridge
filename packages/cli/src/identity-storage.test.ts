// identity-storage.test.ts — tests for identity.key + identity.pub filesystem persistence.
// Run with: node --import tsx --test src/identity-storage.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, readdir, mkdir, stat } from 'node:fs/promises';
import { generateKeyPair, getPeerId } from '@peer-bridge/core';
import { saveIdentity, loadIdentity } from './identity-storage.js';

function tmpdir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'pb-cli-idstore-'));
}

describe('identity storage', () => {
  it('loadIdentity returns null when identity.key is missing', async () => {
    const dir = tmpdir();
    try {
      await mkdir(dir, { recursive: true });
      const result = await loadIdentity(dir);
      assert.strictEqual(result, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('saveIdentity → loadIdentity round-trip (peer_id matches)', async () => {
    const dir = tmpdir();
    try {
      await mkdir(dir, { recursive: true });
      const kp = await generateKeyPair();
      await saveIdentity(dir, kp);
      const loaded = await loadIdentity(dir);
      assert.ok(loaded !== null);
      assert.deepStrictEqual(loaded!.keyPair.publicKey, kp.publicKey);
      assert.deepStrictEqual(loaded!.keyPair.secretKey, kp.secretKey);
      assert.strictEqual(loaded!.peerId, getPeerId(kp.publicKey));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('saveIdentity writes both identity.key and identity.pub', async () => {
    const dir = tmpdir();
    try {
      await mkdir(dir, { recursive: true });
      const kp = await generateKeyPair();
      await saveIdentity(dir, kp);
      const files = await readdir(dir);
      assert.ok(files.includes('identity.key'));
      assert.ok(files.includes('identity.pub'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('identity.pub contains peer_id', async () => {
    const dir = tmpdir();
    try {
      await mkdir(dir, { recursive: true });
      const kp = await generateKeyPair();
      await saveIdentity(dir, kp);
      const pubPem = await readFile(path.join(dir, 'identity.pub'), 'utf-8');
      const expectedPeerId = getPeerId(kp.publicKey);
      assert.ok(pubPem.includes(expectedPeerId), 'identity.pub should contain peer_id');
      assert.ok(pubPem.includes('-----BEGIN PEER-BRIDGE PUBLIC KEY-----'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes atomically (no .tmp leftovers)', async () => {
    const dir = tmpdir();
    try {
      await mkdir(dir, { recursive: true });
      const kp = await generateKeyPair();
      await saveIdentity(dir, kp);
      const files = await readdir(dir);
      assert.ok(!files.some((f: string) => f.endsWith('.tmp')), 'No .tmp files should linger');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('overwrites existing identity', async () => {
    const dir = tmpdir();
    try {
      await mkdir(dir, { recursive: true });
      const kp1 = await generateKeyPair();
      await saveIdentity(dir, kp1);
      const kp2 = await generateKeyPair();
      await saveIdentity(dir, kp2);
      const loaded = await loadIdentity(dir);
      assert.ok(loaded !== null);
      assert.deepStrictEqual(loaded!.keyPair.publicKey, kp2.publicKey);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(
    'Unix: identity.key has mode 0o600 after save',
    { skip: process.platform === 'win32' },
    async () => {
      const dir = tmpdir();
      try {
        await mkdir(dir, { recursive: true });
        const kp = await generateKeyPair();
        await saveIdentity(dir, kp);
        const keyPath = path.join(dir, 'identity.key');
        const st = await stat(keyPath);
        const mode = st.mode & 0o777;
        assert.strictEqual(mode, 0o600, `Expected 0o600, got 0o${mode.toString(8)}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
