// config.ts — data_dir resolution + config.toml load/save primitives.
//
// data_dir priority:
//   1. opts.override (CLI --data-dir)
//   2. PEER_BRIDGE_DATA_DIR env var
//   3. Platform default: Linux/macOS → $XDG_CONFIG_HOME/peer-bridge or ~/.config/peer-bridge
//                         Windows       → %APPDATA%\peer-bridge or ~/AppData/Roaming/peer-bridge
//
// CHOICE (brief #3a): hand-rolled TOML serialization for comments + exact DESIGN §8 layout.
//                     smol-toml used for parsing only.
// CHOICE (brief #3a): loadConfig returns defaults when config.toml is missing (silent fallback).
//                     init writes the file; subsequent runs should never see it missing.

import { parse as parseToml } from 'smol-toml';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';

// ── Config interfaces (matching DESIGN §8) ──

export interface IdentityConfig {
  key_file: string;
}

export interface RendezvousConfig {
  url: string;
}

export interface WebRTCIceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface WebRTCConfig {
  ice_servers: WebRTCIceServer[];
}

export interface DaemonConfig {
  listen?: string; // Unix socket path (M4); empty for now per m2-cli-bypasses-daemon
  data_dir: string;
}

export interface NotifyConfig {
  on_event: string;
}

export interface LimitsConfig {
  max_file_size_mb: number;
  max_messages_per_wait: number;
}

export interface Config {
  identity: IdentityConfig;
  rendezvous: RendezvousConfig;
  webrtc: WebRTCConfig;
  daemon: DaemonConfig;
  notify: NotifyConfig;
  limits: LimitsConfig;
}

// ── data_dir resolution ──

/**
 * Resolve the peer-bridge data directory.
 *
 * Priority: opts.override → env PEER_BRIDGE_DATA_DIR → platform default.
 * Does NOT create the directory (caller must mkdir -p).
 */
export function resolveDataDir(opts?: { override?: string }): string {
  // 1. Explicit override
  if (opts?.override) {
    return path.resolve(opts.override);
  }

  // 2. Environment variable
  const envDir = process.env.PEER_BRIDGE_DATA_DIR;
  if (envDir) {
    return path.resolve(envDir);
  }

  // 3. Platform default
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'peer-bridge');
  }

  // Linux / macOS: XDG_CONFIG_HOME or ~/.config
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(xdgConfig, 'peer-bridge');
}

// ── Default config ──

/**
 * Return the default Config with DESIGN §8 values.
 *
 * dataDir defaults to '<data_dir>' placeholder — writeConfig caller
 * (e.g. runInit) should set the actual resolved path before persisting.
 */
export function defaultConfig(dataDir?: string): Config {
  const dd = dataDir ?? '<data_dir>';
  return {
    identity: {
      key_file: path.join(dd, 'identity.key'),
    },
    rendezvous: {
      // CHOICE (brief #3a): placeholder URL with a comment telling user to edit.
      // Failing fast on this placeholder when actually used by invite/accept is
      // brief #3b's responsibility.
      url: 'wss://rdv.example.com',
    },
    webrtc: {
      ice_servers: [{ urls: ['stun:stun.l.google.com:19302'] }],
    },
    daemon: {
      listen: '',
      data_dir: dd,
    },
    notify: {
      on_event: '', // optional
    },
    limits: {
      max_file_size_mb: 500,
      max_messages_per_wait: 50,
    },
  };
}

// ── TOML serialization (hand-rolled for comment parity with DESIGN §8) ──

function escapeTomlStr(s: string): string {
  // TOML basic string escape: backslash, double-quote, control chars
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Serialize a Config to TOML string, matching DESIGN §8 sample layout
 * (section headers, blank lines between sections, inline comments).
 */
export function serializeConfig(config: Config): string {
  const lines: string[] = [];

  // [identity]
  lines.push('[identity]');
  lines.push('# Ed25519 long-term identity key');
  lines.push(`key_file = "${escapeTomlStr(config.identity.key_file)}"`);
  lines.push('');

  // [rendezvous]
  lines.push('[rendezvous]');
  lines.push('# Home rendezvous server URL (wss://)');
  lines.push(
    '# **IMPORTANT**: Change this to your actual rendezvous server before using invite/accept.',
  );
  lines.push(`url = "${escapeTomlStr(config.rendezvous.url)}"`);
  lines.push('');

  // [webrtc]
  lines.push('[webrtc]');
  lines.push('# STUN / TURN servers for NAT traversal');
  lines.push('ice_servers = [');
  for (const server of config.webrtc.ice_servers) {
    const urlList = server.urls.map((u) => `"${escapeTomlStr(u)}"`).join(', ');
    if (server.username && server.credential) {
      lines.push(
        `  { urls = [${urlList}], username = "${escapeTomlStr(server.username)}", credential = "${escapeTomlStr(server.credential)}" },`,
      );
    } else {
      lines.push(`  { urls = [${urlList}] },`);
    }
  }
  // Show commented-out TURN example
  lines.push(
    '  # { urls = ["turn:turn.example.com:3478"], username = "...", credential = "..." },',
  );
  lines.push(']');
  lines.push('');

  // [daemon]
  lines.push('[daemon]');
  lines.push('# Linux/macOS: Unix domain socket path (set by daemon in M4)');
  lines.push(`listen = "${escapeTomlStr(config.daemon.listen || '')}"`);
  lines.push('# Windows: automatically uses \\\\.\\pipe\\peer-bridge-<username>');
  lines.push(`data_dir = "${escapeTomlStr(config.daemon.data_dir)}"`);
  lines.push('');

  // [notify]
  lines.push('[notify]');
  lines.push('# Optional: shell command to run on incoming events');
  lines.push(`on_event = "${escapeTomlStr(config.notify.on_event)}"`);
  lines.push('');

  // [limits]
  lines.push('[limits]');
  lines.push(`max_file_size_mb = ${config.limits.max_file_size_mb}`);
  lines.push(`max_messages_per_wait = ${config.limits.max_messages_per_wait}`);
  lines.push('');

  return lines.join('\n');
}

// ── TOML parsing (smol-toml with defaults for missing sections) ──

/**
 * Parse a TOML config string. Missing sections are filled from defaults.
 */
export function parseConfig(toml: string, dataDir?: string): Config {
  const defaults = defaultConfig(dataDir);
  let parsed: Record<string, unknown> = {};

  try {
    parsed = (parseToml(toml) as Record<string, unknown>) ?? {};
  } catch {
    // Parse errors → fall back to defaults entirely (corrupted file gets replaced on next write)
  }

  return {
    identity: {
      key_file:
        typeof (parsed.identity as Record<string, unknown> | undefined)?.key_file === 'string'
          ? ((parsed.identity as Record<string, unknown>).key_file as string)
          : defaults.identity.key_file,
    },
    rendezvous: {
      url:
        typeof (parsed.rendezvous as Record<string, unknown> | undefined)?.url === 'string'
          ? ((parsed.rendezvous as Record<string, unknown>).url as string)
          : defaults.rendezvous.url,
    },
    webrtc: parseWebRTC(parsed.webrtc, defaults.webrtc),
    daemon: {
      listen:
        typeof (parsed.daemon as Record<string, unknown> | undefined)?.listen === 'string'
          ? ((parsed.daemon as Record<string, unknown>).listen as string)
          : defaults.daemon.listen,
      data_dir:
        typeof (parsed.daemon as Record<string, unknown> | undefined)?.data_dir === 'string'
          ? ((parsed.daemon as Record<string, unknown>).data_dir as string)
          : defaults.daemon.data_dir,
    },
    notify: {
      on_event:
        typeof (parsed.notify as Record<string, unknown> | undefined)?.on_event === 'string'
          ? ((parsed.notify as Record<string, unknown>).on_event as string)
          : defaults.notify.on_event,
    },
    limits: {
      max_file_size_mb:
        typeof (parsed.limits as Record<string, unknown> | undefined)?.max_file_size_mb === 'number'
          ? ((parsed.limits as Record<string, unknown>).max_file_size_mb as number)
          : defaults.limits.max_file_size_mb,
      max_messages_per_wait:
        typeof (parsed.limits as Record<string, unknown> | undefined)?.max_messages_per_wait ===
        'number'
          ? ((parsed.limits as Record<string, unknown>).max_messages_per_wait as number)
          : defaults.limits.max_messages_per_wait,
    },
  };
}

function parseWebRTC(raw: unknown, defaults: WebRTCConfig): WebRTCConfig {
  if (!Array.isArray((raw as Record<string, unknown> | undefined)?.ice_servers)) {
    return defaults;
  }
  const servers = ((raw as Record<string, unknown>).ice_servers as Array<Record<string, unknown>>)
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => {
      const urls: string[] = Array.isArray(s.urls)
        ? (s.urls as unknown[]).filter((u): u is string => typeof u === 'string')
        : typeof s.urls === 'string'
          ? [s.urls]
          : [];
      return {
        urls,
        username: typeof s.username === 'string' ? s.username : undefined,
        credential: typeof s.credential === 'string' ? s.credential : undefined,
      };
    });
  return servers.length > 0 ? { ice_servers: servers } : defaults;
}

// ── File I/O ──

/**
 * Read and parse config.toml from disk.
 * Returns defaults (with dataDir applied) if file is missing.
 */
export async function loadConfig(dataDir: string): Promise<Config> {
  const configPath = path.join(dataDir, 'config.toml');
  let toml: string;
  try {
    toml = await fs.readFile(configPath, 'utf-8');
  } catch {
    return defaultConfig(dataDir);
  }
  return parseConfig(toml, dataDir);
}

/**
 * Write config.toml atomically (write to .tmp, then rename).
 */
export async function writeConfig(dataDir: string, config: Config): Promise<void> {
  const configPath = path.join(dataDir, 'config.toml');
  const tmpPath = configPath + '.tmp';

  const tomlStr = serializeConfig(config);

  // Ensure data_dir exists
  await fs.mkdir(dataDir, { recursive: true });

  await fs.writeFile(tmpPath, tomlStr, 'utf-8');
  await fs.rename(tmpPath, configPath);
}
