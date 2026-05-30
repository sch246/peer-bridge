# Decision: Unique CBOR Keys, Not Message-Scoped

> status: decided | date: 2026-05
> supersedes: none
> triggered_by: M1 reviewer found `room:file_offer` silently corrupts wire format due to key collision

## Context

`packages/protocol/src/types.ts` 的早期版本（M1 落地时）让多个字段共享同一个 CBOR integer key：

```typescript
sender_peer_id: 2, file_id: 2, capabilities: 2,
body: 3, reason: 3, data: 3,
seq: 5, size: 5,
// ...
```

设计意图：节省 key 空间（CBOR small-int encoding 1 byte vs 2 byte），通过"不同 message type 用不同子集"避免冲突。`docs/protocol.md` Appendix B 也曾以这种"`room_id / version`"形式记录共享。

实际效果：`messageToCBORMap` 在 `room:file_offer` 的同一个 CBOR map 中同时写入了 `file_id`(2) 和 `sender_peer_id`(2)、`size`(5) 和 `seq`(5)。JS 对象的 key 覆盖语义让后写入的字段悄悄擦掉前一个——wire 上的 frame 缺字段，对端 decode 得到错乱数据，**没有任何测试发现**（cbor_frames.json 当时没有 `room:file_offer` vector）。

这个 bug 是 director-mode 审查 chain 的 reviewer 步骤发现的，被 spot-check 在 `frame.ts:42-52` 确认。

## Decision

**每个 protocol 字段持有唯一 CBOR integer key。**

新分配表见 `facts/cbor-key-allocation.md`。范围扩展到 `0..14, 99`，比之前的 `0..7, 99` 多用 7 个 key——这是可接受的 trade-off，理由见 Consequences。

测试层防御：`cbor_frames.json` 添加 `room:file_offer` vector（9 个字段全 round-trip 断言），任何后续 key 冲突会让此 vector 立即失败。

实现层防御：`types.ts` 的 `CBOR_KEYS` 注释里写明 invariant 和反例 commit hash。

## Alternatives Considered

### A. 按 message type scope 复用 key（❌ 否决——就是触发本 decision 的 bug）

让 `sender_peer_id` 和 `file_id` 共享 key 2，"反正它们不在同一个 message"。

**否决理由**：
- 推理在脑子里，不在代码里：JS / CBOR 不知道你的"disjoint message type"假设，遇到同时写入两个共享 key 就静默覆盖
- 一旦加新 message type（如 file_offer 同时需要 sender 和 file_id）就 silent corrupt
- 测试覆盖必须**每一个**潜在冲突组合都跑过，组合爆炸
- 实际发生：`room:file_offer` 同时持有 file_id 和 sender_peer_id，commit `2412765` 起带 bug 直到 reviewer 发现

**证据**：reviewer 报告 `chain-runs/4f6c4fb6/reviewer.md` F1（CRITICAL）

### B. 按 message type 分配 key 段（如 0-15 公共，16-31 room:msg 专用）（❌ 否决）

分段管理 key 空间，每个 message type 拿一段。

**否决理由**：
- 仍然需要 case 分析"哪个字段在哪段"，认知开销不亚于唯一 key
- CBOR small-int 1-byte 表示范围是 0-23，超过就要 2 byte——分段策略很容易跨过这条线，反而比唯一 key 浪费
- 跨 message type 共享的字段（room_id, ts）放在哪段？仍然需要全局唯一

### C. 用字符串 key 不用整数 key（❌ 否决）

CBOR text-string key（即 `{"type": "room:msg", "ts": ...}`）天然唯一，没有冲突问题。

**否决理由**：
- 协议设计目标之一就是 wire byte 紧凑（见 `decisions/webrtc-over-noise-tcp.md` §Frame size budget）
- 1-byte int key vs 平均 8-byte text key，乘以 ~10 字段每条消息，每 frame 多 ~70 byte
- text key 在频繁 ping/msg 场景下浪费显著

### D. 每字段唯一 integer key（✅ 选定）

每个字段一个 key，按需要扩展到 0-23 范围（CBOR 1-byte int 上限），不够再扩 24-255（CBOR 2-byte int）。

**理由**：
- 取消所有 implicit 推理——key 表本身就是 ground truth
- 唯一性可以被 vector test 验证（cbor_frames.json 跑全字段 round-trip）
- 1-byte key 上限 24 个字段，对当前 15 个字段绰绰有余；未来扩展通过 2-byte key 自然增长
- 实现简单：`messageToCBORMap` 不需要 case 之间做 key 规划

## Consequences

| 正面 | 负面 |
|---|---|
| 取消 silent wire corruption 类 bug | key 空间用得多（15 keys vs 8 keys），未来 24+ 个字段时 frame 多 1 byte/key |
| 测试容易：一个 vector 覆盖所有字段就够 | 协议升级需要全局 key registry 维护 |
| 协议跨语言实现时无需推理 disjoint 关系 | 旧 vector 的 `frame_hex` 需要重新生成（已完成） |
| 反例 commit 留存于 telos，agent 不会重蹈 | — |

## Related

- Fact: `cbor-key-allocation.md`
- Spec: `docs/protocol.md` §Appendix B
- Decision: `test-vectors-as-spec-not-regression.md`（CBOR vectors 用语义匹配，让 frame_hex 不再是 spec 但提供文档参考）
- Reviewer report: `chain-runs/4f6c4fb6/reviewer.md` F1
- Failing commit (pre-fix): `2412765`
- Backlog item: Resync messages 和 v2 room management 暂从 `RoomMessage` union 移除，未来加回时必须遵守此 invariant
