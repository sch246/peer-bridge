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
});
