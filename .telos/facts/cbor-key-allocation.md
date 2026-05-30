# Fact: CBOR Key Allocation Invariant

> 协议内部约束。每个 protocol 字段在 CBOR encoding 中持有唯一 integer key。

## Invariant

`packages/protocol/src/types.ts` 的 `CBOR_KEYS` 表中，**每个字段对应唯一的 integer key**。**不允许**多个字段共享同一个 key——即使这些字段只出现在不相交的 message type 中。

权威 spec：`docs/protocol.md` §Appendix B。

## 当前分配

| Key | 字段           |
| --- | -------------- |
| 0   | type           |
| 1   | room_id        |
| 2   | sender_peer_id |
| 3   | body           |
| 4   | kind           |
| 5   | seq            |
| 6   | sha256         |
| 7   | note           |
| 8   | version        |
| 9   | capabilities   |
| 10  | file_id        |
| 11  | name           |
| 12  | size           |
| 13  | data           |
| 14  | reason         |
| 99  | ts             |

## 验证手段

`packages/protocol/test-vectors/cbor_frames.json` 包含 `room:file_offer` vector（最多字段的消息类型，9 个非 ts 字段），`runner.test.ts` 对所有字段做 round-trip 断言。**任何新增的 key 冲突会让这个 vector 失败。**

## 为什么是 fact 不是 decision

这是一个 invariant——没有 alternatives。允许 key 共享的 decision 已经被否决（见 `decisions/unique-cbor-keys-not-message-scoped.md`），本文档把否决后的状态钉成永久约束。

## 来源

- CBOR RFC 8949 §3.1：map keys 唯一性是 application 自己的责任，CBOR 不强制
- JavaScript 对象语义：`{1: 'a', 1: 'b'}` 中后者覆盖前者，不报错
- 项目内反例：commit `2412765` 之前的 `messageToCBORMap` 在 `room:file_offer` 同时使用两组共享 key，wire 上静默 corrupt
