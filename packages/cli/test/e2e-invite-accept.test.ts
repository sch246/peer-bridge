// test/e2e-invite-accept.test.ts — E2E integration test: real rendezvous server + CLI
// invite/accept flow. Boots a live rendezvous server on a random port and exercises
// runInvite (Alice) + runAccept (Bob) end-to-end with the real RendezvousClient
// (no client mocks).
//
// CHOICE: test directory (test/) separate from source (src/) — keeps integration
//         tests segregated from unit tests. Tests are slower and network-using.
// CHOICE: relative-path import for createServer — @peer-bridge/rendezvous doesn't
//         export createServer from its public API. We import from the source path.
// CHOICE: workspace devDependency on @peer-bridge/rendezvous so transitive deps
//         (fastify, @fastify/websocket, etc.) are resolvable via the node_modules
//         graph when importing from ../../rendezvous/src/server.js.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from '../../rendezvous/src/server.js';
import type { ServerDeps } from '../../rendezvous/src/server.js';
import { runInit } from '../src/commands/init.js';
import { runInvite } from '../src/commands/invite.js';
import { runAccept } from '../src/commands/accept.js';
import { loadKnownPeers } from '@peer-bridge/core';
import { loadIdentity } from '../src/identity-storage.js';

function tmpdir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'pb-cli-e2e-'));
}

/** Patch config.toml in dir: replace placeholder URL with actual wsUrl. */
function patchConfigUrl(dir: string, wsUrl: string): void {
  const configPath = path.join(dir, 'config.toml');
  let cfg = readFileSync(configPath, 'utf-8');
  cfg = cfg.replace('wss://rdv.example.com', wsUrl);
  writeFileSync(configPath, cfg, 'utf-8');
}

/** Extract invite code from runInvite stdout. */
function extractInviteCode(stdout: string): string {
  const match = stdout.match(/Invite code: (\S+)/);
  assert.ok(match, `Could not parse invite code from: ${stdout}`);
  return match![1];
}

describe('E2E: invite + accept flow', () => {
  let serverHandle: Awaited<ReturnType<typeof createServer>>;
  let wsUrl: string;
  let aliceDir: string;
  let bobDir: string;
  /** The invite code from test 1 — consumed, used by test 3 to verify double-redeem. */
  let consumedInviteCode: string;
  let alicePeerId: string;

  before(async () => {
    // 1. Boot rendezvous server on random port (pattern from server.test.ts:823-840)
    const deps: ServerDeps = {
      config: {
        server: { listen: '127.0.0.1:0', public_url: 'ws://127.0.0.1:0', identity_key: '' },
        limits: {
          max_peers: 1000,
          max_invites_per_ip_per_hour: 20,
          max_offline_notify_size: 1024,
          offline_notify_ttl_hours: 24,
        },
        federation: [],
      },
      serverId: 'ed25519:e2e-test',
    };

    serverHandle = await createServer(deps);
    const addr = await serverHandle.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (addr.match(/:(\d+)/) as RegExpMatchArray)[1];
    wsUrl = `ws://127.0.0.1:${port}/ws`;

    // 2. Bootstrap Alice's identity + config
    aliceDir = tmpdir();
    const aliceInit = await runInit({ dataDir: aliceDir });
    assert.strictEqual(aliceInit.exitCode, 0, `alice init: ${aliceInit.stderr}`);
    patchConfigUrl(aliceDir, wsUrl);
    const aliceIdent = await loadIdentity(aliceDir);
    assert.ok(aliceIdent, 'alice identity missing');
    alicePeerId = aliceIdent.peerId;

    // 3. Bootstrap Bob's identity + config
    bobDir = tmpdir();
    const bobInit = await runInit({ dataDir: bobDir });
    assert.strictEqual(bobInit.exitCode, 0, `bob init: ${bobInit.stderr}`);
    patchConfigUrl(bobDir, wsUrl);
  });

  after(async () => {
    await serverHandle.app.close();
    rmSync(aliceDir, { recursive: true, force: true });
    rmSync(bobDir, { recursive: true, force: true });
  });

  // ── Test 1: happy path — invite + accept ────────────────────────────────

  it('Alice creates invite, Bob accepts, Bob known_peers contains Alice with trust=verified', async () => {
    // Alice creates invite
    const inviteResult = await runInvite({ dataDir: aliceDir });
    assert.strictEqual(inviteResult.exitCode, 0, `invite: ${inviteResult.stderr}`);
    consumedInviteCode = extractInviteCode(inviteResult.stdout);

    // Bob accepts — mock prompt returns 'y' then 'alice'
    const promptInputs = ['y', 'alice'];
    const mockPrompt = async () => promptInputs.shift() ?? '';

    const acceptResult = await runAccept({
      dataDir: bobDir,
      code: consumedInviteCode,
      promptInput: mockPrompt,
    });
    assert.strictEqual(acceptResult.exitCode, 0, `accept: ${acceptResult.stderr}`);
    assert.ok(acceptResult.stdout.includes("Added peer 'alice'"), `stdout: ${acceptResult.stdout}`);

    // Verify known_peers.toml
    const knownPeersPath = path.join(bobDir, 'known_peers.toml');
    const peers = loadKnownPeers(knownPeersPath);
    assert.strictEqual(peers.length, 1, `expected 1 peer, got ${peers.length}`);
    assert.strictEqual(peers[0].peer_id, alicePeerId);
    assert.strictEqual(peers[0].alias, 'alice');
    // @telos decisions/manual-fingerprint-confirmation-on-accept.md — trust MUST be "verified"
    assert.strictEqual(
      peers[0].trust,
      'verified',
      `trust should be "verified" per manual-fingerprint-confirmation decision`,
    );
    assert.strictEqual(peers[0].home_rendezvous, wsUrl);
  });

  // ── Test 2: decline prompt → no peer added ──────────────────────────────

  it('Bob declining the prompt does NOT write known_peers', async () => {
    // Fresh Bob dir for clean assertion
    const bob2Dir = tmpdir();

    try {
      const bob2Init = await runInit({ dataDir: bob2Dir });
      assert.strictEqual(bob2Init.exitCode, 0);
      patchConfigUrl(bob2Dir, wsUrl);

      // Alice creates a fresh invite
      const inviteResult = await runInvite({ dataDir: aliceDir });
      assert.strictEqual(inviteResult.exitCode, 0);
      const code = extractInviteCode(inviteResult.stdout);

      // Bob inputs 'n' to decline
      const mockDecline = async () => 'n';
      const acceptResult = await runAccept({
        dataDir: bob2Dir,
        code,
        promptInput: mockDecline,
      });

      assert.strictEqual(acceptResult.exitCode, 0);
      assert.ok(acceptResult.stdout.includes('Cancelled'), `stdout: ${acceptResult.stdout}`);

      // known_peers.toml should NOT exist (fresh dir, user declined)
      const knownPeersPath = path.join(bob2Dir, 'known_peers.toml');
      assert.strictEqual(
        existsSync(knownPeersPath),
        false,
        'known_peers.toml should not exist after declining',
      );
    } finally {
      rmSync(bob2Dir, { recursive: true, force: true });
    }
  });

  // ── Test 3: re-redeem of consumed code → exitCode 1 ─────────────────────

  it('Bob redeeming an already-redeemed code fails cleanly', async () => {
    const bob3Dir = tmpdir();

    try {
      const bob3Init = await runInit({ dataDir: bob3Dir });
      assert.strictEqual(bob3Init.exitCode, 0);
      patchConfigUrl(bob3Dir, wsUrl);

      // Attempt to redeem the code from test 1 (already consumed)
      const mockPrompt = async () => 'y'; // won't reach prompt — error fires first
      const acceptResult = await runAccept({
        dataDir: bob3Dir,
        code: consumedInviteCode,
        promptInput: mockPrompt,
      });

      assert.strictEqual(
        acceptResult.exitCode,
        1,
        `expected exitCode 1, got ${acceptResult.exitCode}\nstderr: ${acceptResult.stderr}`,
      );
      // Error message should surface the RendezvousError code (not_found from server)
      assert.ok(
        acceptResult.stderr.includes('not_found') || acceptResult.stderr.includes('already used'),
        `stderr should mention not_found or already used, got: ${acceptResult.stderr}`,
      );
    } finally {
      rmSync(bob3Dir, { recursive: true, force: true });
    }
  });
});
