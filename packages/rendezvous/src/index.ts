#!/usr/bin/env node
// Rendezvous server CLI entry point.
// Usage: node dist/index.js --config server.toml
//
// @telos facts/rendezvous-server-config.md
// @telos facts/rendezvous-tech-stack.md

import { createServer } from './server.js';
import { loadConfig, DEFAULTS, type RendezvousConfig } from './config.js';
import { existsSync } from 'node:fs';

function parseArgs(): { configPath: string } {
  const args = process.argv.slice(2);
  let configPath = './server.toml';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--config' && i + 1 < args.length) {
      configPath = args[++i];
    }
  }

  return { configPath };
}

function getServerId(config: RendezvousConfig): string {
  // M2: server_id is derived from identity_key if configured,
  // otherwise a placeholder. The server_id is sent in register_ok
  // and doesn't need cryptographic significance in M2 single-server mode.
  if (config.server.identity_key) {
    // In M2, identity_key is a file path. The server doesn't load/sign
    // with it in M2 — this is a placeholder for M6 federation.
    return `ed25519:m2-${config.server.public_url.replace(/[^a-zA-Z0-9]/g, '-')}`;
  }
  return `ed25519:m2-server`;
}

async function main(): Promise<void> {
  const { configPath } = parseArgs();

  let config: RendezvousConfig;

  if (existsSync(configPath)) {
    config = loadConfig(configPath);
    console.log(`[rendezvous] Loaded config from ${configPath}`);
  } else {
    config = DEFAULTS;
    console.warn(
      `[rendezvous] Config file not found at ${configPath}, using built-in defaults (port ${
        config.server.listen.split(':')[1] ?? '9372'
      })`,
    );
  }

  const serverId = getServerId(config);
  const { app } = await createServer({ config, serverId });

  const [host, portStr] = config.server.listen.split(':');
  const port = parseInt(portStr, 10);

  await app.listen({ host, port });

  console.log(`[rendezvous] Listening on ${config.server.listen}`);
  console.log(`[rendezvous] Server ID: ${serverId}`);
  console.log(`[rendezvous] Health: http://${host}:${port}/health`);
}

main().catch((err) => {
  console.error('[rendezvous] Fatal error:', err);
  process.exit(1);
});
