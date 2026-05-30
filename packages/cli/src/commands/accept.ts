// commands/accept.ts — the `peer-bridge accept <code>` command.
//
// Redeems an invite code via the rendezvous server, prompts for fingerprint
// confirmation, and writes the peer to known_peers.toml on approval.
//
// @telos decisions/manual-fingerprint-confirmation-on-accept.md — accept MUST
//       prompt user; no --no-verify flag; no --skip-confirmation; trust =
//       "verified" only after user confirms.
// @telos decisions/invite-create-no-cross-reconnect-state.md — accept is
//       single-shot; if it fails, caller re-issues.
//
// CHOICE (brief #3b): placeholder URL strictness — exact-match same as invite.
// CHOICE (brief #3b): alias from prompt with default (first 12 chars of peer_id
//                     after "PB-"). Prompt matches DESIGN §3.6 spirit; CLI flag
//                     adds bloat for #3b, deferred.
// CHOICE (brief #3b): prompt injection via function arg (promptInput) for
//                     testability. Default uses node:readline/promises for
//                     real stdin. Tests inject a mock that returns 'y' or 'n'.
// CHOICE (brief #3b): client-factory dependency injection via optional
//                     `_clientFactory` parameter for testability.
// CHOICE (brief #3b): invite code format — lenient (non-empty + contains hyphen).
//                     Server rejects truly invalid codes; avoids hardcoding
//                     code-format assumptions.
// CHOICE (brief #3b): default Y for "Add to known peers? [Y/n]". Empty input = Y.
//                     Matches common CLI convention for safety-sensitive prompts.
// CHOICE (brief #3b): duplicate peer behavior — exit 1 with "already in known_peers
//                     as alias '<existing>'". No prompt-to-overwrite; user can
//                     edit known_peers.toml directly if needed.

import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { resolveDataDir, loadConfig } from '../config.js';
import { loadIdentity } from '../identity-storage.js';
import {
  addPeerFromInvite,
  verifyPeerTrust,
  RendezvousClient,
  RendezvousError,
  loadKnownPeers,
  saveKnownPeers,
  findPeer,
} from '@peer-bridge/core';
import type { InviteResultResponse, SignKeyPair } from '@peer-bridge/core';
import { hashInviteCode } from '@peer-bridge/protocol';

export interface AcceptArgs {
  code: string;
  dataDir?: string;
  rendezvousUrl?: string;
  /** Dependency injection for tests: returns user input for prompts. */
  promptInput?: () => Promise<string>;
  /** Dependency injection for tests: factory that returns a connect()-able client. */
  _clientFactory?: (opts: { url: string; keypair: SignKeyPair }) => Promise<{
    connect(): Promise<void>;
    inviteRedeem(codeHash: string): Promise<InviteResultResponse>;
    disconnect(): void;
  }>;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** The placeholder URL written by `peer-bridge init` — exact-match check. */
const PLACEHOLDER_URL = 'wss://rdv.example.com';

async function defaultClientFactory(opts: { url: string; keypair: SignKeyPair }) {
  return new RendezvousClient({ url: opts.url, keypair: opts.keypair });
}

/**
 * Create a real readline prompt that reads from stdin.
 * Returns the trimmed input string (empty string if user just hits Enter).
 */
function createReadlinePrompt(): () => Promise<string> {
  return async (): Promise<string> => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const answer = await rl.question('');
    rl.close();
    return answer.trim();
  };
}

/**
 * Default alias from peer_id: first 12 chars after "PB-".
 * e.g. "PB-7X4J2-M9KQR-ABCDE" → "7X4J2-M9KQR-"
 */
function defaultAlias(peerId: string): string {
  if (peerId.startsWith('PB-')) {
    return peerId.slice(3, 3 + 12);
  }
  // Fallback: first 12 chars of whatever was given
  return peerId.slice(0, 12);
}

/**
 * Run the `accept` command. Does NOT call process.exit — caller maps result.
 */
export async function runAccept(args: AcceptArgs): Promise<CliResult> {
  // 1. Resolve data_dir, load identity
  const dataDir = resolveDataDir({ override: args.dataDir });
  const identity = await loadIdentity(dataDir);
  if (!identity) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'No identity. Run `peer-bridge init` first.\n',
    };
  }

  // 2. Load config, take rendezvous URL
  const config = await loadConfig(dataDir);
  const url = args.rendezvousUrl ?? config.rendezvous.url;

  // 3. Validate not the placeholder
  if (url === PLACEHOLDER_URL) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Rendezvous URL is the placeholder "wss://rdv.example.com". Edit ${dataDir}/config.toml to set your real rendezvous server URL.\n`,
    };
  }

  // 4. Validate code: lenient — non-empty, contains hyphen
  if (!args.code || !args.code.includes('-')) {
    return {
      exitCode: 64,
      stdout: '',
      stderr:
        `Error: '${args.code || ''}' is not a valid invite code.\n` +
        'Usage: peer-bridge accept <invite-code>\n',
    };
  }

  // 5. Compute code_hash
  const codeHash = hashInviteCode(args.code);

  // 6. Connect to rendezvous, redeem invite
  const factory = args._clientFactory ?? defaultClientFactory;
  let client;
  try {
    client = await factory({ url, keypair: identity.keyPair });
  } catch (err: unknown) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Failed to create rendezvous client: ${(err as Error).message}\n`,
    };
  }

  let inviteResult: InviteResultResponse;
  try {
    await client.connect();
    inviteResult = await client.inviteRedeem(codeHash);
  } catch (err: unknown) {
    if (err instanceof RendezvousError) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `Invite code not found, expired, or already used. (${err.code})\n`,
      };
    }
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Failed to redeem invite: ${(err as Error).message}\n`,
    };
  } finally {
    client.disconnect();
  }

  // 7. Prompt for fingerprint confirmation
  const prompt = args.promptInput ?? createReadlinePrompt();

  process.stdout.write(
    `Found peer.\n` + `Fingerprint: ${inviteResult.peer_id}\n` + `Add to known peers? [Y/n] `,
  );
  const confirmInput = await prompt();

  if (confirmInput === 'n' || confirmInput === 'N') {
    return {
      exitCode: 0,
      stdout: 'Cancelled. Peer NOT added.\n',
      stderr: '',
    };
  }
  // Empty, 'y', 'Y', or anything else → proceed (default Y)

  // 8. Prompt for alias
  const aliasDefault = defaultAlias(inviteResult.peer_id);
  process.stdout.write(`Alias for this peer (default: ${aliasDefault}): `);
  const aliasInput = await prompt();
  const alias = aliasInput || aliasDefault;

  // 9. Load known_peers, check duplicate
  const knownPeersPath = path.join(dataDir, 'known_peers.toml');
  const peers = loadKnownPeers(knownPeersPath);
  const existing = findPeer(peers, inviteResult.peer_id);
  if (existing) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `Peer already in known_peers as alias '${existing.alias}'.\n`,
    };
  }

  // 10. Add peer with trust = "verified" (manual confirmation)
  let updated = addPeerFromInvite(peers, inviteResult.peer_id, alias, url);
  updated = verifyPeerTrust(updated, inviteResult.peer_id);

  // 11. Save
  saveKnownPeers(knownPeersPath, updated);

  return {
    exitCode: 0,
    stdout: `Added peer '${alias}' to known_peers.\n`,
    stderr: '',
  };
}
