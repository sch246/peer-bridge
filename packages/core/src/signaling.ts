// Rendezvous signaling client — WebSocket connection to a rendezvous server.
//
// Lifecycle: connect() → WS open → register → register_ok → ready → ... → disconnect()
//
// M2 brief #2a: skeleton + 4 frozen choices. Scope bounded to connect/disconnect
// and internal register. lookup/invite/signal/notify/reconnect belong to 2b/2c/2d.
//
// @telos facts/signaling-message-fields.md (field inventory)
// @telos facts/crypto-library-mapping.md (libsodium-wrappers, NOT tweetnacl)
// @telos decisions/disconnect-immediate-offline.md (D1 — no grace period, reconnect = reregister)

import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import WebSocket from 'ws';
import sodium from 'libsodium-wrappers';
import { initCrypto } from './crypto-init.js';
import { getPeerId, type SignKeyPair } from './identity.js';

// ═════════════════════════════════════════════════════════════════════════════
// Types
// ═════════════════════════════════════════════════════════════════════════════

// [choice] C1: Discriminated union FSM — single field, single source of truth.
// Chose discriminated union over boolean flags (isConnecting, isReady, etc.)
// because it eliminates invalid states like { connecting: true, ready: true }
// and makes transition ordering explicit in the type system.
export type FsmState = 'disconnected' | 'connecting' | 'registering' | 'ready';

export interface RendezvousClientEvents {
  state_change: (from: FsmState, to: FsmState) => void;
  registered: (server_id: string, federation_size: number) => void;
  disconnect: (code: number, reason: string) => void;
  error: (err: Error) => void;
}

export interface RendezvousClientOptions {
  keypair: SignKeyPair;
  url: string;
  // [choice] C4: Exponential backoff 1s/2s/4s/8s/16s/32s, max 6 retries.
  // Documented but NOT implemented in 2a. Reconnect stub throws if enabled.
  // Chose exponential over linear/fixed because network recovery times are
  // bimodal (fast jitter vs. long outage) and exponential crowds well under
  // shared-throttle conditions.
  reconnect?: { enabled: boolean };
  /** Timeout waiting for register_ok after sending register (default 10s). */
  registerTimeoutMs?: number;
}

// ═════════════════════════════════════════════════════════════════════════════
// Error
// ═════════════════════════════════════════════════════════════════════════════

// [choice] C3: RendezvousError with .code (string) and optional .detail.
// Server-defined error strings flow through .code. Network/protocol errors
// use codes like 'ws_open_failed', 'register_timeout', 'register_failed'.
// Chose structured error over plain Error because CLI scripts need to branch
// on error kind without parsing message strings, and plain Error doesn't carry
// machine-readable codes.
export class RendezvousError extends Error {
  public readonly code: string;
  public readonly detail?: unknown;

  constructor(code: string, message: string, detail?: unknown) {
    super(message);
    this.name = 'RendezvousError';
    this.code = code;
    this.detail = detail;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Client
// ═════════════════════════════════════════════════════════════════════════════

const DEFAULT_REGISTER_TIMEOUT_MS = 10_000;

// [choice] C2: Hybrid API — Promises for request/response (later in 2b),
// EventEmitter for pushes + lifecycle. Chose hybrid over pure-EventEmitter
// because await-able request methods (lookup, inviteCreate) are more ergonomic
// for CLI and script usage, while push handlers (signal_in, notify_in) fit
// EventEmitter naturally. M2 brief #2a only uses EventEmitter since no request
// methods exist yet, but the class signature commits to hybrid.
export class RendezvousClient extends EventEmitter {
  private _state: FsmState = 'disconnected';
  private _ws: WebSocket | null = null;
  private _keypair: SignKeyPair;
  private _url: string;
  private _peerId: string;
  private _reconnectEnabled: boolean;
  private _registerTimeoutMs: number;
  private _registerResolver: {
    resolve: (msg: { server_id: string; federation_size: number }) => void;
    reject: (err: Error) => void;
  } | null = null;

  constructor(options: RendezvousClientOptions) {
    super();
    this._keypair = options.keypair;
    this._url = options.url;
    this._peerId = getPeerId(options.keypair.publicKey);
    this._reconnectEnabled = options.reconnect?.enabled ?? false;
    this._registerTimeoutMs = options.registerTimeoutMs ?? DEFAULT_REGISTER_TIMEOUT_MS;

    // [choice] C4: reconnect is documented but NOT implemented in 2a.
    // Throw NotImplementedError if enabled=true to prevent silent failure.
    if (this._reconnectEnabled) {
      throw new RendezvousError(
        'not_implemented',
        'Reconnect is not yet implemented (M2 brief #2d). Set reconnect.enabled to false.',
      );
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Current FSM state. Single source of truth; no boolean flag aliasing.
   */
  get state(): FsmState {
    return this._state;
  }

  /**
   * Open WebSocket, send register, await register_ok, transition to 'ready'.
   * Rejects if WS open fails, register times out, or state is wrong.
   */
  async connect(): Promise<void> {
    if (this._state !== 'disconnected') {
      throw new RendezvousError(
        'invalid_state',
        `Cannot connect when state is "${this._state}". Must be "disconnected".`,
      );
    }

    this._transition('connecting');

    // Open WebSocket
    const ws = new WebSocket(this._url);
    this._ws = ws;

    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        ws.removeListener('error', onError);
        resolve();
      };
      const onError = (err: Event) => {
        ws.removeListener('open', onOpen);
        reject(
          new RendezvousError(
            'ws_open_failed',
            `Failed to open WebSocket to ${this._url}`,
            (err as ErrorEvent).message,
          ),
        );
      };
      ws.once('open', onOpen);
      ws.once('error', onError);
    });

    // Set up lifecycle handlers BEFORE sending register
    this._setupLifecycle(ws);

    // Transition → registering, then send register and await response
    this._transition('registering');
    await this._register();
  }

  /**
   * Gracefully close the WebSocket. FSM transitions to 'disconnected',
   * 'disconnect' event fires (via the WS close handler).
   */
  disconnect(): void {
    if (this._ws) {
      this._ws.close(1000, 'Client disconnect');
      // Don't null _ws — let the close handler do it, so 'disconnect' fires
      // with the actual close code/reason.
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────

  /**
   * Build and send a signed register frame to the rendezvous server.
   * Await register_ok (or timeout / WS close).
   *
   * sig = Ed25519(SHA-256(JSON.stringify(payload) || ts), secretKey)
   * per packages/rendezvous/src/auth.ts verifySignature contract.
   */
  private async _register(): Promise<void> {
    await initCrypto();
    const ws = this._ws!;

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._registerResolver = null;
        reject(
          new RendezvousError(
            'register_timeout',
            `Timed out waiting for register_ok after ${this._registerTimeoutMs}ms`,
          ),
        );
      }, this._registerTimeoutMs);

      this._registerResolver = {
        resolve: (msg) => {
          clearTimeout(timeout);
          this._registerResolver = null;
          this._transition('ready');
          this.emit('registered', msg.server_id, msg.federation_size);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timeout);
          this._registerResolver = null;
          reject(err);
        },
      };

      // Build & send signed register frame
      const payload = { peer_id: this._peerId, capabilities: {} };
      const ts = new Date().toISOString();
      const sig = this._sign(payload, ts);

      ws.send(JSON.stringify({ type: 'register', payload, sig, ts }));
    });
  }

  /**
   * Set up WS lifecycle handlers: message, close, error.
   * Called once per connect() after WS open.
   */
  private _setupLifecycle(ws: WebSocket): void {
    ws.on('message', (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        this.emit('error', new RendezvousError('parse_error', 'Failed to parse server message'));
        return;
      }

      // 2a: only handle register_ok. 2b/2c will dispatch more message types.
      if (msg.type === 'register_ok' && this._registerResolver) {
        this._registerResolver.resolve({
          server_id: msg.server_id as string,
          federation_size: msg.federation_size as number,
        });
      }
      // 2b/2c: lookup_result, invite_result, signal_in, notify_in stubs
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this._ws = null;

      // Reject pending register if in-flight
      if (this._registerResolver) {
        this._registerResolver.reject(
          new RendezvousError(
            'register_failed',
            `Connection closed during register: ${code} ${reason.toString()}`,
          ),
        );
      }

      const wasDisconnected = this._state === 'disconnected';
      if (!wasDisconnected) {
        this._transition('disconnected');
      }
      this.emit('disconnect', code, reason.toString());
    });

    ws.on('error', (err: Error) => {
      this.emit('error', err);
    });
  }

  /**
   * Compute Ed25519 detached signature matching the server's auth contract:
   *   sig = Ed25519(SHA-256(JSON.stringify(payload) || ts), secretKey)
   * Returns base64-encoded signature.
   */
  private _sign(payload: Record<string, unknown>, ts: string): string {
    const payloadJson = JSON.stringify(payload);
    const messageBytes = Buffer.from(payloadJson + ts, 'utf-8');
    const hash = createHash('sha256').update(messageBytes).digest();
    const sig = sodium.crypto_sign_detached(hash, this._keypair.secretKey);
    return Buffer.from(sig).toString('base64');
  }

  /**
   * Transition the FSM and emit 'state_change'.
   */
  private _transition(to: FsmState): void {
    const from = this._state;
    this._state = to;
    this.emit('state_change', from, to);
  }
}

// EventEmitter typing is inherited as-is. Callers type the listener callback
// parameter, not the event name string. The RendezvousClientEvents interface
// serves as documentation for the event contract.
