// Peer ID encoding: Ed25519 public key → base32 + Luhn mod 32 checksum → formatted ID
//
// Format: PB-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXX
//         8 groups of 6 chars, final group of 5 chars = 53 base32 chars
//
// Spec: protocol.md §7

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE32_DECODE: Record<string, number> = {};
for (let i = 0; i < BASE32_ALPHABET.length; i++) {
  BASE32_DECODE[BASE32_ALPHABET[i]] = i;
}

const PEER_ID_PREFIX = 'PB-';
const GROUP_SIZE = 6;
/**
 * Encode raw Ed25519 public key (32 bytes) to base32 string (52 chars, no checksum).
 */
export function encodeBase32(bytes: Uint8Array): string {
  let result = '';
  let bits = 0;
  let value = 0;

  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      const index = (value >>> (bits - 5)) & 0x1f;
      result += BASE32_ALPHABET[index];
      bits -= 5;
    }
  }

  // Flush remaining bits
  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
}

/**
 * Decode base32 string (without checksum) back to bytes.
 */
export function decodeBase32(str: string): Uint8Array {
  const upper = str.toUpperCase();
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (let i = 0; i < upper.length; i++) {
    const char = upper[i];
    if (char === '=' || char === '-') continue;
    const v = BASE32_DECODE[char];
    if (v === undefined) {
      throw new Error(`Invalid base32 character: '${char}'`);
    }
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Compute Luhn mod 32 checksum for a base32 string.
 * Returns the checksum character.
 */
export function luhnMod32Checksum(base32: string): string {
  let factor = 2;
  let sum = 0;

  for (let i = base32.length - 1; i >= 0; i--) {
    const codePoint = BASE32_DECODE[base32[i]];
    if (codePoint === undefined) {
      throw new Error(`Invalid base32 character in checksum input: '${base32[i]}'`);
    }
    let addend = factor * codePoint;
    factor = factor === 2 ? 1 : 2;
    addend = Math.floor(addend / 32) + (addend % 32);
    sum += addend;
  }

  const remainder = sum % 32;
  const checksumValue = (32 - remainder) % 32;
  return BASE32_ALPHABET[checksumValue];
}

/**
 * Verify a base32 string against its final Luhn mod 32 checksum character.
 * The full string (52 chars base32 + 1 char checksum) is checked.
 */
export function verifyLuhnMod32(full: string): boolean {
  if (full.length !== 53) return false;
  const base32 = full.slice(0, 52);
  const checksum = full[52];
  return luhnMod32Checksum(base32) === checksum;
}

/**
 * Encode an Ed25519 public key (32 bytes) to a formatted Peer ID.
 */
export function encodePeerId(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`Public key must be 32 bytes, got ${publicKey.length}`);
  }

  const base32 = encodeBase32(publicKey);
  if (base32.length !== 52) {
    throw new Error(`Expected 52 base32 chars, got ${base32.length}`);
  }

  const checksum = luhnMod32Checksum(base32);
  const full = base32 + checksum;

  // Group into 8×6 + 1×5
  const groups: string[] = [];
  for (let i = 0; i < 8; i++) {
    groups.push(full.slice(i * GROUP_SIZE, (i + 1) * GROUP_SIZE));
  }
  groups.push(full.slice(8 * GROUP_SIZE)); // final 5

  return PEER_ID_PREFIX + groups.join('-');
}

/**
 * Decode a formatted Peer ID back to raw bytes (32 bytes public key).
 */
export function decodePeerId(peerId: string): Uint8Array {
  // Strip prefix and separators
  let stripped = peerId;
  if (stripped.startsWith(PEER_ID_PREFIX)) {
    stripped = stripped.slice(PEER_ID_PREFIX.length);
  }
  stripped = stripped.replace(/-/g, '').toUpperCase();

  if (stripped.length !== 53) {
    throw new Error(
      `Invalid peer ID: expected 53 base32 chars after stripping, got ${stripped.length}`,
    );
  }

  // Verify checksum
  if (!verifyLuhnMod32(stripped)) {
    throw new Error('Invalid peer ID: Luhn mod 32 checksum mismatch');
  }

  // Decode first 52 chars (drop checksum)
  return decodeBase32(stripped.slice(0, 52));
}
