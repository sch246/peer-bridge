// Invite-create handler.
// C→S { type: "invite_create", payload: { code_hash, pubkey, peer_id, expires_at } }
// S→C { type: "invite_result", peer_id: <creator>, pubkey: <creator> }
//
// Response shape per DESIGN.md §5.1: invite_result is the only invite response shape.
// [choice] invite_create echoes back creator's peer_id+pubkey using invite_result shape —
//   DESIGN.md §5.1 does not define a separate invite_create_ok, and the task explicitly
//   forbids inventing one.
//
// @telos facts/signaling-message-fields.md

import type { ServerState, InviteRecord } from '../state.js';

export interface InviteCreatePayload {
  code_hash: string;
  pubkey: string;
  peer_id: string;
  expires_at: string;
}

export interface InviteCreateResult {
  success: boolean;
  peer_id: string;
  pubkey: string;
  /** True if rate-limited (caller should close WS 1013 and not send invite_result). */
  rate_limited?: boolean;
}

export function handleInviteCreate(
  state: ServerState,
  payload: InviteCreatePayload,
): InviteCreateResult {
  // Validate fields
  if (!payload.code_hash || typeof payload.code_hash !== 'string') {
    // Return success: false with empty peer_id/pubkey — caller sends invite_result with error
    return { success: false, peer_id: '', pubkey: '' };
  }

  if (!payload.pubkey || typeof payload.pubkey !== 'string') {
    return { success: false, peer_id: '', pubkey: '' };
  }

  const expiresMs = new Date(payload.expires_at).getTime();
  if (isNaN(expiresMs)) {
    return { success: false, peer_id: '', pubkey: '' };
  }

  // Check expiry — don't store already-expired invites
  if (expiresMs <= Date.now()) {
    return { success: false, peer_id: '', pubkey: '' };
  }

  // Store invite record
  const record: InviteRecord = {
    pubkey: Buffer.from(payload.pubkey, 'base64'),
    peer_id: payload.peer_id,
    expires_at: expiresMs,
  };

  state.invite_records.set(payload.code_hash, record);

  return { success: true, peer_id: payload.peer_id, pubkey: payload.pubkey };
}

export function sendInviteResult(
  socket: { send(data: string): void },
  result: InviteCreateResult,
): void {
  const msg: Record<string, unknown> = { type: 'invite_result' };
  if (result.success) {
    msg.peer_id = result.peer_id;
    msg.pubkey = result.pubkey;
  } else {
    msg.error = 'invalid_request';
  }
  socket.send(JSON.stringify(msg));
}
