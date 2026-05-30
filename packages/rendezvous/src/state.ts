// In-memory state stores for the rendezvous server.
// All data is ephemeral — restart = loss (per DESIGN.md §6.1).
//
// @telos decisions/disconnect-immediate-offline.md (D1: WS close → immediate eviction)
// @telos decisions/reconnect-requires-reregister.md (D3: reconnect = fresh session)
// @telos facts/rendezvous-server-config.md (config-driven limits)

// Minimal WebSocket interface — avoids direct ws dependency for types.

// ── Peer registrations ──
// Keyed by peer_id. Removed synchronously on WS close (D1).

export interface PeerRegistration {
  ws: { readyState: number; send(data: string): void; close(code?: number): void };
  capabilities: Record<string, boolean | string>;
  registered_at: number; // Unix ms
  last_seen_at: number; // Unix ms
  pubkey: Uint8Array; // 32-byte Ed25519 pubkey, cached from register decode
}

// ── Invite records ──
// Keyed by code_hash. Survives inviter disconnect (not tied to WS).

export interface InviteRecord {
  pubkey: Uint8Array; // base64-decoded Ed25519 pubkey
  peer_id: string;
  expires_at: number; // Unix ms
}

// ── Offline notifications ──
// Keyed by target peer_id. Delivered on next register (before register_ok).

export interface OfflineNotification {
  sealed_box: string; // base64
  queued_at: string; // ISO8601
}

// ── Socket → peer_id reverse lookup ──

export class ServerState {
  readonly peer_registrations = new Map<string, PeerRegistration>();
  readonly invite_records = new Map<string, InviteRecord>();
  readonly offline_notifications = new Map<string, OfflineNotification[]>();
  readonly socket_to_peer = new WeakMap<object, string>();

  // Federation route cache — placeholder for M6
  readonly federation_routes = new Map<string, { home_url: string; expires_at: number }>();

  started_at: number = Date.now();

  peerCount(): number {
    return this.peer_registrations.size;
  }

  federationSize(): number {
    // M2: single-server, always 0
    return 0;
  }
}

/** Singleton state instance. Tests create their own. */
export function createState(): ServerState {
  return new ServerState();
}
