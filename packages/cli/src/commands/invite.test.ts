// commands/invite.test.ts — tests for `peer-bridge invite`.
// Run with: node --import tsx --test src/commands/invite.test.ts
//
// CHOICE (brief #3b): mock via dependency injection. Each test creates a tempdir,
//                     runs init to bootstrap identity + config, then exercises
//                     runInvite with a mock client factory. No real WebSocket
//                     connections.

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { runInit } from './init.js';
import { runInvite } from './invite.js';

function tmpdir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'pb-cli-invite-'));
}

/**
 * Bootstrap temp dir: run init, then return the dataDir path.
 * Gives us an identity + config.toml with a real (non-placeholder) URL.
 */
async function bootstrap(dataDir: string): Promise<string> {
  const result = await runInit({ dataDir });
  assert.strictEqual(result.exitCode, 0, `init failed: ${result.stderr}`);
  // Replace placeholder URL with a test URL so runInvite doesn't reject
  const configPath = path.join(dataDir, 'config.toml');
  const cfg = readFileSync(configPath, 'utf-8');
  const updated = cfg.replace('wss://rdv.example.com', 'wss://test-rdv.example.com');
  writeFileSync(configPath, updated, 'utf-8');
  return dataDir;
}

/** Create a mock client that always succeeds. */
function mockSuccessClient() {
  return {
    connect: mock.fn(async () => {}),
    inviteCreate: mock.fn(async () => ({ peer_id: 'PB-ABC', pubkey: 'fake' })),
    disconnect: mock.fn(() => {}),
  };
}

describe('runInvite', () => {
  it('without identity → exitCode 1, "No identity"', async () => {
    const dir = tmpdir();
    try {
      const result = await runInvite({ dataDir: dir });
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('No identity'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('with placeholder URL → exitCode 1, mentions config.toml', async () => {
    const dir = tmpdir();
    try {
      // Bootstrap but DON'T replace placeholder — keep wss://rdv.example.com
      await runInit({ dataDir: dir });
      const result = await runInvite({ dataDir: dir });
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('wss://rdv.example.com'));
      assert.ok(result.stderr.includes('config.toml'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('happy path: prints invite code to stdout', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      const result = await runInvite({
        dataDir: dir,
        _clientFactory: async () => mockSuccessClient(),
      });
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('Invite code:'));
      assert.ok(result.stdout.includes('expires in 10 min'));
      assert.ok(result.stdout.includes('single use'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('calls connect → inviteCreate → disconnect in order', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      const client = mockSuccessClient();
      const result = await runInvite({
        dataDir: dir,
        _clientFactory: async () => client,
      });
      assert.strictEqual(result.exitCode, 0);
      const calls = [
        client.connect.mock.calls.length,
        client.inviteCreate.mock.calls.length,
        client.disconnect.mock.calls.length,
      ];
      assert.deepStrictEqual(calls, [1, 1, 1], `Expected [1,1,1], got ${calls}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('inviteCreate receives correct payload shape (code_hash, peer_id, expires_at)', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      const client = mockSuccessClient();
      await runInvite({
        dataDir: dir,
        _clientFactory: async () => client,
      });
      const mockFn = client.inviteCreate as unknown as {
        mock: { calls: Array<{ arguments: [Record<string, unknown>] }> };
      };
      const payload = mockFn.mock.calls[0]?.arguments[0];
      assert.ok(payload, 'inviteCreate should be called with a payload');
      assert.ok(
        typeof payload.code_hash === 'string' && (payload.code_hash as string).length === 64,
        `code_hash should be 64-char hex`,
      );
      assert.ok(
        typeof payload.peer_id === 'string' && (payload.peer_id as string).startsWith('PB-'),
      );
      assert.ok(typeof payload.expires_at === 'string');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('RendezvousError → exitCode 2, error code in stderr', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      // Import RendezvousError — need to reach into core
      const { RendezvousError } = await import('@peer-bridge/core');
      const result = await runInvite({
        dataDir: dir,
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteCreate: mock.fn(async () => {
            throw new RendezvousError('rate_limited', 'Too many invites');
          }),
          disconnect: mock.fn(() => {}),
        }),
      });
      assert.strictEqual(result.exitCode, 2);
      assert.ok(result.stderr.includes('rate_limited'), `stderr: ${result.stderr}`);
      assert.ok(result.stderr.includes('Failed to register invite'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('disconnect called even when inviteCreate throws (try/finally)', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      let disconnectCalled = false;
      const result = await runInvite({
        dataDir: dir,
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteCreate: mock.fn(async () => {
            throw new Error('boom');
          }),
          disconnect: mock.fn(() => {
            disconnectCalled = true;
          }),
        }),
      });
      assert.strictEqual(result.exitCode, 2);
      assert.ok(disconnectCalled, 'disconnect must be called even on error');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('connect throws → exitCode 2, disconnect still called', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      let disconnectCalled = false;
      const result = await runInvite({
        dataDir: dir,
        _clientFactory: async () => ({
          connect: mock.fn(async () => {
            throw new Error('ws_open_failed');
          }),
          inviteCreate: mock.fn(async () => ({ peer_id: 'PB-X', pubkey: 'x' })),
          disconnect: mock.fn(() => {
            disconnectCalled = true;
          }),
        }),
      });
      // Connect failure happens before client.connect() in try block
      // The client is constructed then connect() is called in try, so disconnect
      // should be called in finally
      assert.strictEqual(result.exitCode, 2);
      assert.ok(disconnectCalled, 'disconnect must be called on connect failure');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
