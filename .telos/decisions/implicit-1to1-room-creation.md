# Decision: Implicit 1:1 Room Creation

> status: decided | date: 2025-05
> supersedes: none
> triggered_by: M0 agent-blind gap G5

## Context

1:1 聊天室的 room_id 是确定性推导的（`SHA-256(sorted_peer_ids)`），但 room 在 SQLite 中的记录何时创建需要明确定义。Agent-blind 检查发现白名单内未覆盖"收到 file_offer 时房间还不存在"的场景。

## Decision

### 创建时机

Room 在以下时机**隐式创建**（不需要显式的 `room:create` 消息）：

1. **发送方向**：CLI / pi extension 调 `POST /rooms/:id/send` 或 `send_file`，且 `room_id` 不在 SQLite `rooms` 表中 → daemon 自动创建 room 记录
2. **接收方向**：收到对端的第一个 room 消息（`room:msg` / `room:file_offer`），且 `room_id` 不在 SQLite → daemon 自动创建 room 记录

### 自动创建的字段

```sql
INSERT INTO rooms (room_id, name, created_at, last_active_at, last_seq)
VALUES (?, NULL, datetime('now'), datetime('now'), 0);

INSERT INTO room_members (room_id, peer_id, joined_at)
VALUES (?, self_peer_id, datetime('now')),
       (?, sender_peer_id, datetime('now'));
```

- `name` 初始为 NULL（后续 CLI / 扩展可更新）

### 信任验证先于创建

创建 room 之前必须通过两层验证：

1. Identity 交叉验证（connection.peer_id == frame.sender_peer_id）
2. Known_peers trust 检查

如果 sender 不在 known_peers 中 → 拒绝 message，不创建 room。

**为什么是两层**：DTLS 握手阶段（protocol.md §3 步骤 4）已校验过 known_peers + Ed25519 签名。理论上握手不通过就没有 DataChannel，帧处理时不需要重查。但 known_peers 可能在连接存活期间被用户编辑（删除或降级信任），握手时通过的 peer 在数据到达时可能已不再受信任。**每帧重查是有意冗余**，防御运行中信任撤销的窗口。这是防御性编程，不是矛盾。

### 多人房间

多人房间仍需显式 `room:invite` + `room:join` 流程。隐式创建仅适用于 1:1 房间。

## Consequences

| 正面                                                            | 负面                                              |
| --------------------------------------------------------------- | ------------------------------------------------- |
| 用户不需要手动创建 1:1 聊天室                                   | 隐式创建可能导致僵尸 room（但无实际危害）         |
| 接收方在验证通过后自动入 room                                   | 垃圾 peer（如果在 known_peers 中）可自动创建 room |
| 与 `peer_chat_send(to="alice")` → 隐式创建 → 发送消息的 UX 一致 |                                                   |

## Related

- Decision: `deterministic-1to1-room-id.md`
- Fact: `inbox-directory-structure.md`
- Fact: `daemon-sqlite-schema.md`
