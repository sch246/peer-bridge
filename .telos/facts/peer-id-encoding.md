---
id: peer-id-encoding
kind: fact
status: stable
since: 2026-05-30
---

# Peer ID Encoding

## Content

Peer ID 的编码格式：Ed25519 公钥 → base32 (RFC 4648) → Luhn mod 32 checksum → 格式化 ID。

### 编码格式

```
PB-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXX
   └─ 6 ─┘ └─ 6 ─┘ └─ 6 ─┘ └─ 6 ─┘ └─ 6 ─┘ └─ 6 ─┘ └─ 6 ─┘ └─ 6 ─┘ └─ 5 ─┘
```

8 组 6 字符 + 最后 1 组 5 字符 = 53 base32 字符。前缀 `PB-`，组间以 `-` 分隔。

### 编码步骤

1. **取 Ed25519 公钥**：32 字节 raw binary。
2. **Base32 编码**：使用 RFC 4648 标准 base32 字母表（A-Z + 2-7，不含 0/1/8/9），得到 52 字符（`ceil(32×8/5) = 52`）。
3. **追加 Luhn mod 32 checksum**：对 52 字符 base32 字符串计算 Luhn mod 32 checksum，结果为一个 base32 字符，总长度 53。
4. **分组**：53 字符切成 8 段 6 字符 + 1 段 5 字符，以 `-` 连接。

### Luhn Mod 32 校验

标准 Luhn 算法的 base32 变体：

1. 从右向左处理每个 base32 字符（不含 PB- 前缀和分隔符）。
2. 偶数位（从右数，1-indexed）：字符值双倍后 mod 32，若结果 ≥ 32 则拆为 (结果/32) + (结果%32)。
3. 所有位求和，取 `(32 - sum % 32) % 32` 为校验码。
4. 校验码作为一个 base32 字符追加到 52 字符 base32 之后。

实现位于 `packages/protocol/src/peer-id.ts`（`luhnMod32Checksum` / `verifyLuhnMod32`）。

### 示例

Ed25519 公钥（hex, RFC 8032 test vector 2）：

```
3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c
```

1. Raw bytes → base32: `HVABPQ7IIOEVVEVXBKTU2G36XSOJQLGPF3CJNDGAZVK7CKXUMYGA`
2. Luhn checksum → `V`
3. 完整 53 字符: `HVABPQ7IIOEVVEVXBKTU2G36XSOJQLGPF3CJNDGAZVK7CKXUMYGAV`
4. 分组 (8×6 + 1×5): `PB-HVABPQ-7IIOEV-VEVXBK-TU2G36-XSOJQL-GPF3CJ-NDGAZV-K7CKXU-MYGAV`

> 此示例来自 `packages/protocol/test-vectors/peer_id.json`，由 test runner 验证。

### 约束

- peer_id 自验证（Luhn checksum，无需 CA）。
- `known_peers.toml` 中的 peer_id 为全格式含校验码。
- Base32 字母表为 RFC 4648：`A-Z` + `2-7`（不含 `0`/`1`/`8`/`9`）。
- 大小写不敏感（接受小写，内部转大写）。
- 实现: `packages/protocol/src/peer-id.ts` — `encodePeerId` / `decodePeerId`。

## Source

- `packages/protocol/src/peer-id.ts` (commit 3f192e7) — canonical implementation.
- `packages/protocol/test-vectors/peer_id.json` — 5 组 test vectors, verified by runner.
- RFC 4648: Base32 encoding.
- Luhn mod N algorithm: https://en.wikipedia.org/wiki/Luhn_mod_N_algorithm

## Boundaries

- 仅定义 `encodePeerId` / `decodePeerId` 的编码约定。
- 不覆盖 peer_id 的生成（Ed25519 keypair 生成在 `packages/core/src/identity.ts`）。
- 不覆盖 peer_id 在信令消息或 CBOR 帧中的使用方式。
