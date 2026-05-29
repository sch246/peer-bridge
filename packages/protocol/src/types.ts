// Protocol message type definitions for peer-bridge.
// All DataChannel messages use CBOR encoding with integer keys (see protocol.md Appendix B).

/** CBOR integer keys for all message fields */
export const CBOR_KEYS = {
  type: 0,
  room_id: 1,
  version: 1,
  sender_peer_id: 2,
  file_id: 2,
  capabilities: 2,
  body: 3,
  reason: 3,
  data: 3,
  kind: 4,
  name: 4,
  seq: 5,
  size: 5,
  sha256: 6,
  note: 7,
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

export interface RoomResyncRequest extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_RESYNC_REQUEST;
  room_id: Uint8Array;
  sender: Uint8Array; // 32 bytes
  from_seq: number;
  to_seq: number;
}

export interface RoomResyncResponse extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_RESYNC_RESPONSE;
  room_id: Uint8Array;
  messages: RoomMsg[];
}

// ── Room management (v2) ──

export interface RoomInvite extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_INVITE;
  room_id: Uint8Array;
  inviter_peer_id: Uint8Array;
  room_name: string;
}

export interface RoomJoin extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_JOIN;
  room_id: Uint8Array;
}

export interface RoomLeave extends ProtoMessage {
  type: typeof MSG_TYPES.ROOM_LEAVE;
  room_id: Uint8Array;
}

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
  | RoomFileAbort
  | RoomResyncRequest
  | RoomResyncResponse
  | RoomInvite
  | RoomJoin
  | RoomLeave;
