// Unit tests for known-peers: TOML parsing, serialization, file IO, find/trust.
// Run with: npx tsx --test packages/core/src/known-peers.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  mkdtempSync,
  existsSync,
  readFileSync,
  unlinkSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parseKnownPeers,
  serializeKnownPeers,
  loadKnownPeers,
  saveKnownPeers,
  findPeer,
  isTrusted,
  type KnownPeer,
} from './known-peers.js';

// Helper to generate a minimal valid TOML chunk for a single peer
function peerToml(p: Partial<Record<string, string>>): string {
  const alias = p.alias ?? 'alice';
  const peerId = p.peer_id ?? 'PB-DEYDCM-RTGQYT-ANJQGA';
  const rv = p.home_rendezvous ?? 'wss://rdv.example.com';
  let out =
    '[[peer]]\n' +
    `alias = "${alias}"\n` +
    `peer_id = "${peerId}"\n` +
    `home_rendezvous = "${rv}"\n`;
  if (p.trust) out += `trust = "${p.trust}"\n`;
  if (p.added_at) out += `added_at = "${p.added_at}"\n`;
  return out;
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'kp-test-'));
}

function cleanup(dir: string): void {
  // Best-effort cleanup
  try {
    for (const name of ['peers.toml', 'peers2.toml', 'peers3.toml']) {
      const p = join(dir, name);
      if (existsSync(p)) unlinkSync(p);
    }
    rmdirSync(dir);
  } catch {
    // ignore
  }
}

// ── parseKnownPeers tests ──

describe('parseKnownPeers', () => {
  it('returns empty array for empty input', () => {
    assert.deepStrictEqual(parseKnownPeers(''), []);
  });

  it('returns empty array for whitespace-only input', () => {
    assert.deepStrictEqual(parseKnownPeers('  \n\n  '), []);
  });

  it('returns empty array for comment-only input', () => {
    assert.deepStrictEqual(parseKnownPeers('# just a comment\n# another'), []);
  });

  it('parses a single peer with minimum required fields', () => {
    const input = peerToml({});
    const peers = parseKnownPeers(input);
    assert.strictEqual(peers.length, 1);
    assert.strictEqual(peers[0].alias, 'alice');
    assert.strictEqual(peers[0].peer_id, 'PB-DEYDCM-RTGQYT-ANJQGA');
    assert.strictEqual(peers[0].home_rendezvous, 'wss://rdv.example.com');
    assert.strictEqual(peers[0].trust, 'tofu'); // default
    assert.ok(typeof peers[0].added_at === 'string');
    assert.ok(peers[0].added_at.length > 0);
  });

  it('parses a peer with all fields present', () => {
    const input = peerToml({
      trust: 'verified',
      added_at: '2025-01-15T10:30:00Z',
    });
    const peers = parseKnownPeers(input);
    assert.strictEqual(peers.length, 1);
    assert.strictEqual(peers[0].trust, 'verified');
    assert.strictEqual(peers[0].added_at, '2025-01-15T10:30:00Z');
  });

  it('parses multiple peers', () => {
    const input =
      peerToml({ alias: 'alice', peer_id: 'PB-AAAA-BBBB-CCCC-DDDD' }) +
      '\n' +
      peerToml({ alias: 'bob', peer_id: 'PB-EEEE-FFFF-GGGG-HHHH' });
    const peers = parseKnownPeers(input);
    assert.strictEqual(peers.length, 2);
    assert.strictEqual(peers[0].alias, 'alice');
    assert.strictEqual(peers[1].alias, 'bob');
  });

  it('allows duplicate aliases (no uniqueness enforcement)', () => {
    const input =
      peerToml({ alias: 'alice', peer_id: 'PB-A' }) +
      '\n' +
      peerToml({ alias: 'alice', peer_id: 'PB-B' });
    const peers = parseKnownPeers(input);
    assert.strictEqual(peers.length, 2);
    assert.strictEqual(peers[0].alias, 'alice');
    assert.strictEqual(peers[1].alias, 'alice');
    assert.strictEqual(peers[0].peer_id, 'PB-A');
    assert.strictEqual(peers[1].peer_id, 'PB-B');
  });

  it('ignores comments and blank lines between peers', () => {
    const input =
      '# top comment\n' +
      '\n' +
      peerToml({ alias: 'alice' }) +
      '\n# between comment\n' +
      peerToml({ alias: 'bob' }) +
      '\n';
    const peers = parseKnownPeers(input);
    assert.strictEqual(peers.length, 2);
  });

  it('throws on missing alias', () => {
    const input = '[[peer]]\npeer_id = "PB-A"\nhome_rendezvous = "wss://x"';
    assert.throws(() => parseKnownPeers(input), /Peer entry missing "alias"/);
  });

  it('throws on missing peer_id', () => {
    const input = '[[peer]]\nalias = "alice"\nhome_rendezvous = "wss://x"';
    assert.throws(() => parseKnownPeers(input), /Peer "alice" missing "peer_id"/);
  });

  it('throws on missing home_rendezvous', () => {
    const input = '[[peer]]\nalias = "alice"\npeer_id = "PB-A"';
    assert.throws(() => parseKnownPeers(input), /Peer "alice" missing "home_rendezvous"/);
  });

  it('throws on invalid trust value', () => {
    const input = peerToml({ trust: 'untrusted' });
    assert.throws(() => parseKnownPeers(input), /Invalid trust value/);
  });

  it('accepts "tofu" as valid trust', () => {
    const input = peerToml({ trust: 'tofu' });
    const peers = parseKnownPeers(input);
    assert.strictEqual(peers[0].trust, 'tofu');
  });

  it('accepts "verified" as valid trust', () => {
    const input = peerToml({ trust: 'verified' });
    const peers = parseKnownPeers(input);
    assert.strictEqual(peers[0].trust, 'verified');
  });

  it('ignores lines without equals sign inside a peer block', () => {
    const input =
      '[[peer]]\nalias = "x"\npeer_id = "PB-X"\nhome_rendezvous = "wss://x"\nsome junk line\n';
    const peers = parseKnownPeers(input);
    assert.strictEqual(peers.length, 1);
    assert.strictEqual(peers[0].alias, 'x');
  });

  it('handles single-quoted values', () => {
    // The parser strips both kinds of quotes
    const input =
      "[[peer]]\nalias = 'carla'\npeer_id = 'PB-C'\nhome_rendezvous = 'wss://c.example.com'";
    const peers = parseKnownPeers(input);
    assert.strictEqual(peers[0].alias, 'carla');
    assert.strictEqual(peers[0].peer_id, 'PB-C');
  });
});

// ── serializeKnownPeers tests ──

describe('serializeKnownPeers', () => {
  it('serializes empty array to empty string', () => {
    assert.strictEqual(serializeKnownPeers([]), '');
  });

  it('produces output parseable by parseKnownPeers (round-trip)', () => {
    const original = parseKnownPeers(
      '[[peer]]\n' +
        'alias = "alice"\n' +
        'peer_id = "PB-DEYDCM-RTGQYT-ANJQGA"\n' +
        'added_at = "2025-01-15T10:30:00Z"\n' +
        'trust = "verified"\n' +
        'home_rendezvous = "wss://rdv.example.com"\n',
    );
    const serialized = serializeKnownPeers(original);
    const reparsed = parseKnownPeers(serialized);
    assert.strictEqual(reparsed.length, 1);
    assert.strictEqual(reparsed[0].alias, original[0].alias);
    assert.strictEqual(reparsed[0].peer_id, original[0].peer_id);
    assert.strictEqual(reparsed[0].added_at, original[0].added_at);
    assert.strictEqual(reparsed[0].trust, original[0].trust);
    assert.strictEqual(reparsed[0].home_rendezvous, original[0].home_rendezvous);
  });

  it('round-trip preserves multiple peers', () => {
    const original: KnownPeer[] = [
      {
        alias: 'alice',
        peer_id: 'PB-A',
        added_at: '2025-01-15T10:30:00Z',
        trust: 'verified',
        home_rendezvous: 'wss://a.example.com',
      },
      {
        alias: 'bob',
        peer_id: 'PB-B',
        added_at: '2025-01-16T12:00:00Z',
        trust: 'tofu',
        home_rendezvous: 'wss://b.example.com',
      },
    ];
    const serialized = serializeKnownPeers(original);
    const reparsed = parseKnownPeers(serialized);
    assert.strictEqual(reparsed.length, 2);
    assert.deepStrictEqual(reparsed[0], original[0]);
    assert.deepStrictEqual(reparsed[1], original[1]);
  });
});

// ── loadKnownPeers tests ──

describe('loadKnownPeers', () => {
  it('returns empty array when file does not exist', () => {
    const dir = tmpDir();
    const missing = join(dir, 'nonexistent.toml');
    try {
      const peers = loadKnownPeers(missing);
      assert.deepStrictEqual(peers, []);
    } finally {
      cleanup(dir);
    }
  });

  it('loads and parses a valid known_peers file', () => {
    const dir = tmpDir();
    const path = join(dir, 'peers.toml');
    try {
      const toml = peerToml({
        alias: 'alice',
        trust: 'verified',
        added_at: '2025-01-15T10:30:00Z',
      });
      writeFileSync(path, toml, 'utf-8');
      const peers = loadKnownPeers(path);
      assert.strictEqual(peers.length, 1);
      assert.strictEqual(peers[0].alias, 'alice');
      assert.strictEqual(peers[0].trust, 'verified');
    } finally {
      cleanup(dir);
    }
  });

  it('throws on malformed TOML (missing required field)', () => {
    const dir = tmpDir();
    const path = join(dir, 'peers2.toml');
    try {
      writeFileSync(path, '[[peer]]\nalias = "bob"', 'utf-8');
      assert.throws(() => loadKnownPeers(path), /missing "peer_id"/);
    } finally {
      cleanup(dir);
    }
  });

  it('returns empty array for empty file', () => {
    const dir = tmpDir();
    const path = join(dir, 'peers3.toml');
    try {
      writeFileSync(path, '', 'utf-8');
      assert.deepStrictEqual(loadKnownPeers(path), []);
    } finally {
      cleanup(dir);
    }
  });
});

// ── saveKnownPeers tests ──

describe('saveKnownPeers', () => {
  it('writes a file that can be loaded back (round-trip)', () => {
    const dir = tmpDir();
    const path = join(dir, 'peers.toml');
    try {
      const peers: KnownPeer[] = [
        {
          alias: 'alice',
          peer_id: 'PB-DEYDCM-RTGQYT-ANJQGA',
          added_at: '2025-01-15T10:30:00Z',
          trust: 'verified',
          home_rendezvous: 'wss://rdv.example.com',
        },
      ];
      saveKnownPeers(path, peers);

      assert.ok(existsSync(path));
      const loaded = loadKnownPeers(path);
      assert.strictEqual(loaded.length, 1);
      assert.strictEqual(loaded[0].alias, 'alice');
      assert.strictEqual(loaded[0].peer_id, 'PB-DEYDCM-RTGQYT-ANJQGA');
    } finally {
      cleanup(dir);
    }
  });

  it('saves multiple peers and loads them correctly', () => {
    const dir = tmpDir();
    const path = join(dir, 'peers2.toml');
    try {
      const peers: KnownPeer[] = [
        {
          alias: 'alice',
          peer_id: 'PB-AAAA-BBBB-CCCC-DDDD',
          added_at: '2025-01-15T10:30:00Z',
          trust: 'verified',
          home_rendezvous: 'wss://a.example.com',
        },
        {
          alias: 'bob',
          peer_id: 'PB-EEEE-FFFF-GGGG-HHHH',
          added_at: '2025-01-16T12:00:00Z',
          trust: 'tofu',
          home_rendezvous: 'wss://b.example.com',
        },
      ];
      saveKnownPeers(path, peers);
      const loaded = loadKnownPeers(path);
      assert.deepStrictEqual(loaded, peers);
    } finally {
      cleanup(dir);
    }
  });

  it('overwrites existing file', () => {
    const dir = tmpDir();
    const path = join(dir, 'peers3.toml');
    try {
      // Write initial peers
      saveKnownPeers(path, [
        {
          alias: 'alice',
          peer_id: 'PB-A',
          added_at: '2025-01-01T00:00:00Z',
          trust: 'verified',
          home_rendezvous: 'wss://a.example.com',
        },
      ]);

      // Overwrite with new peers
      saveKnownPeers(path, [
        {
          alias: 'bob',
          peer_id: 'PB-B',
          added_at: '2025-02-02T00:00:00Z',
          trust: 'tofu',
          home_rendezvous: 'wss://b.example.com',
        },
      ]);

      const loaded = loadKnownPeers(path);
      assert.strictEqual(loaded.length, 1);
      assert.strictEqual(loaded[0].alias, 'bob');
    } finally {
      cleanup(dir);
    }
  });

  it('saves empty peer list (empty file)', () => {
    const dir = tmpDir();
    const path = join(dir, 'peers4.toml');
    try {
      saveKnownPeers(path, []);
      assert.ok(existsSync(path));
      const content = readFileSync(path, 'utf-8');
      assert.strictEqual(content, '');
    } finally {
      cleanup(dir);
    }
  });
});

// ── findPeer tests ──

describe('findPeer', () => {
  const peers: KnownPeer[] = [
    {
      alias: 'alice',
      peer_id: 'PB-AAAA-BBBB-CCCC-DDDD',
      added_at: '2025-01-15T10:30:00Z',
      trust: 'verified',
      home_rendezvous: 'wss://a.example.com',
    },
    {
      alias: 'bob',
      peer_id: 'PB-EEEE-FFFF-GGGG-HHHH',
      added_at: '2025-01-16T12:00:00Z',
      trust: 'tofu',
      home_rendezvous: 'wss://b.example.com',
    },
  ];

  it('finds peer by exact peer_id', () => {
    const result = findPeer(peers, 'PB-EEEE-FFFF-GGGG-HHHH');
    assert.ok(result !== undefined);
    assert.strictEqual(result!.alias, 'bob');
  });

  it('returns undefined for missing peer_id', () => {
    const result = findPeer(peers, 'PB-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    assert.strictEqual(result, undefined);
  });

  it('returns undefined for empty peer list', () => {
    const result = findPeer([], 'PB-AAAA-BBBB-CCCC-DDDD');
    assert.strictEqual(result, undefined);
  });

  it('matches peer_id precisely (case sensitive)', () => {
    const result = findPeer(peers, 'pb-aaaa-bbbb-cccc-dddd');
    assert.strictEqual(result, undefined);
  });
});

// ── isTrusted tests ──

describe('isTrusted', () => {
  const peers: KnownPeer[] = [
    {
      alias: 'alice',
      peer_id: 'PB-VERIFIED-PEER',
      added_at: '2025-01-15T10:30:00Z',
      trust: 'verified',
      home_rendezvous: 'wss://a.example.com',
    },
    {
      alias: 'bob',
      peer_id: 'PB-TOFU-PEER',
      added_at: '2025-01-16T12:00:00Z',
      trust: 'tofu',
      home_rendezvous: 'wss://b.example.com',
    },
  ];

  it('returns true for verified peer', () => {
    assert.strictEqual(isTrusted(peers, 'PB-VERIFIED-PEER'), true);
  });

  it('returns false for tofu peer', () => {
    assert.strictEqual(isTrusted(peers, 'PB-TOFU-PEER'), false);
  });

  it('returns false for unknown peer_id', () => {
    assert.strictEqual(isTrusted(peers, 'PB-UNKNOWN-PEER'), false);
  });

  it('returns false for empty peer list', () => {
    assert.strictEqual(isTrusted([], 'PB-VERIFIED-PEER'), false);
  });
});
