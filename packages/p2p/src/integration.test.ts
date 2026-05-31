// Integration test — two PeerSessions exchange control-channel messages through a
// real in-process RendezvousServer via wireSessionToRendezvous.
//
// Phase 3: adds fingerprint signing/verification. Happy-path test now passes
// auth options to wireSessionToRendezvous. A forged-signature test verifies
// that an envelope signed with the wrong key is rejected.
//
// Run: node --import tsx --test src/integration.test.ts

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair, getPeerId, initCrypto, RendezvousClient } from '@peer-bridge/core';
import { createServer } from '../../rendezvous/src/server.js';
import type { ServerDeps } from '../../rendezvous/src/server.js';
import { PeerConnectionManager } from './peer-connection-manager.js';
import { PeerSession } from './peer-session.js';
import { wireSessionToRendezvous } from './rendezvous-relay.js';
import type { RelayAuthOptions } from './rendezvous-relay.js';
import { PeerSessionError } from './errors.js';

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

  // ── Happy path: signed offer/answer exchange ───────────────────────────

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

      // 4. Build auth options
      const aliceAuth: RelayAuthOptions = {
        keyPair: aliceKp,
        localPeerId: alicePeerId,
        expectedRemotePeerId: bobPeerId,
      };
      const bobAuth: RelayAuthOptions = {
        keyPair: bobKp,
        localPeerId: bobPeerId,
        expectedRemotePeerId: alicePeerId,
      };

      // 5. Wire sessions to rendezvous
      const aliceUnsub = wireSessionToRendezvous(aliceSession, aliceClient, bobPeerId, aliceAuth);
      const bobUnsub = wireSessionToRendezvous(bobSession, bobClient, alicePeerId, bobAuth);

      // 6. Start offer/answer flow
      const startTime = Date.now();
      const aliceConnect = aliceSession.startOffer(15_000);
      const bobConnect = bobSession.waitForConnected(15_000);

      await Promise.all([aliceConnect, bobConnect]);
      const handshakeMs = Date.now() - startTime;

      // 7. Verify connected state
      assert.strictEqual(aliceSession.state, 'connected');
      assert.strictEqual(bobSession.state, 'connected');
      assert.ok(handshakeMs < 10_000, `handshake took ${handshakeMs}ms (limit 10s)`);
      console.log(`  ✓ rendezvous handshakeMs = ${handshakeMs}`);

      // 8. Exchange messages
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

      // 9. Cleanup in correct order: unsub → close → disconnect
      aliceUnsub();
      bobUnsub();
      aliceSession.close();
      bobSession.close();
      aliceClient.disconnect();
      bobClient.disconnect();
    },
  );

  // ── Forged signature: Mallory signs as Alice → rejected by Bob ─────────

  it('rejects forged signature and surfaces error via onError', { timeout: 15_000 }, async () => {
    // 1. Generate keypairs
    const aliceKp = await generateKeyPair();
    const malloryKp = await generateKeyPair();
    const bobKp = await generateKeyPair();
    const alicePeerId = getPeerId(aliceKp.publicKey);
    const bobPeerId = getPeerId(bobKp.publicKey);

    // 2. Connect clients
    const aliceClient = new RendezvousClient({ keypair: aliceKp, url: wsUrl });
    const bobClient = new RendezvousClient({ keypair: bobKp, url: wsUrl });

    const aliceRegistered = new Promise<void>((r) => aliceClient.once('registered', r));
    const bobRegistered = new Promise<void>((r) => bobClient.once('registered', r));

    await aliceClient.connect();
    await bobClient.connect();
    await Promise.all([aliceRegistered, bobRegistered]);

    assert.strictEqual(aliceClient.state, 'ready');
    assert.strictEqual(bobClient.state, 'ready');

    // 3. Create PeerSessions
    const aliceMgr = new PeerConnectionManager({ iceServers: [], connectTimeoutMs: 5000 });
    const bobMgr = new PeerConnectionManager({ iceServers: [], connectTimeoutMs: 5000 });

    const aliceSession = aliceMgr.createOutgoing();
    const bobSession = bobMgr.createIncoming();

    // Track Bob's state transitions and errors
    const bobStates: string[] = [];
    bobSession.onStateChange = (s) => bobStates.push(s);
    let bobError: PeerSessionError | null = null;
    bobSession.onError = (err) => {
      bobError = err;
    };

    // 4. Alice uses Mallory's keyPair but claims alicePeerId as localPeerId
    const aliceAuth: RelayAuthOptions = {
      keyPair: malloryKp,
      localPeerId: alicePeerId,
      expectedRemotePeerId: bobPeerId,
    };
    const bobAuth: RelayAuthOptions = {
      keyPair: bobKp,
      localPeerId: bobPeerId,
      expectedRemotePeerId: alicePeerId,
    };

    // 5. Wire sessions
    const aliceUnsub = wireSessionToRendezvous(aliceSession, aliceClient, bobPeerId, aliceAuth);
    const bobUnsub = wireSessionToRendezvous(bobSession, bobClient, alicePeerId, bobAuth);

    // 6. Alice starts offer — Bob rejects signature → Bob enters 'failed'
    //    Alice times out because Bob never answers.
    await assert.rejects(
      () => aliceSession.startOffer(5000),
      /PeerSession error/,
      'Alice offer should reject because Bob rejected the forged signature',
    );

    // 7. Bob must have entered 'failed' state with signature_invalid
    assert.strictEqual(
      bobSession.state,
      'failed',
      'Bob session should be failed because forged signature was rejected',
    );
    assert.ok(bobError !== null, 'Bob should have received an onError callback');
    const bobErr = bobError as PeerSessionError;
    assert.strictEqual(
      bobErr.reason,
      'signature_invalid',
      'Bob error reason should be signature_invalid',
    );
    assert.strictEqual(bobErr.code, 1);
    assert.ok(bobErr instanceof PeerSessionError);

    // 8. Cleanup
    aliceUnsub();
    bobUnsub();
    aliceSession.close();
    bobSession.close();
    aliceClient.disconnect();
    bobClient.disconnect();
  });

  // ── PeerSessionError constructor ────────────────────────────────────────

  it('PeerSessionError has correct shape', () => {
    const err = new PeerSessionError('signature_invalid', 'custom message');
    assert.strictEqual(err.reason, 'signature_invalid');
    assert.strictEqual(err.code, 1);
    assert.strictEqual(err.message, 'custom message');
    assert.strictEqual(err.name, 'PeerSessionError');
    assert.ok(err instanceof Error);
  });

  it('PeerSessionError has default message from reason', () => {
    const err = new PeerSessionError('connect_timeout');
    assert.ok(err.message.includes('connect_timeout'));
  });

  // ── PeerSession fail() method ──────────────────────────────────────────

  it('fail() transitions to failed and emits onError', async () => {
    const session = new PeerSession({ iceServers: [], connectTimeoutMs: 5000 }, 'test');

    assert.strictEqual(session.state, 'idle');

    const states: string[] = [];
    session.onStateChange = (s) => states.push(s);

    let caughtError: PeerSessionError | null = null;
    session.onError = (err) => {
      caughtError = err;
    };

    session.fail('pc_connection_failed');

    assert.strictEqual(session.state, 'failed');
    assert.deepStrictEqual(states, ['failed']);
    assert.ok(caughtError !== null, 'onError should have been called');
    const err = caughtError as PeerSessionError;
    assert.strictEqual(err.reason, 'pc_connection_failed');
    assert.strictEqual(err.code, 1);

    session.close();
  });

  it('fail() is idempotent', async () => {
    const session = new PeerSession({ iceServers: [], connectTimeoutMs: 5000 }, 'test');

    let errorCount = 0;
    session.onError = () => {
      errorCount++;
    };

    session.fail('schema_invalid');
    assert.strictEqual(errorCount, 1);
    assert.strictEqual(session.state, 'failed');

    // Second call should be a no-op
    session.fail('signature_invalid');
    assert.strictEqual(errorCount, 1, 'onError should not fire twice');
    assert.strictEqual(session.state, 'failed');

    session.close();
  });

  it('fail() rejects pending startOffer promise with PeerSessionError', async () => {
    const session = new PeerSession({ iceServers: [], connectTimeoutMs: 5000 }, 'test');

    // Wire a no-op local description to avoid errors
    session.onLocalDescription = () => {};
    session.onLocalCandidate = () => {};

    const startPromise = session.startOffer(5000);

    // Fail before connected
    session.fail('connect_timeout');

    await assert.rejects(
      () => startPromise,
      (err: unknown) => {
        assert.ok(err instanceof PeerSessionError);
        assert.strictEqual((err as PeerSessionError).reason, 'connect_timeout');
        return true;
      },
    );

    session.close();
  });

  it('fail() rejects pending waitForConnected promise with PeerSessionError', async () => {
    const session = new PeerSession({ iceServers: [], connectTimeoutMs: 5000 }, 'test');

    const waitPromise = session.waitForConnected(5000);

    session.fail('pc_connection_failed');

    await assert.rejects(
      () => waitPromise,
      (err: unknown) => {
        assert.ok(err instanceof PeerSessionError);
        assert.strictEqual((err as PeerSessionError).reason, 'pc_connection_failed');
        return true;
      },
    );

    session.close();
  });

  it('close() from failed state works', async () => {
    const session = new PeerSession({ iceServers: [], connectTimeoutMs: 5000 }, 'test');

    session.fail('peer_id_mismatch');
    assert.strictEqual(session.state, 'failed');

    const statesAfterFail: string[] = [];
    session.onStateChange = (s) => statesAfterFail.push(s);

    session.close();

    assert.strictEqual(session.state, 'closed');
    assert.deepStrictEqual(statesAfterFail, ['closing', 'closed']);
  });
});
