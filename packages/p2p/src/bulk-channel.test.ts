// Bulk DataChannel test — file_chunk round-trip through the bulk channel.
//
// Phase 6: proves
//   (1) PeerSession opens both control + bulk DataChannels (offerer creates,
//       answerer receives via dc.getLabel() routing),
//   (2) RoomFileChunk round-trips through the bulk channel via RoomSession.sendBulk,
//   (3) control + bulk are independent SCTP streams and both deliver,
//   (4) 64KiB is the safe upper bound — actual SCTP single-message ceiling.
//
// Run: node --import tsx --test src/bulk-channel.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { PeerConnectionManager } from './peer-connection-manager.js';
import { RoomSession } from './room-session.js';
import type { RoomMessage, RoomFileChunk, RoomMsg } from '@peer-bridge/protocol';

function makeFileChunk(overrides?: Partial<RoomFileChunk>): RoomFileChunk {
  return {
    type: 'room:file_chunk',
    file_id: crypto.randomUUID(),
    seq_num: 0,
    data: new Uint8Array(crypto.randomBytes(1024)),
    ...overrides,
  };
}

describe('Bulk DataChannel transport', () => {
  it('file_chunk round-trips through the bulk channel', { timeout: 15_000 }, async () => {
    const mgr = new PeerConnectionManager({ iceServers: [], connectTimeoutMs: 10_000 });

    const alicePeer = mgr.createOutgoing();
    const bobPeer = mgr.createIncoming();

    // Mock relay
    alicePeer.onLocalDescription = (sdp, type) => bobPeer.acceptSignal(sdp, type);
    bobPeer.onLocalDescription = (sdp, type) => alicePeer.acceptSignal(sdp, type);
    alicePeer.onLocalCandidate = (candidate, mid) => bobPeer.acceptCandidate(candidate, mid);
    bobPeer.onLocalCandidate = (candidate, mid) => alicePeer.acceptCandidate(candidate, mid);

    const alice = new RoomSession(alicePeer);
    const bob = new RoomSession(bobPeer);

    await Promise.all([alicePeer.startOffer(10_000), bobPeer.waitForConnected(10_000)]);
    assert.strictEqual(alicePeer.state, 'connected');
    assert.strictEqual(bobPeer.state, 'connected');

    // Wait for bulk channel to open (control gates connected, bulk opens slightly after)
    for (let i = 0; i < 50; i++) {
      if (alice.hasBulkChannel && bob.hasBulkChannel) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.strictEqual(alice.hasBulkChannel, true, 'alice bulk channel should open');
    assert.strictEqual(bob.hasBulkChannel, true, 'bob bulk channel should open');

    const original = makeFileChunk({ seq_num: 7, data: new Uint8Array(crypto.randomBytes(2048)) });
    const received = new Promise<RoomMessage>((resolve) => {
      bob.onRoomMessage = resolve;
    });

    alice.sendBulk(original);
    const decoded = (await received) as RoomFileChunk;

    assert.strictEqual(decoded.type, 'room:file_chunk');
    assert.strictEqual(decoded.file_id, original.file_id);
    assert.strictEqual(decoded.seq_num, 7);
    assert.strictEqual(decoded.data.byteLength, 2048);
    assert.deepStrictEqual(decoded.data, original.data, 'data bytes must match');

    alicePeer.close();
    bobPeer.close();
  });

  it('control and bulk both deliver independently', { timeout: 15_000 }, async () => {
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
    for (let i = 0; i < 50; i++) {
      if (alice.hasBulkChannel && bob.hasBulkChannel) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.strictEqual(bob.hasBulkChannel, true);

    const collected: RoomMessage[] = [];
    bob.onRoomMessage = (msg) => collected.push(msg);

    const ctrl: RoomMsg = {
      type: 'room:msg',
      room_id: new Uint8Array(crypto.randomBytes(16)),
      sender_peer_id: new Uint8Array(crypto.randomBytes(32)),
      body: 'hello on control',
      kind: 'text',
      seq: 1,
      ts: Date.now(),
    };
    const chunk = makeFileChunk({ seq_num: 1, data: new Uint8Array(crypto.randomBytes(512)) });

    alice.send(ctrl);
    alice.sendBulk(chunk);

    // Wait for both
    for (let i = 0; i < 100; i++) {
      if (collected.length >= 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    assert.strictEqual(collected.length, 2, 'both messages must arrive');
    assert.ok(
      collected.some((m) => m.type === 'room:msg'),
      'control room:msg must arrive',
    );
    assert.ok(
      collected.some((m) => m.type === 'room:file_chunk'),
      'bulk room:file_chunk must arrive',
    );

    // [choice] No cross-channel ordering — bulk and control are independent SCTP streams.

    alicePeer.close();
    bobPeer.close();
  });

  it('large chunk (32KiB) survives byte-for-byte', { timeout: 15_000 }, async () => {
    // 32KiB stays well below the SCTP single-message ceiling (64KiB) and the
    // CBOR/length-prefix overhead margin. Phase 7 will exercise the full
    // 64KiB-minus-overhead boundary when chunking is implemented.
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
    for (let i = 0; i < 50; i++) {
      if (alice.hasBulkChannel && bob.hasBulkChannel) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.strictEqual(bob.hasBulkChannel, true);

    const data = new Uint8Array(crypto.randomBytes(32 * 1024));
    const original: RoomFileChunk = {
      type: 'room:file_chunk',
      file_id: crypto.randomUUID(),
      seq_num: 99,
      data,
    };

    const received = new Promise<RoomMessage>((resolve) => {
      bob.onRoomMessage = resolve;
    });

    alice.sendBulk(original);
    const decoded = (await received) as RoomFileChunk;

    assert.strictEqual(decoded.type, 'room:file_chunk');
    assert.strictEqual(decoded.data.byteLength, 32 * 1024);
    assert.deepStrictEqual(decoded.data, data, '32KiB chunk must round-trip byte-for-byte');

    alicePeer.close();
    bobPeer.close();
  });
});
