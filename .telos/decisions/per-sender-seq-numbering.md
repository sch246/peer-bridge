# Decision: Per-Sender Sequence Numbers

> status: decided | date: 2025-01
> supersedes: none

## Context

聊天室消息需要排序和去重。在 P2P 1:1 房间中，没有共识机制。

## Alternatives Considered

### A. 全局递增 seq（❌ 已否决）

所有发送方共享一个全局递增的 seq 号。

**否决理由**：

- 需要共识机制分配 seq，1:1 房间没有这种机制
- P2P 场景下两台机器各自的时钟不同步，无法达成一致的 seq 顺序

### B. Timestamp only（❌ 已否决）

纯 timestamp 排序。

**否决理由**：

- 时钟不同步导致排序错乱
- 同一毫秒内多条消息无法区分顺序
- 无法检测丢消息

### C. Per-Sender seq + Timestamp Hybrid（✅ 选定）

## Decision

`seq` 是 **per-sender** 单调递增整数，从 0 开始。

房间消息的全局顺序由 `(timestamp, sender_peer_id, seq)` 三元组决定：

1. **粗排序**：`timestamp`（用于 UI 展示）
2. **精确定位**：`sender_peer_id + seq`（唯一标识某 sender 的某条消息）
3. **丢消息检测**：seq 跳号 → 可能丢消息

## Resync 机制

接收方发现 seq 跳号：

- 发 `room:resync_request{room_id, sender, from_seq, to_seq}`
- sender 重发缺失消息（从本地 transcript 取出）
- 第一版可简化为打日志告警，先不强求完整 resync

## Consequences

| 正面             | 负面                                        |
| ---------------- | ------------------------------------------- |
| 无需共识机制     | 全局顺序可能因时钟差异而不完全准确          |
| 可检测丢消息     | 需要本地持久化 transcript 以支持 resync     |
| 简单可靠         | 多人房间下未来可能需要 vector clock 或 CRDT |
| 兼容未来多人扩展 |                                             |

## Related

- DESIGN.md §3.12
- DESIGN.md §5.4（`room:resync_request` / `room:resync_response`）
