# Decision: Test Vectors as Spec, Not Regression

> status: decided | date: 2025-05
> supersedes: none
> triggered_by: M1 vectors mismatch → vectors were changed to match code instead of code matching vectors

## Context

M0 产出的 test vectors 是协议的**规范输出**。M1 实现时如果 mismatched，问题是**实现错了**，不是**vectors 错了**。

但实际发生的是：vectors 里有 bug（hex `"AAAA"` 被当成全零字节），实现给出了正确输出，因为实现是直接从 hex 转 bytes 的。检测到 mismatch 后，vectors 被修改去匹配实现。vectors 从规范降级成了回归测试。

## Decision

### Test vectors 是规范契约

1. **规范原语（peer ID / invite / sealed box / fingerprint sig）**：vectors 规定协议**必须**产生的输出。实现要匹配 vectors，不是反过来。
2. **CBOR frames**：由于 CBOR 编码有实现自由度（integer encoding 的宽度选择），CBOR vectors 采用**语义匹配**而非字节匹配 — 解码后字段相等即可。
3. **模板**：每个 vector 组的 `expected` 是来源（人工核对或交叉实现确认），`input` 是推导目标。

### 修改 vectors 的规则

- **只能修 input**（如果 input 有歧义或错误），不能因为实现输出不同就改 expected
- **expected 错误** → 确认是预期的错误后修 expected，同时记录为什么原来的 expected 是错的
- 修改后重新跑所有实现确认

### CBOR 语义匹配策略

CBOR vectors 的 runner 不做 `assert.deepStrictEqual(frame, expectedHex)`，而是：

1. 从 input 构建 message
2. `encodeFrame(msg)` → frame
3. `decodeFrame(frame)` → decoded
4. `assert.strictEqual(decoded.type, msg.type)` 等字段级断言

如果未来有 Rust/Go 实现，它们可以自己决定 CBOR 的最小整数编码宽度，只要解码后字段一致。

## Alternatives Considered

### A. 实现输出 → 更新 vectors（❌ 否决 — 就是这次犯的错）

把实现（Node.js + cbor-x + 自编 base32）的输出当作正确值写回 vectors。

**否决理由**：

- vectors 从规范降级为回归测试
- 跨语言实现时误判合规实现为错误
- 掩盖了"输入数据有歧义"的 bug（全零 hex vs 全零 bytes）

**证据**：M1 commit `4fb2ffc` — vectors 从 M0 的手工值改成了 Node 实现的实际输出。

### B. 字节严格匹配所有 vectors（❌ 否决）

要求 CBOR 的字节精确匹配。

**否决理由**：CBOR 标准允许同一个值有多种合法编码（如 int 42 可以是 1-byte 或 2-byte encoding）。强制字节匹配会阻止合规的非 Node 实现。

### C. 语义匹配 CBOR + 字节匹配 crypto（✅ 选定）

规范原语输出是确定性的（base32 编码、SHA-256 hash、Ed25519 sig）→ 字节匹配。
CBOR 编码有实现自由度 → 语义匹配。

## Consequences

| 正面                         | 负面                                   |
| ---------------------------- | -------------------------------------- |
| 协议规范有可验证的二进制锚点 | CBOR 部分没有字节级锚点                |
| 跨语言兼容                   | CBOR 实现验证需要解码+字段对比逻辑     |
| vectors 修改有明确规则       | 发现 expected 错误时改动的追溯需要人审 |

## Related

- Fact: `crypto-library-mapping.md`
- M0 test vectors: `packages/protocol/test-vectors/*.json`
- Commit `4fb2ffc`: vectors changed to match implementation (this decision's motivating failure)
