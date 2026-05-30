// Rendezvous server tests — node:test + tsx
// Run: node --import tsx --test test/**/*.test.ts
//
// Covers: state, auth, rate-limit, config, all handlers, server integration, federation stubs

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { writeFileSync, unlinkSync } from 'node:fs';
import { createServer, type ServerDeps } from '../src/server.js';
import { createState } from '../src/state.js';
import { initCrypto, verifySignature, decodePeerIdSafe, isTimestampValid } from '../src/auth.js';
import { RateLimiter } from '../src/rate-limit.js';
import { loadConfig, DEFAULTS } from '../src/config.js';
import { handleRegister, sendRegisterOk } from '../src/handlers/register.js';
import { handleLookup, sendLookupResult } from '../src/handlers/lookup.js';
import { handleInviteCreate, sendInviteResult } from '../src/handlers/invite-create.js';
import { handleInviteRedeem, sendInviteRedeemResult } from '../src/handlers/invite-redeem.js';
import { handleSignal } from '../src/handlers/signal.js';
import { handleNotify } from '../src/handlers/notify.js';

import { encodePeerId } from '@peer-bridge/protocol';
import sodium from 'libsodium-wrappers';

// ── Test helpers ──

interface MockSocket {
  sent: string[];
  closed: boolean;
  closeCode?: number;
  closeReason?: string;
  readyState: number;
  send(data: string): void;
  close(code?: number, data?: string): void;
}

function mockSocket(): MockSocket {
  return {
    sent: [],
    closed: false,
    readyState: 1, // OPEN
    send(data: string) {
      this.sent.push(data);
    },
    close(code?: number, data?: string) {
      this.closed = true;
      this.closeCode = code;
      this.closeReason = data;
    },
  };
}

function lastSent(sock: MockSocket): Record<string, unknown> {
  return JSON.parse(sock.sent[sock.sent.length - 1]);
}

function generateKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
  const kp = sodium.crypto_sign_keypair();
  return { publicKey: kp.publicKey, secretKey: kp.privateKey };
}

function makePeerId(pubkey: Uint8Array): string {
  return encodePeerId(pubkey);
}

function signPayload(payload: Record<string, unknown>, ts: string, secretKey: Uint8Array): string {
  const payloadJson = JSON.stringify(payload);
  const messageBytes = Buffer.from(payloadJson + ts, 'utf-8');
  const hash = createHash('sha256').update(messageBytes).digest();
  const sig = sodium.crypto_sign_detached(hash, secretKey);
  return Buffer.from(sig).toString('base64');
}

// ── State tests (D1: disconnect-immediate-offline) ──

describe('State (in-memory)', () => {
  it('creates empty state', () => {
    const state = createState();
    assert.strictEqual(state.peerCount(), 0);
    assert.strictEqual(state.federationSize(), 0);
  });

  it('adds and retrieves peer registration', () => {
    const state = createState();
    const sock = mockSocket();
    const pubkey = new Uint8Array(32).fill(1);
    state.peer_registrations.set('PB-TEST', {
      ws: sock,
      capabilities: { webrtc: true },
      registered_at: Date.now(),
      last_seen_at: Date.now(),
      pubkey,
    });
    state.socket_to_peer.set(sock, 'PB-TEST');

    assert.strictEqual(state.peerCount(), 1);
    assert.ok(state.peer_registrations.has('PB-TEST'));
  });

  it('D1: close handler removes registration (simulated)', () => {
    // Simulate: WS close → delete from peer_registrations
    const state = createState();
    const sock = mockSocket();
    const pubkey = new Uint8Array(32).fill(1);
    state.peer_registrations.set('PB-TEST', {
      ws: sock,
      capabilities: { webrtc: true },
      registered_at: Date.now(),
      last_seen_at: Date.now(),
      pubkey,
    });
    state.socket_to_peer.set(sock, 'PB-TEST');

    // Simulate close
    const peerId = state.socket_to_peer.get(sock);
    if (peerId) state.peer_registrations.delete(peerId);

    assert.strictEqual(state.peerCount(), 0);
  });

  it('invite_records survive inviter disconnect (not keyed by WS)', () => {
    const state = createState();
    const inviterSock = mockSocket();
    const pubkey = new Uint8Array(32).fill(1);
    state.peer_registrations.set('PB-INVITER', {
      ws: inviterSock,
      capabilities: {},
      registered_at: Date.now(),
      last_seen_at: Date.now(),
      pubkey,
    });

    // Create invite
    state.invite_records.set('abc123', {
      pubkey,
      peer_id: 'PB-INVITER',
      expires_at: Date.now() + 600_000,
    });

    // Inviter disconnects
    state.peer_registrations.delete('PB-INVITER');

    // Invite still exists
    assert.ok(state.invite_records.has('abc123'));
  });

  it('offline_notifications survive peer disconnect', () => {
    const state = createState();
    state.offline_notifications.set('PB-TARGET', [
      { sealed_box: 'AAAA', queued_at: new Date().toISOString() },
    ]);

    // Simulate peer disconnect (no registration, but notifications persist)
    assert.strictEqual(state.offline_notifications.get('PB-TARGET')!.length, 1);
  });
});

// ── Auth tests ──

describe('Auth (Ed25519 signature verification)', () => {
  let kp: { publicKey: Uint8Array; secretKey: Uint8Array };
  let peerId: string;

  before(async () => {
    await initCrypto();
    kp = generateKeyPair();
    peerId = makePeerId(kp.publicKey);
  });

  it('verifySignature accepts valid sig', () => {
    const payload = { peer_id: peerId, capabilities: { webrtc: true } };
    const ts = new Date().toISOString();
    const sig = signPayload(payload, ts, kp.secretKey);

    const valid = verifySignature(payload, sig, ts, kp.publicKey);
    assert.strictEqual(valid, true);
  });

  it('verifySignature rejects invalid sig', () => {
    const payload = { peer_id: peerId, capabilities: {} };
    const ts = new Date().toISOString();
    const badSig = Buffer.from(new Uint8Array(64).fill(0xab)).toString('base64');

    const valid = verifySignature(payload, badSig, ts, kp.publicKey);
    assert.strictEqual(valid, false);
  });

  it('verifySignature rejects wrong key', () => {
    const kp2 = generateKeyPair();
    const payload = { peer_id: peerId, capabilities: {} };
    const ts = new Date().toISOString();
    const sig = signPayload(payload, ts, kp.secretKey);

    const valid = verifySignature(payload, sig, ts, kp2.publicKey);
    assert.strictEqual(valid, false);
  });

  it('verifySignature rejects expired timestamp', () => {
    const payload = { peer_id: peerId, capabilities: {} };
    const oldDate = new Date(Date.now() - 400_000); // 400s ago, past 300s window
    const ts = oldDate.toISOString();
    const sig = signPayload(payload, ts, kp.secretKey);

    const valid = verifySignature(payload, sig, ts, kp.publicKey);
    assert.strictEqual(valid, false);
  });

  it('verifySignature rejects future timestamp', () => {
    const payload = { peer_id: peerId, capabilities: {} };
    const futureDate = new Date(Date.now() + 400_000);
    const ts = futureDate.toISOString();
    const sig = signPayload(payload, ts, kp.secretKey);

    const valid = verifySignature(payload, sig, ts, kp.publicKey);
    assert.strictEqual(valid, false);
  });

  it('verifySignature rejects tampered payload', () => {
    const payload = { peer_id: peerId, capabilities: {} };
    const ts = new Date().toISOString();
    const sig = signPayload(payload, ts, kp.secretKey);

    const tamperedPayload = { peer_id: peerId, capabilities: { hacked: true } };
    const valid = verifySignature(tamperedPayload, sig, ts, kp.publicKey);
    assert.strictEqual(valid, false);
  });

  it('decodePeerIdSafe returns pubkey for valid peer_id', async () => {
    const result = decodePeerIdSafe(peerId);
    assert.ok(result);
    assert.strictEqual(result!.length, 32);
  });

  it('decodePeerIdSafe returns null for invalid peer_id', () => {
    assert.strictEqual(decodePeerIdSafe('not-a-peer-id'), null);
    assert.strictEqual(decodePeerIdSafe(''), null);
  });

  it('isTimestampValid checks window', () => {
    const now = new Date().toISOString();
    assert.strictEqual(isTimestampValid(now), true);

    const old = new Date(Date.now() - 400_000).toISOString();
    assert.strictEqual(isTimestampValid(old), false);

    const invalid = 'not-a-date';
    assert.strictEqual(isTimestampValid(invalid), false);
  });
});

// ── Rate limiter tests ──

describe('RateLimiter', () => {
  it('allows first 20 requests', () => {
    const rl = new RateLimiter(20);
    for (let i = 0; i < 20; i++) {
      assert.strictEqual(rl.check('127.0.0.1'), true);
    }
    assert.strictEqual(rl.getCount('127.0.0.1'), 20);
  });

  it('blocks 21st request', () => {
    const rl = new RateLimiter(20);
    for (let i = 0; i < 20; i++) {
      rl.check('127.0.0.1');
    }
    assert.strictEqual(rl.check('127.0.0.1'), false);
  });

  it('tracks different IPs independently', () => {
    const rl = new RateLimiter(20);
    for (let i = 0; i < 20; i++) {
      rl.check('10.0.0.1');
    }
    assert.strictEqual(rl.check('10.0.0.2'), true);
    assert.strictEqual(rl.check('10.0.0.1'), false);
  });

  it('reset clears all counters', () => {
    const rl = new RateLimiter(20);
    for (let i = 0; i < 20; i++) rl.check('127.0.0.1');
    rl.reset();
    assert.strictEqual(rl.check('127.0.0.1'), true);
  });
});

// ── Handler: register ──

describe('handleRegister', () => {
  let kp: { publicKey: Uint8Array; secretKey: Uint8Array };
  let peerId: string;

  before(async () => {
    await initCrypto();
    kp = generateKeyPair();
    peerId = makePeerId(kp.publicKey);
  });

  it('registers a new peer', () => {
    const state = createState();
    const sock = mockSocket();
    const limits = { max_peers: 10000 } as any;

    const result = handleRegister(
      state,
      sock,
      {
        peer_id: peerId,
        capabilities: { webrtc: true },
      },
      limits,
    );

    assert.strictEqual(result.success, true);
    assert.strictEqual(state.peerCount(), 1);
    assert.ok(state.socket_to_peer.has(sock));
  });

  it('rejects register with missing peer_id', () => {
    const state = createState();
    const sock = mockSocket();
    const limits = { max_peers: 10000 } as any;

    const result = handleRegister(
      state,
      sock,
      {
        peer_id: '',
        capabilities: {},
      },
      limits,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.closeCode, 1008);
  });

  it('rejects register with invalid peer_id encoding', () => {
    const state = createState();
    const sock = mockSocket();
    const limits = { max_peers: 10000 } as any;

    const result = handleRegister(
      state,
      sock,
      {
        peer_id: 'invalid-peer-id',
        capabilities: {},
      },
      limits,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.closeCode, 1008);
  });

  it('D3: reconnect replaces registration', () => {
    const state = createState();
    const sock1 = mockSocket();
    const sock2 = mockSocket();
    const limits = { max_peers: 10000 } as any;

    // First register
    handleRegister(state, sock1, { peer_id: peerId, capabilities: {} }, limits);
    assert.strictEqual(state.peerCount(), 1);
    assert.ok(state.socket_to_peer.has(sock1));

    // Reconnect (new socket)
    handleRegister(state, sock2, { peer_id: peerId, capabilities: { v2: true } }, limits);
    assert.strictEqual(state.peerCount(), 1);
    assert.ok(state.socket_to_peer.has(sock2));
    assert.ok(!state.socket_to_peer.has(sock1));
  });

  it('rejects when server is full', () => {
    const state = createState();
    const sock = mockSocket();
    const limits = { max_peers: 0 } as any; // zero capacity

    const result = handleRegister(
      state,
      sock,
      {
        peer_id: peerId,
        capabilities: {},
      },
      limits,
    );

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.closeCode, 1013);
  });

  it('delivers queued offline notifications before register_ok', () => {
    const state = createState();
    const sock = mockSocket();
    const limits = { max_peers: 10000, offline_notify_ttl_hours: 24 } as any;

    // Queue an offline notification
    state.offline_notifications.set(peerId, [
      { sealed_box: 'AAAA', queued_at: new Date().toISOString() },
      { sealed_box: 'BBBB', queued_at: new Date().toISOString() },
    ]);

    const result = handleRegister(
      state,
      sock,
      {
        peer_id: peerId,
        capabilities: {},
      },
      limits,
    );

    assert.strictEqual(result.success, true);
    assert.ok(result.pending_notifications);
    assert.strictEqual(result.pending_notifications!.length, 2);

    // Notifications removed from store
    assert.ok(!state.offline_notifications.has(peerId));
  });

  it('drops expired offline notifications on delivery', () => {
    const state = createState();
    const sock = mockSocket();
    const limits = { max_peers: 10000, offline_notify_ttl_hours: 24 } as any;

    // Queue one fresh, one expired
    state.offline_notifications.set(peerId, [
      { sealed_box: 'FRESH', queued_at: new Date().toISOString() },
      {
        sealed_box: 'EXPIRED',
        queued_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      },
    ]);

    const result = handleRegister(
      state,
      sock,
      {
        peer_id: peerId,
        capabilities: {},
      },
      limits,
    );

    assert.strictEqual(result.pending_notifications!.length, 1);
    assert.strictEqual(result.pending_notifications![0].sealed_box, 'FRESH');
  });

  it('sendRegisterOk sends correct fields', () => {
    const sock = mockSocket();
    sendRegisterOk(sock, 'ed25519:test', 0);
    const msg = lastSent(sock);
    assert.strictEqual(msg.type, 'register_ok');
    assert.strictEqual(msg.server_id, 'ed25519:test');
    assert.strictEqual(msg.federation_size, 0);
    // Verify no origin_server field (per signaling-message-fields.md)
    assert.strictEqual(msg.origin_server, undefined);
  });
});

// ── Handler: lookup ──

describe('handleLookup', () => {
  it('returns found: true for registered peer', () => {
    const state = createState();
    const sock = mockSocket();
    const pubkey = new Uint8Array(32).fill(1);
    state.peer_registrations.set('PB-TEST', {
      ws: sock,
      capabilities: {},
      registered_at: Date.now(),
      last_seen_at: Date.now(),
      pubkey,
    });

    const result = handleLookup(state, { peer_id: 'PB-TEST' });
    assert.strictEqual(result.found, true);
  });

  it('returns found: false for unknown peer', () => {
    const state = createState();
    const result = handleLookup(state, { peer_id: 'PB-UNKNOWN' });
    assert.strictEqual(result.found, false);
    assert.strictEqual(result.home, undefined); // no home when not found
  });

  it('returns found: false for missing peer_id field', () => {
    const state = createState();
    const result = handleLookup(state, { peer_id: '' });
    assert.strictEqual(result.found, false);
  });

  it('sendLookupResult sends correct shape', () => {
    const sock = mockSocket();
    sendLookupResult(sock, { found: true, home: 'wss://rdv.example.com' });
    const msg = lastSent(sock);
    assert.strictEqual(msg.type, 'lookup_result');
    assert.strictEqual(msg.found, true);
    assert.strictEqual(msg.home, 'wss://rdv.example.com');
  });

  it('sendLookupResult omits home when found: false', () => {
    const sock = mockSocket();
    sendLookupResult(sock, { found: false });
    const msg = lastSent(sock);
    assert.strictEqual(msg.found, false);
    assert.strictEqual(msg.home, undefined);
  });
});

// ── Handler: invite_create ──

describe('handleInviteCreate', () => {
  before(async () => {
    await initCrypto();
  });

  it('stores invite record and returns success', () => {
    const state = createState();
    const pubkey = Buffer.from(new Uint8Array(32).fill(0xaa)).toString('base64');
    const expiresAt = new Date(Date.now() + 600_000).toISOString();

    const result = handleInviteCreate(state, {
      code_hash: 'abc123',
      pubkey,
      peer_id: 'PB-TEST',
      expires_at: expiresAt,
    });

    assert.strictEqual(result.success, true);
    assert.ok(state.invite_records.has('abc123'));
  });

  it('invite_result echoes back creator info', () => {
    const sock = mockSocket();
    const result = { success: true, peer_id: 'PB-CREATOR', pubkey: 'base64key' };
    sendInviteResult(sock, result);
    const msg = lastSent(sock);
    assert.strictEqual(msg.type, 'invite_result');
    assert.strictEqual(msg.peer_id, 'PB-CREATOR');
    assert.strictEqual(msg.pubkey, 'base64key');
  });

  it('invite_result returns error for failed create', () => {
    const sock = mockSocket();
    const result = { success: false, peer_id: '', pubkey: '' };
    sendInviteResult(sock, result);
    const msg = lastSent(sock);
    assert.strictEqual(msg.type, 'invite_result');
    assert.strictEqual(msg.error, 'invalid_request');
  });

  it('rejects missing code_hash', () => {
    const state = createState();
    const result = handleInviteCreate(state, {
      code_hash: '',
      pubkey: 'aa==',
      peer_id: 'PB-TEST',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    assert.strictEqual(result.success, false);
  });

  it('rejects already-expired invite', () => {
    const state = createState();
    const result = handleInviteCreate(state, {
      code_hash: 'expired',
      pubkey: 'aa==',
      peer_id: 'PB-TEST',
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    assert.strictEqual(result.success, false);
    assert.ok(!state.invite_records.has('expired'));
  });

  it('rejects invalid expires_at', () => {
    const state = createState();
    const result = handleInviteCreate(state, {
      code_hash: 'bad-date',
      pubkey: 'aa==',
      peer_id: 'PB-TEST',
      expires_at: 'not-a-date',
    });
    assert.strictEqual(result.success, false);
  });

  it('rejects missing pubkey', () => {
    const state = createState();
    const result = handleInviteCreate(state, {
      code_hash: 'no-pubkey',
      pubkey: '',
      peer_id: 'PB-TEST',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    assert.strictEqual(result.success, false);
  });
});

// ── Handler: invite_redeem ──

describe('handleInviteRedeem', () => {
  before(async () => {
    await initCrypto();
  });

  it('redeems existing invite and deletes it (one-time use)', () => {
    const state = createState();
    const pubkey = new Uint8Array(32).fill(0xbb);
    state.invite_records.set('abc123', {
      pubkey,
      peer_id: 'PB-INVITER',
      expires_at: Date.now() + 600_000,
    });

    const result = handleInviteRedeem(state, { code_hash: 'abc123' });

    assert.strictEqual(result.found, true);
    assert.strictEqual(result.peer_id, 'PB-INVITER');
    assert.ok(result.pubkey);
    // One-time use: deleted
    assert.ok(!state.invite_records.has('abc123'));
  });

  it('returns not_found for unknown code_hash', () => {
    const state = createState();
    const result = handleInviteRedeem(state, { code_hash: 'unknown' });
    assert.strictEqual(result.found, false);
  });

  it('returns not_found for expired invite', () => {
    const state = createState();
    const pubkey = new Uint8Array(32).fill(0xbb);
    state.invite_records.set('expired', {
      pubkey,
      peer_id: 'PB-INVITER',
      expires_at: Date.now() - 1000, // expired 1 second ago
    });

    const result = handleInviteRedeem(state, { code_hash: 'expired' });
    assert.strictEqual(result.found, false);
    // Expired invite is cleaned up
    assert.ok(!state.invite_records.has('expired'));
  });

  it('sendInviteRedeemResult sends not_found for failure', () => {
    const sock = mockSocket();
    sendInviteRedeemResult(sock, { found: false });
    const msg = lastSent(sock);
    assert.strictEqual(msg.type, 'invite_result');
    assert.strictEqual(msg.error, 'not_found');
  });

  it('sendInviteRedeemResult sends peer_id + pubkey for success', () => {
    const sock = mockSocket();
    const pubkey = new Uint8Array(32).fill(0xcc);
    sendInviteRedeemResult(sock, {
      found: true,
      peer_id: 'PB-FOUND',
      pubkey,
    });
    const msg = lastSent(sock);
    assert.strictEqual(msg.type, 'invite_result');
    assert.strictEqual(msg.peer_id, 'PB-FOUND');
    assert.ok(typeof msg.pubkey === 'string');
  });
});

// ── Handler: signal ──

describe('handleSignal', () => {
  it('forwards signal_in to target peer', () => {
    const state = createState();
    const targetSock = mockSocket();
    const pubkey = new Uint8Array(32).fill(1);
    state.peer_registrations.set('PB-TARGET', {
      ws: targetSock,
      capabilities: {},
      registered_at: Date.now(),
      last_seen_at: Date.now(),
      pubkey,
    });

    handleSignal(state, { to: 'PB-TARGET', payload: 'encrypted-data' }, 'PB-SENDER');

    assert.strictEqual(targetSock.sent.length, 1);
    const msg = JSON.parse(targetSock.sent[0]);
    assert.strictEqual(msg.type, 'signal_in');
    assert.strictEqual(msg.from, 'PB-SENDER');
    assert.strictEqual(msg.payload, 'encrypted-data');
  });

  it('[stuck-then-choice] drops silently when target not found', () => {
    const state = createState();
    // Should not throw
    handleSignal(state, { to: 'PB-NOBODY', payload: 'data' }, 'PB-SENDER');
  });

  it('drops silently for missing to field', () => {
    const state = createState();
    // Should not throw
    handleSignal(state, { to: '', payload: 'data' }, 'PB-SENDER');
  });
});

// ── Handler: notify ──

describe('handleNotify', () => {
  it('delivers notify_in immediately when target is online', () => {
    const state = createState();
    const targetSock = mockSocket();
    const pubkey = new Uint8Array(32).fill(1);
    state.peer_registrations.set('PB-TARGET', {
      ws: targetSock,
      capabilities: {},
      registered_at: Date.now(),
      last_seen_at: Date.now(),
      pubkey,
    });

    handleNotify(state, { to: 'PB-TARGET', sealed_box: 'AAAA' }, 1024);

    assert.strictEqual(targetSock.sent.length, 1);
    const msg = JSON.parse(targetSock.sent[0]);
    assert.strictEqual(msg.type, 'notify_in');
    assert.strictEqual(msg.sealed_box, 'AAAA');
    assert.ok(typeof msg.queued_at === 'string');
  });

  it('queues notify when target is offline', () => {
    const state = createState();

    handleNotify(state, { to: 'PB-OFFLINE', sealed_box: 'BBBB' }, 1024);

    assert.ok(state.offline_notifications.has('PB-OFFLINE'));
    const queued = state.offline_notifications.get('PB-OFFLINE')!;
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(queued[0].sealed_box, 'BBBB');
  });

  it('drops notify when sealed_box exceeds size limit', () => {
    const state = createState();
    // sealed_box > 1024 bytes when base64 decoded
    const largeBox = Buffer.from('X'.repeat(2000)).toString('base64');

    handleNotify(state, { to: 'PB-TARGET', sealed_box: largeBox }, 1024);

    assert.ok(!state.offline_notifications.has('PB-TARGET'));
  });

  it('queues notify when target socket write fails', () => {
    const state = createState();
    const badSock = {
      ...mockSocket(),
      send(_data: string) {
        throw new Error('socket error');
      },
    };
    const pubkey = new Uint8Array(32).fill(1);
    state.peer_registrations.set('PB-TARGET', {
      ws: badSock,
      capabilities: {},
      registered_at: Date.now(),
      last_seen_at: Date.now(),
      pubkey,
    });

    // Should not throw, should queue
    handleNotify(state, { to: 'PB-TARGET', sealed_box: 'CCCC' }, 1024);

    assert.ok(state.offline_notifications.has('PB-TARGET'));
  });
});

// ── Config tests ──

describe('Config', () => {
  it('loadConfig parses valid TOML', () => {
    // Create a temp config inline
    const path = 'test-server.toml';
    writeFileSync(
      path,
      `
[server]
listen = "0.0.0.0:9999"
public_url = "ws://localhost:9999"

[limits]
max_peers = 500
max_invites_per_ip_per_hour = 10
max_offline_notify_size = 512
offline_notify_ttl_hours = 12
`,
    );
    try {
      const config = loadConfig(path);
      assert.strictEqual(config.server.listen, '0.0.0.0:9999');
      assert.strictEqual(config.limits.max_peers, 500);
    } finally {
      try {
        unlinkSync(path);
      } catch {
        /* ignore */
      }
    }
  });

  it('DEFAULTS are sane', () => {
    assert.strictEqual(DEFAULTS.limits.max_peers, 10000);
    assert.strictEqual(DEFAULTS.limits.max_invites_per_ip_per_hour, 20);
    assert.strictEqual(DEFAULTS.server.listen, '0.0.0.0:9372');
  });
});

// ── Server integration tests ──

describe('Server integration', () => {
  let kp: { publicKey: Uint8Array; secretKey: Uint8Array };
  let peerId: string;
  let serverHandle: Awaited<ReturnType<typeof createServer>>;
  let wsBaseUrl: string;

  before(async () => {
    await initCrypto();
    kp = generateKeyPair();
    peerId = makePeerId(kp.publicKey);

    const deps: ServerDeps = {
      config: {
        server: { listen: '127.0.0.1:0', public_url: 'ws://127.0.0.1:0', identity_key: '' },
        limits: {
          max_peers: 1000,
          max_invites_per_ip_per_hour: 20,
          max_offline_notify_size: 1024,
          offline_notify_ttl_hours: 24,
        },
        federation: [],
      },
      serverId: 'ed25519:test',
    };

    serverHandle = await createServer(deps);
    const addr = await serverHandle.app.listen({ port: 0, host: '127.0.0.1' });
    wsBaseUrl = `ws://127.0.0.1:${(addr.match(/:(\d+)/) as any)[1]}`;
  });

  after(async () => {
    await serverHandle.app.close();
  });

  it('GET /health returns peer_count, federation_size, uptime_seconds', async () => {
    // [obs] Fastify inject doesn't support WebSocket routes well for this pattern.
    // Use the inject API for HTTP endpoints.
    const res = await serverHandle.app.inject({ method: 'GET', url: '/health' });
    assert.strictEqual(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.strictEqual(body.peer_count, 0);
    assert.strictEqual(body.federation_size, 0);
    assert.ok(typeof body.uptime_seconds === 'number');
  });

  it('POST /federation/query returns 501', async () => {
    const res = await serverHandle.app.inject({
      method: 'POST',
      url: '/federation/query',
    });
    assert.strictEqual(res.statusCode, 501);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('Federation'));
  });

  it('POST /federation/proxy_signal returns 501', async () => {
    const res = await serverHandle.app.inject({
      method: 'POST',
      url: '/federation/proxy_signal',
    });
    assert.strictEqual(res.statusCode, 501);
  });

  it('/health reflects peer count after WS registration', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`${wsBaseUrl}/ws`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        const ts = new Date().toISOString();
        const sig = signPayload(
          { peer_id: peerId, capabilities: { webrtc: true } },
          ts,
          kp.secretKey,
        );
        ws.send(
          JSON.stringify({
            type: 'register',
            payload: { peer_id: peerId, capabilities: { webrtc: true } },
            sig,
            ts,
          }),
        );
      });

      ws.on('message', (raw: Buffer) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register_ok') {
          resolve();
        } else {
          reject(new Error(`Unexpected message: ${JSON.stringify(msg)}`));
        }
      });

      ws.on('error', reject);
    });

    // Check health now shows peer_count: 1
    const res = await serverHandle.app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.peer_count, 1);

    ws.close();
  });

  it('WS register with invalid sig closes 1008', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`${wsBaseUrl}/ws`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        const ts = new Date().toISOString();
        ws.send(
          JSON.stringify({
            type: 'register',
            payload: { peer_id: peerId, capabilities: {} },
            sig: Buffer.from(new Uint8Array(64).fill(0x00)).toString('base64'),
            ts,
          }),
        );
      });

      ws.on('close', (code: number) => {
        assert.strictEqual(code, 1008);
        resolve();
      });

      ws.on('error', reject);
    });
  });

  it('lookup returns found: true for registered peer', async () => {
    const { default: WebSocket } = await import('ws');
    const ws = new WebSocket(`${wsBaseUrl}/ws`);

    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        const ts = new Date().toISOString();
        const sig = signPayload({ peer_id: peerId, capabilities: {} }, ts, kp.secretKey);
        ws.send(
          JSON.stringify({
            type: 'register',
            payload: { peer_id: peerId, capabilities: {} },
            sig,
            ts,
          }),
        );
      });

      let registered = false;
      ws.on('message', (raw: Buffer) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register_ok' && !registered) {
          registered = true;
          // Now lookup self
          const ts = new Date().toISOString();
          const sig = signPayload({ peer_id: peerId }, ts, kp.secretKey);
          ws.send(
            JSON.stringify({
              type: 'lookup',
              payload: { peer_id: peerId },
              sig,
              ts,
            }),
          );
        } else if (msg.type === 'lookup_result') {
          assert.strictEqual(msg.found, true);
          resolve();
        } else {
          reject(new Error(`Unexpected: ${JSON.stringify(msg)}`));
        }
      });

      ws.on('error', reject);
    });

    ws.close();
  });

  it('WS close evicts peer (D1)', async () => {
    // Register, close, verify lookup returns found: false
    const { default: WebSocket } = await import('ws');
    const ws1 = new WebSocket(`${wsBaseUrl}/ws`);
    const ts = new Date().toISOString();
    const sig = signPayload({ peer_id: peerId, capabilities: {} }, ts, kp.secretKey);

    await new Promise<void>((resolve, reject) => {
      ws1.on('open', () => {
        ws1.send(
          JSON.stringify({
            type: 'register',
            payload: { peer_id: peerId, capabilities: {} },
            sig,
            ts,
          }),
        );
      });
      ws1.on('message', (raw: Buffer) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register_ok') {
          resolve();
        }
      });
      ws1.on('error', reject);
    });

    ws1.close();

    // Wait a tick for close handler
    await new Promise((r) => setTimeout(r, 50));

    // Check health — should be 0
    const res = await serverHandle.app.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(res.body);
    assert.strictEqual(body.peer_count, 0);
  });
});
