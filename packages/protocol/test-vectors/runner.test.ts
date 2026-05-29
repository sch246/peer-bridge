// Test vector runner — loads JSON test vectors and validates protocol implementations.
// Run with: node --import tsx --test test-vectors/runner.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodePeerId, decodePeerId, encodeBase32 } from '../src/peer-id.js';
import { generateInviteCode, hashInviteCode } from '../src/invite.js';
import { encodeFrame, decodeFrame } from '../src/frame.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadVectors<T>(filename: string): T {
  const path = resolve(__dirname, filename);
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

// ── Peer ID test vectors ──

interface PeerIdVector {
  input: { publicKey: string };
  expected: { base32_no_checksum: string; checksum_char: string; peer_id: string };
}

describe('Peer ID encoding', () => {
  const data = loadVectors<{ vectors: PeerIdVector[] }>('peer_id.json');

  for (const v of data.vectors) {
    it(v.name, () => {
      const pk = hexToBytes(v.input.publicKey);

      // Base32 encoding (no checksum)
      const base32 = encodeBase32(pk);
      assert.strictEqual(base32, v.expected.base32_no_checksum);

      // Full peer ID encoding
      const peerId = encodePeerId(pk);
      assert.strictEqual(peerId, v.expected.peer_id);

      // Round-trip: decode back to bytes
      const decoded = decodePeerId(peerId);
      assert.deepStrictEqual(decoded, pk);
    });
  }
});

// ── Invite code test vectors ──

interface InviteVector {
  input: { word_bytes: string; nonce_bytes: string };
  expected: { invite_code: string; code_hash: string };
}

describe('Invite code', () => {
  const data = loadVectors<{ vectors: InviteVector[] }>('invite.json');

  for (const v of data.vectors) {
    it(v.name, () => {
      const wordBytes = hexToBytes(v.input.word_bytes);
      const nonceBytes = hexToBytes(v.input.nonce_bytes);

      const code = generateInviteCode(wordBytes, nonceBytes);
      assert.strictEqual(code, v.expected.invite_code);

      const hash = hashInviteCode(code);
      assert.strictEqual(hash, v.expected.code_hash);
    });
  }
});

// ── CBOR frame test vectors ──

interface CBORFrameVector {
  input: Record<string, unknown>;
  expected: { frame_hex: string; note: string };
}

describe('CBOR frame encoding', () => {
  const data = loadVectors<{ vectors: CBORFrameVector[] }>('cbor_frames.json');

  for (const v of data.vectors) {
    it(v.name, () => {
      // Build message from input fields
      const msg = buildMessageFromInput(v.input);

      // Encode to frame
      const frame = encodeFrame(msg);

      // Compare with expected hex
      const expected = hexToBytes(v.expected.frame_hex);
      assert.deepStrictEqual(frame, expected, `Frame mismatch for: ${v.expected.note}`);

      // Round-trip: decode back
      const decoded = decodeFrame(frame);
      assert.strictEqual(decoded.type, msg.type);
    });
  }
});

// ── Helpers ──

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function buildMessageFromInput(
  input: Record<string, unknown>,
): import('../src/types.js').RoomMessage {
  const type = input.type as string;
  const ts = (input.ts as number) || 0;

  switch (type) {
    case 'room:hello':
      return {
        type: 'room:hello',
        version: (input.version as string) || '',
        capabilities: (input.capabilities as Record<string, boolean>) || {},
        ts,
      };
    case 'room:ping':
      return { type: 'room:ping', ts };
    case 'room:msg':
      return {
        type: 'room:msg',
        room_id: hexToBytes(input.room_id as string),
        sender_peer_id: hexToBytes(input.sender_peer_id as string),
        body: input.body as string,
        kind: (input.kind as 'text' | 'system') || 'text',
        seq: (input.seq as number) || 0,
        ts,
      };
    case 'room:file_offer':
      return {
        type: 'room:file_offer',
        room_id: hexToBytes(input.room_id as string),
        file_id: input.file_id as string,
        sender_peer_id: hexToBytes(input.sender_peer_id as string),
        name: input.name as string,
        size: (input.size as number) || 0,
        sha256: hexToBytes(input.sha256 as string),
        note: input.note as string | undefined,
        seq: (input.seq as number) || 0,
        ts,
      };
    case 'room:file_chunk':
      return {
        type: 'room:file_chunk',
        file_id: input.file_id as string,
        seq_num: (input.seq_num as number) || 0,
        data: hexToBytes(input.data as string),
      };
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}
