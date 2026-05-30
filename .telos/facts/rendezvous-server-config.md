---
id: rendezvous-server-config
kind: fact
status: stable
since: 2026-05-30
---

# Rendezvous Server Config Format

## Content

Rendezvous server 配置文件为 TOML 格式，通过 `--config` 参数指定路径（DESIGN.md §6.1: `peer-bridge-rendezvous --config /etc/peer-bridge/server.toml`）。

三部分：

### `[server]`
- `listen`: string — IP:port，如 `"0.0.0.0:443"`。
- `public_url`: string — 对外的 WebSocket URL（`wss://` 或 `ws://`）。
- `identity_key`: string — server Ed25519 私钥文件路径。

### `[limits]`
- `max_peers`: number — 全局最大注册 peer 数，设计值 `10000`。
- `max_invites_per_ip_per_hour`: number — 每 IP 每小时最大 `invite_create` 数，设计值 `20`。这是 DESIGN.md 中唯一枚举具体数值的速率限制维度。
- `max_offline_notify_size`: number — 单条 sealed-box 最大字节数，设计值 `1024`。
- `offline_notify_ttl_hours`: number — 离线通知保留时长（小时后清理），设计值 `24`。

### `[[federation]]`
- `url`: string — 联邦 peer server 的 URL。
- `pubkey`: string — 联邦 peer 的 Ed25519 公钥（`ed25519:...` 格式）。

完整示例（DESIGN.md §6.1）：
```toml
[server]
listen = "0.0.0.0:443"
public_url = "wss://rdv.example.com"
identity_key = "/etc/peer-bridge/server.key"

[limits]
max_peers = 10000
max_invites_per_ip_per_hour = 20
max_offline_notify_size = 1024
offline_notify_ttl_hours = 24

[[federation]]
url = "wss://rdv.friend.example.com"
pubkey = "ed25519:..."
```

## Source

derived from DESIGN.md §6.1

- DESIGN.md §6.1 — 完整 `server.toml` 示例、启动命令、健康检查端点。

## Boundaries

- 仅覆盖 rendezvous server 配置。Daemon 配置文件（`config.toml`）是独立的 fact（M4 范围），虽然也使用 TOML 但字段不同（见 DESIGN.md §8）。
- `[limits]` 中的速率限制阈值：仅 `max_invites_per_ip_per_hour = 20` 在 DESIGN.md 中有具体数值。其他维度（register、lookup、invite_redeem 的 per-IP limit）未在 DESIGN.md 中枚举，属于 BACKLOG known-unknown #4 的未解决部分。
- M2 单 server 场景 `[[federation]]` 为空数组或不填。M6 时才生效。
