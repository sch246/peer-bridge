# Fact: Cryptographic Library Mapping

> 外部约束。每个密码学原语对应的 npm 包和运行时 API。避免"看起来能编译但运行时不存在"的 bug。

## 原语→库映射

| 原语                  | npm 包               | 运行时 API                                                                                            |
| --------------------- | -------------------- | ----------------------------------------------------------------------------------------------------- |
| Ed25519 密钥生成      | `libsodium-wrappers` | `sodium.crypto_sign_keypair()`                                                                        |
| Ed25519 签名          | `libsodium-wrappers` | `sodium.crypto_sign_detached(msg, sk)`                                                                |
| Ed25519 验签          | `libsodium-wrappers` | `sodium.crypto_sign_verify_detached(sig, msg, pk)`                                                    |
| Ed25519 → X25519 转换 | `libsodium-wrappers` | `sodium.crypto_sign_ed25519_pk_to_curve25519(pk)` / `sodium.crypto_sign_ed25519_sk_to_curve25519(sk)` |
| NaCl Sealed Box 加密  | `libsodium-wrappers` | `sodium.crypto_box_seal(msg, recipient_pk)`                                                           |
| NaCl Sealed Box 解密  | `libsodium-wrappers` | `sodium.crypto_box_seal_open(sealed, pk, sk)`                                                         |
| SHA-256               | `node:crypto`        | `createHash('sha256')`                                                                                |
| Base32 编码           | 自实现               | `packages/protocol/src/peer-id.ts`                                                                    |
| CBOR 编码/解码        | `cbor-x`             | `new Encoder().encode()` / `decode()`                                                                 |
| 随机数                | `node:crypto`        | `crypto.getRandomValues()` (invite nonce)、`sodium.randombytes_buf()` (crypto nonce)                  |
| X25519 DH             | `libsodium-wrappers` | `sodium.crypto_scalarmult_base()` / `sodium.crypto_scalarmult()`                                      |

## 明确不用的包

| 包                       | 原因                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `tweetnacl`              | vanilla 版本**不包含** sealed box、不包含 key conversion。类型定义 (`nacl.d.ts`) 缺少这些 API |
| `tweetnacl-util`         | 只是 encoding 工具，非密码学原语                                                              |
| `ed2curve`               | libsodium-wrappers 自带了转换函数，不需要额外包                                               |
| `tweetnacl-sealedbox-js` | libsodium-wrappers 一站式覆盖，不需要拼接                                                     |

## libsodium-wrappers 注意事项

- **初始化**：必须在调用任何 sodium API 前 `await initCrypto()`（见 `crypto-init.ts`，集中管理 `sodium.ready`）
- **禁用规则**：同步函数（未标 `async` 的）**禁止**调用 sodium API。如果未来某人给 `decodePublicKey` 加 `crypto_sign_ed25519_pk_to_curve25519` 缓存——sodium 可能还没 ready，会静默失败。这是代码审查纪律，不由类型系统强制执行
- **Keypair 格式**：`crypto_sign_keypair()` 返回 `{ publicKey, privateKey, keyType }` — 注意 `privateKey` 不是 `secretKey`
- **签名长度**：Ed25519 签名固定 64 bytes
- **Sealed box overhead**：`crypto_box_SEALBYTES` = 48 bytes（ephemeral pk 32 + MAC 16）
- **类型**：自带完整 TypeScript 类型定义（不需要 `@types/libsodium-wrappers`）

## 来源

- libsodium-wrappers: https://github.com/jedisct1/libsodium.js
- 验证方式: `node -e "import('libsodium-wrappers').then(s => {...})"` 确认运行时 API 存在
- 此 fact 由 sealed-box.ts 运行时崩溃（tweetnacl 缺少 API）驱动创建
