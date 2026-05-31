// RoomSession test — CBOR frame round-trip through mock relay.
//
// Phase 5: proves RoomMsg and RoomFileOffer can round-trip through the
// PeerSession binary path (sendMessageBinary / onBinaryMessage) with
// encodeFrame / decodeFrame.
//
// Run: node --import tsx --test src/room-session.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { PeerConnectionManager } from './peer-connection-manager.js';
import { RoomSession } from './room-session.js';
import type { RoomMessage, RoomMsg, RoomFileOffer } from '@peer-bridge/protocol';

function makeRoomMsg(overrides?: Partial<RoomMsg>): RoomMsg {
  return {
    type: 'room:msg',
    room_id: crypto.randomBytes(16),
    sender_peer_id: crypto.randomBytes(32),
    body: 'hello from cborington',
    kind: 'text',
    seq: 1,
    ts: Date.now(),
    ...overrides,
  };
}

function makeRoomFileOffer(overrides?: Partial<RoomFileOffer>): RoomFileOffer {
  const sha256 = crypto.createHash('sha256').update(crypto.randomBytes(64)).digest();
  return {
    type: 'room:file_offer',
    room_id: crypto.randomBytes(16),
    file_id: crypto.randomUUID(),
    sender_peer_id: crypto.randomBytes(32),
    name: 'report.pdf',
    size: 1048576,
    sha256: new Uint8Array(sha256),
    note: 'the quarterly report',
    seq: 2,
    ts: Date.now(),
    ...overrides,
  };
}

describe('RoomSession CBOR frame transport', () => {
  it('round-trips a RoomMsg through mock relay', { timeout: 15_000 }, async () => {
    const mgr = new PeerConnectionManager({ iceServers: [], connectTimeoutMs: 10_000 });

    const alicePeer = mgr.createOutgoing();
    const bobPeer = mgr.createIncoming();

    // ── In-process mock relay ──
    alicePeer.onLocalDescription = (sdp, type) => bobPeer.acceptSignal(sdp, type);
    bobPeer.onLocalDescription = (sdp, type) => alicePeer.acceptSignal(sdp, type);
    alicePeer.onLocalCandidate = (candidate, mid) => bobPeer.acceptCandidate(candidate, mid);
    bobPeer.onLocalCandidate = (candidate, mid) => alicePeer.acceptCandidate(candidate, mid);

    // ── Wrap in RoomSessions ──
    const alice = new RoomSession(alicePeer);
    const bob = new RoomSession(bobPeer);

    // ── Connect ──
    const startTime = Date.now();
    await Promise.all([alicePeer.startOffer(10_000), bobPeer.waitForConnected(10_000)]);
    const handshakeMs = Date.now() - startTime;

    assert.strictEqual(alicePeer.state, 'connected');
    assert.strictEqual(bobPeer.state, 'connected');
    assert.ok(handshakeMs < 5000, `handshake took ${handshakeMs}ms (limit 5000ms)`);
    console.log(`  ✓ handshakeMs = ${handshakeMs}`);

    // ── Send RoomMsg from Alice → Bob ──
    const originalMsg = makeRoomMsg({
      body: 'hello cbor world',
      kind: 'text',
      seq: 1,
    });

    const bobReceived = new Promise<RoomMessage>((resolve) => {
      bob.onRoomMessage = resolve;
    });

    alice.send(originalMsg);

    const decoded = await bobReceived;

    // ── Assert every field round-trips ──
    assert.strictEqual(decoded.type, 'room:msg');
    const received = decoded as RoomMsg;
    assert.strictEqual(received.body, 'hello cbor world');
    assert.strictEqual(received.kind, 'text');
    assert.strictEqual(received.seq, 1);
    assert.strictEqual(received.ts, originalMsg.ts, 'ts must match');
    assert.ok(received.room_id instanceof Uint8Array, 'room_id must be Uint8Array');
    assert.ok(received.sender_peer_id instanceof Uint8Array, 'sender_peer_id must be Uint8Array');
    assert.deepStrictEqual(received.room_id, originalMsg.room_id, 'room_id binary must match');
    assert.deepStrictEqual(
      received.sender_peer_id,
      originalMsg.sender_peer_id,
      'sender_peer_id binary must match',
    );

    // ── Bidirectional: Bob → Alice ──
    const replyMsg = makeRoomMsg({ body: 'roger that', kind: 'text', seq: 2 });

    const aliceReceived = new Promise<RoomMessage>((resolve) => {
      alice.onRoomMessage = resolve;
    });

    bob.send(replyMsg);

    const reply = (await aliceReceived) as RoomMsg;
    assert.strictEqual(reply.body, 'roger that');
    assert.strictEqual(reply.seq, 2);
    assert.deepStrictEqual(reply.room_id, replyMsg.room_id);
    assert.deepStrictEqual(reply.sender_peer_id, replyMsg.sender_peer_id);

    // ── Cleanup ──
    alicePeer.close();
    bobPeer.close();

    assert.strictEqual(alicePeer.state, 'closed');
    assert.strictEqual(bobPeer.state, 'closed');
  });

  it('round-trips a RoomFileOffer through mock relay', { timeout: 15_000 }, async () => {
    const mgr = new PeerConnectionManager({ iceServers: [], connectTimeoutMs: 10_000 });

    const alicePeer = mgr.createOutgoing();
    const bobPeer = mgr.createIncoming();

    // ── In-process mock relay ──
    alicePeer.onLocalDescription = (sdp, type) => bobPeer.acceptSignal(sdp, type);
    bobPeer.onLocalDescription = (sdp, type) => alicePeer.acceptSignal(sdp, type);
    alicePeer.onLocalCandidate = (candidate, mid) => bobPeer.acceptCandidate(candidate, mid);
    bobPeer.onLocalCandidate = (candidate, mid) => alicePeer.acceptCandidate(candidate, mid);

    // ── Wrap in RoomSessions ──
    const alice = new RoomSession(alicePeer);
    const bob = new RoomSession(bobPeer);

    // ── Connect ──
    await Promise.all([alicePeer.startOffer(10_000), bobPeer.waitForConnected(10_000)]);
    assert.strictEqual(alicePeer.state, 'connected');
    assert.strictEqual(bobPeer.state, 'connected');

    // ── Send RoomFileOffer from Alice → Bob ──
    const originalOffer = makeRoomFileOffer({
      name: 'bigdata.csv',
      size: 500_000_000,
      note: '500MB dataset',
      seq: 7,
    });

    const bobReceived = new Promise<RoomMessage>((resolve) => {
      bob.onRoomMessage = resolve;
    });

    alice.send(originalOffer);

    const decoded = await bobReceived;

    // ── Assert every field round-trips (9 fields + ts) ──
    assert.strictEqual(decoded.type, 'room:file_offer');
    const received = decoded as RoomFileOffer;
    assert.strictEqual(received.name, 'bigdata.csv');
    assert.strictEqual(received.size, 500_000_000);
    assert.strictEqual(received.note, '500MB dataset');
    assert.strictEqual(received.seq, 7);
    assert.strictEqual(received.file_id, originalOffer.file_id, 'file_id must match');
    assert.strictEqual(received.ts, originalOffer.ts, 'ts must match');
    assert.ok(received.room_id instanceof Uint8Array, 'room_id must be Uint8Array');
    assert.ok(received.sender_peer_id instanceof Uint8Array, 'sender_peer_id must be Uint8Array');
    assert.ok(received.sha256 instanceof Uint8Array, 'sha256 must be Uint8Array');
    assert.deepStrictEqual(received.room_id, originalOffer.room_id, 'room_id binary must match');
    assert.deepStrictEqual(
      received.sender_peer_id,
      originalOffer.sender_peer_id,
      'sender_peer_id binary must match',
    );
    assert.deepStrictEqual(received.sha256, originalOffer.sha256, 'sha256 binary must match');

    // ── Cleanup ──
    alicePeer.close();
    bobPeer.close();
  });

  it(
    'room:msg carries 16-byte room_id and 32-byte sender_peer_id as Uint8Array',
    { timeout: 15_000 },
    async () => {
      const mgr = new PeerConnectionManager({ iceServers: [], connectTimeoutMs: 10_000 });

      const alicePeer = mgr.createOutgoing();
      const bobPeer = mgr.createIncoming();

      alicePeer.onLocalDescription = (sdp, type) => bobPeer.acceptSignal(sdp, type);
      bobPeer.onLocalDescription = (sdp, type) => alicePeer.acceptSignal(sdp, type);
      alicePeer.onLocalCandidate = (candidate, mid) => bobPeer.acceptCandidate(candidate, mid);
      bobPeer.onLocalCandidate = (candidate, mid) => alicePeer.acceptCandidate(candidate, mid);

      const alice = new RoomSession(alicePeer);
      const bob = new RoomSession(bobPeer);

      await Promise.all([alicePeer.startOffer(10_000), bobPeer.waitForConnected(10_000)]);

      // Construct explicit binary fields with known lengths
      const roomId = crypto.randomBytes(16);
      const peerId = crypto.randomBytes(32);

      const msg = makeRoomMsg({ room_id: roomId, sender_peer_id: peerId, body: 'binary test' });

      const bobReceived = new Promise<RoomMessage>((resolve) => {
        bob.onRoomMessage = resolve;
      });

      alice.send(msg);
      const decoded = (await bobReceived) as RoomMsg;

      // Verify lengths survived CBOR round-trip
      assert.strictEqual(decoded.room_id.length, 16, 'room_id must be 16 bytes');
      assert.strictEqual(decoded.sender_peer_id.length, 32, 'sender_peer_id must be 32 bytes');
      assert.deepStrictEqual(decoded.room_id, roomId);
      assert.deepStrictEqual(decoded.sender_peer_id, peerId);

      alicePeer.close();
      bobPeer.close();
    },
  );
});
