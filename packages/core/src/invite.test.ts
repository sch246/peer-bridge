// Runtime tests for invite code creation, payload building, and peer management.
// Covers the core-level invite module (wrapping protocol-level invite generation).
// Run with: node --import tsx --test src/invite.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';

import {
  createInvite,
  buildInviteCreatePayload,
  buildInviteRedeemPayload,
  addPeerFromInvite,
  verifyPeerTrust,
} from './invite.js';

import type { KnownPeer } from './known-peers.js';

// ── Helpers ──

/** Create a minimal known peer entry for test lists. */
function makePeer(overrides: Partial<KnownPeer> = {}): KnownPeer {
  return {
    alias: 'alice',
    peer_id: 'PB-ALICE',
    added_at: '2025-01-15T10:30:00Z',
    trust: 'tofu',
    home_rendezvous: 'wss://rdv.example.com',
    ...overrides,
  };
}

// ── createInvite ──

describe('createInvite', () => {
  it('returns a properly shaped InviteResult', () => {
    const pk = new Uint8Array(32).fill(0xab);
    const result = createInvite('PB-TEST', pk);

    assert.strictEqual(typeof result.code, 'string');
    assert.ok(result.code.length > 0);
    assert.strictEqual(typeof result.codeHash, 'string');
    assert.strictEqual(result.codeHash.length, 64); // SHA-256 hex
    assert.ok(result.expiresAt instanceof Date);
    assert.strictEqual(result.peerId, 'PB-TEST');
    assert.deepStrictEqual(result.publicKey, pk);
  });

  it('generates a code matching word-word-word-word-hexhex pattern', () => {
    const pk = new Uint8Array(32);
    const result = createInvite('PB-TEST', pk);

    const parts = result.code.split('-');
    assert.strictEqual(parts.length, 5, 'invite code should have 5 parts separated by dashes');
    // Last part is 4-char hex nonce
    assert.match(parts[4], /^[0-9a-f]{4}$/);
    // First 4 parts are lowercase words
    for (const word of parts.slice(0, 4)) {
      assert.match(word, /^[a-z]+$/);
    }
  });

  it('sets expiresAt approximately 10 minutes in the future', () => {
    const pk = new Uint8Array(32);
    const before = Date.now() + 10 * 60 * 1000;
    const result = createInvite('PB-TEST', pk);
    const after = Date.now() + 10 * 60 * 1000;

    const expiresMs = result.expiresAt.getTime();
    // Allow a few seconds of clock skew
    assert.ok(expiresMs >= before - 5000, 'expiresAt too early');
    assert.ok(expiresMs <= after + 5000, 'expiresAt too late');
  });

  it('preserves the peerId exactly', () => {
    const pk = new Uint8Array(32);
    const result = createInvite('PB-MYPEER-12345', pk);
    assert.strictEqual(result.peerId, 'PB-MYPEER-12345');
  });

  it('preserves the publicKey reference', () => {
    const pk = crypto.getRandomValues(new Uint8Array(32));
    const result = createInvite('PB-TEST', pk);
    // Same buffer — no copy needed (but verify bytes match)
    assert.deepStrictEqual(result.publicKey, pk);
  });

  it('generates different codes on each call', () => {
    const pk = new Uint8Array(32);
    const r1 = createInvite('PB-TEST', pk);
    const r2 = createInvite('PB-TEST', pk);
    assert.notStrictEqual(r1.code, r2.code);
    assert.notStrictEqual(r1.codeHash, r2.codeHash);
  });

  it('codeHash matches SHA-256 hex of the code', () => {
    const pk = new Uint8Array(32);
    const result = createInvite('PB-TEST', pk);
    const expected = createHash('sha256').update(result.code, 'utf-8').digest('hex');
    assert.strictEqual(result.codeHash, expected);
  });
});

// ── buildInviteCreatePayload ──

describe('buildInviteCreatePayload', () => {
  it('builds a payload with code_hash matching the invite', () => {
    const pk = new Uint8Array(32).fill(0x42);
    const invite = createInvite('PB-TEST', pk);
    const payload = buildInviteCreatePayload(invite);

    assert.strictEqual(payload.code_hash, invite.codeHash);
  });

  it('encodes pubkey as base64', () => {
    const pk = new Uint8Array(32).fill(0x42);
    const invite = createInvite('PB-TEST', pk);
    const payload = buildInviteCreatePayload(invite);

    const expectedB64 = Buffer.from(pk).toString('base64');
    assert.strictEqual(payload.pubkey, expectedB64);
  });

  it('preserves peer_id from the invite', () => {
    const pk = new Uint8Array(32);
    const invite = createInvite('PB-MYPEER-42', pk);
    const payload = buildInviteCreatePayload(invite);

    assert.strictEqual(payload.peer_id, 'PB-MYPEER-42');
  });

  it('formats expires_at as ISO string', () => {
    const pk = new Uint8Array(32);
    const invite = createInvite('PB-TEST', pk);
    const payload = buildInviteCreatePayload(invite);

    const iso = new Date(payload.expires_at).toISOString();
    assert.strictEqual(payload.expires_at, iso);
  });

  it('payload round-trip: invite → payload preserves all fields', () => {
    const pk = new Uint8Array(32).fill(0x7f);
    const invite = createInvite('PB-ROUNDTRIP', pk);
    const payload = buildInviteCreatePayload(invite);

    assert.strictEqual(payload.code_hash, invite.codeHash);
    assert.strictEqual(payload.pubkey, Buffer.from(invite.publicKey).toString('base64'));
    assert.strictEqual(payload.peer_id, invite.peerId);
    assert.strictEqual(new Date(payload.expires_at).getTime(), invite.expiresAt.getTime());
  });
});

// ── buildInviteRedeemPayload ──

describe('buildInviteRedeemPayload', () => {
  it('returns an object with a code_hash property', () => {
    const payload = buildInviteRedeemPayload('cobra-sapphire-lighthouse-tango-a1b2');
    assert.strictEqual(typeof payload.code_hash, 'string');
    assert.strictEqual(payload.code_hash.length, 64);
  });

  it('code_hash is hex-encoded SHA-256', () => {
    const payload = buildInviteRedeemPayload('test-code-1234-abcd');
    assert.match(payload.code_hash, /^[0-9a-f]{64}$/);
  });

  it('same code produces the same hash', () => {
    const code = 'aardvark-absurd-accrue-acme-00ff';
    const p1 = buildInviteRedeemPayload(code);
    const p2 = buildInviteRedeemPayload(code);
    assert.strictEqual(p1.code_hash, p2.code_hash);
  });

  it('different codes produce different hashes', () => {
    const p1 = buildInviteRedeemPayload('cobra-sapphire-lighthouse-tango-a1b2');
    const p2 = buildInviteRedeemPayload('zulu-woodlark-willow-wayside-ffff');
    assert.notStrictEqual(p1.code_hash, p2.code_hash);
  });

  it('code_hash matches SHA-256 of the code string', () => {
    const code = 'python-quadrant-quiver-quota-1234';
    const payload = buildInviteRedeemPayload(code);
    const expected = createHash('sha256').update(code, 'utf-8').digest('hex');
    assert.strictEqual(payload.code_hash, expected);
  });
});

// ── addPeerFromInvite ──

describe('addPeerFromInvite', () => {
  it('adds a new peer to an empty list', () => {
    const result = addPeerFromInvite([], 'PB-NEW', 'bob', 'wss://rdv.example.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].peer_id, 'PB-NEW');
  });

  it('sets correct fields on the added peer', () => {
    const result = addPeerFromInvite([], 'PB-NEW', 'bob', 'wss://rdv.example.com');
    const peer = result[0];

    assert.strictEqual(peer.alias, 'bob');
    assert.strictEqual(peer.peer_id, 'PB-NEW');
    assert.strictEqual(peer.home_rendezvous, 'wss://rdv.example.com');
    assert.strictEqual(peer.trust, 'tofu');
    assert.strictEqual(typeof peer.added_at, 'string');
    assert.ok(peer.added_at.length > 0);
  });

  it('returns a new array (does not mutate input)', () => {
    const existing: KnownPeer[] = [];
    const result = addPeerFromInvite(existing, 'PB-NEW', 'bob', 'wss://rdv.example.com');
    assert.notStrictEqual(result, existing);
    assert.strictEqual(existing.length, 0);
  });

  it('prevents adding duplicate peer_id', () => {
    const existing: KnownPeer[] = [makePeer({ peer_id: 'PB-EXISTING', alias: 'alice' })];
    const result = addPeerFromInvite(existing, 'PB-EXISTING', 'alice2', 'wss://other.example.com');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].alias, 'alice'); // original unchanged
  });

  it('appends new peer to existing list without removing others', () => {
    const existing: KnownPeer[] = [makePeer({ peer_id: 'PB-A', alias: 'a' })];
    const result = addPeerFromInvite(existing, 'PB-B', 'b', 'wss://rdv.example.com');

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].peer_id, 'PB-A');
    assert.strictEqual(result[1].peer_id, 'PB-B');
  });

  it('duplicate check matches exact peer_id', () => {
    const existing: KnownPeer[] = [makePeer({ peer_id: 'PB-SIMILAR', alias: 'a' })];
    // Different peer_id, should still add
    const result = addPeerFromInvite(existing, 'PB-SIMILAR2', 'b', 'wss://rdv.example.com');
    assert.strictEqual(result.length, 2);
  });
});

// ── verifyPeerTrust ──

describe('verifyPeerTrust', () => {
  it('upgrades a tofu peer to verified', () => {
    const peers: KnownPeer[] = [makePeer({ peer_id: 'PB-A', trust: 'tofu' })];
    const result = verifyPeerTrust(peers, 'PB-A');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].peer_id, 'PB-A');
    assert.strictEqual(result[0].trust, 'verified');
  });

  it('leaves already-verified peers unchanged', () => {
    const peers: KnownPeer[] = [makePeer({ peer_id: 'PB-A', trust: 'verified' })];
    const result = verifyPeerTrust(peers, 'PB-A');

    assert.strictEqual(result[0].trust, 'verified');
  });

  it('does not modify other peers in the list', () => {
    const peers: KnownPeer[] = [
      makePeer({ peer_id: 'PB-A', trust: 'tofu', alias: 'a' }),
      makePeer({ peer_id: 'PB-B', trust: 'tofu', alias: 'b' }),
    ];
    const result = verifyPeerTrust(peers, 'PB-A');

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].trust, 'verified');
    assert.strictEqual(result[0].alias, 'a');
    assert.strictEqual(result[1].trust, 'tofu'); // PB-B unchanged
    assert.strictEqual(result[1].alias, 'b');
  });

  it('returns a new array (immutable)', () => {
    const peers: KnownPeer[] = [makePeer({ peer_id: 'PB-A', trust: 'tofu' })];
    const result = verifyPeerTrust(peers, 'PB-A');

    assert.notStrictEqual(result, peers);
    // Original array unchanged
    assert.strictEqual(peers[0].trust, 'tofu');
  });

  it('non-existent peerId leaves list unchanged', () => {
    const peers: KnownPeer[] = [makePeer({ peer_id: 'PB-A', trust: 'tofu' })];
    const result = verifyPeerTrust(peers, 'PB-NONEXISTENT');

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].peer_id, 'PB-A');
    assert.strictEqual(result[0].trust, 'tofu');
  });

  it('handles empty peer list gracefully', () => {
    const result = verifyPeerTrust([], 'PB-ANY');
    assert.deepStrictEqual(result, []);
  });
});
