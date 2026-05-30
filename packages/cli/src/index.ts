#!/usr/bin/env node
// index.ts — bin entry for the peer-bridge CLI.
//
// CHOICE (brief #3a): testability via return-object — runInit returns
//                     {exitCode, stdout, stderr} and this file maps to
//                     process.std{out,err}.write + process.exit.

import { parseArgs, USAGE } from './router.js';
import { runInit } from './commands/init.js';
import { runInvite } from './commands/invite.js';
import { runAccept } from './commands/accept.js';

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);

  // Flag error from parser (e.g. unknown flag, missing --data-dir value)
  if (parsed.error) {
    process.stderr.write(`peer-bridge: ${parsed.error}\n`);
    process.stderr.write('Try `peer-bridge --help` for usage.\n');
    process.exit(64);
  }

  // --help / -h or no command
  if (parsed.flags.help || !parsed.command) {
    process.stdout.write(USAGE);
    process.exit(parsed.command ? 0 : 64);
  }

  let result;
  switch (parsed.command) {
    case 'init':
      result = await runInit({
        dataDir: parsed.flags.dataDir,
        force: parsed.flags.force,
      });
      break;
    case 'invite':
      result = await runInvite({
        dataDir: parsed.flags.dataDir,
      });
      break;
    case 'accept':
      result = await runAccept({
        code: parsed.positional[0] || '',
        dataDir: parsed.flags.dataDir,
      });
      break;
    default:
      result = {
        exitCode: 64,
        stdout: '',
        stderr: `peer-bridge: unknown command '${parsed.command}'\n${USAGE}`,
      };
  }

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.exitCode);
}

main().catch((err: unknown) => {
  process.stderr.write(`peer-bridge: fatal error: ${(err as Error).message}\n`);
  process.exit(2);
});
