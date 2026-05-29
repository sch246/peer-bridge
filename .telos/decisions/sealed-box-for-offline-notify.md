# Decision: NaCl Sealed Box for Offline Notification

> status: decided | date: 2025-01
> supersedes: none

## Context

rendezvous server 需要支持离线通知暂存（peer 离线时，发送方可以留一条小通知）。server 必须不能看到通知内容。

## Alternatives Considered

### A. Encrypt with server pubkey and sender pubkey（❌ 已否决）

使用传统 box（双方 keypair），server 端解密后重新加密给接收方。

**否决理由**：

- server 可以解密 → 违反 "server 透明" 原则
- 多一层加解密开销和复杂性

### B. 不做离线通知（❌ 已否决）

纯 P2P 在线模型：双方必须同时在线。

**否决理由**：

- UX 太差。用户期望"发消息时对方不在线也能收到"
- 与即时通讯的用户心理模型冲突

### C. NaCl Sealed Box（✅ 选定）

## Decision

使用 **NaCl Sealed Box**（`crypto_box_seal`）加密离线通知 payload。

**密钥方案**：

1. daemon 启动时，将自己的 Ed25519 公钥转换为 X25519 公钥（见 fact `ed25519-x25519-conversion.md`）
2. 发送方用接收方的 X25519 公钥加密 payload：`nacl.box.seal(payload, recipient_x25519_pk)`
3. Sealed box 使用一次性 ephemeral keypair，发送方 **不需要** 暴露自己身份给加密层
4. 接收方用自己的 X25519 私钥解密：`nacl.box.seal.open(sealed, x25519_pk, x25519_sk)`

**Payload 内容**（在密文内）：

```
{ sender_peer_id, room_id, note, timestamp, nonce }
```

不携带文件内容或消息正文。

**限制**：

- ≤1KB sealed box 密文
- TTL 24h
- no replay protection built-in → payload 内含 timestamp + nonce，接收方验证

## Consequences

| 正面                                          | 负面                                   |
| --------------------------------------------- | -------------------------------------- |
| Server 完全看不到通知内容和 sender            | TTL 过期后通知消失（但提醒发送方重试） |
| 发送方匿名（ephemeral key）                   | 无 message ordering 保证               |
| libsodium/tweetnacl 三平台都支持              | 密钥转换步骤增加实现复杂度             |
| 简化发送方逻辑（不需要自己的 X25519 keypair） |                                        |

## Related

- Fact: `nacl-sealed-box-properties.md`
- Fact: `ed25519-x25519-conversion.md`
- DESIGN.md §3.8
