// commands/invite.ts — the `peer-bridge invite` command.
//
// Creates an invite code, registers it with the rendezvous server, and prints
// the code to stdout.
//
// CHOICE (brief #3b): placeholder URL strictness — exact match against the
//                     documented placeholder `wss://rdv.example.com`. No full
//                     URL validation; users may use `ws://localhost:N` for
//                     local testing and should not be blocked by scheme checks.
// CHOICE (brief #3b): client-factory dependency injection via optional
//                     `_clientFactory` parameter for testability. Production
//                     code uses the real RendezvousClient as default.
//                     Tests inject a mock.
// CHOICE (brief #3b): invite code format validation — lenient. No regex or
//                     structure check; server rejects invalid codes. This
//                     avoids hardcoding code-format assumptions that the
//                     protocol may evolve.

import { resolveDataDir, loadConfig } from '../config.js';
import { loadIdentity } from '../identity-storage.js';
import {
  createInvite,
  buildInviteCreatePayload,
  RendezvousClient,
  RendezvousError,
} from '@peer-bridge/core';
import type {
  InviteCreatePayload,
  InviteResultResponse,
  SignKeyPair,
} from '@peer-bridge/core';

export interface InviteArgs {
  dataDir?: string;
  rendezvousUrl?: string;
  /** Dependency injection for tests: factory that returns a connect()-able client. */
  _clientFactory?: (opts: { url: string; keypair: SignKeyPair }) => Promise<{
    connect(): Promise<void>;
    inviteCreate(payload: InviteCreatePayload): Promise<InviteResultResponse>;
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
 * Run the `invite` command. Does NOT call process.exit — caller maps result.
 */
export async function runInvite(args: InviteArgs = {}): Promise<CliResult> {
  // 1. Resolve data_dir, load identity
  const dataDir = resolveDataDir({ override: args.dataDir });
  const identity = await loadIdentity(dataDir);
  if (!identity) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: "No identity. Run `peer-bridge init` first.\n",
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

  // 4. Generate invite
  const invite = createInvite(identity.peerId, identity.keyPair.publicKey);
  const payload = buildInviteCreatePayload(invite);

  // 5. Connect to rendezvous, create invite
  const factory = args._clientFactory ?? defaultClientFactory;
  let client;
  try {
    client = await factory({ url, keypair: identity.keyPair });
  } catch (err: unknown) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Failed to create rendezvous client: ${(err as Error).message}\n`,
    };
  }

  try {
    await client.connect();
    await client.inviteCreate(payload);
  } catch (err: unknown) {
    if (err instanceof RendezvousError) {
      return {
        exitCode: 2,
        stdout: '',
        stderr: `Failed to register invite: ${invite.code} (${err.code})\n`,
      };
    }
    return {
      exitCode: 2,
      stdout: '',
      stderr: `Failed to register invite: ${(err as Error).message}\n`,
    };
  } finally {
    client.disconnect();
  }

  // 6. Print invite code
  return {
    exitCode: 0,
    stdout: `Invite code: ${invite.code}\n(expires in 10 min, single use)\n`,
    stderr: '',
  };
}
