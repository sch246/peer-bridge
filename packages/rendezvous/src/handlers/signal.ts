// Signal handler — forwards encrypted signaling data to target peer.
// C→S { type: "signal", payload: { to, payload } }
// S→C { type: "signal_in", from, payload } (to target)
//
// Fire-and-forget: no response to sender on success.
//
// [stuck-then-choice] Target peer not found: drop silently.
// The spec defines no error response shape for signal failures.
// DESIGN.md §5.1 and signaling-message-fields.md only define signal and signal_in.
// Defensible default: fire-and-forget semantics — sender retries on its own.
// Suggested telos: .telos/decisions/signal-dropped-if-peer-not-found.md
//
// @telos facts/signaling-message-fields.md

import type { ServerState } from '../state.js';

export interface SignalPayload {
  to: string;
  payload: string;
}

export function handleSignal(
  state: ServerState,
  payload: SignalPayload,
  fromPeerId: string,
): void {
  if (!payload.to || typeof payload.to !== 'string') return;

  const target = state.peer_registrations.get(payload.to);
  if (!target) {
    // [stuck-then-choice] Drop silently
    return;
  }

  const signalIn = {
    type: 'signal_in',
    from: fromPeerId,
    payload: payload.payload,
  };

  try {
    target.ws.send(JSON.stringify(signalIn));
  } catch {
    // Socket write failed — target may have disconnected. D1 handles eviction.
  }
}
