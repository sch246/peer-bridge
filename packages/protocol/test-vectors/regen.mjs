// One-shot generator for CBOR vector frame_hex documentation.
// Not a test runner. Run with: node packages/protocol/test-vectors/regen.mjs
// (only after rebuilding @peer-bridge/protocol)

import { encodeFrame } from '../dist/frame.js';

const toHex = (bytes) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
const hexToBytes = (h) => new Uint8Array(h.match(/.{2}/g).map((b) => parseInt(b, 16)));

const vectors = [
  {
    name: 'room:hello (minimal)',
    msg: { type: 'room:hello', version: '0.1.0', capabilities: {}, ts: 1736937600000 },
  },
  { name: 'room:ping', msg: { type: 'room:ping', ts: 1736937600000 } },
  {
    name: 'room:msg (text)',
    msg: {
      type: 'room:msg',
      room_id: hexToBytes('0102030405060708090a0b0c0d0e0f10'),
      sender_peer_id: hexToBytes(
        '0000000000000000000000000000000000000000000000000000000000000001',
      ),
      body: 'hello',
      kind: 'text',
      seq: 1,
      ts: 1736937600000,
    },
  },
  {
    name: 'room:file_offer (with note)',
    msg: {
      type: 'room:file_offer',
      room_id: hexToBytes('0102030405060708090a0b0c0d0e0f10'),
      file_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      sender_peer_id: hexToBytes(
        '0000000000000000000000000000000000000000000000000000000000000001',
      ),
      name: 'photo.jpg',
      size: 1048576,
      sha256: hexToBytes('0000000000000000000000000000000000000000000000000000000000000002'),
      note: 'check it out',
      seq: 42,
      ts: 1736937600000,
    },
  },
  {
    name: 'room:file_chunk (bulk channel)',
    msg: {
      type: 'room:file_chunk',
      file_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      seq_num: 42,
      data: hexToBytes('000102030405060708090a0b0c0d0e0f10'),
    },
  },
];

for (const v of vectors) {
  const frame = encodeFrame(v.msg);
  console.log(`${v.name}: ${toHex(frame)} (${frame.length}B)`);
}
