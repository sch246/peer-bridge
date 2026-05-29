// Known peers management: read/write known_peers.toml
// Format:
//   [[peer]]
//   alias = "alice"
//   peer_id = "PB-..."
//   added_at = "2025-01-15T10:30:00Z"
//   trust = "verified"  # verified | tofu
//   home_rendezvous = "wss://rdv.example.com"

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/**
 * A single known peer entry.
 */
export interface KnownPeer {
  alias: string;
  peer_id: string;
  added_at: string;
  trust: 'verified' | 'tofu';
  home_rendezvous: string;
}

/**
 * Parse a known_peers.toml file content into structured entries.
 * Simple TOML parser for the [[peer]] array-of-tables format.
 */
export function parseKnownPeers(tomlContent: string): KnownPeer[] {
  const peers: KnownPeer[] = [];
  let current: Partial<KnownPeer> | null = null;

  for (const line of tomlContent.split('\n')) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    // Start of a new peer section
    if (trimmed === '[[peer]]') {
      if (current) {
        peers.push(validatePeer(current));
      }
      current = {};
      continue;
    }

    if (current === null) continue;

    // Key-value pairs
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Strip quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    switch (key) {
      case 'alias':
        current.alias = value;
        break;
      case 'peer_id':
        current.peer_id = value;
        break;
      case 'added_at':
        current.added_at = value;
        break;
      case 'trust':
        if (value !== 'verified' && value !== 'tofu') {
          throw new Error(`Invalid trust value: "${value}". Must be "verified" or "tofu".`);
        }
        current.trust = value;
        break;
      case 'home_rendezvous':
        current.home_rendezvous = value;
        break;
    }
  }

  if (current) {
    peers.push(validatePeer(current));
  }

  return peers;
}

function validatePeer(p: Partial<KnownPeer>): KnownPeer {
  if (!p.alias) throw new Error('Peer entry missing "alias"');
  if (!p.peer_id) throw new Error(`Peer "${p.alias}" missing "peer_id"`);
  if (!p.home_rendezvous) throw new Error(`Peer "${p.alias}" missing "home_rendezvous"`);
  return {
    alias: p.alias,
    peer_id: p.peer_id,
    added_at: p.added_at || new Date().toISOString(),
    trust: p.trust || 'tofu',
    home_rendezvous: p.home_rendezvous,
  };
}

/**
 * Serialize known peers to TOML format.
 */
export function serializeKnownPeers(peers: KnownPeer[]): string {
  const lines: string[] = [];
  for (const peer of peers) {
    lines.push('[[peer]]');
    lines.push(`alias = "${peer.alias}"`);
    lines.push(`peer_id = "${peer.peer_id}"`);
    lines.push(`added_at = "${peer.added_at}"`);
    lines.push(`trust = "${peer.trust}"`);
    lines.push(`home_rendezvous = "${peer.home_rendezvous}"`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Load known peers from a file.
 */
export function loadKnownPeers(path: string): KnownPeer[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf-8');
  return parseKnownPeers(content);
}

/**
 * Save known peers to a file.
 */
export function saveKnownPeers(path: string, peers: KnownPeer[]): void {
  const content = serializeKnownPeers(peers);
  writeFileSync(path, content, { encoding: 'utf-8', mode: 0o644 });
}

/**
 * Look up a peer by peer_id in the known peers list.
 */
export function findPeer(peers: KnownPeer[], peerId: string): KnownPeer | undefined {
  return peers.find((p) => p.peer_id === peerId);
}

/**
 * Check if a peer_id is trusted (verified) in the known peers list.
 */
export function isTrusted(peers: KnownPeer[], peerId: string): boolean {
  const peer = findPeer(peers, peerId);
  return peer !== undefined && peer.trust === 'verified';
}
