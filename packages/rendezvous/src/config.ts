// Server configuration loading and validation.
// Reads TOML per .telos/facts/rendezvous-server-config.md.
//
// [choice] smol-toml for TOML parsing — zero-dependency, ESM-native, smaller than @iarna/toml.
// @telos facts/rendezvous-server-config.md

import { readFileSync } from 'node:fs';
import { parse as parseToml } from 'smol-toml';

export interface ServerConfig {
  listen: string;
  public_url: string;
  identity_key: string;
}

export interface LimitsConfig {
  max_peers: number;
  max_invites_per_ip_per_hour: number;
  max_offline_notify_size: number;
  offline_notify_ttl_hours: number;
}

export interface FederationPeer {
  url: string;
  pubkey: string;
}

export interface RendezvousConfig {
  server: ServerConfig;
  limits: LimitsConfig;
  federation: FederationPeer[];
}

export const DEFAULTS: RendezvousConfig = {
  server: {
    listen: '0.0.0.0:9372',
    public_url: 'ws://localhost:9372',
    identity_key: '',
  },
  limits: {
    max_peers: 10000,
    max_invites_per_ip_per_hour: 20,
    max_offline_notify_size: 1024,
    offline_notify_ttl_hours: 24,
  },
  federation: [],
};

export function loadConfig(path: string): RendezvousConfig {
  const raw = readFileSync(path, 'utf-8');
  const parsed = parseToml(raw) as Record<string, unknown>;

  const config: RendezvousConfig = {
    server: { ...DEFAULTS.server, ...((parsed.server as Record<string, unknown>) ?? {}) },
    limits: { ...DEFAULTS.limits, ...((parsed.limits as Record<string, unknown>) ?? {}) },
    federation: Array.isArray(parsed.federation) ? (parsed.federation as FederationPeer[]) : [],
  };

  validateConfig(config);
  return config;
}

function validateConfig(config: RendezvousConfig): void {
  if (!config.server.listen || typeof config.server.listen !== 'string') {
    throw new Error('config error: server.listen must be a non-empty string');
  }
  if (typeof config.limits.max_peers !== 'number' || config.limits.max_peers < 1) {
    throw new Error('config error: limits.max_peers must be a positive number');
  }
  if (
    typeof config.limits.max_invites_per_ip_per_hour !== 'number' ||
    config.limits.max_invites_per_ip_per_hour < 1
  ) {
    throw new Error('config error: limits.max_invites_per_ip_per_hour must be a positive number');
  }
  if (
    typeof config.limits.max_offline_notify_size !== 'number' ||
    config.limits.max_offline_notify_size < 1
  ) {
    throw new Error('config error: limits.max_offline_notify_size must be a positive number');
  }
  if (
    typeof config.limits.offline_notify_ttl_hours !== 'number' ||
    config.limits.offline_notify_ttl_hours < 1
  ) {
    throw new Error('config error: limits.offline_notify_ttl_hours must be a positive number');
  }
}
