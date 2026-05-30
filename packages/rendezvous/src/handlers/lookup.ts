// Lookup handler.
// C→S { type: "lookup", payload: { peer_id } }
// S→C { type: "lookup_result", found: bool, home?: url }
//
// @telos facts/signaling-message-fields.md

import type { ServerState } from '../state.js';

export interface LookupPayload {
  peer_id: string;
}

export interface LookupResult {
  found: boolean;
  home?: string;
}

export function handleLookup(state: ServerState, payload: LookupPayload): LookupResult {
  if (!payload.peer_id || typeof payload.peer_id !== 'string') {
    return { found: false };
  }

  const reg = state.peer_registrations.get(payload.peer_id);
  if (reg) {
    return { found: true };
  }

  // M2: no federation routing. home is always absent when not found locally.
  return { found: false };
}

export function sendLookupResult(socket: { send(data: string): void }, result: LookupResult): void {
  const msg: Record<string, unknown> = { type: 'lookup_result', found: result.found };
  if (result.found && result.home) {
    msg.home = result.home;
  }
  socket.send(JSON.stringify(msg));
}
