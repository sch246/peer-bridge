// commands/init.ts — the `peer-bridge init` command.
//
// Sets up identity keypair + config.toml in the data directory.
//
// CHOICE (brief #3a): returns {exitCode, stdout, stderr} for testability.
//                     The bin entry (index.ts) maps this to process.exit/write.
// CHOICE (brief #3a): exitCode 1 for "already exists" (not 64 — 64 is usage errors).
// CHOICE (brief #3a): mkdir -p is silent (standard init UX).
// CHOICE (brief #3a): config.toml placeholder URL (wss://rdv.example.com) with a
//                     comment instructing user to edit. Failing fast on placeholder
//                     when used by invite/accept is brief #3b's responsibility.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { resolveDataDir, defaultConfig, writeConfig } from '../config.js';
import { loadIdentity, saveIdentity } from '../identity-storage.js';
import { generateKeyPair, getPeerId } from '@peer-bridge/core';

export interface InitArgs {
  dataDir?: string;
  force?: boolean;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the `init` command. Does NOT call process.exit — caller maps result.
 */
export async function runInit(args: InitArgs = {}): Promise<CliResult> {
  let dataDir: string;
  try {
    dataDir = resolveDataDir({ override: args.dataDir });

    // mkdir -p (silent — standard init UX)
    await fs.mkdir(dataDir, { recursive: true });
  } catch (err: unknown) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Failed to create data directory: ${(err as Error).message}\n`,
    };
  }

  // Check for existing identity
  const existing = await loadIdentity(dataDir);
  if (existing && !args.force) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Identity already exists at ${path.join(dataDir, 'identity.key')}. Use --force to overwrite.\n`,
    };
  }

  // Generate identity
  let keyPair;
  try {
    keyPair = await generateKeyPair();
    await saveIdentity(dataDir, keyPair);
  } catch (err: unknown) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Failed to save identity: ${(err as Error).message}\n`,
    };
  }

  // Write config (don't overwrite existing config unless force)
  const configPath = path.join(dataDir, 'config.toml');
  let configExists = false;
  try {
    await fs.access(configPath);
    configExists = true;
  } catch {
    // doesn't exist — that's fine
  }

  if (!configExists || args.force) {
    try {
      const cfg = defaultConfig(dataDir);
      await writeConfig(dataDir, cfg);
    } catch (err: unknown) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: `Failed to write config: ${(err as Error).message}\n`,
      };
    }
  }

  const peerId = getPeerId(keyPair.publicKey);

  return {
    exitCode: 0,
    stdout:
      `Identity created at ${dataDir}\n` +
      `Peer ID: ${peerId}\n` +
      '\n' +
      'Run `peer-bridge invite` to share an invite code.\n',
    stderr: '',
  };
}
