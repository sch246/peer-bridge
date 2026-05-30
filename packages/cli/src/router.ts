// router.ts — minimal arg dispatcher for the CLI.
//
// CHOICE (brief #3a): hand-rolled parser (no commander/yargs dependency).
//                     The surface is small enough for now; revisit if #3b/#3c
//                     shows it's painful.

export interface ParsedArgs {
  command: string | null;
  /** Positional args after the command name */
  positional: string[];
  flags: {
    dataDir?: string;
    force: boolean;
    help: boolean;
  };
  /** First unknown flag encountered (if any) — caller should report + exit */
  error?: string;
}

const USAGE = `peer-bridge <command> [options]

Commands:
  init      Set up peer-bridge identity and config

Options:
  --data-dir <path>  Override data directory
  --force            Force overwrite existing identity
  -h, --help         Show this help

Examples:
  peer-bridge init
  peer-bridge init --data-dir ~/.peer-bridge-custom
  peer-bridge init --force
`;

/** Parse CLI arguments into a structured form. */
export function parseArgs(argv: string[]): ParsedArgs {
  // Trim node/tsx and script path (argv[0], argv[1])
  const args = argv.slice(2);
  const flags: ParsedArgs['flags'] = { force: false, help: false };
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--data-dir': {
        const next = args[i + 1];
        if (next === undefined || next.startsWith('-')) {
          return {
            command: null,
            positional: [],
            flags,
            error: '--data-dir requires a path argument',
          };
        }
        flags.dataDir = next;
        i++; // consume value
        break;
      }
      case '--force':
        flags.force = true;
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        if (arg.startsWith('-')) {
          return {
            command: null,
            positional: [],
            flags,
            error: `Unknown flag: ${arg}`,
          };
        }
        positional.push(arg);
        break;
    }
  }

  return {
    command: positional[0] || null,
    positional: positional.slice(1),
    flags,
  };
}

export { USAGE };
