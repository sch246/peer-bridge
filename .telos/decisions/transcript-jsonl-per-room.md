# Decision: Transcript JSONL Format and Location

> status: decided | date: 2025-05
> supersedes: none
> triggered_by: M0 agent-blind gap G4

## Context

Daemon 需要持久化房间消息的完整审计日志以支持 seq 恢复和 resync。需要在 .telos/ 中明确定义 transcript 的格式和位置。

## Decision

### 格式：JSONL Append-Only

每行一个 JSON 对象，`\n` 分隔。记录原始消息帧的完整数据，不截断字段。

### 路径：Per-Room

```
<data_dir>/rooms/<room_id>/transcript.jsonl
```

而非全局 transcript 文件。理由：
- 每个房间独立生命周期（创建/删除/归档）
- Per-room 避免单文件膨胀
- resync 只需扫描特定房间

### 写入顺序：Transcript First

transcript → SQLite。transcript 是 source of truth，SQLite 是查询索引。若 transcript 写入成功但 SQLite 失败，可从 transcript 重建 SQLite。

### 恢复：启动时 Rebuild

Daemon 启动时扫描所有 `rooms/<id>/transcript.jsonl`：
1. 计算每个 (room_id, sender_peer_id) 的 last_seq
2. 重建未读计数（对比 SQLite read_at）
3. 校验 transcript 与 SQLite 一致性

## Consequences

| 正面 | 负面 |
|---|---|
| Per-room 隔离，单文件大小可控 | 需要启动时扫描和重建 |
| Transcript = source of truth，可 rebuild SQLite | 两个写入点增加复杂度 |
| Resync 请求只需扫描单个文件 | |

## Alternatives Considered

### 全局 transcript（❌ 否决）
所有房间消息写入同一个 transcript.jsonl。跨房间混杂，resync 扫描大。

### 只用 SQLite 不用 transcript（❌ 否决）
丢失了"source of truth"的独立审计能力。从 SQLite 重建不如从 transcript 可靠。

## Related

- Fact: `daemon-sqlite-schema.md`
- Fact: `inbox-directory-structure.md`
- Decision: `per-sender-seq-numbering.md`
