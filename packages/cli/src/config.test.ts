// config.test.ts — tests for data_dir resolution + config.toml load/save primitives.
// Run with: node --import tsx --test src/config.test.ts

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import {
  resolveDataDir,
  defaultConfig,
  serializeConfig,
  parseConfig,
  loadConfig,
  writeConfig,
} from './config.js';

// ── Helpers ──

function tmpdir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'pb-cli-config-'));
}

function saveEnv(): Record<string, string | undefined> {
  return {
    PEER_BRIDGE_DATA_DIR: process.env.PEER_BRIDGE_DATA_DIR,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    APPDATA: process.env.APPDATA,
  };
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

// ── resolveDataDir ──

describe('resolveDataDir', () => {
  it('uses explicit override path', () => {
    const result = resolveDataDir({ override: '/custom/path/peer-bridge' });
    assert.ok(path.isAbsolute(result));
    assert.ok(result.includes('custom'));
    assert.ok(result.includes('peer-bridge'));
  });

  it('uses PEER_BRIDGE_DATA_DIR env var when no override', () => {
    const saved = saveEnv();
    try {
      process.env.PEER_BRIDGE_DATA_DIR = '/env/data/dir';
      delete process.env.XDG_CONFIG_HOME;
      const result = resolveDataDir();
      assert.ok(result.endsWith(path.join('env', 'data', 'dir')));
    } finally {
      restoreEnv(saved);
    }
  });

  it('override takes priority over env', () => {
    const saved = saveEnv();
    try {
      process.env.PEER_BRIDGE_DATA_DIR = '/env/path';
      const result = resolveDataDir({ override: '/override/path' });
      assert.ok(result.endsWith(path.join('override', 'path')));
    } finally {
      restoreEnv(saved);
    }
  });

  it('platform default includes peer-bridge in path', () => {
    const saved = saveEnv();
    try {
      delete process.env.PEER_BRIDGE_DATA_DIR;
      if (process.platform !== 'win32') {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        delete process.env.APPDATA;
      }
      const result = resolveDataDir();
      assert.ok(result.includes('peer-bridge'));
      assert.ok(path.isAbsolute(result));
    } finally {
      restoreEnv(saved);
    }
  });

  it('resolve returns absolute path even with relative input', () => {
    const result = resolveDataDir({ override: './relative/pb' });
    assert.ok(path.isAbsolute(result));
  });
});

// ── defaultConfig ──

describe('defaultConfig', () => {
  it('has correct rendezvous and limits fields', () => {
    const cfg = defaultConfig();
    assert.strictEqual(cfg.rendezvous.url, 'wss://rdv.example.com');
    assert.strictEqual(cfg.limits.max_file_size_mb, 500);
    assert.strictEqual(cfg.limits.max_messages_per_wait, 50);
  });

  it('uses placeholder <data_dir> when no dataDir arg', () => {
    const cfg = defaultConfig();
    assert.ok(cfg.identity.key_file.includes('<data_dir>'));
  });

  it('has empty listen by default', () => {
    const cfg = defaultConfig();
    assert.strictEqual(cfg.daemon.listen, '');
  });

  it('uses provided dataDir in paths', () => {
    const cfg = defaultConfig('/my/data');
    assert.strictEqual(cfg.daemon.data_dir, '/my/data');
    // identity.key_file uses path.join — check against platform-aware join
    const expectedKeyFile = path.join('/my/data', 'identity.key');
    assert.strictEqual(cfg.identity.key_file, expectedKeyFile);
  });
});

// ── serializeConfig + parseConfig ──

describe('serializeConfig + parseConfig round-trip', () => {
  it('preserves all fields through serialize→parse', () => {
    const cfg = defaultConfig();
    cfg.rendezvous.url = 'wss://actual.example.com';
    cfg.limits.max_file_size_mb = 1024;

    const toml = serializeConfig(cfg);
    const parsed = parseConfig(toml);

    assert.strictEqual(parsed.rendezvous.url, 'wss://actual.example.com');
    assert.strictEqual(parsed.limits.max_file_size_mb, 1024);
    assert.strictEqual(parsed.limits.max_messages_per_wait, 50);
    assert.strictEqual(parsed.daemon.listen, '');
  });

  it('handles TURN credentials', () => {
    const cfg = defaultConfig();
    cfg.webrtc.ice_servers = [
      { urls: ['stun:stun.l.google.com:19302'] },
      { urls: ['turn:turn.example.com:3478'], username: 'user', credential: 'pass' },
    ];

    const toml = serializeConfig(cfg);
    const parsed = parseConfig(toml);

    assert.strictEqual(parsed.webrtc.ice_servers.length, 2);
    assert.strictEqual(parsed.webrtc.ice_servers[1]?.username, 'user');
    assert.strictEqual(parsed.webrtc.ice_servers[1]?.credential, 'pass');
  });

  it('parseConfig returns defaults for missing sections', () => {
    const toml = '[rendezvous]\nurl = "wss://custom.example.com"\n';
    const parsed = parseConfig(toml);
    assert.strictEqual(parsed.rendezvous.url, 'wss://custom.example.com');
    assert.strictEqual(parsed.limits.max_file_size_mb, 500);
    // identity.key_file uses path.join with '<data_dir>' placeholder
    assert.ok(parsed.identity.key_file.includes('<data_dir>'));
    assert.ok(parsed.identity.key_file.includes('identity.key'));
  });

  it('parseConfig returns defaults for corrupted TOML', () => {
    const parsed = parseConfig('this is not valid toml [[[');
    assert.strictEqual(parsed.rendezvous.url, 'wss://rdv.example.com');
    assert.strictEqual(parsed.limits.max_file_size_mb, 500);
  });
});

// ── loadConfig / writeConfig ──

describe('loadConfig / writeConfig', () => {
  it('loadConfig returns defaults when file is missing', async () => {
    const dir = tmpdir();
    try {
      const cfg = await loadConfig(dir);
      assert.strictEqual(cfg.rendezvous.url, 'wss://rdv.example.com');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeConfig + loadConfig round-trip with defaults', async () => {
    const dir = tmpdir();
    try {
      const cfg = defaultConfig(dir);
      await writeConfig(dir, cfg);
      const loaded = await loadConfig(dir);
      assert.strictEqual(loaded.rendezvous.url, 'wss://rdv.example.com');
      assert.strictEqual(loaded.limits.max_file_size_mb, 500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writeConfig writes atomically (no .tmp leftover)', async () => {
    const dir = tmpdir();
    try {
      const cfg = defaultConfig(dir);
      await writeConfig(dir, cfg);
      const files = await readdir(dir);
      assert.ok(files.includes('config.toml'));
      assert.ok(!files.some((f: string) => f.endsWith('.tmp')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('loadConfig falls back for empty file', async () => {
    const dir = tmpdir();
    try {
      await mkdir(dir, { recursive: true });
      writeFileSync(path.join(dir, 'config.toml'), '');
      const cfg = await loadConfig(dir);
      assert.strictEqual(cfg.rendezvous.url, 'wss://rdv.example.com');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('custom values survive write→load round-trip', async () => {
    const dir = tmpdir();
    try {
      const cfg = defaultConfig(dir);
      cfg.rendezvous.url = 'wss://my-rdv.example.com';
      cfg.limits.max_file_size_mb = 2048;
      cfg.notify.on_event = 'notify-send "peer message"';
      await writeConfig(dir, cfg);
      const loaded = await loadConfig(dir);
      assert.strictEqual(loaded.rendezvous.url, 'wss://my-rdv.example.com');
      assert.strictEqual(loaded.limits.max_file_size_mb, 2048);
      assert.strictEqual(loaded.notify.on_event, 'notify-send "peer message"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ── serializeConfig output format ──

describe('serializeConfig output format', () => {
  it('contains all DESIGN §8 section headers', () => {
    const toml = serializeConfig(defaultConfig());
    const sections = ['[identity]', '[rendezvous]', '[webrtc]', '[daemon]', '[notify]', '[limits]'];
    for (const s of sections) {
      assert.ok(toml.includes(s), `Missing section ${s}`);
    }
  });

  it('has blank lines between sections', () => {
    const toml = serializeConfig(defaultConfig());
    const blankLines = [...toml.matchAll(/\n\n/g)];
    assert.ok(
      blankLines.length >= 4,
      `Expected >=4 blank-line separators, got ${blankLines.length}`,
    );
  });

  it('has TURN comment placeholder', () => {
    const toml = serializeConfig(defaultConfig());
    assert.ok(toml.includes('turn:turn.example.com'));
    assert.ok(toml.includes('# { urls ='));
  });
});
