// sdp-fingerprint — extract DTLS SHA-256 fingerprint from SDP.
//
// Phase 3: used by rendezvous-relay for envelope signing and verification.

/**
 * Extract the DTLS SHA-256 fingerprint from an SDP string.
 *
 * Parses the first `a=fingerprint:sha-256 XX:XX:...:XX` line (case-insensitive
 * on "sha-256"), strips colons, hex-decodes 32 bytes, and returns a Uint8Array.
 *
 * @throws {Error} if no `a=fingerprint:sha-256` line is found
 * @throws {Error} if the hex string is not exactly 64 characters (32 bytes)
 */
export function extractSDPFingerprint(sdp: string): Uint8Array {
  const lines = sdp.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('a=fingerprint:')) continue;

    const afterPrefix = trimmed.slice('a=fingerprint:'.length);
    const spaceIdx = afterPrefix.indexOf(' ');
    if (spaceIdx === -1) continue;

    const algo = afterPrefix.slice(0, spaceIdx).toLowerCase();
    if (algo !== 'sha-256') continue;

    const hexColons = afterPrefix.slice(spaceIdx + 1).trim();
    const hexPairs = hexColons.split(':');
    const hex = hexPairs.join('');

    if (hex.length !== 64) {
      throw new Error('SDP fingerprint not 32 bytes');
    }

    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  throw new Error('SDP missing a=fingerprint:sha-256 line');
}
