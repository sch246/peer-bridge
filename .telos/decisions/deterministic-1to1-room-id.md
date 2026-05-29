# Decision: Deterministic 1:1 Room ID

> status: decided | date: 2025-01
> supersedes: none

## Context

1:1 聊天室需要一个稳定的 room_id，双方无需协商即可得到相同值。

## Alternatives Considered

### A. 随机生成 + 信令交换（❌ 已否决）

发起方生成随机 room_id，通过 rendezvous 传递给对方。

**否决理由**：
- 如果两个 peer 同时创建 1:1 房间，会有重复
- 需要额外协商步骤

### B. 发起方选择的固定格式（❌ 已否决）

发起方选 room_id = `"{alice_peer_id}:{bob_peer_id}"`。

**否决理由**：
- 不对称：alice 和 bob 各自发起的 1:1 房间 ID 不同
- 后续多人 room 无法扩展

### C. 确定性推导（✅ 选定）

## Decision

```
room_id = SHA-256(min(peer_id_a, peer_id_b) || ":" || max(peer_id_a, peer_id_b))
```

然后按 UUIDv7 风格编码（时间戳前缀 + 随机后缀，但这里不是真的 UUIDv7 — 我们实际使用 hash 的前 128 位编码为类 UUID 格式）。

**更精确**：取 SHA-256 hash 的前 128 bits，编码为 UUID 格式：
```
hex(hash[0:16]) → "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

注意：这不是 UUIDv7（没有时间戳语义），只是 UUID 格式的 128-bit 标识符。

## 替代：真 UUIDv7？

多人房间用 UUIDv7（时间排序 + 单调序列号 + 随机后缀）。1:1 房间用确定性 hash。

实际上，DESIGN.md §5.4 说：
> 1:1 房间的 room_id 由 min(peer_id_a, peer_id_b) || ":" || max(peer_id_a, peer_id_b) 取 SHA-256 后再 UUIDv7 风格编码

"UUIDv7 风格编码" 的意思是：取 hash 填充到类似 UUID 格式，但实际上 hash 不满足 UUIDv7 的时间排序属性。所以更准确的表达是：
1. 计算 `SHA-256(sorted_peer_ids)`
2. 取前 128 bits 编码为 UUID 格式的 hex 字符串
3. 多人 room 用真正的 UUIDv7

## Consequences

| 正面 | 负面 |
|---|---|
| 双方无需协商得到相同 room_id | room_id 不按时间排序（1:1 的） |
| 对称、确定性 | hash 碰撞概率极低但不为零（2^-128） |
| 同一对 peer 的多个 1:1 房间不冲突（始终同一 room_id） | 第一版接受：一对 peer 之间只有一个 1:1 房间 |

## Related

- DESIGN.md §5.4
