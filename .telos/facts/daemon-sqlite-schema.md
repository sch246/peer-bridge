# Fact: Daemon SQLite Schema

> 外部约束。定义 daemon 的 SQLite 持久化 schema。此 schema 是 daemon 房间状态管理的核心数据结构。

## 设计原则

- **统一消息表**：不区分消息类型（text / file_offer / system），所有消息记录在同一张 `room_messages` 表，通过 `kind` 字段区分
- **Per-sender seq**：`(room_id, sender_peer_id, seq)` 联合唯一（概念上，不作为 DB constraint — seq 由应用层保证单调）
- **未读管理**：通过 `read_at` NULL 表示未读；非 NULL 表示客户端已确认读取

## Schema

```sql
CREATE TABLE rooms (
  room_id TEXT PRIMARY KEY,
  name TEXT,
  created_at TEXT,
  last_active_at TEXT,
  last_seq INTEGER DEFAULT 0
);

CREATE TABLE room_members (
  room_id TEXT,
  peer_id TEXT,
  joined_at TEXT,
  PRIMARY KEY (room_id, peer_id)
);

CREATE TABLE room_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  sender_peer_id TEXT NOT NULL,
  kind TEXT NOT NULL,               -- "text" | "file_offer" | "system" | "file_done" | ...
  body TEXT,                        -- text 消息内容 / JSON 序列化的元数据
  file_id TEXT,                     -- 文件传输相关
  file_name TEXT,                   -- 文件名（冗余，方便查询）
  timestamp TEXT NOT NULL,
  read_at TEXT                      -- NULL = 未读, ISO8601 = 已读时间
);

CREATE INDEX idx_messages_room_seq ON room_messages(room_id, sender_peer_id, seq);
CREATE INDEX idx_messages_room_unread ON room_messages(room_id, read_at);
```

## Kind 枚举

| Kind         | 含义         | body 内容                            |
| ------------ | ------------ | ------------------------------------ |
| `text`       | 文本消息     | 消息正文                             |
| `system`     | 系统控制消息 | JSON: `{ action, ... }`              |
| `file_offer` | 文件传输提议 | JSON: `{ name, size, sha256, note }` |
| `file_done`  | 文件传输完成 | JSON: `{ name, size, sha256 }`       |

## 与 transcript.jsonl 的关系

- SQLite 是**结构化查询层**：支持按 room/seq/sender/kind 快速检索、未读计数
- `transcript.jsonl` 是**完整审计日志**：包含所有原始帧数据，支持 resync
- 写入顺序：先 transcript → 后 SQLite（transcript 是 source of truth）
- 两者不是冗余 — SQLite 提供查询，transcript 提供完整性和 resync 能力

## 未读计数

```sql
-- 某房间的未读消息数
SELECT COUNT(*) FROM room_messages WHERE room_id = ? AND read_at IS NULL;

-- 标记房间所有消息为已读
UPDATE room_messages SET read_at = datetime('now') WHERE room_id = ? AND read_at IS NULL;
```

## 对 peer-bridge 的影响

- daemon 用 `kind` 字段区分消息类型，不需要多张消息表
- `file_offer` 行在消息表中的 file_id/file_name 字段可直接用于文件状态查询
- `read_at` 支持客户端已读确认（pi extension 调 wait 后回写已读时间）
- `(room_id, sender_peer_id, seq)` 索引支持 per-sender seq 跳号检测

## 参考

- DESIGN.md §6.2 SQLite schema
