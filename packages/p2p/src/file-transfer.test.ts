// File transfer test — e2e file transfer via FileSender + FileReceiver.
//
// Phase 7a: proves
//   (1) Happy-path 256KB random file transfers byte-for-byte with SHA-256 verification,
//   (2) Multi-chunk 1MB transfer (17+ chunks) has correct byte accounting,
//   (3) Reject path: sender promise rejects + receiver enters 'failed' state.
//
// Run: node --import tsx --test src/file-transfer.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PeerConnectionManager } from './peer-connection-manager.js';
import { RoomSession } from './room-session.js';
import { FileSender } from './file-sender.js';
import { FileReceiver } from './file-receiver.js';
import type { RoomFileAbort, RoomMessage } from '@peer-bridge/protocol';

/** Create a temporary file with random content of the given size (bytes). */
function createTempFile(size: number): { filePath: string; content: Buffer; sha256: Uint8Array } {
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-test-'));
  const filePath = path.join(tmpdir, 'test-file.bin');
  const content = crypto.randomBytes(size);
  fs.writeFileSync(filePath, content);
  const sha256 = new Uint8Array(crypto.createHash('sha256').update(content).digest());
  return { filePath, content, sha256 };
}

/** Set up a mock-relay pair of connected RoomSessions. */
async function setupPair(): Promise<{
  alice: RoomSession;
  bob: RoomSession;
  cleanup: () => void;
}> {
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

  // Wait for bulk channels to open
  for (let i = 0; i < 50; i++) {
    if (alice.hasBulkChannel && bob.hasBulkChannel) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.strictEqual(alice.hasBulkChannel, true, 'alice bulk channel should open');
  assert.strictEqual(bob.hasBulkChannel, true, 'bob bulk channel should open');

  return {
    alice,
    bob,
    cleanup: () => {
      alicePeer.close();
      bobPeer.close();
    },
  };
}

describe('FileSender + FileReceiver', () => {
  it(
    'happy-path: 256KB random file transfers byte-for-byte with SHA-256 match',
    { timeout: 15_000 },
    async () => {
      const { alice, bob, cleanup } = await setupPair();

      const { filePath, content, sha256 } = createTempFile(256 * 1024);
      const tmpdir = path.dirname(filePath);

      try {
        const roomId = crypto.randomBytes(16);
        const senderPeerId = crypto.randomBytes(32);

        // ── Bob: auto-accept to a temp file ──
        const savePath = path.join(tmpdir, 'received.bin');
        const receiver = new FileReceiver(bob);
        receiver.onFileOffer = async () => ({ accept: true, savePath });
        const donePromise = receiver.waitForDone();

        // ── Alice: send the file ──
        const sender = new FileSender(alice, {
          filePath,
          name: 'test-file.bin',
          roomId,
          senderPeerId,
          seq: 1,
        });

        const sendPromise = sender.send();

        // Wait for both sides
        await Promise.all([sendPromise, donePromise]);

        // ── Assert sender side ──
        assert.strictEqual(sender.state, 'done', 'sender must be done');
        assert.strictEqual(sender.bytesSent, 256 * 1024, 'sender bytesSent = 256KB');
        assert.strictEqual(sender.totalBytes, 256 * 1024, 'sender totalBytes = 256KB');

        // ── Assert receiver side ──
        assert.strictEqual(receiver.state, 'done', 'receiver must be done');

        // ── Assert file on disk matches original byte-for-byte ──
        const received = fs.readFileSync(savePath);
        assert.strictEqual(received.byteLength, 256 * 1024, 'received file size = 256KB');
        assert.deepStrictEqual(
          received,
          content,
          'received file must match original byte-for-byte', // A20: 最强断言行
        );

        // ── Assert SHA-256 matches ──
        const receivedHash = new Uint8Array(crypto.createHash('sha256').update(received).digest());
        assert.deepStrictEqual(receivedHash, sha256, 'SHA-256 must match');

        // Cleanup temp files
        fs.rmSync(tmpdir, { recursive: true });
      } finally {
        cleanup();
        // Best-effort temp cleanup — may already be removed above
        try {
          fs.rmSync(tmpdir, { recursive: true });
        } catch {
          /* already cleaned up */
        }
      }
    },
  );

  it(
    'multi-chunk: 1MB file transfers with correct byte accounting',
    { timeout: 15_000 },
    async () => {
      const { alice, bob, cleanup } = await setupPair();

      const { filePath, content, sha256 } = createTempFile(1024 * 1024);
      const tmpdir = path.dirname(filePath);

      try {
        const roomId = crypto.randomBytes(16);
        const senderPeerId = crypto.randomBytes(32);

        const savePath = path.join(tmpdir, 'received-1mb.bin');
        const receiver = new FileReceiver(bob);
        receiver.onFileOffer = async () => ({ accept: true, savePath });
        const donePromise = receiver.waitForDone();

        const sender = new FileSender(alice, {
          filePath,
          name: 'big-file.bin',
          roomId,
          senderPeerId,
          seq: 1,
        });

        await Promise.all([sender.send(), donePromise]);

        // ── Byte accounting ──
        assert.strictEqual(sender.state, 'done');
        assert.strictEqual(sender.bytesSent, 1024 * 1024, 'bytesSent = 1MB');
        assert.strictEqual(sender.totalBytes, 1024 * 1024, 'totalBytes = 1MB');

        // ── Chunks: 1MB / 60KB ≈ 18 chunks (ceil 17.07) ──
        // bytesSent proves all chunks were delivered and accounted for

        // ── Verify received file ──
        const received = fs.readFileSync(savePath);
        assert.strictEqual(received.byteLength, 1024 * 1024);
        assert.deepStrictEqual(received, content, '1MB file must match byte-for-byte');

        const receivedHash = new Uint8Array(crypto.createHash('sha256').update(received).digest());
        assert.deepStrictEqual(receivedHash, sha256, 'SHA-256 must match');

        fs.rmSync(tmpdir, { recursive: true });
      } finally {
        cleanup();
        try {
          fs.rmSync(tmpdir, { recursive: true });
        } catch {
          /* already cleaned up */
        }
      }
    },
  );

  it(
    'reject path: sender promise rejects and receiver enters failed state',
    { timeout: 15_000 },
    async () => {
      const { alice, bob, cleanup } = await setupPair();

      const { filePath } = createTempFile(64 * 1024);
      const tmpdir = path.dirname(filePath);

      try {
        const roomId = crypto.randomBytes(16);
        const senderPeerId = crypto.randomBytes(32);

        // ── Bob: explicitly reject ──
        const receiver = new FileReceiver(bob);
        receiver.onFileOffer = async () => ({
          accept: false,
          reason: 'user_rejected',
        });

        const sender = new FileSender(alice, {
          filePath,
          name: 'reject-me.bin',
          roomId,
          senderPeerId,
          seq: 1,
        });

        // ── Wait for the reject to propagate ──
        // Bob rejects synchronously in onFileOffer → file_reject sent immediately.
        // Alice receives it via the wrapped onRoomMessage and rejects the promise.
        await assert.rejects(
          () => sender.send(),
          /File rejected: user_rejected/,
          'sender promise must reject with user_rejected reason',
        );

        assert.strictEqual(sender.state, 'failed', 'sender state must be failed');
        assert.strictEqual(receiver.state, 'failed', 'receiver state must be failed');

        await assert.rejects(
          () => receiver.waitForDone(),
          /File rejected: user_rejected/,
          'receiver waitForDone must reject',
        );

        fs.rmSync(tmpdir, { recursive: true });
      } finally {
        cleanup();
        try {
          fs.rmSync(tmpdir, { recursive: true });
        } catch {
          /* already cleaned up */
        }
      }
    },
  );

  // ── Phase 7b tests ──

  it(
    'backpressure flow control: 10MB random file transfers byte-for-byte with SHA-256 match',
    { timeout: 30_000 },
    async () => {
      const { alice, bob, cleanup } = await setupPair();

      // Set backpressure threshold to 256 KiB on alice's underlying peer session
      alice.session.setBulkBufferedAmountLowThreshold(256 * 1024);

      const { filePath, content, sha256 } = createTempFile(10 * 1024 * 1024); // 10 MiB
      const tmpdir = path.dirname(filePath);

      try {
        const roomId = crypto.randomBytes(16);
        const senderPeerId = crypto.randomBytes(32);

        // Bob: auto-accept
        const savePath = path.join(tmpdir, 'received-10mb.bin');
        const receiver = new FileReceiver(bob);
        receiver.onFileOffer = async () => ({ accept: true, savePath });
        const donePromise = receiver.waitForDone();

        // Alice: send with hasBulkChannel guard + backpressure
        const sender = new FileSender(alice, {
          filePath,
          name: 'large-10mb.bin',
          roomId,
          senderPeerId,
          seq: 1,
        });

        const sendPromise = sender.send();

        await Promise.all([sendPromise, donePromise]);

        // ── Sender assertions ──
        assert.strictEqual(sender.state, 'done', 'sender must be done');
        assert.strictEqual(sender.bytesSent, 10 * 1024 * 1024, 'bytesSent = 10 MiB');
        assert.strictEqual(sender.totalBytes, 10 * 1024 * 1024, 'totalBytes = 10 MiB');

        // ── Receiver assertions ──
        assert.strictEqual(receiver.state, 'done', 'receiver must be done');

        // ── A20: strongest assertion — 10MB byte-for-byte match ──
        const received = fs.readFileSync(savePath);
        assert.strictEqual(received.byteLength, 10 * 1024 * 1024, 'received file size = 10 MiB');
        assert.deepStrictEqual(
          received,
          content,
          '10 MiB file must match original byte-for-byte under backpressure flow control', // A20: strongest assertion
        );

        // SHA-256 match
        const receivedHash = new Uint8Array(crypto.createHash('sha256').update(received).digest());
        assert.deepStrictEqual(receivedHash, sha256, 'SHA-256 must match for 10 MiB transfer');

        fs.rmSync(tmpdir, { recursive: true });
      } finally {
        cleanup();
        try {
          fs.rmSync(tmpdir, { recursive: true });
        } catch {
          /* already cleaned up */
        }
      }
    },
  );

  it(
    'size limit: file_offer >500 MiB triggers file_reject before user callback',
    { timeout: 15_000 },
    async () => {
      const { alice, bob, cleanup } = await setupPair();

      try {
        const roomId = crypto.randomBytes(16);

        // Bob: receiver with onFileOffer that should NOT be called
        let onFileOfferCalled = false;
        const receiver = new FileReceiver(bob);
        receiver.onFileOffer = async () => {
          onFileOfferCalled = true;
          return { accept: true, savePath: '/tmp/never-used' };
        };

        const failPromise = receiver.waitForDone().catch((err: Error) => err.message);

        // Collect file_reject on alice side
        let rejectReceived: string | null = null;
        const originalHandler = alice.onRoomMessage;
        alice.onRoomMessage = (msg: RoomMessage) => {
          if (msg.type === 'room:file_reject') {
            rejectReceived = (msg as { reason: string }).reason;
          }
          originalHandler?.(msg);
        };

        // Alice: send a file_offer with size >500 MiB directly on control channel
        // (bypass FileSender since FileSender computes real file size from fs.stat)
        const fakeFileId = crypto.randomUUID();
        alice.send({
          type: 'room:file_offer',
          room_id: roomId,
          file_id: fakeFileId,
          sender_peer_id: crypto.randomBytes(32),
          name: 'giant-file.bin',
          size: 600 * 1024 * 1024, // 600 MiB
          sha256: crypto.randomBytes(32),
          seq: 1,
          ts: Date.now(),
        });

        // Wait for the reject to propagate
        for (let i = 0; i < 50; i++) {
          if (rejectReceived) break;
          await new Promise((r) => setTimeout(r, 50));
        }

        // Assertions
        const failReason = await failPromise;
        assert.strictEqual(failReason, 'file_too_large', 'receiver must fail with file_too_large');
        assert.strictEqual(receiver.state, 'failed', 'receiver state must be failed');
        assert.strictEqual(
          rejectReceived,
          'file_too_large',
          'alice must receive file_reject with reason file_too_large',
        );
        assert.strictEqual(onFileOfferCalled, false, 'onFileOffer callback must NOT be called');

        // Cleanup
        alice.onRoomMessage = originalHandler;
      } finally {
        cleanup();
      }
    },
  );

  it(
    'chunk gap: missing seq_num triggers file_abort and deletes .part',
    { timeout: 15_000 },
    async () => {
      const { alice, bob, cleanup } = await setupPair();

      try {
        const roomId = crypto.randomBytes(16);
        const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-test-'));

        // Bob: auto-accept
        const savePath = path.join(tmpdir, 'received-gap.bin');
        const receiver = new FileReceiver(bob);
        receiver.onFileOffer = async () => ({ accept: true, savePath });
        const failPromise = receiver.waitForDone().catch((err: Error) => err.message);

        // Collect file_abort on alice side
        let abortReceived: RoomFileAbort | null = null;
        const originalHandler = alice.onRoomMessage;
        alice.onRoomMessage = (msg: RoomMessage) => {
          if (msg.type === 'room:file_abort') {
            abortReceived = msg as RoomFileAbort;
          }
          originalHandler?.(msg);
        };

        // Alice: send file_offer
        const fileId = crypto.randomUUID();
        alice.send({
          type: 'room:file_offer',
          room_id: roomId,
          file_id: fileId,
          sender_peer_id: crypto.randomBytes(32),
          name: 'gap-test.bin',
          size: 256 * 1024,
          sha256: crypto.randomBytes(32), // won't match — abort happens first
          seq: 1,
          ts: Date.now(),
        });

        // Wait for file_accept
        await new Promise((r) => setTimeout(r, 100));
        if (receiver.state !== 'receiving') {
          await new Promise((r) => setTimeout(r, 100));
        }

        // Send chunk seq_num=0 (valid first chunk)
        alice.sendBulk({
          type: 'room:file_chunk',
          file_id: fileId,
          seq_num: 0,
          data: new Uint8Array(crypto.randomBytes(1024)),
        });

        // Brief yield to let the receiver process seq_num=0
        await new Promise((r) => setTimeout(r, 50));

        // Send chunk seq_num=2 (GAP — should be 1)
        alice.sendBulk({
          type: 'room:file_chunk',
          file_id: fileId,
          seq_num: 2,
          data: new Uint8Array(crypto.randomBytes(1024)),
        });

        // Wait for abort to propagate
        for (let i = 0; i < 50; i++) {
          if (abortReceived) break;
          await new Promise((r) => setTimeout(r, 50));
        }

        // Assertions
        const failReason = await failPromise;
        assert.strictEqual(failReason, 'chunk_gap', 'receiver must fail with chunk_gap');
        assert.strictEqual(receiver.state, 'failed', 'receiver state must be failed');
        assert.ok(abortReceived, 'alice must receive file_abort');
        assert.strictEqual(abortReceived!.file_id, fileId, 'abort file_id must match');
        assert.strictEqual(abortReceived!.reason, 'chunk_gap', 'abort reason must be chunk_gap');

        // .part file must be deleted
        assert.strictEqual(
          fs.existsSync(savePath + '.part'),
          false,
          '.part file must be deleted after chunk_gap',
        );

        // Cleanup
        alice.onRoomMessage = originalHandler;
        fs.rmSync(tmpdir, { recursive: true });
      } finally {
        cleanup();
        try {
          fs.rmSync(tmpdir, { recursive: true });
        } catch {
          /* already cleaned up */
        }
      }
    },
  );

  it(
    'sha256 mismatch: receiver sends file_abort and deletes .part',
    { timeout: 15_000 },
    async () => {
      const { alice, bob, cleanup } = await setupPair();

      const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-test-'));

      try {
        const roomId = crypto.randomBytes(16);

        // Bob: auto-accept
        const savePath = path.join(tmpdir, 'received-bad-hash.bin');
        const receiver = new FileReceiver(bob);
        receiver.onFileOffer = async () => ({ accept: true, savePath });
        const failPromise = receiver.waitForDone().catch((err: Error) => err.message);

        // Collect file_abort on alice side
        let abortReceived: RoomFileAbort | null = null;
        const originalHandler = alice.onRoomMessage;
        alice.onRoomMessage = (msg: RoomMessage) => {
          if (msg.type === 'room:file_abort') {
            abortReceived = msg as RoomFileAbort;
          }
          originalHandler?.(msg);
        };

        // Alice: send file_offer with a fake random SHA-256 (won't match actual chunks)
        const fakeSha256 = crypto.randomBytes(32);
        const realChunkData = crypto.randomBytes(60 * 1024); // 60 KiB
        const fileId = crypto.randomUUID();

        alice.send({
          type: 'room:file_offer',
          room_id: roomId,
          file_id: fileId,
          sender_peer_id: crypto.randomBytes(32),
          name: 'mismatch-test.bin',
          size: 60 * 1024,
          sha256: fakeSha256,
          seq: 1,
          ts: Date.now(),
        });

        // Wait for file_accept
        await new Promise((r) => setTimeout(r, 100));
        if (receiver.state !== 'receiving') {
          await new Promise((r) => setTimeout(r, 100));
        }

        // Send one real chunk (different from the fake SHA-256)
        alice.sendBulk({
          type: 'room:file_chunk',
          file_id: fileId,
          seq_num: 0,
          data: realChunkData,
        });

        // Send file_done
        alice.send({
          type: 'room:file_done',
          file_id: fileId,
          ts: Date.now(),
        });

        // Wait for abort to propagate
        for (let i = 0; i < 50; i++) {
          if (abortReceived) break;
          await new Promise((r) => setTimeout(r, 50));
        }

        // Assertions
        const failReason = await failPromise;
        assert.strictEqual(
          failReason,
          'sha256_mismatch',
          'receiver must fail with sha256_mismatch',
        );
        assert.strictEqual(receiver.state, 'failed', 'receiver state must be failed');
        assert.ok(abortReceived, 'alice must receive file_abort');
        assert.strictEqual(abortReceived!.file_id, fileId, 'abort file_id must match');
        assert.strictEqual(
          abortReceived!.reason,
          'sha256_mismatch',
          'abort reason must be sha256_mismatch',
        );

        // .part file must be deleted
        assert.strictEqual(
          fs.existsSync(savePath + '.part'),
          false,
          '.part file must be deleted after sha256_mismatch',
        );

        // Cleanup
        alice.onRoomMessage = originalHandler;
        fs.rmSync(tmpdir, { recursive: true });
      } finally {
        cleanup();
        try {
          fs.rmSync(tmpdir, { recursive: true });
        } catch {
          /* already cleaned up */
        }
      }
    },
  );
});
