// Integration test — two PeerSessions exchange control-channel messages through a
// real in-process RendezvousServer via wireSessionToRendezvous.
//
// Replaces the Phase 1 in-memory callback relay with real RendezvousClient signaling.
// The old mock-relay test (peer-session.test.ts) is preserved and must continue to pass.
//
// Run: node --import tsx --test src/integration.test.ts

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair, getPeerId, initCrypto, RendezvousClient } from '@peer-bridge/core';
import { createServer } from '../../rendezvous/src/server.js';
import type { ServerDeps } from '../../rendezvous/src/server.js';
import { PeerConnectionManager } from './peer-connection-manager.js';
import { wireSessionToRendezvous } from './rendezvous-relay.js';

describe('Rendezvous-relay integration', () => {
  let serverHandle: Awaited<ReturnType<typeof createServer>>;
  let wsUrl: string;

  // ── Boot in-process rendezvous server ─────────────────────────────────

  before(async () => {
    await initCrypto();

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
      serverId: 'ed25519:p2p-integration-test',
    };

    serverHandle = await createServer(deps);
    const addr = await serverHandle.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (addr.match(/:(\d+)/) as RegExpMatchArray)[1];
    wsUrl = `ws://127.0.0.1:${port}/ws`;
  });

  after(async () => {
    await serverHandle.app.close();
  });

  // ── Main integration test ──────────────────────────────────────────────

  it(
    'two PeerSessions exchange messages through rendezvous server',
    { timeout: 30_000 },
    async () => {
      // 1. Generate keypairs
      const aliceKp = await generateKeyPair();
      const bobKp = await generateKeyPair();
      const alicePeerId = getPeerId(aliceKp.publicKey);
      const bobPeerId = getPeerId(bobKp.publicKey);

      // 2. Create and connect RendezvousClients
      const aliceClient = new RendezvousClient({
        keypair: aliceKp,
        url: wsUrl,
      });
      const bobClient = new RendezvousClient({
        keypair: bobKp,
        url: wsUrl,
      });

      const aliceRegistered = new Promise<void>((resolve) => {
        aliceClient.once('registered', () => resolve());
      });
      const bobRegistered = new Promise<void>((resolve) => {
        bobClient.once('registered', () => resolve());
      });

      await aliceClient.connect();
      await bobClient.connect();
      await Promise.all([aliceRegistered, bobRegistered]);

      assert.strictEqual(aliceClient.state, 'ready');
      assert.strictEqual(bobClient.state, 'ready');

      // 3. Create PeerSessions
      const aliceMgr = new PeerConnectionManager({ iceServers: [], connectTimeoutMs: 15_000 });
      const bobMgr = new PeerConnectionManager({ iceServers: [], connectTimeoutMs: 15_000 });

      const aliceSession = aliceMgr.createOutgoing();
      const bobSession = bobMgr.createIncoming();

      // 4. Wire sessions to rendezvous
      const aliceUnsub = wireSessionToRendezvous(aliceSession, aliceClient, bobPeerId);
      const bobUnsub = wireSessionToRendezvous(bobSession, bobClient, alicePeerId);

      // 5. Start offer/answer flow
      const startTime = Date.now();
      const aliceConnect = aliceSession.startOffer(15_000);
      const bobConnect = bobSession.waitForConnected(15_000);

      await Promise.all([aliceConnect, bobConnect]);
      const handshakeMs = Date.now() - startTime;

      // 6. Verify connected state
      assert.strictEqual(aliceSession.state, 'connected');
      assert.strictEqual(bobSession.state, 'connected');
      assert.ok(handshakeMs < 10_000, `handshake took ${handshakeMs}ms (limit 10s)`);
      console.log(`  ✓ rendezvous handshakeMs = ${handshakeMs}`);

      // 7. Exchange messages
      const bobReceived = new Promise<string>((resolve) => {
        bobSession.onMessage = resolve;
      });
      aliceSession.sendMessage('hello-from-alice');
      const msg1 = await bobReceived;
      assert.strictEqual(msg1, 'hello-from-alice');

      const aliceReceived = new Promise<string>((resolve) => {
        aliceSession.onMessage = resolve;
      });
      bobSession.sendMessage('hello-from-bob');
      const msg2 = await aliceReceived;
      assert.strictEqual(msg2, 'hello-from-bob');

      // 8. Cleanup in correct order: unsub → close → disconnect
      aliceUnsub();
      bobUnsub();
      aliceSession.close();
      bobSession.close();
      aliceClient.disconnect();
      bobClient.disconnect();
    },
  );
});
