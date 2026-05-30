// commands/init.test.ts — tests for the `peer-bridge init` command.
// Run with: node --import tsx --test src/commands/init.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { runInit } from './init.js';

function tmpdir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'pb-cli-initcmd-'));
}

function extractPeerId(stdout: string): string {
  const match = stdout.match(/Peer ID: (PB-[A-Z2-7-]+)/);
  if (!match) throw new Error(`Could not extract peer ID from: ${stdout}`);
  return match[1];
}

describe('runInit', () => {
  it('on empty dir: creates identity.key, identity.pub, config.toml; exitCode 0', async () => {
    const dir = tmpdir();
    try {
      const result = await runInit({ dataDir: dir });
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stderr, '');
      const files = await readdir(dir);
      assert.ok(files.includes('identity.key'));
      assert.ok(files.includes('identity.pub'));
      assert.ok(files.includes('config.toml'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stdout contains peer_id', async () => {
    const dir = tmpdir();
    try {
      const result = await runInit({ dataDir: dir });
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('Peer ID: PB-'), `stdout: ${result.stdout}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stdout shows invite hint', async () => {
    const dir = tmpdir();
    try {
      const result = await runInit({ dataDir: dir });
      assert.ok(result.stdout.includes('peer-bridge invite'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('second run returns exitCode 1 with "already exists" stderr', async () => {
    const dir = tmpdir();
    try {
      const first = await runInit({ dataDir: dir });
      assert.strictEqual(first.exitCode, 0);
      const second = await runInit({ dataDir: dir });
      assert.strictEqual(second.exitCode, 1);
      assert.ok(second.stderr.includes('already exists'));
      assert.ok(second.stderr.includes('--force'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('runInit with force: true overwrites existing identity', async () => {
    const dir = tmpdir();
    try {
      const first = await runInit({ dataDir: dir });
      const firstPeerId = extractPeerId(first.stdout);
      const second = await runInit({ dataDir: dir, force: true });
      assert.strictEqual(second.exitCode, 0);
      const secondPeerId = extractPeerId(second.stdout);
      assert.notStrictEqual(secondPeerId, firstPeerId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates data_dir if it does not exist (mkdir -p)', async () => {
    const dir = tmpdir();
    try {
      const nestedDir = path.join(dir, 'nested', 'subdir');
      const result = await runInit({ dataDir: nestedDir });
      assert.strictEqual(result.exitCode, 0);
      const files = await readdir(nestedDir);
      assert.ok(files.includes('identity.key'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--force also overwrites config.toml', async () => {
    const dir = tmpdir();
    try {
      await runInit({ dataDir: dir });
      const configPath = path.join(dir, 'config.toml');
      let cfg = await readFile(configPath, 'utf-8');
      cfg = cfg.replace('wss://rdv.example.com', 'wss://custom.example.com');
      writeFileSync(configPath, cfg, 'utf-8');
      const result = await runInit({ dataDir: dir, force: true });
      assert.strictEqual(result.exitCode, 0);
      const newCfg = await readFile(configPath, 'utf-8');
      assert.ok(newCfg.includes('wss://rdv.example.com'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('config.toml is not overwritten when init is rejected (existing identity, no force)', async () => {
    const dir = tmpdir();
    try {
      await runInit({ dataDir: dir });
      const configPath = path.join(dir, 'config.toml');
      const original = await readFile(configPath, 'utf-8');
      const second = await runInit({ dataDir: dir });
      assert.strictEqual(second.exitCode, 1);
      const after = await readFile(configPath, 'utf-8');
      assert.strictEqual(after, original);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns data_dir in success stdout', async () => {
    const dir = tmpdir();
    try {
      const result = await runInit({ dataDir: dir });
      assert.ok(result.stdout.includes(dir), `stdout should contain dataDir: ${result.stdout}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
