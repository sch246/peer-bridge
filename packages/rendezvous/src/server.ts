// Rendezvous server — Fastify + WebSocket signaling dispatcher.
//
// Wires: Fastify HTTP (health, federation stubs) + @fastify/websocket (/ws)
// State: in-memory (ServerState) — restart = loss (DESIGN.md §6.1)
// Auth: all C→S WS messages verified via auth.ts (Ed25519 detached sig)
//
// @telos facts/rendezvous-tech-stack.md (Fastify + ws)
// @telos facts/signaling-message-fields.md (field inventory)
// @telos decisions/disconnect-immediate-offline.md (D1)
// @telos decisions/reconnect-requires-reregister.md (D3)

import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from '@fastify/websocket';
import { createState, type ServerState } from './state.js';
import { initCrypto, verifySignature, decodePeerIdSafe } from './auth.js';
import { RateLimiter } from './rate-limit.js';
import { handleRegister, sendRegisterOk, type RegisterPayload } from './handlers/register.js';
import { handleLookup, sendLookupResult, type LookupPayload } from './handlers/lookup.js';
import {
  handleInviteCreate,
  sendInviteResult,
  type InviteCreatePayload,
} from './handlers/invite-create.js';
import {
  handleInviteRedeem,
  sendInviteRedeemResult,
  type InviteRedeemPayload,
} from './handlers/invite-redeem.js';
import { handleSignal, type SignalPayload } from './handlers/signal.js';
import { handleNotify, type NotifyPayload } from './handlers/notify.js';
import { registerHealthRoute } from './health.js';
import type { RendezvousConfig } from './config.js';

export interface ServerDeps {
  config: RendezvousConfig;
  serverId: string;
}

/** Alias used for WebSocket objects with the interface state.ts expects. */
type Ws = {
  readyState: number;
  send(data: string): void;
  close(code?: number, data?: string): void;
};

export async function createServer(deps: ServerDeps) {
  await initCrypto();

  const { config, serverId } = deps;
  const state = createState();
  // M2: single-server, no federation, server_id is sent in register_ok
  // and is the server's own Ed25519 pubkey in ed25519:... format

  const rateLimiter = new RateLimiter(config.limits.max_invites_per_ip_per_hour);

  const app = Fastify({ logger: false });

  await app.register(fastifyWebsocket);

  // ── Health endpoint ──
  registerHealthRoute(app, state);

  // ── Federation stubs (M6) ──
  app.post('/federation/query', async (_req, reply) => {
    reply.code(501).send({ error: 'Federation not implemented (M6)' });
  });

  app.post('/federation/proxy_signal', async (_req, reply) => {
    reply.code(501).send({ error: 'Federation not implemented (M6)' });
  });

  // ── WebSocket signaling ──
  app.register(async (wsScope) => {
    wsScope.get('/ws', { websocket: true }, (socket: WebSocket, req) => {
      // D1: clean up on close
      socket.on('close', () => {
        const peerId = state.socket_to_peer.get(socket);
        if (peerId) {
          state.peer_registrations.delete(peerId);
        }
      });

      socket.on('error', () => {
        const peerId = state.socket_to_peer.get(socket);
        if (peerId) {
          state.peer_registrations.delete(peerId);
        }
      });

      socket.on('message', (raw: Buffer) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          socket.close(1008, 'Invalid JSON');
          return;
        }

        const envelopeType = msg.type;
        const payload = msg.payload as Record<string, unknown> | undefined;
        const sig = msg.sig as string | undefined;
        const ts = msg.ts as string | undefined;

        if (!envelopeType || !payload || !sig || !ts) {
          socket.close(1008, 'Missing envelope fields (type, payload, sig, ts)');
          return;
        }

        // ── Dispatch ──

        if (envelopeType === 'register') {
          dispatchRegister(state, socket, payload, sig, ts, config, serverId);
        } else {
          // All other messages require prior registration
          const peerId = state.socket_to_peer.get(socket);
          if (!peerId) {
            socket.close(1008, 'Not registered');
            return;
          }

          const reg = state.peer_registrations.get(peerId);
          if (!reg) {
            socket.close(1008, 'Registration lost');
            return;
          }

          // Verify signature
          if (!verifySignature(payload, sig, ts, reg.pubkey)) {
            socket.close(1008, 'Invalid signature');
            return;
          }

          // Update last_seen
          reg.last_seen_at = Date.now();

          switch (envelopeType) {
            case 'lookup':
              dispatchLookup(state, socket, payload);
              break;
            case 'invite_create':
              dispatchInviteCreate(state, socket, payload, rateLimiter, req);
              break;
            case 'invite_redeem':
              dispatchInviteRedeem(state, socket, payload);
              break;
            case 'signal':
              dispatchSignal(state, socket, payload, peerId);
              break;
            case 'notify':
              dispatchNotify(state, socket, payload, config);
              break;
            default:
              // Unknown message type — tolerate (forward-compat) but ignore
              break;
          }
        }
      });
    });
  });

  // Periodic cleanup of expired invites (every 60s)
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [codeHash, record] of state.invite_records) {
      if (record.expires_at <= now) {
        state.invite_records.delete(codeHash);
      }
    }
  }, 60_000);

  app.addHook('onClose', () => {
    clearInterval(cleanupInterval);
  });

  return { app, state };
}

// ── Dispatch helpers ──

function dispatchRegister(
  state: ServerState,
  socket: Ws,
  payload: Record<string, unknown>,
  sig: string,
  ts: string,
  config: RendezvousConfig,
  serverId: string,
): void {
  const regPayload = payload as unknown as RegisterPayload;

  // Verify signature before registering
  const pubkey = decodePeerIdSafe(regPayload.peer_id);
  if (!pubkey) {
    socket.close(1008, 'Invalid peer_id');
    return;
  }
  if (!verifySignature(payload, sig, ts, pubkey)) {
    socket.close(1008, 'Invalid signature');
    return;
  }

  const result = handleRegister(state, socket, regPayload, config.limits);

  if (!result.success) {
    socket.close(result.closeCode ?? 1011, result.closeReason);
    return;
  }

  // Deliver queued offline notifications BEFORE register_ok
  if (result.pending_notifications && result.pending_notifications.length > 0) {
    for (const n of result.pending_notifications) {
      socket.send(
        JSON.stringify({
          type: 'notify_in',
          sealed_box: n.sealed_box,
          queued_at: n.queued_at,
        }),
      );
    }
  }

  sendRegisterOk(socket, serverId, state.federationSize());
}

function dispatchLookup(state: ServerState, socket: Ws, payload: Record<string, unknown>): void {
  const result = handleLookup(state, payload as unknown as LookupPayload);
  sendLookupResult(socket, result);
}

function dispatchInviteCreate(
  state: ServerState,
  socket: Ws,
  payload: Record<string, unknown>,
  rateLimiter: RateLimiter,
  req: { socket?: { remoteAddress?: string } },
): void {
  const ip = req.socket?.remoteAddress ?? 'unknown';

  if (!rateLimiter.check(ip)) {
    // Rate limited — close connection
    socket.close(1013, 'Rate limited');
    return;
  }

  const result = handleInviteCreate(state, payload as unknown as InviteCreatePayload);
  sendInviteResult(socket, result);
}

function dispatchInviteRedeem(
  state: ServerState,
  socket: Ws,
  payload: Record<string, unknown>,
): void {
  const result = handleInviteRedeem(state, payload as unknown as InviteRedeemPayload);
  sendInviteRedeemResult(socket, result);
}

function dispatchSignal(
  state: ServerState,
  _socket: Ws,
  payload: Record<string, unknown>,
  fromPeerId: string,
): void {
  handleSignal(state, payload as unknown as SignalPayload, fromPeerId);
}

function dispatchNotify(
  state: ServerState,
  _socket: Ws,
  payload: Record<string, unknown>,
  config: RendezvousConfig,
): void {
  handleNotify(state, payload as unknown as NotifyPayload, config.limits.max_offline_notify_size);
}
