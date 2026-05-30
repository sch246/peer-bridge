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
// [choice] 2d: 'reconnecting' as a 5th FSM state (vs reusing 'connecting').
// Semantic distinction matters for callers: reconnecting means we had a
// session and are recovering; connecting means fresh start.
export type FsmState = 'disconnected' | 'connecting' | 'registering' | 'ready' | 'reconnecting';

export interface RendezvousClientEvents {
  state_change: (from: FsmState, to: FsmState) => void;
  registered: (server_id: string, federation_size: number) => void;
  disconnect: (code: number, reason: string) => void;
  error: (err: Error) => void;
  signal_in: (from: string, payload: string) => void;
  notify_in: (sealed_box: string, queued_at: string) => void;
  // [choice] 2d: reconnect event signature is (attempt, delayMs).
  // Including delayMs lets callers display backoff progress.
  reconnect: (attempt: number, delayMs: number) => void;
  // [choice] 2d: reconnect_failed as a distinct event (vs re-emitting disconnect
  // with a reason). Allows callers to distinguish "gave up after retries" from
  // "voluntary/normal disconnect".
  reconnect_failed: () => void;
}

// [choice] 2d: ReconnectOptions exposes baseDelayMs for test scaling.
// Production default is 1000ms; tests can set baseDelayMs = 10 for fast runs.
export interface ReconnectOptions {
  enabled: boolean;
  /** Base delay for first reconnect attempt in ms (default 1000). */
  baseDelayMs?: number;
  /** Maximum reconnect attempts (default 6). */
  maxAttempts?: number;
}

export interface RendezvousClientOptions {
  keypair: SignKeyPair;
  url: string;
  // [choice] C4: Exponential backoff 1s/2s/4s/8s/16s/32s, max 6 retries.
  // Chose exponential over linear/fixed because network recovery times are
  // bimodal (fast jitter vs. long outage) and exponential crowds well under
  // shared-throttle conditions.
  reconnect?: ReconnectOptions;
  /** Timeout waiting for register_ok after sending register (default 10s). */
  registerTimeoutMs?: number;
}

export interface LookupResponse {
  found: boolean;
  home?: string;
}

export interface InviteCreatePayload {
  code_hash: string;
  expires_at: string;
  // pubkey and peer_id are auto-filled by the client from its own identity
}

export interface InviteResultResponse {
  peer_id: string;
  pubkey: string;
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
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_ATTEMPTS = 6;

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
  private _baseDelayMs: number;
  private _maxAttempts: number;
  private _registerTimeoutMs: number;
  // [choice] 2d: setTimeout-based backoff timer (vs while-loop+await-sleep).
  // setTimeout integrates with disconnect() — we store the handle and clear
  // it on explicit disconnect to prevent in-flight reconnect from continuing.
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempt: number = 0;
  private _explicitDisconnect: boolean = false;
  private _registerResolver: {
    resolve: (msg: { server_id: string; federation_size: number }) => void;
    reject: (err: Error) => void;
  } | null = null;

  // [choice] C5: FIFO queue-wait — queue the second call until the first resolves.
  // Chose queue-wait over fail-fast because caller UX is simpler (no retry loop)
  // and queue depth is bounded by the caller. Per D2, at-most-one in-flight is enforced
  // on the wire; this queue is internal client-side serialization.
  // [choice] FIFO shape: chained promise (simpler than explicit queue — just
  // a single tail promise that each call chains onto).
  private _fifoQueue: Promise<void> = Promise.resolve();
  private _pendingRequest: {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    expectedType: string;
  } | null = null;

  constructor(options: RendezvousClientOptions) {
    super();
    this._keypair = options.keypair;
    this._url = options.url;
    this._peerId = getPeerId(options.keypair.publicKey);
    this._reconnectEnabled = options.reconnect?.enabled ?? false;
    this._baseDelayMs = options.reconnect?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this._maxAttempts = options.reconnect?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this._registerTimeoutMs = options.registerTimeoutMs ?? DEFAULT_REGISTER_TIMEOUT_MS;
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

    // Reset reconnect state for fresh explicit connection
    this._explicitDisconnect = false;
    this._reconnectAttempt = 0;

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
   *
   * If a reconnect attempt is in-flight (reconnecting state with pending
   * backoff timer), the timer is cancelled.
   */
  disconnect(): void {
    this._explicitDisconnect = true;

    // Cancel any pending reconnect backoff timer
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (this._ws) {
      this._ws.close(1000, 'Client disconnect');
      // Don't null _ws — let the close handler do it, so 'disconnect' fires
      // with the actual close code/reason.
    } else if (this._state === 'reconnecting') {
      // No active WS (between backoff attempts). Transition directly.
      this._transition('disconnected');
      this.emit('disconnect', 1000, 'Client disconnect');
    }
  }

  // ── Request methods ────────────────────────────────────────────────────

  /**
   * Look up a peer by peer_id. Returns { found, home? }.
   * @throws {RendezvousError} with code 'not_ready' if client is not in 'ready' state.
   */
  async lookup(peerId: string): Promise<LookupResponse> {
    this._guardReady();
    const result = await this._sendRequest<Record<string, unknown>>(
      'lookup',
      { peer_id: peerId },
      'lookup_result',
    );
    return {
      found: result.found as boolean,
      home: result.home as string | undefined,
    };
  }

  /**
   * Create an invite. The client auto-fills pubkey and peer_id from its own identity.
   * @throws {RendezvousError} with code from server error on failure.
   */
  async inviteCreate(payload: InviteCreatePayload): Promise<InviteResultResponse> {
    this._guardReady();
    const fullPayload: Record<string, unknown> = {
      code_hash: payload.code_hash,
      pubkey: Buffer.from(this._keypair.publicKey).toString('base64'),
      peer_id: this._peerId,
      expires_at: payload.expires_at,
    };
    const result = await this._sendRequest<Record<string, unknown>>(
      'invite_create',
      fullPayload,
      'invite_result',
    );
    if (result.error) {
      throw new RendezvousError(result.error as string, `invite_create failed: ${result.error}`);
    }
    return {
      peer_id: result.peer_id as string,
      pubkey: result.pubkey as string,
    };
  }

  /**
   * Redeem an invite by code_hash.
   * @throws {RendezvousError} with code from server error on failure.
   */
  async inviteRedeem(codeHash: string): Promise<InviteResultResponse> {
    this._guardReady();
    const result = await this._sendRequest<Record<string, unknown>>(
      'invite_redeem',
      { code_hash: codeHash },
      'invite_result',
    );
    if (result.error) {
      throw new RendezvousError(result.error as string, `invite_redeem failed: ${result.error}`);
    }
    return {
      peer_id: result.peer_id as string,
      pubkey: result.pubkey as string,
    };
  }

  // ── Fire-and-forget methods ────────────────────────────────────────────

  /**
   * Send an encrypted signaling message to a peer. Fire-and-forget per S1.
   * [choice] fire-and-forget returns void synchronously — calling-code awaits
   * is misleading since the server sends no ack.
   * Bypasses FIFO: can be called while a request is in-flight.
   * @throws {RendezvousError} with code 'not_ready' if state !== 'ready'.
   */
  signal(toPeer: string, payload: string): void {
    this._guardReady();
    // Assumes crypto is initialized (guaranteed: _guardReady ensures connect() completed)
    const msgPayload = { to: toPeer, payload };
    const ts = new Date().toISOString();
    const sig = this._sign(msgPayload, ts);
    this._ws!.send(JSON.stringify({ type: 'signal', payload: msgPayload, sig, ts }));
  }

  /**
   * Send a sealed-box notification to a peer. Fire-and-forget per S1.
   * [choice] fire-and-forget returns void synchronously — server sends no ack.
   * Server queues for offline targets per sealed_box contract; client doesn't
   * know or care about offline delivery.
   * Bypasses FIFO: can be called while a request is in-flight.
   * @throws {RendezvousError} with code 'not_ready' if state !== 'ready'.
   */
  notify(toPeer: string, sealedBox: string): void {
    this._guardReady();
    // Assumes crypto is initialized (guaranteed: _guardReady ensures connect() completed)
    const msgPayload = { to: toPeer, sealed_box: sealedBox };
    const ts = new Date().toISOString();
    const sig = this._sign(msgPayload, ts);
    this._ws!.send(JSON.stringify({ type: 'notify', payload: msgPayload, sig, ts }));
  }

  // ── Internal helpers ───────────────────────────────────────────────────

  /**
   * Send a signed request frame and await the matching response.
   * Enforces FIFO serialization — at most one in-flight on the wire.
   */
  private async _sendRequest<T>(
    type: string,
    payload: Record<string, unknown>,
    expectedResponseType: string,
  ): Promise<T> {
    // FIFO: wait for previous request to complete
    const prev = this._fifoQueue;
    let release: () => void = () => {};
    this._fifoQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await prev;

    await initCrypto();
    const ws = this._ws!;
    const ts = new Date().toISOString();
    const sig = this._sign(payload, ts);

    return new Promise<T>((resolve, reject) => {
      // [choice] release() is called inside resolve/reject wrappers, not in a
      // finally block, because the FIFO slot must be held until the response
      // arrives — not until the frame is sent.
      this._pendingRequest = {
        resolve: (value: unknown) => {
          release();
          resolve(value as T);
        },
        reject: (err: Error) => {
          release();
          reject(err);
        },
        expectedType: expectedResponseType,
      };

      try {
        ws.send(JSON.stringify({ type, payload, sig, ts }));
      } catch (err) {
        this._pendingRequest = null;
        release();
        reject(new RendezvousError('send_failed', `Failed to send ${type} request`, err));
      }
    });
  }

  /**
   * [choice] request-before-connect: reject synchronously with code 'not_ready'.
   * Chose 'not_ready' over reusing 'register_failed' because the semantic distinction
   * matters — not_ready means "call connect() first", while register_failed means
   * "the connect attempt itself failed". Different recovery paths.
   */
  private _guardReady(): void {
    if (this._state !== 'ready') {
      throw new RendezvousError(
        'not_ready',
        `Cannot send request when state is "${this._state}". Must be "ready".`,
      );
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

      // Handle register_ok during connect flow
      if (msg.type === 'register_ok' && this._registerResolver) {
        this._registerResolver.resolve({
          server_id: msg.server_id as string,
          federation_size: msg.federation_size as number,
        });
        return;
      }

      // Handle error envelope (server can send {type: "error", ...} mid-FIFO)
      if (msg.type === 'error' && this._pendingRequest) {
        const pending = this._pendingRequest;
        this._pendingRequest = null;
        pending.reject(
          new RendezvousError(
            (msg.code as string) || 'server_error',
            (msg.message as string) || 'Server error',
          ),
        );
        return;
      }

      // Push message dispatch for signal_in and notify_in.
      // [choice] Unified dispatch: handlers emit regardless of FSM state.
      // Q-N3: notify_in may arrive before register_ok during 'registering' state.
      // Push messages run BEFORE the _pendingRequest FIFO check, so they
      // never get consumed by the FIFO-matching logic (they won't match
      // the expectedType of any in-flight request).
      if (msg.type === 'signal_in') {
        // [choice] signal_in in non-ready state: tolerate-and-emit.
        // Forward-compat permissive — emit the event even if the message
        // was unexpected by protocol.
        this.emit('signal_in', msg.from as string, msg.payload as string);
        return;
      }
      if (msg.type === 'notify_in') {
        this.emit('notify_in', msg.sealed_box as string, msg.queued_at as string);
        return;
      }

      // Dispatch to pending request if type matches expected
      if (this._pendingRequest) {
        if (msg.type === this._pendingRequest.expectedType) {
          const pending = this._pendingRequest;
          this._pendingRequest = null;
          pending.resolve(msg);
          return;
        }
        // Unexpected type while waiting — tolerate (forward-compat)
        return;
      }
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

      // Reject pending request if in-flight
      // [choice] 2d Q-N4: pending invite_create (expectedType 'invite_result') is
      // rejected here with 'connection_closed'. No special drop-list code — the
      // natural behavior of "reject and clear" means the client does NOT auto-resend
      // after reconnect. The caller must re-issue.
      if (this._pendingRequest) {
        const pending = this._pendingRequest;
        this._pendingRequest = null;
        pending.reject(
          new RendezvousError(
            'connection_closed',
            `Connection closed while waiting for response: ${code} ${reason.toString()}`,
          ),
        );
      }

      const wasDisconnected = this._state === 'disconnected';
      if (wasDisconnected) {
        return;
      }

      this.emit('disconnect', code, reason.toString());

      // [choice] C4 + D3: reconnect on involuntary close from ready/reconnecting,
      // or during an active reconnect cycle (connecting/registering with _reconnectAttempt > 0).
      // Only if reconnect is enabled, not an explicit client disconnect, and
      // we were in a state that had (or was recovering) an established session.
      if (
        this._reconnectEnabled &&
        !this._explicitDisconnect &&
        (this._state === 'ready' ||
          this._state === 'reconnecting' ||
          (this._reconnectAttempt > 0 &&
            (this._state === 'connecting' || this._state === 'registering')))
      ) {
        this._transition('reconnecting');
        this._scheduleReconnect();
        return;
      }

      this._transition('disconnected');
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

  // ── Reconnect (D3 + C4) ────────────────────────────────────────────────

  /**
   * Schedule the next reconnect attempt with exponential backoff.
   *
   * Backoff per C4: baseDelay * 2^(attempt-1), i.e. 1s/2s/4s/8s/16s/32s.
   * [choice] 2d: setTimeout-based (vs while-loop+await-sleep). Stores handle
   * for disconnect() to cancel, preventing in-flight reconnect on explicit close.
   */
  private _scheduleReconnect(): void {
    this._reconnectAttempt++;

    if (this._reconnectAttempt > this._maxAttempts) {
      this._reconnectTimer = null;
      this.emit('reconnect_failed');
      this._transition('disconnected');
      return;
    }

    const delayMs = this._baseDelayMs * 2 ** (this._reconnectAttempt - 1);
    this.emit('reconnect', this._reconnectAttempt, delayMs);

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._doReconnect();
    }, delayMs);
  }

  /**
   * Attempt one reconnect cycle: open new WS, register from scratch per D3.
   * D3 (reconnect-requires-reregister) mandates fresh register on every
   * reconnect — no session resume, no token, no implicit identity binding.
   *
   * On failure (register timeout, WS close, etc.), the close handler is the
   * sole driver of the next attempt — this method catches errors to prevent
   * unhandled rejections but does NOT schedule the next attempt itself.
   */
  private async _doReconnect(): Promise<void> {
    this._transition('connecting');

    const ws = new WebSocket(this._url);
    this._ws = ws;

    try {
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
              `Failed to open WebSocket to ${this._url} (reconnect attempt ${this._reconnectAttempt})`,
              (err as ErrorEvent).message,
            ),
          );
        };
        ws.once('open', onOpen);
        ws.once('error', onError);
      });

      this._setupLifecycle(ws);
      this._transition('registering');
      await this._register();
      // _register transitions to 'ready' on success
    } catch (err) {
      // If the close handler already cleaned up (ws closed by server), _ws
      // will not equal `ws`. If _ws still equals `ws`, the failure was
      // caused by timeout or a WS error that didn't close — force-close
      // so the close handler runs cleanup + schedules next attempt.
      if (this._ws === ws) {
        this._ws.close(1000, 'reconnect attempt failed');
      }
      // Don't re-throw — close handler drives the next attempt schedule.
    }
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
