# Fact: Ed25519 ↔ X25519 Key Conversion

> 外部约束。Ed25519 签名密钥可转换为 X25519 Diffie-Hellman 密钥用于密封加密。

## 转换算法

来源：RFC 7748 §4.1 + libsodium 文档 `crypto_sign_ed25519_pk_to_curve25519`

### 原理

Ed25519 和 X25519 使用相同的底层曲线（Curve25519），但密钥编码方式不同：

- Ed25519 密钥：Twisted Edwards 坐标系，带 cofactor 清除
- X25519 密钥：Montgomery 坐标系

libsodium 提供双向转换函数：

```c
// Ed25519 公钥 → X25519 公钥
int crypto_sign_ed25519_pk_to_curve25519(
    unsigned char curve25519_pk[crypto_scalarmult_curve25519_BYTES],
    const unsigned char ed25519_pk[crypto_sign_ed25519_PUBLICKEYBYTES]
);

// Ed25519 私钥 → X25519 私钥
int crypto_sign_ed25519_sk_to_curve25519(
    unsigned char curve25519_sk[crypto_scalarmult_curve25519_BYTES],
    const unsigned char ed25519_sk[crypto_sign_ed25519_SECRETKEYBYTES]
);
```

### tweetnacl 等价操作

在 `tweetnacl`（JS 实现）中，等价于：

```typescript
// Ed25519 公钥 → X25519 公钥
nacl.sign.pk_to_curve25519(ed25519PublicKey): Uint8Array(32)

// Ed25519 私钥 → X25519 私钥
nacl.sign.sk_to_curve25519(ed25519SecretKey): Uint8Array(32)
```

### NaCl Sealed Box 使用

```typescript
// 密封加密（发送方不需要暴露自己身份）
const sealedBox = nacl.box.seal(message, recipientX25519PublicKey);

// 解密（接收方用自己的密钥对）
const message = nacl.box.seal.open(sealedBox, recipientX25519PublicKey, recipientX25519SecretKey);
```

## 安全属性

| 属性       | 说明                                         |
| ---------- | -------------------------------------------- |
| **确定性** | 给定 Ed25519 密钥 → 生成相同的 X25519 密钥   |
| **不可逆** | 从 X25519 密钥不能恢复 Ed25519 签名能力      |
| **安全性** | 两种曲线的离散对数问题等价，转换不增加攻击面 |

## 对 peer-bridge 的影响

1. **离线通知加密**：daemon 启动时将自己的 Ed25519 公钥转换为 X25519，提供给 sealed box
2. **密封箱不需要 sender keypair**：`nacl.box.seal` 用一次性 ephemeral key + recipient 公钥完成加密，发送方不需要暴露身份
3. **转换是标准操作**：跨平台三套实现（libsodium native / tweetnacl JS / sodium-native Node.js binding）都支持

## 参考

- RFC 7748: Elliptic Curves for Security (Section 4.1, Curve25519)
- libsodium: `crypto_sign_ed25519_pk_to_curve25519` / `crypto_sign_ed25519_sk_to_curve25519`
- libsodium sealed box: `crypto_box_seal()` / `crypto_box_seal_open()`
- NaCl: `nacl.box.seal()` / `nacl.box.seal.open()`
