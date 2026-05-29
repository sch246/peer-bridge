// CBOR frame encoder/decoder for peer-bridge DataChannel messages.
//
// Frame format: [4-byte BE length] [CBOR payload]
// Spec: protocol.md §4

import { Encoder, decode, type Options } from 'cbor-x';
import { CBOR_KEYS, type RoomMessage } from './types.js';

const cborEncoder = new Encoder({
  // Use definitive-length encoding (no indefinite length)
  useRecords: false,
  // Keep maps as objects for JSON-like encoding
  mapsAsObjects: false,
} satisfies Options);

/**
 * Encode a RoomMessage to a CBOR map suitable for frame payload.
 * Uses integer keys per protocol.md Appendix B.
 */
function messageToCBORMap(msg: RoomMessage): Record<number, unknown> {
  const map: Record<number, unknown> = {};

  map[CBOR_KEYS.type] = msg.type;

  switch (msg.type) {
    case 'room:hello': {
      map[CBOR_KEYS.version] = msg.version;
      map[CBOR_KEYS.capabilities] = msg.capabilities;
      break;
    }
    case 'room:ping':
    case 'room:pong':
      break;
    case 'room:msg': {
      map[CBOR_KEYS.room_id] = msg.room_id;
      map[CBOR_KEYS.sender_peer_id] = msg.sender_peer_id;
      map[CBOR_KEYS.body] = msg.body;
      map[CBOR_KEYS.kind] = msg.kind;
      map[CBOR_KEYS.seq] = msg.seq;
      break;
    }
    case 'room:file_offer': {
      map[CBOR_KEYS.room_id] = msg.room_id;
      map[CBOR_KEYS.file_id] = msg.file_id;
      map[CBOR_KEYS.sender_peer_id] = msg.sender_peer_id;
      map[CBOR_KEYS.name] = msg.name;
      map[CBOR_KEYS.size] = msg.size;
      map[CBOR_KEYS.sha256] = msg.sha256;
      if (msg.note) map[CBOR_KEYS.note] = msg.note;
      map[CBOR_KEYS.seq] = msg.seq;
      break;
    }
    case 'room:file_accept': {
      map[CBOR_KEYS.room_id] = msg.room_id;
      map[CBOR_KEYS.file_id] = msg.file_id;
      break;
    }
    case 'room:file_reject': {
      map[CBOR_KEYS.room_id] = msg.room_id;
      map[CBOR_KEYS.file_id] = msg.file_id;
      map[CBOR_KEYS.reason] = msg.reason;
      break;
    }
    case 'room:file_chunk': {
      map[CBOR_KEYS.file_id] = msg.file_id;
      map[CBOR_KEYS.seq] = msg.seq_num;
      map[CBOR_KEYS.data] = msg.data;
      break;
    }
    case 'room:file_done': {
      map[CBOR_KEYS.file_id] = msg.file_id;
      break;
    }
    case 'room:file_abort': {
      map[CBOR_KEYS.room_id] = msg.room_id;
      map[CBOR_KEYS.file_id] = msg.file_id;
      map[CBOR_KEYS.reason] = msg.reason;
      break;
    }
    case 'room:resync_request': {
      map[CBOR_KEYS.room_id] = msg.room_id;
      map[CBOR_KEYS.sender_peer_id] = msg.sender;
      map[CBOR_KEYS.seq] = msg.from_seq;
      map[CBOR_KEYS.sha256] = msg.to_seq; // reuse sha256 key position for to_seq
      break;
    }
    case 'room:resync_response': {
      map[CBOR_KEYS.room_id] = msg.room_id;
      // messages array → CBOR array
      break;
    }
  }

  // Timestamp always present for ProtoMessage types (everything except room:file_chunk)
  if (msg.type !== 'room:file_chunk') {
    map[CBOR_KEYS.ts] = msg.ts;
  }

  return map;
}

/**
 * Encode a RoomMessage into a length-prefixed CBOR frame.
 * Returns the full frame as Uint8Array: [4B BE length][CBOR payload].
 */
export function encodeFrame(msg: RoomMessage): Uint8Array {
  const cborMap = messageToCBORMap(msg);
  const payload = cborEncoder.encode(cborMap);

  const frame = new Uint8Array(4 + payload.length);
  const view = new DataView(frame.buffer);

  // Big-endian 4-byte length
  view.setUint32(0, payload.length, false);

  // CBOR payload
  frame.set(payload, 4);

  return frame;
}

/**
 * Decode a CBOR frame into a RoomMessage.
 * Input: full frame: [4B BE length][CBOR payload].
 */
export function decodeFrame(frame: Uint8Array): RoomMessage {
  if (frame.length < 4) {
    throw new Error('Frame too short: missing length prefix');
  }

  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const payloadLength = view.getUint32(0, false);

  if (frame.length < 4 + payloadLength) {
    throw new Error(
      `Frame too short: expected ${4 + payloadLength} bytes, got ${frame.length}`,
    );
  }

  const payload = frame.slice(4, 4 + payloadLength);
  const map = decode(payload) as Record<number, unknown>;

  return cborMapToMessage(map);
}

/**
 * Convert a decoded CBOR map back to a typed RoomMessage.
 */
function cborMapToMessage(map: Record<number, unknown>): RoomMessage {
  const type = map[CBOR_KEYS.type] as string;

  switch (type) {
    case 'room:hello':
      return {
        type,
        version: map[CBOR_KEYS.version] as string,
        capabilities: (map[CBOR_KEYS.capabilities] as Record<string, boolean>) || {},
        ts: map[CBOR_KEYS.ts] as number,
      } as RoomMessage;
    case 'room:ping':
      return { type, ts: map[CBOR_KEYS.ts] as number } as RoomMessage;
    case 'room:pong':
      return { type, ts: map[CBOR_KEYS.ts] as number } as RoomMessage;
    case 'room:msg':
      return {
        type,
        room_id: map[CBOR_KEYS.room_id] as Uint8Array,
        sender_peer_id: map[CBOR_KEYS.sender_peer_id] as Uint8Array,
        body: map[CBOR_KEYS.body] as string,
        kind: (map[CBOR_KEYS.kind] as 'text' | 'system') || 'text',
        seq: map[CBOR_KEYS.seq] as number,
        ts: map[CBOR_KEYS.ts] as number,
      } as RoomMessage;
    case 'room:file_offer':
      return {
        type,
        room_id: map[CBOR_KEYS.room_id] as Uint8Array,
        file_id: map[CBOR_KEYS.file_id] as string,
        sender_peer_id: map[CBOR_KEYS.sender_peer_id] as Uint8Array,
        name: map[CBOR_KEYS.name] as string,
        size: map[CBOR_KEYS.size] as number,
        sha256: map[CBOR_KEYS.sha256] as Uint8Array,
        note: map[CBOR_KEYS.note] as string | undefined,
        seq: map[CBOR_KEYS.seq] as number,
        ts: map[CBOR_KEYS.ts] as number,
      } as RoomMessage;
    case 'room:file_chunk':
      return {
        type,
        file_id: map[CBOR_KEYS.file_id] as string,
        seq_num: map[CBOR_KEYS.seq] as number,
        data: map[CBOR_KEYS.data] as Uint8Array,
      } as RoomMessage;
    case 'room:file_accept':
      return {
        type,
        room_id: map[CBOR_KEYS.room_id] as Uint8Array,
        file_id: map[CBOR_KEYS.file_id] as string,
        ts: map[CBOR_KEYS.ts] as number,
      } as RoomMessage;
    case 'room:file_reject':
      return {
        type,
        room_id: map[CBOR_KEYS.room_id] as Uint8Array,
        file_id: map[CBOR_KEYS.file_id] as string,
        reason: map[CBOR_KEYS.reason] as string,
        ts: map[CBOR_KEYS.ts] as number,
      } as RoomMessage;
    case 'room:file_done':
      return {
        type,
        file_id: map[CBOR_KEYS.file_id] as string,
        ts: map[CBOR_KEYS.ts] as number,
      } as RoomMessage;
    case 'room:file_abort':
      return {
        type,
        room_id: map[CBOR_KEYS.room_id] as Uint8Array,
        file_id: map[CBOR_KEYS.file_id] as string,
        reason: map[CBOR_KEYS.reason] as string,
        ts: map[CBOR_KEYS.ts] as number,
      } as RoomMessage;
    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

/**
 * Extract the frame length from the first 4 bytes.
 * Useful for reading from a stream: read 4 bytes, get length, then read that many bytes.
 */
export function readFrameLength(header: Uint8Array): number {
  if (header.length < 4) {
    throw new Error('Header too short for length prefix');
  }
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  return view.getUint32(0, false);
}
