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

  // ── Additional: reconnect.enabled no longer throws (2d implements it) ──

  it('constructor accepts reconnect.enabled: true (2d)', async () => {
    const kp = await generateKeyPair();
    const client = new RendezvousClient({
      keypair: kp,
      url: 'ws://localhost:9999',
      reconnect: { enabled: true, baseDelayMs: 10 },
    });
    assert.strictEqual(client.state, 'disconnected');
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

  // ── Request methods (FIFO) ──────────────────────────────────────────────

  it('lookup: resolves with {found:true, home} on success', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'lookup') {
          ws.send(JSON.stringify({ type: 'lookup_result', found: true, home: 'rdv://home' }));
        }
      });
    });
    t.after(() => server.close());

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    const result = await client.lookup('some-peer');
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.home, 'rdv://home');

    client.disconnect();
  });

  it('lookup: resolves with {found:false} when peer not found', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'lookup') {
          ws.send(JSON.stringify({ type: 'lookup_result', found: false }));
        }
      });
    });
    t.after(() => server.close());

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    const result = await client.lookup('no-such-peer');
    assert.strictEqual(result.found, false);
    assert.strictEqual(result.home, undefined);

    client.disconnect();
  });

  it('inviteCreate: resolves with {peer_id, pubkey} on success', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'invite_create') {
          ws.send(
            JSON.stringify({
              type: 'invite_result',
              peer_id: 'PB-CREATOR',
              pubkey: 'base64pub',
            }),
          );
        }
      });
    });
    t.after(() => server.close());

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    const result = await client.inviteCreate({
      code_hash: 'abc123',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    assert.strictEqual(result.peer_id, 'PB-CREATOR');
    assert.strictEqual(result.pubkey, 'base64pub');

    client.disconnect();
  });

  it('inviteCreate: rejects with RendezvousError on server error', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'invite_create') {
          ws.send(JSON.stringify({ type: 'invite_result', error: 'invalid_request' }));
        }
      });
    });
    t.after(() => server.close());

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    await assert.rejects(
      () => client.inviteCreate({ code_hash: 'bad', expires_at: 'bad' }),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'invalid_request');
        return true;
      },
    );

    client.disconnect();
  });

  it('inviteRedeem: resolves with {peer_id, pubkey} on success', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'invite_redeem') {
          ws.send(
            JSON.stringify({
              type: 'invite_result',
              peer_id: 'PB-INVITER',
              pubkey: 'base64inviter',
            }),
          );
        }
      });
    });
    t.after(() => server.close());

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    const result = await client.inviteRedeem('abc123');
    assert.strictEqual(result.peer_id, 'PB-INVITER');
    assert.strictEqual(result.pubkey, 'base64inviter');

    client.disconnect();
  });

  it('inviteRedeem: rejects with RendezvousError code=not_found', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'invite_redeem') {
          ws.send(JSON.stringify({ type: 'invite_result', error: 'not_found' }));
        }
      });
    });
    t.after(() => server.close());

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    await assert.rejects(
      () => client.inviteRedeem('no-such-code'),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'not_found');
        return true;
      },
    );

    client.disconnect();
  });

  it('FIFO: two back-to-back lookups resolve in order', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'lookup') {
          // Respond to each lookup with the peer_id from the request
          const peerId = (msg.payload as Record<string, unknown>).peer_id as string;
          ws.send(JSON.stringify({ type: 'lookup_result', found: true, home: `home/${peerId}` }));
        }
      });
    });
    t.after(() => server.close());

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    // Issue two lookups back-to-back without awaiting
    const p1 = client.lookup('peer-a');
    const p2 = client.lookup('peer-b');

    const results = await Promise.all([p1, p2]);
    assert.strictEqual(results[0].found, true);
    assert.strictEqual(results[0].home, 'home/peer-a');
    assert.strictEqual(results[1].found, true);
    assert.strictEqual(results[1].home, 'home/peer-b');

    client.disconnect();
  });

  it('FIFO: second request frame is not sent until first resolves', async (t) => {
    const kp = await generateKeyPair();
    const rxFrames: Array<{ type: string; payload: Record<string, unknown> }> = [];
    let resolveFirst: (() => void) | null = null;

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        rxFrames.push({
          type: msg.type as string,
          payload: msg.payload as Record<string, unknown>,
        });

        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'lookup') {
          if (!resolveFirst) {
            // Hold the first lookup response
            resolveFirst = () => {
              ws.send(JSON.stringify({ type: 'lookup_result', found: true }));
            };
          } else {
            // Second lookup: respond immediately
            ws.send(JSON.stringify({ type: 'lookup_result', found: false }));
          }
        }
      });
    });
    t.after(() => server.close());

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    // Issue first lookup — will be held by mock server
    const firstPromise = client.lookup('peer-a');

    // Issue second lookup — must queue behind the first
    const secondPromise = client.lookup('peer-b');

    // Wait a tick for the first frame to be sent (second should NOT be sent)
    await new Promise((r) => setTimeout(r, 50));

    // Only one lookup frame should be on the wire
    const lookupFrames = rxFrames.filter((f) => f.type === 'lookup');
    assert.strictEqual(
      lookupFrames.length,
      1,
      'second lookup must not be sent before first resolves',
    );
    assert.strictEqual(lookupFrames[0].payload.peer_id, 'peer-a');

    // Release the first response
    resolveFirst!();
    const firstResult = await firstPromise;
    assert.strictEqual(firstResult.found, true);

    // Now second should go through
    const secondResult = await secondPromise;
    assert.strictEqual(secondResult.found, false);

    // Verify both frames were eventually sent in order
    const allLookupFrames = rxFrames.filter((f) => f.type === 'lookup');
    assert.strictEqual(allLookupFrames.length, 2);
    assert.strictEqual(allLookupFrames[0].payload.peer_id, 'peer-a');
    assert.strictEqual(allLookupFrames[1].payload.peer_id, 'peer-b');

    client.disconnect();
  });

  it('FIFO: server error envelope rejects current request and releases slot', async (t) => {
    const kp = await generateKeyPair();
    let firstRejected = false;

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'lookup') {
          if (!firstRejected) {
            // First lookup: send error envelope
            firstRejected = true;
            ws.send(JSON.stringify({ type: 'error', code: 'malformed', message: 'bad request' }));
          } else {
            // Second lookup: respond normally (FIFO slot was released by the error)
            ws.send(JSON.stringify({ type: 'lookup_result', found: true }));
          }
        }
      });
    });
    t.after(() => server.close());

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    // First lookup gets an error from server
    await assert.rejects(
      () => client.lookup('bad'),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'malformed');
        return true;
      },
    );

    // Second lookup succeeds — FIFO slot was properly released
    const result = await client.lookup('good');
    assert.strictEqual(result.found, true);

    client.disconnect();
  });

  it('request before connect rejects with not_ready', async () => {
    const kp = await generateKeyPair();
    const client = new RendezvousClient({
      keypair: kp,
      url: 'ws://localhost:9999',
    });

    assert.strictEqual(client.state, 'disconnected');

    // lookup rejects (async functions always return Promises; guard throws internally
    // but it surfaces as a rejected Promise, not a synchronous throw)
    await assert.rejects(
      () => client.lookup('peer'),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'not_ready');
        return true;
      },
    );
  });

  it('request after disconnect rejects with not_ready', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        }
      });
    });
    t.after(() => server.close());

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();
    assert.strictEqual(client.state, 'ready');

    // Disconnect and await the disconnect event so state is deterministically 'disconnected'
    const disconnectPromise = new Promise<void>((resolve) => {
      client.once('disconnect', () => resolve());
    });
    client.disconnect();
    await disconnectPromise;

    assert.strictEqual(client.state, 'disconnected');

    await assert.rejects(
      () => client.lookup('peer'),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'not_ready');
        return true;
      },
    );
  });

  it('request method signs payload matching server auth contract', async (t) => {
    const kp = await generateKeyPair();
    const peerId = getPeerId(kp.publicKey);

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'lookup') {
          // Verify the lookup payload is properly signed
          const { payload, sig, ts } = msg;
          assert.strictEqual(payload.peer_id, peerId);
          const valid = verifyClientSignature(payload, sig, ts, kp.publicKey);
          assert.strictEqual(valid, true, 'lookup signature must verify');

          ws.send(JSON.stringify({ type: 'lookup_result', found: true }));
        }
      });
    });
    t.after(() => server.close());

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    const result = await client.lookup(peerId);
    assert.strictEqual(result.found, true);

    client.disconnect();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Push handlers + fire-and-forget (M2 brief #2c)
// ═════════════════════════════════════════════════════════════════════════════

describe('Push handlers + fire-and-forget', () => {
  before(async () => {
    await initCrypto();
  });

  // ── signal() fire-and-forget ─────────────────────────────────────────────

  it('signal sends correct frame shape', async (t) => {
    const kp = await generateKeyPair();
    let signalFrame: Record<string, unknown> | null = null;

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'signal') {
          signalFrame = msg;
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    client.signal('peer-abc', 'encrypted-payload-data');

    // Allow async delivery
    await new Promise((r) => setTimeout(r, 20));

    assert.ok(signalFrame, 'signal frame must be sent');
    assert.strictEqual(signalFrame!.type, 'signal');
    const payload = signalFrame!.payload as Record<string, unknown>;
    assert.strictEqual(payload.to, 'peer-abc');
    assert.strictEqual(payload.payload, 'encrypted-payload-data');
    assert.ok(typeof signalFrame!.sig === 'string', 'sig must be present');
    assert.ok(typeof signalFrame!.ts === 'string', 'ts must be present');

    // Verify signature
    const valid = verifyClientSignature(payload, signalFrame!.sig as string, signalFrame!.ts as string, kp.publicKey);
    assert.strictEqual(valid, true, 'signal signature must verify');

    client.disconnect();
  });

  it('signal returns synchronously (void)', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    const result = client.signal('peer-x', 'data');
    assert.strictEqual(result, undefined, 'signal must return undefined (void)');

    client.disconnect();
  });

  it('signal throws if state !== ready', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();
    assert.strictEqual(client.state, 'ready');

    // Disconnect and wait for state transition
    const disconnectPromise = new Promise<void>((resolve) => {
      client.once('disconnect', () => resolve());
    });
    client.disconnect();
    await disconnectPromise;
    assert.strictEqual(client.state, 'disconnected');

    assert.throws(
      () => client.signal('peer', 'data'),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'not_ready');
        return true;
      },
    );
  });

  it('signal does not consume FIFO slot', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'signal') {
          // fire-and-forget — no response
        } else if (msg.type === 'lookup') {
          ws.send(JSON.stringify({ type: 'lookup_result', found: true, home: 'rdv://found' }));
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    // Send signal, then lookup — both should work
    client.signal('peer', 'data');
    const result = await client.lookup('peer');
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.home, 'rdv://found');

    client.disconnect();
  });

  // ── notify() fire-and-forget ─────────────────────────────────────────────

  it('notify sends correct frame shape', async (t) => {
    const kp = await generateKeyPair();
    let notifyFrame: Record<string, unknown> | null = null;

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'notify') {
          notifyFrame = msg;
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    client.notify('peer-xyz', 'base64sealedboxdata==');

    // Allow async delivery
    await new Promise((r) => setTimeout(r, 20));

    assert.ok(notifyFrame, 'notify frame must be sent');
    assert.strictEqual(notifyFrame!.type, 'notify');
    const payload = notifyFrame!.payload as Record<string, unknown>;
    assert.strictEqual(payload.to, 'peer-xyz');
    assert.strictEqual(payload.sealed_box, 'base64sealedboxdata==');
    assert.ok(typeof notifyFrame!.sig === 'string', 'sig must be present');
    assert.ok(typeof notifyFrame!.ts === 'string', 'ts must be present');

    // Verify signature
    const valid = verifyClientSignature(payload, notifyFrame!.sig as string, notifyFrame!.ts as string, kp.publicKey);
    assert.strictEqual(valid, true, 'notify signature must verify');

    client.disconnect();
  });

  it('notify throws if state !== ready', async (t) => {
    const kp = await generateKeyPair();
    const client = new RendezvousClient({ keypair: kp, url: 'ws://localhost:9999' });
    assert.strictEqual(client.state, 'disconnected');

    assert.throws(
      () => client.notify('peer', 'box'),
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'not_ready');
        return true;
      },
    );
  });

  // ── Push handler: signal_in ──────────────────────────────────────────────

  it('signal_in event fires with correct (from, payload) when server pushes', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          // Send signal_in after register_ok (normal flow)
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
          ws.send(JSON.stringify({ type: 'signal_in', from: 'PB-ALICE', payload: 'encrypted-stuff' }));
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });

    const signalEvents: Array<{ from: string; payload: string }> = [];
    client.on('signal_in', (from, payload) => {
      signalEvents.push({ from, payload });
    });

    await client.connect();

    // Allow async delivery of signal_in after connect resolves
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(signalEvents.length, 1, 'exactly one signal_in event');
    assert.strictEqual(signalEvents[0].from, 'PB-ALICE');
    assert.strictEqual(signalEvents[0].payload, 'encrypted-stuff');

    client.disconnect();
  });

  // ── Push handler: notify_in ──────────────────────────────────────────────

  it('notify_in event fires with correct (sealed_box, queued_at)', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
          ws.send(JSON.stringify({
            type: 'notify_in',
            sealed_box: 'dmVyeSBsb25nIGJhc2U2NCBzdHJpbmcgd2l0aCBtYW55IGNoYXJhY3RlcnM=',
            queued_at: '2024-06-15T12:00:00.000Z',
          }));
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });

    const notifyEvents: Array<{ sealed_box: string; queued_at: string }> = [];
    client.on('notify_in', (sealed_box, queued_at) => {
      notifyEvents.push({ sealed_box, queued_at });
    });

    await client.connect();

    // Allow async delivery
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(notifyEvents.length, 1, 'exactly one notify_in event');
    assert.strictEqual(notifyEvents[0].sealed_box, 'dmVyeSBsb25nIGJhc2U2NCBzdHJpbmcgd2l0aCBtYW55IGNoYXJhY3RlcnM=');
    assert.strictEqual(notifyEvents[0].queued_at, '2024-06-15T12:00:00.000Z');

    client.disconnect();
  });

  // ── Q-N3: notify_in before register_ok ───────────────────────────────────

  it('Q-N3: notify_in dispatches before register_ok during registering state', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          // Simulate Q-N3: server flushes queued notify_in BEFORE register_ok.
          // Per register.ts handleRegister: pending_notifications are delivered
          // before sendRegisterOk.
          ws.send(JSON.stringify({
            type: 'notify_in',
            sealed_box: 'cTJucXVldWVkbm90aWZ5',
            queued_at: '2024-01-01T00:00:00.000Z',
          }));
          ws.send(JSON.stringify({
            type: 'register_ok',
            server_id: 'test',
            federation_size: 0,
          }));
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });

    const eventOrder: string[] = [];
    let notifyData: { sealed_box: string; queued_at: string } | null = null;

    client.on('notify_in', (sealed_box, queued_at) => {
      eventOrder.push('notify_in');
      notifyData = { sealed_box, queued_at };
    });
    client.on('registered', () => {
      eventOrder.push('registered');
    });
    client.on('state_change', (_, to) => {
      if (to === 'ready') eventOrder.push('state_change:ready');
    });

    await client.connect();

    assert.strictEqual(client.state, 'ready');

    // Q-N3 critical assertion: notify_in fired exactly once
    const notifyIdx = eventOrder.indexOf('notify_in');
    const registeredIdx = eventOrder.indexOf('registered');
    assert.ok(notifyIdx >= 0, 'notify_in event must have fired');
    assert.ok(registeredIdx >= 0, 'registered event must have fired');
    assert.ok(
      notifyIdx < registeredIdx,
      `Q-N3 violation: notify_in (idx ${notifyIdx}) must fire before registered (idx ${registeredIdx}). Order: ${eventOrder.join(' -> ')}`,
    );

    // Verify payload round-trips
    assert.strictEqual(notifyData!.sealed_box, 'cTJucXVldWVkbm90aWZ5');
    assert.strictEqual(notifyData!.queued_at, '2024-01-01T00:00:00.000Z');

    client.disconnect();
  });

  // ── Push during in-flight request ────────────────────────────────────────

  it('push during in-flight request: signal_in does not corrupt FIFO', async (t) => {
    const kp = await generateKeyPair();
    let lookupWs: WsWebSocket | null = null;

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'lookup') {
          lookupWs = ws;
          // Do NOT respond yet — push signal_in first
          ws.send(JSON.stringify({ type: 'signal_in', from: 'PB-PUSHER', payload: 'push-during-lookup' }));
          // Then respond to lookup
          ws.send(JSON.stringify({ type: 'lookup_result', found: true, home: 'rdv://target' }));
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();

    const signalEvents: Array<{ from: string; payload: string }> = [];
    client.on('signal_in', (from, payload) => {
      signalEvents.push({ from, payload });
    });

    const result = await client.lookup('target-peer');

    // Allow async delivery of signal_in
    await new Promise((r) => setTimeout(r, 20));

    // signal_in event must have fired
    assert.strictEqual(signalEvents.length, 1, 'signal_in must fire during in-flight lookup');
    assert.strictEqual(signalEvents[0].from, 'PB-PUSHER');
    assert.strictEqual(signalEvents[0].payload, 'push-during-lookup');

    // lookup must resolve correctly — FIFO not corrupted
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.home, 'rdv://target');

    client.disconnect();
  });

  // ── signal_in in non-ready state ─────────────────────────────────────────

  it('signal_in in registering state: tolerated and emitted', async (t) => {
    const kp = await generateKeyPair();
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          // Push signal_in before register_ok (forward-compat: server may do this
          // even though protocol says it only forwards to registered peers)
          ws.send(JSON.stringify({ type: 'signal_in', from: 'PB-EARLY', payload: 'early-signal' }));
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });

    const signalEvents: Array<{ from: string; payload: string }> = [];
    client.on('signal_in', (from, payload) => {
      signalEvents.push({ from, payload });
    });

    // During connect, state is 'registering' when signal_in arrives
    await client.connect();
    assert.strictEqual(client.state, 'ready');

    await new Promise((r) => setTimeout(r, 20));

    // [choice] tolerate-and-emit: signal_in in non-ready state is emitted, not dropped
    assert.strictEqual(signalEvents.length, 1, 'signal_in must be emitted even in registering state');
    assert.strictEqual(signalEvents[0].from, 'PB-EARLY');
    assert.strictEqual(signalEvents[0].payload, 'early-signal');

    client.disconnect();
  });

  // ── notify_in sealed_box round-trip ──────────────────────────────────────

  it('notify_in sealed_box field round-trips intact with long base64 string', async (t) => {
    const kp = await generateKeyPair();
    const longBase64 = 'TG9yZW0gaXBzdW0gZG9sb3Igc2l0IGFtZXQgY29uc2VjdGV0dXIgYWRpcGlzY2luZyBlbGl0IHNlZCBkbyBlaXVzbW9kIHRlbXBvciBpbmNpZGlkdW50IHV0IGxhYm9yZSBldCBkb2xvcmUgbWFnbmEgYWxpcXVhIFV0IGVuaW0gYWQgbWluaW0gdmVuaWFtIHF1aXMgbm9zdHJ1ZCBleGVyY2l0YXRpb24gdWxsYW1jbyBsYWJvcmlzIG5pc2kgdXQgYWxpcXVpcCBleCBlYSBjb21tb2RvIGNvbnNlcXVhdA==';

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
          ws.send(JSON.stringify({
            type: 'notify_in',
            sealed_box: longBase64,
            queued_at: '2025-12-01T00:00:00.000Z',
          }));
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });

    const notifyEvents: Array<{ sealed_box: string; queued_at: string }> = [];
    client.on('notify_in', (sealed_box, queued_at) => {
      notifyEvents.push({ sealed_box, queued_at });
    });

    await client.connect();
    await new Promise((r) => setTimeout(r, 20));

    assert.strictEqual(notifyEvents.length, 1);
    assert.strictEqual(notifyEvents[0].sealed_box, longBase64, 'long base64 sealed_box must round-trip intact');
    assert.strictEqual(notifyEvents[0].queued_at, '2025-12-01T00:00:00.000Z');

    client.disconnect();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Reconnect (D3) + Q-N4 (M2 brief #2d)
// ═════════════════════════════════════════════════════════════════════════════

describe('Reconnect (D3) + Q-N4', () => {
  before(async () => {
    await initCrypto();
  });

  // ── reconnect disabled (default) ────────────────────────────────────────

  it('reconnect disabled: close from ready → disconnected, no reconnect', async (t) => {
    const kp = await generateKeyPair();
    let serverCloseCount = 0;

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
          // Force-close to trigger disconnect
          setTimeout(() => {
            serverCloseCount++;
            ws.close(1001, 'going away');
          }, 20);
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({ keypair: kp, url, registerTimeoutMs: 2000 });
    await client.connect();
    assert.strictEqual(client.state, 'ready');

    let disconnectEvent: { code: number; reason: string } | null = null;
    const reconnectEvents: Array<{ attempt: number; delayMs: number }> = [];
    client.on('disconnect', (code, reason) => { disconnectEvent = { code, reason }; });
    client.on('reconnect', (attempt, delayMs) => { reconnectEvents.push({ attempt, delayMs }); });

    // Wait for close to be processed
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(disconnectEvent, 'disconnect event must fire');
    assert.strictEqual(disconnectEvent!.code, 1001);
    assert.strictEqual(client.state, 'disconnected');
    assert.strictEqual(reconnectEvents.length, 0, 'no reconnect event when disabled');

    // Verify only one connection was made
    assert.strictEqual(serverCloseCount, 1);

    client.disconnect();
  });

  // ── reconnect enabled: close from ready → reconnecting → ready ──────────

  it('reconnect enabled: close from ready → reconnecting → reconnects', async (t) => {
    const kp = await generateKeyPair();
    let registerCount = 0;

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          registerCount++;
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
          // Force-close on FIRST register (not on reconnect)
          if (registerCount === 1) {
            setTimeout(() => ws.close(1001, 'going away'), 20);
          }
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
      reconnect: { enabled: true, baseDelayMs: 10 },
    });

    const stateChanges: Array<{ from: string; to: string }> = [];
    client.on('state_change', (from, to) => { stateChanges.push({ from, to }); });

    await client.connect();
    assert.strictEqual(client.state, 'ready');
    assert.strictEqual(registerCount, 1);

    // Wait for disconnect + reconnect cycle
    await new Promise((r) => {
      client.once('registered', () => r(undefined));
    });
    await new Promise((r) => setTimeout(r, 30));

    assert.strictEqual(client.state, 'ready', 'must be ready after reconnect');
    assert.strictEqual(registerCount, 2, 'must have registered twice (initial + reconnect)');

    // Verify state transitions include reconnecting
    const states = stateChanges.map((s) => s.to);
    assert.ok(states.includes('reconnecting'), 'must transition through reconnecting state');

    client.disconnect();
  });

  // ── reconnect re-registers (D3 fresh session) ───────────────────────────

  it('reconnect sends fresh register frame (D3 fresh-session)', async (t) => {
    const kp = await generateKeyPair();
    const peerId = getPeerId(kp.publicKey);
    let registerCount = 0;
    const registerPayloads: Record<string, unknown>[] = [];

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          registerCount++;
          registerPayloads.push(msg.payload as Record<string, unknown>);
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: registerCount }));
          // Force-close on first register only
          if (registerCount === 1) {
            setTimeout(() => ws.close(1001, 'going away'), 20);
          }
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
      reconnect: { enabled: true, baseDelayMs: 10 },
    });
    await client.connect();

    // Wait for reconnect to complete
    await new Promise((r) => {
      const onRegistered = () => {
        if (registerCount >= 2) {
          client.off('registered', onRegistered);
          r(undefined);
        }
      };
      client.on('registered', onRegistered);
    });
    await new Promise((r) => setTimeout(r, 30));

    assert.strictEqual(registerCount, 2, 'must have two register frames (initial + reconnect)');
    assert.strictEqual(registerPayloads.length, 2);

    // Both register payloads must have peer_id and capabilities
    for (const p of registerPayloads) {
      assert.strictEqual(p.peer_id, peerId);
      assert.ok(p.capabilities !== undefined, 'capabilities field must be present');
    }

    client.disconnect();
  });

  // ── reconnect event signature ───────────────────────────────────────────

  it('reconnect event fires with (attempt, delayMs)', async (t) => {
    const kp = await generateKeyPair();
    let registerCount = 0;

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          registerCount++;
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
          // Force-close on first register only (reconnect succeeds on 2nd)
          if (registerCount === 1) {
            setTimeout(() => ws.close(1001, 'going away'), 20);
          }
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
      reconnect: { enabled: true, baseDelayMs: 10 },
    });

    const reconnectEvents: Array<{ attempt: number; delayMs: number }> = [];
    client.on('reconnect', (attempt, delayMs) => {
      reconnectEvents.push({ attempt, delayMs });
    });

    await client.connect();

    // Wait for reconnect to complete
    await new Promise((r) => {
      const onRegistered = () => {
        if (registerCount >= 2) {
          client.off('registered', onRegistered);
          r(undefined);
        }
      };
      client.on('registered', onRegistered);
    });
    await new Promise((r) => setTimeout(r, 30));

    assert.strictEqual(reconnectEvents.length, 1, 'one reconnect event for successful reconnect');
    assert.strictEqual(reconnectEvents[0].attempt, 1, 'first attempt');
    assert.strictEqual(reconnectEvents[0].delayMs, 10, 'baseDelayMs on first attempt');

    client.disconnect();
  });

  // ── reconnect exponential backoff ───────────────────────────────────────

  it('reconnect exponential backoff: delays follow 2^n pattern (scaled)', async (t) => {
    const kp = await generateKeyPair();
    const baseDelay = 10;
    let registerCount = 0;

    // First connection succeeds (reach ready), then force-close.
    // Reconnect attempts fail (server closes immediately) to exercise backoff.
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          registerCount++;
          if (registerCount === 1) {
            // Initial registration: succeed, then force-close
            ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
            setTimeout(() => ws.close(1001, 'going away'), 5);
          } else {
            // Reconnect attempts: fail immediately
            setTimeout(() => ws.close(1008, 'not available'), 2);
          }
        }
      });
    });
    t.after(() => { server.close(); });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 500,
      reconnect: { enabled: true, baseDelayMs: baseDelay, maxAttempts: 3 },
    });

    const reconnectEvents: Array<{ attempt: number; delayMs: number }> = [];
    client.on('reconnect', (attempt, delayMs) => {
      reconnectEvents.push({ attempt, delayMs });
    });

    await client.connect();
    assert.strictEqual(client.state, 'ready');

    // Wait for all reconnect attempts to complete
    let reconnectFailed = false;
    client.once('reconnect_failed', () => { reconnectFailed = true; });
    await new Promise((r) => setTimeout(r, baseDelay * (1 + 2 + 4) + 200));

    assert.strictEqual(reconnectEvents.length, 3, '3 reconnect events for maxAttempts=3');
    assert.strictEqual(reconnectEvents[0].attempt, 1);
    assert.strictEqual(reconnectEvents[0].delayMs, baseDelay * 1); // 10ms
    assert.strictEqual(reconnectEvents[1].attempt, 2);
    assert.strictEqual(reconnectEvents[1].delayMs, baseDelay * 2); // 20ms
    assert.strictEqual(reconnectEvents[2].attempt, 3);
    assert.strictEqual(reconnectEvents[2].delayMs, baseDelay * 4); // 40ms

    assert.ok(reconnectFailed, 'reconnect_failed must fire after max attempts');
    assert.strictEqual(client.state, 'disconnected');

    client.disconnect();
  });

  // ── reconnect max attempts → reconnect_failed ───────────────────────────

  it('reconnect max attempts: after failures, reconnect_failed + disconnected', async (t) => {
    const kp = await generateKeyPair();
    let registerCount = 0;

    // First connection succeeds (reach ready), then force-close.
    // Reconnect attempts fail to exercise maxAttempts exhaustion.
    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          registerCount++;
          if (registerCount === 1) {
            ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
            setTimeout(() => ws.close(1001, 'going away'), 5);
          } else {
            setTimeout(() => ws.close(1008, 'not available'), 2);
          }
        }
      });
    });
    t.after(() => { server.close(); });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 200,
      reconnect: { enabled: true, baseDelayMs: 4, maxAttempts: 2 },
    });

    let reconnectFailedFired = false;
    client.on('reconnect_failed', () => { reconnectFailedFired = true; });

    await client.connect();
    assert.strictEqual(client.state, 'ready');

    // Wait for all reconnect attempts (baseDelay * (1+2)) + register timeouts + buffer
    await new Promise((r) => setTimeout(r, 4 * 3 + 400 + 100));

    assert.ok(reconnectFailedFired, 'reconnect_failed must fire');
    assert.strictEqual(client.state, 'disconnected');

    client.disconnect();
  });

  // ── explicit disconnect() during reconnecting cancels backoff ───────────

  it('explicit disconnect() during reconnecting cancels backoff', async (t) => {
    const kp = await generateKeyPair();
    let registerCount = 0;

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          registerCount++;
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
          // Force-close on first register
          if (registerCount === 1) {
            setTimeout(() => ws.close(1001, 'going away'), 20);
          }
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
      reconnect: { enabled: true, baseDelayMs: 10 },
    });

    await client.connect();

    // Wait for 'reconnect' event (fires synchronously before setTimeout),
    // then immediately call disconnect() to cancel the pending backoff timer.
    await new Promise<void>((resolve) => {
      client.once('reconnect', () => resolve());
    });

    // Now explicitly disconnect — timer hasn't fired yet (delay = 10ms)
    const disconnectEventPromise = new Promise<number>((resolve) => {
      client.once('disconnect', (code) => resolve(code));
    });
    client.disconnect();

    const code = await disconnectEventPromise;
    assert.strictEqual(code, 1000);
    assert.strictEqual(client.state, 'disconnected');

    // Wait to confirm NO reconnect happened (registerCount should still be 1)
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(registerCount, 1, 'no second register — reconnect was cancelled');

    client.disconnect();
  });

  // ── explicit disconnect() during ready: no reconnect attempted ──────────

  it('explicit disconnect() during ready: no reconnect', async (t) => {
    const kp = await generateKeyPair();
    let registerCount = 0;

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          registerCount++;
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
      reconnect: { enabled: true, baseDelayMs: 10 },
    });

    await client.connect();
    assert.strictEqual(client.state, 'ready');

    const reconnectEvents: Array<{ attempt: number; delayMs: number }> = [];
    client.on('reconnect', (attempt, delayMs) => { reconnectEvents.push({ attempt, delayMs }); });

    const disconnectEventPromise = new Promise<number>((resolve) => {
      client.once('disconnect', (code) => resolve(code));
    });
    client.disconnect();

    const code = await disconnectEventPromise;
    assert.strictEqual(code, 1000);
    assert.strictEqual(client.state, 'disconnected');

    // Wait to confirm no reconnect
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(reconnectEvents.length, 0, 'no reconnect after explicit disconnect');
    assert.strictEqual(registerCount, 1, 'only one register (no reconnect)');

    client.disconnect();
  });

  // ── Q-N4: invite_create dropped on close, NOT re-sent on reconnect ─────

  it('Q-N4: invite_create dropped on close, not re-sent after reconnect', async (t) => {
    const kp = await generateKeyPair();
    let connIndex = 0;
    // Track messages per connection
    const connMessages: string[][] = [];

    const { server, url } = await createMockServer((ws) => {
      const thisConn = connIndex++;
      const messages: string[] = [];
      connMessages[thisConn] = messages;

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        messages.push(msg.type as string);

        if (msg.type === 'register') {
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
        } else if (msg.type === 'invite_create') {
          // Force-close immediately on invite_create — simulate network failure
          setTimeout(() => ws.close(1001, 'simulated failure'), 10);
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
      reconnect: { enabled: true, baseDelayMs: 10 },
    });

    await client.connect();
    assert.strictEqual(client.state, 'ready');

    // Send invite_create — server will force-close
    const invitePromise = client.inviteCreate({
      code_hash: 'q-n4-test-hash',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });

    // Ensure the invite_create rejection is captured
    await assert.rejects(
      () => invitePromise,
      (err: unknown) => {
        assert.ok(err instanceof RendezvousError);
        assert.strictEqual((err as RendezvousError).code, 'connection_closed');
        return true;
      },
    );

    // Wait for reconnect to complete (next 'registered' event after reconnect)
    await new Promise<void>((r) => {
      client.once('registered', () => r());
    });
    await new Promise((r) => setTimeout(r, 30));

    assert.strictEqual(client.state, 'ready', 'must be ready after reconnect');

    // Q-N4 critical: verify second connection messages do NOT contain invite_create
    assert.ok(connMessages[1], 'second connection must exist');
    const conn2Types = connMessages[1]!;

    // Must contain register (reconnection re-registers per D3)
    assert.ok(conn2Types.includes('register'), 'reconnect must send register');

    // Must NOT contain invite_create (Q-N4: dropped, not auto-resent)
    assert.ok(
      !conn2Types.includes('invite_create'),
      `Q-N4 violation: invite_create was re-sent after reconnect. conn2 messages: ${conn2Types.join(', ')}`,
    );

    client.disconnect();
  });

  // ── reconnect preserves event listeners ─────────────────────────────────

  it('reconnect preserves signal_in event listener', async (t) => {
    const kp = await generateKeyPair();
    let registerCount = 0;

    const { server, url } = await createMockServer((ws) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'register') {
          registerCount++;
          ws.send(JSON.stringify({ type: 'register_ok', server_id: 'test', federation_size: 0 }));
          // Force-close on first register
          if (registerCount === 1) {
            setTimeout(() => ws.close(1001, 'going away'), 30);
          } else {
            // After reconnect, push a signal_in
            setTimeout(() => {
              ws.send(JSON.stringify({ type: 'signal_in', from: 'PB-ALICE', payload: 'post-reconnect-signal' }));
            }, 20);
          }
        }
      });
    });
    t.after(() => { server.close(); client.disconnect(); });

    const client = new RendezvousClient({
      keypair: kp,
      url,
      registerTimeoutMs: 2000,
      reconnect: { enabled: true, baseDelayMs: 10 },
    });

    const signalEvents: Array<{ from: string; payload: string }> = [];
    client.on('signal_in', (from, payload) => {
      signalEvents.push({ from, payload });
    });

    await client.connect();

    // Wait for reconnect to complete
    await new Promise((r) => {
      const onRegistered = () => {
        if (registerCount >= 2) {
          client.off('registered', onRegistered);
          r(undefined);
        }
      };
      client.on('registered', onRegistered);
    });

    // Wait for signal_in to arrive
    await new Promise((r) => setTimeout(r, 50));

    assert.strictEqual(signalEvents.length, 1, 'signal_in event must fire after reconnect');
    assert.strictEqual(signalEvents[0].from, 'PB-ALICE');
    assert.strictEqual(signalEvents[0].payload, 'post-reconnect-signal');

    client.disconnect();
  });
});
