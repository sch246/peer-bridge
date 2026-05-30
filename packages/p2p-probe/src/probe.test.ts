// P2P probe test — validates node-datachannel connectivity in-process.
// Run: node --import tsx --test src/probe.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runProbe } from './probe.js';

describe('p2p-probe', () => {
  it(
    'two PeerConnections exchange a DataChannel message in-process',
    { timeout: 15_000 },
    async () => {
      const result = await runProbe();
      assert.strictEqual(result.message, 'hello from alice');
      assert.ok(result.handshakeMs < 5000, `handshake took ${result.handshakeMs}ms (limit 5000ms)`);
      console.log(`  ✓ handshakeMs = ${result.handshakeMs}`);
    },
  );
});
