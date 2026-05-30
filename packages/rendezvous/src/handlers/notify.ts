// Notify handler — offline notification queue.
// C→S { type: "notify", payload: { to, sealed_box } }
// S→C { type: "notify_in", sealed_box, queued_at } (to target, immediately or on reconnect)
//
// If target is online: forward as notify_in immediately.
// If target is offline: queue in offline_notifications, deliver on next register.
//
// Server NEVER decrypts the sealed_box — it only stores and forwards.
//
// @telos facts/nacl-sealed-box-properties.md
// @telos facts/signaling-message-fields.md
// @telos decisions/sealed-box-for-offline-notify.md

import type { ServerState, OfflineNotification } from '../state.js';

export interface NotifyPayload {
  to: string;
  sealed_box: string;
}

export function handleNotify(
  state: ServerState,
  payload: NotifyPayload,
  maxOfflineNotifySize: number,
): void {
  if (!payload.to || typeof payload.to !== 'string') return;
  if (!payload.sealed_box || typeof payload.sealed_box !== 'string') return;

  // Check sealed box size (base64-encoded bytes)
  const sealedBytes = Buffer.from(payload.sealed_box, 'base64');
  if (sealedBytes.length > maxOfflineNotifySize) {
    // Too large — drop
    return;
  }

  const now = new Date().toISOString();

  const target = state.peer_registrations.get(payload.to);
  if (target) {
    // Target is online — deliver immediately
    const notifyIn = {
      type: 'notify_in',
      sealed_box: payload.sealed_box,
      queued_at: now,
    };
    try {
      target.ws.send(JSON.stringify(notifyIn));
    } catch {
      // Socket write failed — queue for later
      queueNotification(state, payload.to, payload.sealed_box);
    }
    return;
  }

  // Target is offline — queue
  queueNotification(state, payload.to, payload.sealed_box);
}

function queueNotification(state: ServerState, peerId: string, sealedBox: string): void {
  const entry: OfflineNotification = {
    sealed_box: sealedBox,
    queued_at: new Date().toISOString(),
  };

  const existing = state.offline_notifications.get(peerId) ?? [];
  existing.push(entry);
  state.offline_notifications.set(peerId, existing);
}
