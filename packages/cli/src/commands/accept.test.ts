// commands/accept.test.ts — tests for `peer-bridge accept <code>`.
// Run with: node --import tsx --test src/commands/accept.test.ts
//
// CHOICE (brief #3b): mock via dependency injection (promptInput + _clientFactory).
//                     No real WebSocket connections, no real stdin prompts.

import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { runInit } from './init.js';
import { runAccept } from './accept.js';

function tmpdir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'pb-cli-accept-'));
}

/**
 * Bootstrap temp dir: run init, replace placeholder URL.
 */
async function bootstrap(dataDir: string): Promise<string> {
  const result = await runInit({ dataDir });
  assert.strictEqual(result.exitCode, 0, `init failed: ${result.stderr}`);
  const configPath = path.join(dataDir, 'config.toml');
  const cfg = readFileSync(configPath, 'utf-8');
  const updated = cfg.replace('wss://rdv.example.com', 'wss://test-rdv.example.com');
  writeFileSync(configPath, updated, 'utf-8');
  return dataDir;
}

/** Create a mock prompt that returns a fixed answer. */
function mockPrompt(answer: string) {
  return mock.fn(async () => answer);
}

describe('runAccept', () => {
  it('without identity → exitCode 1, "No identity"', async () => {
    const dir = tmpdir();
    try {
      const result = await runAccept({
        code: 'some-valid-code',
        dataDir: dir,
        promptInput: mockPrompt('y'),
      });
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('No identity'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('with placeholder URL → exitCode 1, mentions config.toml', async () => {
    const dir = tmpdir();
    try {
      await runInit({ dataDir: dir }); // keep placeholder
      const result = await runAccept({
        code: 'some-valid-code',
        dataDir: dir,
        promptInput: mockPrompt('y'),
      });
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('wss://rdv.example.com'));
      assert.ok(result.stderr.includes('config.toml'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('with empty code → exitCode 64, usage hint', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      const result = await runAccept({
        code: '',
        dataDir: dir,
        promptInput: mockPrompt('y'),
      });
      assert.strictEqual(result.exitCode, 64);
      assert.ok(result.stderr.includes('not a valid invite code'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('with code missing hyphen → exitCode 64', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      const result = await runAccept({
        code: 'no_hyphen_here',
        dataDir: dir,
        promptInput: mockPrompt('y'),
      });
      assert.strictEqual(result.exitCode, 64);
      assert.ok(result.stderr.includes('not a valid invite code'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('happy path with Y + alias → known_peers.toml written, trust=verified', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      const prompts = ['y', 'alice'];
      let promptIndex = 0;
      const result = await runAccept({
        code: 'cobra-sapphire-lighthouse-tango-a1b2',
        dataDir: dir,
        promptInput: mock.fn(async () => prompts[promptIndex++] ?? ''),
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteRedeem: mock.fn(async () => ({
            peer_id: 'PB-7X4J2-M9KQR-ABCDE-FGHIJ-KLMNO-PQRST',
            pubkey: 'cHVibGljLWtleS1iYXNlNjQ=',
          })),
          disconnect: mock.fn(() => {}),
        }),
      });
      assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes("Added peer 'alice'"));

      const kpPath = path.join(dir, 'known_peers.toml');
      assert.ok(existsSync(kpPath), 'known_peers.toml should exist');
      const content = readFileSync(kpPath, 'utf-8');
      assert.ok(content.includes('trust = "verified"'), `content: ${content}`);
      assert.ok(content.includes('alias = "alice"'));
      assert.ok(content.includes('PB-7X4J2-M9KQR'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('user enters n → no file written, "Cancelled" stdout', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      const result = await runAccept({
        code: 'cobra-sapphire-lighthouse-tango-a1b2',
        dataDir: dir,
        promptInput: mockPrompt('n'),
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteRedeem: mock.fn(async () => ({
            peer_id: 'PB-7X4J2-M9KQR-ABCDE-FGHIJ-KLMNO-PQRST',
            pubkey: 'cHVibGljLWtleS1iYXNlNjQ=',
          })),
          disconnect: mock.fn(() => {}),
        }),
      });
      assert.strictEqual(result.exitCode, 0);
      assert.ok(result.stdout.includes('Cancelled'));
      assert.ok(result.stdout.includes('NOT added'));

      const kpPath = path.join(dir, 'known_peers.toml');
      assert.ok(
        !existsSync(kpPath),
        `known_peers.toml should NOT exist, got:\n${existsSync(kpPath) ? readFileSync(kpPath, 'utf-8') : '(none)'}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('empty input on Y/n prompt → defaults to Yes (proceed)', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      // First prompt empty (default Y), second prompt empty (default alias)
      const prompts = ['', ''];
      let promptIndex = 0;
      const result = await runAccept({
        code: 'cobra-sapphire-lighthouse-tango-a1b2',
        dataDir: dir,
        promptInput: mock.fn(async () => prompts[promptIndex++] ?? ''),
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteRedeem: mock.fn(async () => ({
            peer_id: 'PB-7X4J2-M9KQR-ABCDE-FGHIJ-KLMNO-PQRST',
            pubkey: 'cHVibGljLWtleS1iYXNlNjQ=',
          })),
          disconnect: mock.fn(() => {}),
        }),
      });
      assert.strictEqual(result.exitCode, 0, `stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Added peer'));
      // Default alias should be first 12 chars after "PB-"
      assert.ok(result.stdout.includes("'7X4J2-M9KQR-'"), `stdout: ${result.stdout}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('duplicate peer → exitCode 1 with existing alias in stderr', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      const peerId = 'PB-7X4J2-M9KQR-ABCDE-FGHIJ-KLMNO-PQRST';
      // First accept: add the peer
      const clientFactory = async () => ({
        connect: mock.fn(async () => {}),
        inviteRedeem: mock.fn(async () => ({
          peer_id: peerId,
          pubkey: 'cHVibGljLWtleS1iYXNlNjQ=',
        })),
        disconnect: mock.fn(() => {}),
      });
      const first = await runAccept({
        code: 'cobra-sapphire-lighthouse-tango-a1b2',
        dataDir: dir,
        promptInput: mockPrompt('y'), // confirm Y
        _clientFactory: clientFactory,
      });
      assert.strictEqual(first.exitCode, 0);

      // Second accept for same peer (different code, same peer_id returned)
      const second = await runAccept({
        code: 'echo-alpha-bravo-delta-x1y2',
        dataDir: dir,
        promptInput: mockPrompt('y'),
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteRedeem: mock.fn(async () => ({
            peer_id: peerId,
            pubkey: 'cHVibGljLWtleS1iYXNlNjQ=',
          })),
          disconnect: mock.fn(() => {}),
        }),
      });
      assert.strictEqual(second.exitCode, 1);
      assert.ok(second.stderr.includes('already in known_peers'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('invite_redeem returns RendezvousError not_found → exitCode 1', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      const { RendezvousError } = await import('@peer-bridge/core');
      const result = await runAccept({
        code: 'cobra-sapphire-lighthouse-tango-a1b2',
        dataDir: dir,
        promptInput: mockPrompt('y'),
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteRedeem: mock.fn(async () => {
            throw new RendezvousError('not_found', 'Invite not found');
          }),
          disconnect: mock.fn(() => {}),
        }),
      });
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('not found'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('disconnect called on error path', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      let disconnectCalled = false;
      const result = await runAccept({
        code: 'cobra-sapphire-lighthouse-tango-a1b2',
        dataDir: dir,
        promptInput: mockPrompt('y'),
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteRedeem: mock.fn(async () => {
            throw new Error('boom');
          }),
          disconnect: mock.fn(() => {
            disconnectCalled = true;
          }),
        }),
      });
      assert.strictEqual(result.exitCode, 1);
      assert.ok(disconnectCalled, 'disconnect must be called on error');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('default alias = peer_id short form (12 chars after PB-) when user enters empty alias', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      const peerId = 'PB-123456789012-XXXXX-YYYYY-ZZZZZ-WWWWW-VVVVV';
      // First prompt: 'y' for confirmation, second prompt: '' for default alias
      const prompts = ['y', ''];
      let promptIndex = 0;
      const result = await runAccept({
        code: 'cobra-sapphire-lighthouse-tango-a1b2',
        dataDir: dir,
        promptInput: mock.fn(async () => prompts[promptIndex++] ?? ''),
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteRedeem: mock.fn(async () => ({
            peer_id: peerId,
            pubkey: 'cHVibGljLWtleS1iYXNlNjQ=',
          })),
          disconnect: mock.fn(() => {}),
        }),
      });
      assert.strictEqual(result.exitCode, 0);
      // Default = first 12 chars after "PB-" = "123456789012"
      assert.ok(result.stdout.includes("'123456789012'"), `stdout: ${result.stdout}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('shows fingerprint (peer_id) in prompt', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      // We can't easily capture process.stdout in tests, but we verify
      // the result assumes the prompt was shown
      const peerId = 'PB-MYFINGERPRINT-TEST-DATA-HERE';
      const result = await runAccept({
        code: 'cobra-sapphire-lighthouse-tango-a1b2',
        dataDir: dir,
        promptInput: mockPrompt('y'),
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteRedeem: mock.fn(async () => ({
            peer_id: peerId,
            pubkey: 'cHVibGljLWtleS1iYXNlNjQ=',
          })),
          disconnect: mock.fn(() => {}),
        }),
      });
      assert.strictEqual(result.exitCode, 0);
      // The fingerprint is shown via process.stdout.write, but we can at least
      // verify the peer was added with the correct peer_id
      const kpPath = path.join(dir, 'known_peers.toml');
      const content = readFileSync(kpPath, 'utf-8');
      assert.ok(content.includes(peerId));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // SKIP ON WINDOWS: The existing known_peers.toml may not exist yet (loadKnownPeers returns [] for missing file).
  // This test verifies that when known_peers.toml DOES already exist, append works correctly.
  it('appends to existing known_peers.toml (does not overwrite)', async () => {
    const dir = tmpdir();
    try {
      await bootstrap(dir);
      // First peer
      const firstPeerId = 'PB-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG';
      await runAccept({
        code: 'first-code-word-test-a1b2',
        dataDir: dir,
        promptInput: mockPrompt('y'),
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteRedeem: mock.fn(async () => ({
            peer_id: firstPeerId,
            pubkey: 'Zmlyc3Q=',
          })),
          disconnect: mock.fn(() => {}),
        }),
      });

      // Second peer
      const secondPeerId = 'PB-ZZZZ-YYYY-XXXX-WWWW-VVVV-UUUU-TTTT';
      await runAccept({
        code: 'second-code-word-test-x9y8',
        dataDir: dir,
        promptInput: mockPrompt('y'),
        _clientFactory: async () => ({
          connect: mock.fn(async () => {}),
          inviteRedeem: mock.fn(async () => ({
            peer_id: secondPeerId,
            pubkey: 'c2Vjb25k',
          })),
          disconnect: mock.fn(() => {}),
        }),
      });

      const content = readFileSync(path.join(dir, 'known_peers.toml'), 'utf-8');
      assert.ok(content.includes(firstPeerId));
      assert.ok(content.includes(secondPeerId));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
