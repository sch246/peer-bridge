// PeerSession happy-path test — two PeerConnectionManagers exchange a control-channel
// message through an in-process mock relay.
//
// Mirrors packages/p2p-probe/src/probe.test.ts assert pattern.
//
// Run: node --import tsx --test src/peer-session.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PeerConnectionManager } from './peer-connection-manager.js';

describe('PeerSession happy path', () => {
  it(
    'two managers exchange "hello" via in-process callback relay',
    { timeout: 15_000 },
    async () => {
      const aliceMgr = new PeerConnectionManager({ iceServers: [], connectTimeoutMs: 10_000 });
      const bobMgr = new PeerConnectionManager({ iceServers: [], connectTimeoutMs: 10_000 });

      const alice = aliceMgr.createOutgoing();
      const bob = bobMgr.createIncoming();

      // ── In-process mock relay: wire signaling ──
      alice.onLocalDescription = (sdp, type) => bob.acceptSignal(sdp, type);
      bob.onLocalDescription = (sdp, type) => alice.acceptSignal(sdp, type);
      alice.onLocalCandidate = (candidate, mid) => bob.acceptCandidate(candidate, mid);
      bob.onLocalCandidate = (candidate, mid) => alice.acceptCandidate(candidate, mid);

      // ── Collect state transitions ──
      const aliceStates: string[] = [];
      const bobStates: string[] = [];
      alice.onStateChange = (s) => aliceStates.push(s);
      bob.onStateChange = (s) => bobStates.push(s);

      // ── Start negotiation ──
      const startTime = Date.now();
      const aliceConnect = alice.startOffer(10_000);
      const bobConnect = bob.waitForConnected(10_000);

      await Promise.all([aliceConnect, bobConnect]);
      const handshakeMs = Date.now() - startTime;

      // ── Verify states ──
      assert.strictEqual(alice.state, 'connected');
      assert.strictEqual(bob.state, 'connected');
      assert.deepStrictEqual(aliceStates, ['connecting', 'connected']);
      assert.deepStrictEqual(bobStates, ['connecting', 'connected']);

      // ── Handshake timing ──
      assert.ok(handshakeMs < 5000, `handshake took ${handshakeMs}ms (limit 5000ms)`);
      console.log(`  ✓ handshakeMs = ${handshakeMs}`);

      // ── Exchange "hello" messages ──
      const bobReceived = new Promise<string>((resolve) => {
        bob.onMessage = resolve;
      });
      alice.sendMessage('hello from alice');

      const aliceMsg = await bobReceived;
      assert.strictEqual(aliceMsg, 'hello from alice');

      // Bob replies
      const aliceReceived = new Promise<string>((resolve) => {
        alice.onMessage = resolve;
      });
      bob.sendMessage('hello from bob');

      const bobMsg = await aliceReceived;
      assert.strictEqual(bobMsg, 'hello from bob');

      // ── Cleanup ──
      alice.close();
      bob.close();

      assert.strictEqual(alice.state, 'closed');
      assert.strictEqual(bob.state, 'closed');
    },
  );
});
