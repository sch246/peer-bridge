// Centralized libsodium initialization.
// Every module that uses sodium MUST call initCrypto() before any sodium API.
// Synchronous functions MUST NOT call sodium APIs — this is enforced by
// code review, not by the type system.

import sodium from 'libsodium-wrappers';

let initPromise: Promise<void> | null = null;

export function initCrypto(): Promise<void> {
  if (!initPromise) {
    initPromise = sodium.ready;
  }
  return initPromise;
}
