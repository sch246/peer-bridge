// RendezvousClient tests — node:test + tsx
// Run: node --import tsx --test src/signaling.test.ts
//
// Covers: constructor, connect, register flow, disconnect, FSM transitions,
// error paths, double-connect guard. Uses in-process mock WS server (ws pkg).

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { WebSocketServer, type WebSocket as WsWebSocket } from 'ws';
import sodium from 'libsodium-wrappers';
import { initCrypto } from './crypto-init.js';
import { generateKeyPair, getPeerId } from './identity.js';
import { RendezvousClient, RendezvousError, type FsmState } from './signaling.js';

// ═════════════════════════════════════════════════════════════════════════════
// Helpers
// ═════════════════════════════════════════════════════════════════════════════

interface MockServer {
  server: WebSocketServer;
  url: string;
}

function createMockServer(handler: (ws: WsWebSocket) => void): Promise<MockServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    wss.on('listening', () => {
      const addr = wss.address()!;
      const port = (addr as { port: number }).port;
      const url = `ws://127.0.0.1:${port}`;
      wss.on('connection', handler);
      resolve({ server: wss, url });
    });
  });
}

function closeServer(server: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function verifyClientSignature(
  payload: Record<string, unknown>,
  sigBase64: string,
  ts: string,
  pubkey: Uint8Array,
): boolean {
  const payloadJson = JSON.stringify(payload);
  const messageBytes = Buffer.from(payloadJson + ts, 'utf-8');
  const hash = createHash('sha256').update(messageBytes).digest();

  let sigBytes: Uint8Array;
  try {
    sigBytes = Buffer.from(sigBase64, 'base64');
  } catch {
    return false;
  }
  if (sigBytes.length !== 64) return false;

  return sodium.crypto_sign_verify_detached(sigBytes, hash, pubkey);
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

describe('RendezvousClient', () => {
  before(async () => {
    await initCrypto();
  });

  // ── Test 1: constructor sets state=disconnected ─────────────────────────

  it('constructor sets state=disconnected', async () => {
    const kp = await generateKeyPair();
    const client = new RendezvousClient({
      keypair: kp,
      url: 'ws://localhost:9999',
    });
    assert.strictEqual(client.state, 'disconnected');
  });

  // ── Test 2: connect() opens WS and reaches ready after register_ok ─────

  it('connect() opens WS and reaches ready after register_ok', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(
            JSON.stringify({
              type: 'register_ok',
              server_id: 'ed25519:test',
              federation_size: 0,
            }),
          );
        }
      });
    });
    t.after(() => {
      server.close();
    });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
    });
    await client.connect();

    assert.strictEqual(client.state, 'ready');
    client.disconnect();
  });

  // ── Test 3: register frame matches server's auth verif path ─────────────────

  it('register frame matches server auth verification path', async (t) => {
    const kp = await generateKeyPair();
    const peerId = getPeerId(kp.publicKey);

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          const { payload, sig, ts } = msg;

          // Verify payload fields
          assert.strictEqual(payload.peer_id, peerId);

          // Verify signature using libsodium (same contract as rendezvous/src/auth.ts)
          const valid = verifyClientSignature(payload, sig, ts, kp.publicKey);
          assert.strictEqual(valid, true);

          ws.send(
            JSON.stringify({
              type: 'register_ok',
              server_id: 'ed25519:test',
              federation_size: 0,
            }),
          );
        }
      });
    });
    t.after(() => {
      server.close();
    });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
    });
    await client.connect();

    assert.strictEqual(client.state, 'ready');
    client.disconnect();
  });

  // ── Test 4: disconnect() transitions to disconnected and emits disconnect ──

  it('disconnect() transitions to disconnected and emits disconnect event', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(
            JSON.stringify({
              type: 'register_ok',
              server_id: 'ed25519:test',
              federation_size: 0,
            }),
          );
        }
      });
    });
    t.after(() => {
      server.close();
    });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
    });
    await client.connect();
    assert.strictEqual(client.state, 'ready');

    const disconnectPromise = new Promise<{ code: number; reason: string }>((resolve) => {
      client.once('disconnect', (code, reason) => {
        resolve({ code, reason });
      });
    });

    client.disconnect();

    const disconnectEvent = await disconnectPromise;
    assert.strictEqual(disconnectEvent.code, 1000);
    assert.strictEqual(client.state, 'disconnected');
  });

  // ── Test 5: state_change events fire in correct order ────────────────────

  it('state_change events fire in correct order', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(
            JSON.stringify({
              type: 'register_ok',
              server_id: 'ed25519:test',
              federation_size: 0,
            }),
          );
        }
      });
    });
    t.after(() => {
      server.close();
    });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
    });

    const transitions: Array<{ from: FsmState; to: FsmState }> = [];
    client.on('state_change', (from, to) => {
      transitions.push({ from, to });
    });

    await client.connect();

    assert.deepStrictEqual(transitions, [
      { from: 'disconnected', to: 'connecting' },
      { from: 'connecting', to: 'registering' },
      { from: 'registering', to: 'ready' },
    ]);

    client.disconnect();
  });

  // ── Test 6: connect rejects if WS open fails ─────────────────────────────

  it('connect rejects if WS open fails', async (t) => {
    const kp = await generateKeyPair();
    // Create server that we immediately close
    const { server, url } = await createMockServer(() => {});

    // Close server so the port is unreachable
    await closeServer(server);

    t.after(() => {
      // already closed
    });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 500,
    });

    await assert.rejects(
      () => client.connect(),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'ws_open_failed');
        return true;
      },
    );

    assert.strictEqual(client.state, 'connecting');
  });

  // ── Test 7: connect rejects if register_ok times out ─────────────────────

  it('connect rejects if register_ok times out', async (t) => {
    const kp = await generateKeyPair();
    // Server that accepts connections but never responds with register_ok
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', () => {
        // Silently drop — do NOT send register_ok
      });
    });
    t.after(() => {
      server.close();
    });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 100,
    });

    await assert.rejects(
      () => client.connect(),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'register_timeout');
        return true;
      },
    );

    assert.strictEqual(client.state, 'registering');
    client.disconnect();
  });

  // ── Test 8: double-connect is rejected ──────────────────────────────────

  it('double-connect is rejected', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(
            JSON.stringify({
              type: 'register_ok',
              server_id: 'ed25519:test',
              federation_size: 0,
            }),
          );
        }
      });
    });
    t.after(() => {
      server.close();
    });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
    });

    await client.connect();
    assert.strictEqual(client.state, 'ready');

    await assert.rejects(
      () => client.connect(),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'invalid_state');
        return true;
      },
    );

    client.disconnect();
  });

  // ── Additional: reconnect.enabled throws ────────────────────────────────

  it('throws if reconnect.enabled is true', async () => {
    const kp = await generateKeyPair();
    assert.throws(
      () =>
        new RendezvousClient({
          keypair: kp,
          url: 'ws://localhost:9999',
          reconnect: { enabled: true },
        }),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'not_implemented');
        return true;
      },
    );
  });

  // ── Additional: registered event fires with correct fields ───────────────

  it('registered event fires with server_id and federation_size', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(
            JSON.stringify({
              type: 'register_ok',
              server_id: 'ed25519:rendezvous-1',
              federation_size: 3,
            }),
          );
        }
      });
    });
    t.after(() => {
      server.close();
    });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
    });

    const registeredPromise = new Promise<{
      server_id: string;
      federation_size: number;
    }>((resolve) => {
      client.once('registered', (server_id, federation_size) => {
        resolve({ server_id, federation_size });
      });
    });

    await client.connect();

    const evt = await registeredPromise;
    assert.strictEqual(evt.server_id, 'ed25519:rendezvous-1');
    assert.strictEqual(evt.federation_size, 3);

    client.disconnect();
  });

  // ── Additional: server-initiated close during register emits error ───────

  it('server close during register rejects connect with register_failed', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          // Server closes the connection instead of sending register_ok
          ws.close(1008, 'Invalid peer_id');
        }
      });
    });
    t.after(() => {
      server.close();
    });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
    });

    await assert.rejects(
      () => client.connect(),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'register_failed');
        return true;
      },
    );
  });
});
