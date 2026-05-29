# Tension: Single Identity Per Device

> status: open | date: 2025-01
> first_version: accept_constraint

## Description

peer-bridge 当前设计 peer_id 与设备一一对应。同一用户的多台设备（笔记本 + 台式机）是两个独立的 peer_id，需要分别加好友。

## Why It's a Tension

- 用户期望 "alice" 是一个身份跨多设备
- 但 Ed25519 密钥与设备绑定（密钥不共享）
- 共享密钥跨设备有安全风险（一台设备被攻陷 = 所有设备）

## Mitigation (First Version)

- 用户可以为不同设备设置不同 alias（"alice-laptop", "alice-desktop"）
- 在 `known_peers.toml` 中标注同属一个用户是手动行为

## Future Directions

- **Client-side device group**：一个 alias 映射到多个 peer_id。发送消息时如果主设备离线，自动路由到其他设备
- **Sub-key derivation**：从 master seed 派生出可撤销的 sub-key。每个设备一个 sub-key
- **密钥同步**：用 peer-bridge 自身同步密钥（鸡生蛋问题）

## Related

- DESIGN.md §3.2（身份模型）
- DESIGN.md §3.11 T1
