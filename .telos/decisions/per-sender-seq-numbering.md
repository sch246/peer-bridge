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

`seq` 是 **per-(sender, room)** 单调递增整数，从 0 开始。

**seq 适用范围**：seq 仅适用于 **sender-generated application messages**（由发送方生成、参与 per-sender transcript 排序的消息）。按消息类别分为：

- **共享 seq**（sender-generated application messages，参与 transcript 排序）：`room:msg`、`room:file_offer`、`room:file_done`、`room:file_abort`。这些消息由发送方生成，在接收方按 `(sender_peer_id, seq)` 排序，共用同一个单调递增的 seq 空间。例如 sender 发了 3 条 `room:msg`（seq 0-2），再发 1 条 `room:file_offer`（seq = 3），然后 `room:file_done`（seq = 4）。
- **不共享 seq**（receiver-generated one-shot acks）：`room:file_accept`、`room:file_reject`。这些是接收方对 file_offer 的单次响应，不参与 sender 的 seq 序列。
- **不共享 seq**（protocol management）：`room:hello`、`room:ping`、`room:pong`。这些是协议管理层消息，不进 transcript，不参与 seq。
- **不共享 seq**（bulk channel chunk）：`room:file_chunk` 使用自己的 `seq_num`（per-file、0-indexed），不参与 sender 的 room-level seq。
- **未实现**：`room:resync_request`、`room:resync_response`、`room:invite`、`room:join`、`room:leave` 不在 M1 `RoomMessage` union 中，回引时遵循其原 milestone 的设计；按需 amend。

**跨连接持久**：seq 在 daemon 重启后不重置。发送方从本地 room 的 `MAX(seq) + 1` 继续（从 transcript 或 room_messages 恢复）；接收方启动时从 transcript 重建每个 sender 的 `last_seen_seq`。seq 不因 WebRTC 断开/重连而重置为零 — 这是一个持久化计数器，不是会话内计数器。

房间消息的全局顺序由 `(timestamp, sender_peer_id, seq)` 三元组决定：

1. **粗排序**：`timestamp`（用于 UI 展示）
2. **精确定位**：`sender_peer_id + seq`（唯一标识某 sender 的某条消息）
3. **丢消息检测**：seq 跳号 → 可能丢消息
4. **跨重启连续性**：sender 自身持久化 last_seq，重启后不归零

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

## Alternatives for Cross-Connection Seq Lifecycle

### A. Per-Session Seq（❌ 否决）

每次 WebRTC 连接新建时 seq 从 0 开始。对端断线重连后重置。接收方需要在 hello 消息中交换"我从 N 开始"。

**否决理由**：hello 交换增加协议复杂度；接收方 reset 后无法区分"新连接的 seq 从 0"和"旧连接的 seq 0 重复"; transcript 恢复语义分裂。

### B. 持久化 Seq（✅ 选定）

seq 跨 daemon 重启、跨 WebRTC 连接断线重连保持单调递增。发送方从 room 的 `MAX(seq) + 1` 继续。

## Related

- Decision: `transcript-jsonl-per-room.md`（启动时从 transcript 恢复 last_seq）
- DESIGN.md §3.12
- DESIGN.md §5.4（`room:resync_request` / `room:resync_response`）
