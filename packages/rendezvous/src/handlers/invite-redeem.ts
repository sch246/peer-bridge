// Invite-redeem handler.
// C→S { type: "invite_redeem", payload: { code_hash } }
// S→C { type: "invite_result", peer_id, pubkey } on success
// S→C { type: "invite_result", error: "not_found" } on failure
//
// @telos facts/signaling-message-fields.md

import type { ServerState } from '../state.js';

export interface InviteRedeemPayload {
  code_hash: string;
}

export interface InviteRedeemResult {
  found: boolean;
  peer_id?: string;
  pubkey?: Uint8Array;
}

export function handleInviteRedeem(
  state: ServerState,
  payload: InviteRedeemPayload,
): InviteRedeemResult {
  if (!payload.code_hash || typeof payload.code_hash !== 'string') {
    return { found: false };
  }

  const record = state.invite_records.get(payload.code_hash);
  if (!record) {
    return { found: false };
  }

  // Check expiry
  if (record.expires_at <= Date.now()) {
    state.invite_records.delete(payload.code_hash);
    return { found: false };
  }

  // One-time use: delete on successful redeem
  state.invite_records.delete(payload.code_hash);

  return {
    found: true,
    peer_id: record.peer_id,
    pubkey: record.pubkey,
  };
}

export function sendInviteRedeemResult(
  socket: { send(data: string): void },
  result: InviteRedeemResult,
): void {
  const msg: Record<string, unknown> = { type: 'invite_result' };
  if (result.found) {
    msg.peer_id = result.peer_id;
    msg.pubkey = Buffer.from(result.pubkey!).toString('base64');
  } else {
    msg.error = 'not_found';
  }
  socket.send(JSON.stringify(msg));
}
