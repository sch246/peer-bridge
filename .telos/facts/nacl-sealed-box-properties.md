# Fact: NaCl Sealed Box Properties

> 外部约束。NaCl Sealed Box (`crypto_box_seal`) 的密码学属性和使用限制。

## 算法

来源：libsodium 文档 `crypto_box_seal` / `sealed boxes`

Sealed box 是 **匿名公钥加密**：
- **发送方匿名**：使用一次性 ephemeral keypair + 接收方公钥，不暴露 sender 身份
- **仅接收方可解密**：只有持有对应私钥的接收方能解密
- **前向保密**：即使 sender 长期密钥泄漏，历史 sealed box 仍然安全（因为用了 ephemeral key）

## 密钥大小

| 元素 | 字节 |
|---|---|
| Ed25519 公钥（输入） | 32 |
| Ed25519 私钥（输入） | 64 (含公钥 + 种子) |
| X25519 公钥（转换后） | 32 |
| X25519 私钥（转换后） | 32 |
| 密封密文 overhead | 48 (ephemeral pubkey 32 + MAC 16) |

## API

```typescript
// tweetnacl
const sealed = nacl.box.seal(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array
const message = nacl.box.seal.open(sealed: Uint8Array, publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array | null
```

```c
// libsodium
crypto_box_seal(ciphertext, message, message_len, recipient_pk);
crypto_box_seal_open(message, ciphertext, ciphertext_len, recipient_pk, recipient_sk);
```

## 安全属性

| 属性 | 说明 |
|---|---|
| **机密性** | 只有接收方可以解密 |
| **完整性** | Poly1305 MAC 防篡改 |
| **匿名性** | 发送方身份不暴露（ephemeral key） |
| **重放保护** | 无内置重放保护！上层需要 nonce/timestamp |
| **1-to-1** | 只能发给单一接收方（不像 Signal 的 sender key 可群发） |
| **大小限制** | 无硬性上限（message + 48 overhead），但 peer-bridge 限制 ≤1KB 策略性 |

## 对 peer-bridge 的影响

1. **离线通知 payload**：rendezvous 存放 ≤1KB sealed box 密文，TTL 24h
2. **发送方身份不在密文内**：rendezvous 看不到 sender 是谁
3. **无重放保护**：payload 内需包含 `(sender_peer_id, timestamp, nonce)`，接收方验证时间窗口防重放
4. **key 转换预计算**：daemon 启动时做 Ed25519→X25519 转换，缓存 X25519 keypair
5. **payload 内容**：`{ sender_peer_id, room_id, note, timestamp, nonce }`（不包含文件内容或消息正文）

## 参考

- libsodium: `crypto_box_seal` — https://doc.libsodium.org/public-key_cryptography/sealed_boxes
- NaCl: `crypto_box_seal`
- tweetnacl-js: `nacl.box.seal` / `nacl.box.seal.open`
