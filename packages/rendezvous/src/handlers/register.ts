// Register handler.
// C→S { type: "register", payload: { peer_id, capabilities } }
// S→C { type: "register_ok", server_id: "ed25519:...", federation_size: N }
//
// Per D3 (reconnect-requires-reregister): reconnect = fresh session, replace old entry.
// Per D1 (disconnect-immediate-offline): WS close evicts synchronously (done in server.ts).
//
// @telos facts/signaling-message-fields.md
// @telos decisions/reconnect-requires-reregister.md
// @telos decisions/signaling-fifo-no-request-id.md

import { decodePeerId } from '@peer-bridge/protocol';
import type { ServerState } from '../state.js';
import type { LimitsConfig } from '../config.js';

export interface RegisterPayload {
  peer_id: string;
  capabilities: Record<string, boolean | string>;
}

export interface RegisterResult {
  success: boolean;
  closeCode?: number;
  closeReason?: string;
  /** Offline notifications to deliver BEFORE register_ok */
  pending_notifications?: Array<{ sealed_box: string; queued_at: string }>;
}

/**
 * Handle register. Verifies signature externally (by server.ts dispatch).
 * On D3 reconnect: replaces existing registration entirely.
 * On D1: no action needed — eviction at close is handled in server.ts.
 *
 * [choice] Delivers queued offline notifications BEFORE sending register_ok.
 * The blind audit Q1 implicitly assumed this ordering — delivering after
 * register_ok would let the client miss notifications in a race.
 */
export function handleRegister(
  state: ServerState,
  socket: { readyState: number; send(data: string): void; close(code?: number): void },
  payload: RegisterPayload,
  limits: LimitsConfig,
): RegisterResult {
  if (!payload.peer_id || typeof payload.peer_id !== 'string') {
    return { success: false, closeCode: 1008, closeReason: 'Missing peer_id' };
  }

  let pubkey: Uint8Array;
  try {
    pubkey = decodePeerId(payload.peer_id);
  } catch {
    return { success: false, closeCode: 1008, closeReason: 'Invalid peer_id encoding' };
  }

  // Check max_peers limit (unless this peer is already registered — re-registration)
  if (!state.peer_registrations.has(payload.peer_id)) {
    if (state.peerCount() >= limits.max_peers) {
      return { success: false, closeCode: 1013, closeReason: 'Server full' };
    }
  }

  const now = Date.now();

  // D3: if replacing an existing registration, clean up the old socket mapping
  const existing = state.peer_registrations.get(payload.peer_id);
  if (existing) {
    state.socket_to_peer.delete(existing.ws);
  }

  // Record registration (D3: replace if exists)
  state.peer_registrations.set(payload.peer_id, {
    ws: socket,
    capabilities: payload.capabilities ?? {},
    registered_at: now,
    last_seen_at: now,
    pubkey,
  });

  // Track socket→peer_id mapping for auth on subsequent messages
  state.socket_to_peer.set(socket, payload.peer_id);

  // Gather queued offline notifications
  const queued = state.offline_notifications.get(payload.peer_id) ?? [];
  state.offline_notifications.delete(payload.peer_id); // delivered, remove

  // Expire old notifications based on TTL
  const ttlCutoff = now - limits.offline_notify_ttl_hours * 3600 * 1000;
  const active = queued.filter((n) => new Date(n.queued_at).getTime() > ttlCutoff);

  return { success: true, pending_notifications: active };
}

/** Send register_ok response to the socket. */
export function sendRegisterOk(
  socket: { send(data: string): void },
  serverId: string,
  federationSize: number,
): void {
  socket.send(
    JSON.stringify({
      type: 'register_ok',
      server_id: serverId,
      federation_size: federationSize,
    }),
  );
}
