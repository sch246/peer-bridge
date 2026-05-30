// Protocol message type definitions for peer-bridge.
// All DataChannel messages use CBOR encoding with integer keys (see protocol.md Appendix B).

/**
 * CBOR integer keys for all message fields.
 *
 * INVARIANT: every protocol field holds a UNIQUE integer key. Reusing keys
 * across message types caused a silent wire-corruption bug in `room:file_offer`
 * (e.g. file_id and sender_peer_id both at key 2 — the second assignment
 * overwrote the first in the CBOR map).
 *
 * Spec authority: docs/protocol.md §Appendix B.
 * Decision: .telos/decisions/unique-cbor-keys-not-message-scoped.md
 * Fact:     .telos/facts/cbor-key-allocation.md
 */
export const CBOR_KEYS = {
  type: 0,
  room_id: 1,
  sender_peer_id: 2,
  body: 3,
  kind: 4,
  seq: 5,
  sha256: 6,
  note: 7,
  version: 8,
  capabilities: 9,
  file_id: 10,
  name: 11,
  size: 12,
  data: 13,
  reason: 14,
  ts: 99,
} as const;

// ── Message type string constants ──

export const MSG_TYPES = {
  ROOM_HELLO: 'room:hello',
  ROOM_PING: 'room:ping',
  ROOM_PONG: 'room:pong',
  ROOM_MSG: 'room:msg',
  ROOM_FILE_OFFER: 'room:file_offer',
  ROOM_FILE_ACCEPT: 'room:file_accept',
  ROOM_FILE_REJECT: 'room:file_reject',
  ROOM_FILE_CHUNK: 'room:file_chunk',
  ROOM_FILE_DONE: 'room:file_done',
  ROOM_FILE_ABORT: 'room:file_abort',
  ROOM_RESYNC_REQUEST: 'room:resync_request',
  ROOM_RESYNC_RESPONSE: 'room:resync_response',
  // Second-version room management (defined but not exposed in v1)
  ROOM_INVITE: 'room:invite',
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
} as const;

export type MsgType = (typeof MSG_TYPES)[keyof typeof MSG_TYPES];

// ── Common fields ──

export interface ProtoMessage {
  type: MsgType;
  ts: number; // Unix milliseconds
}

// ── Room messages ──

export interface RoomHello extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_HELLO;
  version: string;
  capabilities: Record<string, boolean>;
}

export interface RoomPing extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_PING;
}

export interface RoomPong extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_PONG;
}

export type MessageKind = 'text' | 'system';

export interface RoomMsg extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_MSG;
  room_id: Uint8Array; // 16 bytes
  sender_peer_id: Uint8Array; // 32 bytes
  body: string;
  kind: MessageKind;
  seq: number;
}

export interface RoomFileOffer extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_FILE_OFFER;
  room_id: Uint8Array; // 16 bytes
  file_id: string; // UUID
  sender_peer_id: Uint8Array; // 32 bytes
  name: string;
  size: number;
  sha256: Uint8Array; // 32 bytes
  note?: string;
  seq: number;
}

export interface RoomFileAccept extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_FILE_ACCEPT;
  room_id: Uint8Array;
  file_id: string;
}

export interface RoomFileReject extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_FILE_REJECT;
  room_id: Uint8Array;
  file_id: string;
  reason: string;
}

export interface RoomFileChunk {
  type: typeof MSG_TYPES.ROOM_FILE_CHUNK;
  file_id: string;
  seq_num: number;
  data: Uint8Array; // ≤ 65536 bytes
}

export interface RoomFileDone extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_FILE_DONE;
  file_id: string;
}

export interface RoomFileAbort extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_FILE_ABORT;
  room_id: Uint8Array;
  file_id: string;
  reason: string;
}

// Resync (RoomResyncRequest/Response) and v2 room management (RoomInvite/Join/Leave)
// intentionally OMITTED from the M1 union. They belong to M4 (daemon) and a future
// milestone. Their previous half-implementation (encode-only, no decode case, with
// from_seq/to_seq smuggled into the seq/sha256 keys) was removed because:
//   1. Half-implementations create false coverage in `RoomMessage`-typed code.
//   2. The smuggling pattern violates the "unique CBOR key per field" invariant.
// They will be added back when their owning milestone arrives, with proper decode
// cases and dedicated CBOR keys.
// See BACKLOG.md "resync messages" and "v2 room management".

// ── Union type ──

export type RoomMessage =
  | RoomHello
  | RoomPing
  | RoomPong
  | RoomMsg
  | RoomFileOffer
  | RoomFileAccept
  | RoomFileReject
  | RoomFileChunk
  | RoomFileDone
  | RoomFileAbort;
