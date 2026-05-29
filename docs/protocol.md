# Peer-Bridge Protocol Specification v0.1

> 字节级协议规范。M0 阶段产出，供 M1+ 实现参照。

---

## Table of Contents

1. [信令协议 (Client ↔ Rendezvous)](#1-信令协议-client--rendezvous)
2. [联邦协议 (Server ↔ Server)](#2-联邦协议-server--server)
3. [P2P 握手 (WebRTC + DTLS Fingerprint)](#3-p2p-握手-webrtc--dtls-fingerprint)
4. [应用消息帧格式 (CBOR, Length-Prefixed)](#4-应用消息帧格式-cbor-length-prefixed)
5. [消息类型与字段定义](#5-消息类型与字段定义)
6. [邀请码生成](#6-邀请码生成)
7. [Peer ID 编码](#7-peer-id-编码)
8. [Room ID 推导](#8-room-id-推导)
9. [加密细节](#9-加密细节)
10. [Test Vectors](#10-test-vectors)

---

## 1. 信令协议 (Client ↔ Rendezvous)

### 传输

WebSocket (WSS) 长连。所有消息为 JSON。

### 认证

所有 client → server 消息附签名：
```json
{
  "payload": { ... },
  "sig": "<base64-ed25519-sig>",
  "ts": "<ISO8601-timestamp>"
}
```

`sig` = Ed25519(`SHA-256(JSON(payload) || ts)`)，用 client 的长期 Ed25519 私钥签名。

### 消息类型

#### register

Client → Server。daemon 启动时注册。

```json
{
  "type": "register",
  "payload": {
    "peer_id": "PB-HKSTQN-3BFRSX-S43PN5-WNO6LQ-MVZHIY-J5PFSX-U2ZPMF-4W6QKD-IOLAX",
    "capabilities": {
      "webrtc": true,
      "bulk_transfer": true,
      "version": "0.1.0"
    }
  }
}
```

Server → Client:
```json
{
  "type": "register_ok",
  "server_id": "ed25519:abcdef...",
  "federation_size": 3
}
```

#### lookup

Client → Server。查询 peer 在线状态。

```json
{
  "type": "lookup",
  "payload": { "peer_id": "PB-..." }
}
```

Server → Client:
```json
{
  "type": "lookup_result",
  "found": true,
  "home": "wss://rdv.example.com"
}
```

`found: false` 时无 `home` 字段。

#### invite_create

Client → Server。创建邀请码。

```json
{
  "type": "invite_create",
  "payload": {
    "code_hash": "<SHA-256-hex-of-invite-code>",
    "pubkey": "<base64-ed25519-pk>",
    "peer_id": "PB-...",
    "expires_at": "2025-01-15T10:40:00Z"
  }
}
```

#### invite_redeem → invite_result

Client → Server:
```json
{
  "type": "invite_redeem",
  "payload": { "code_hash": "<SHA-256-hex>" }
}
```

Server → Client:
```json
{
  "type": "invite_result",
  "peer_id": "PB-...",
  "pubkey": "<base64-ed25519-pk>"
}
```

或：
```json
{ "type": "invite_result", "error": "not_found" }
```

#### signal → signal_in

Client → Server（信令转发）:
```json
{
  "type": "signal",
  "payload": {
    "to": "PB-...",
    "payload": "<encrypted-signal-data>"
  }
}
```

Server → Client:
```json
{
  "type": "signal_in",
  "from": "PB-...",
  "payload": "<encrypted-signal-data>"
}
```

#### notify → notify_in

Client → Server（离线暂存）:
```json
{
  "type": "notify",
  "payload": {
    "to": "PB-...",
    "sealed_box": "<base64-encrypted>"
  }
}
```

Server → Client（接收方上线后）:
```json
{
  "type": "notify_in",
  "sealed_box": "<base64-encrypted>",
  "queued_at": "2025-01-15T10:35:00Z"
}
```

### Server Limits

| 限制 | 值 |
|---|---|
| `max_peers` | 10000 |
| `max_invites_per_ip_per_hour` | 20 |
| `max_offline_notify_size` | 1024 bytes |
| `offline_notify_ttl` | 24 hours |
| `invite_ttl` | 10 minutes |

---

## 2. 联邦协议 (Server ↔ Server)

### 传输

HTTP/1.1 POST，或 WebSocket。

### 查询

```
POST /federation/query
Content-Type: application/json

{
  "request_id": "<uuid>",
  "peer_id": "PB-...",
  "ttl": 2,
  "origin_server": "wss://rdv-a.example.com"
}

Response:
{ "found": true, "home": "wss://rdv-b.example.com" }
{ "found": false }
```

### 代理信令

```
POST /federation/proxy_signal
Content-Type: application/json

{
  "request_id": "<uuid>",
  "from_server": "wss://rdv-a.example.com",
  "from_peer_id": "PB-...",
  "to_peer_id": "PB-...",
  "payload": "<encrypted>"
}

Response: { "ack": true }
```

### 去重

- `request_id` 在 10 秒窗口内去重
- 所有 server 维护 `seen_queries: Map<request_id, expires_at>`
- 不去重则丢弃

### 路由缓存

- `route_cache: Map<peer_id, { home_url, expires_at }>`
- TTL 5 分钟
- 查到后先查 cache 再广播

---

## 3. P2P 握手 (WebRTC + DTLS Fingerprint)

### 步骤

1. **生成 ephemeral DTLS 证书**
   - Alice 生成 ECDSA P-256 短期证书
   - 计算 SHA-256 fingerprint: `sha256(spki_der)`
   - SPKI = SubjectPublicKeyInfo DER 编码

2. **签名 fingerprint**
   ```
   signed_payload = fingerprint_bytes (32) || 
                    alice_peer_id_bytes (base32-decoded, 32) ||
                    timestamp_be (8 bytes, big-endian unix seconds) ||
                    nonce (16 bytes, random)
   
   signature = Ed25519_sign(alice_longterm_sk, signed_payload)
   ```

3. **SDP offer**
   ```json
   {
     "type": "signal",
     "subtype": "webrtc_offer",
     "sdp": "...",
     "fingerprint": "<hex>",
     "signature": "<base64>",
     "peer_id": "PB-ALICE-...",
     "timestamp": 1736937600,
     "nonce": "<base64>"
   }
   ```

4. **Bob 验证**
   - 解码 peer_id → 公钥
   - 重组 `signed_payload` = fingerprint_bytes || peer_id_bytes || timestamp_be || nonce
   - 验证 `Ed25519_verify(pubkey, signed_payload, signature)`
   - 验证 `timestamp` 在 ±300 秒内
   - 验证 `peer_id` 在 `known_peers.toml` 中

5. **DTLS 握手**
   - WebRTC 自动验证 certificate fingerprint 匹配 SDP
   - 如果匹配，进入 DataChannel 阶段

6. **双向握手**（Bob 侧同样流程）

---

## 4. 应用消息帧格式 (CBOR, Length-Prefixed)

### Frame 结构

```
┌──────────────────────────────────────┐
│  Length (4 bytes, big-endian)        │
├──────────────────────────────────────┤
│  Payload (CBOR-encoded)              │
└──────────────────────────────────────┘
```

- Length: 4-byte unsigned big-endian integer，表示 CBOR payload 的长度（不含自身）
- Payload: CBOR 编码的消息对象（map type）

### CBOR 编码规则

- 使用 CBOR definitive encoding（无 indefinite length）
- Map keys 用整数或短字符串（尽量短）
- Fields 按固定顺序编码（实现一致性）

### 示例 Frame

```
# room:msg (text=hello)
长度: 43 bytes
CBOR: a4 64 7479 7065 68 726f 6f6d 3a6d
      7367 67 726f 6f6d 5f69 64 58 20 <sha256>
      6c 626f 6479 65 68 656c 6c6f 65 6b
      696e 64 64 7465 7874

Frame:
00 00 00 2b  a4 64 7479 7065 ...
```

---

## 5. 消息类型与字段定义

### 公共字段

所有消息共享：
```
{ "type": tstr,      // 消息类型标识
  "ts": uint,        // Unix 毫秒时间戳
}
```

### room:hello

连接建立后首条消息。

| 字段 | CBOR key | 类型 | 说明 |
|---|---|---|---|
| type | 0 | tstr | `"room:hello"` |
| version | 1 | tstr | `"0.1.0"` |
| capabilities | 2 | map | 可选能力 |
| ts | 99 | uint | 时间戳 |

```cbor
{
  0: "room:hello",
  1: "0.1.0",
  2: {"webrtc": true},
  99: 1736937600000
}
```

### room:ping / room:pong

| 字段 | CBOR key | 类型 |
|---|---|---|
| type | 0 | tstr = `"room:ping"` / `"room:pong"` |
| ts | 99 | uint |

### room:msg

聊天文本消息。

| 字段 | CBOR key | 类型 | 必需 |
|---|---|---|---|
| type | 0 | tstr = `"room:msg"` | ✓ |
| room_id | 1 | bstr (16) | ✓ |
| sender_peer_id | 2 | bstr (32) | ✓ |
| body | 3 | tstr | ✓ |
| kind | 4 | tstr = "text" / "system" | ✓ |
| seq | 5 | uint | ✓ |
| ts | 99 | uint (ms) | ✓ |

**约束**：
- `body` ≤ 64 KiB
- `seq` per-sender, per-room 单调递增
- `kind: "system"` 为控制类消息（加入/离开通知等），第一版仅用于 daemon 自动消息

```cbor
{
  0: "room:msg",
  1: h'abcdef1234567890...',        // room_id bytes
  2: h'...',                         // sender peer_id bytes
  3: "Hello, Bob!",
  4: "text",
  5: 7,
  99: 1736937600000
}
```

### room:file_offer

文件传输提议。

| 字段 | CBOR key | 类型 | 必需 |
|---|---|---|---|
| type | 0 | tstr = `"room:file_offer"` | ✓ |
| room_id | 1 | bstr (16) | ✓ |
| file_id | 2 | tstr (UUID) | ✓ |
| sender_peer_id | 3 | bstr (32) | ✓ |
| name | 4 | tstr | ✓ |
| size | 5 | uint | ✓ |
| sha256 | 6 | bstr (32) | ✓ |
| note | 7 | tstr | - |
| seq | 8 | uint | ✓ |
| ts | 99 | uint | ✓ |

```cbor
{
  0: "room:file_offer",
  1: h'...',
  2: "550e8400-e29b-41d4-a716-446655440000",
  3: h'...',
  4: "report.pdf",
  5: 1048576,
  6: h'deadbeef...',
  7: "季度分析报告",
  8: 8,
  99: 1736937600000
}
```

### room:file_accept / room:file_reject

| 字段 | CBOR key | 类型 | 必需 |
|---|---|---|---|
| type | 0 | tstr | ✓ |
| room_id | 1 | bstr (16) | ✓ |
| file_id | 2 | tstr | ✓ |
| reason | 3 | tstr | reject 时 |
| ts | 99 | uint | ✓ |

### room:file_chunk

文件数据块。**只在 bulk channel** 上发送。

| 字段 | CBOR key | 类型 |
|---|---|---|
| type | 0 | tstr = `"room:file_chunk"` |
| file_id | 1 | tstr |
| seq_num | 2 | uint (0-indexed) |
| data | 3 | bstr (≤65536 bytes) |

### room:file_done / room:file_abort

| 字段 | CBOR key | 类型 |
|---|---|---|
| type | 0 | tstr |
| file_id | 1 | tstr |
| reason | 2 | tstr (abort 时) |
| ts | 99 | uint |

### room:resync_request / room:resync_response

丢消息检测和重传。

resync_request:
```
{ type, room_id, sender: bstr(32), from_seq: uint, to_seq: uint, ts }
```

resync_response:
```
{ type, room_id, messages: [ room:msg... ], ts }
```

### 房间管理消息（第二版）

```
room:invite  { type, room_id, inviter_peer_id, room_name, ts }
room:join    { type, room_id, ts }
room:leave   { type, room_id, ts }
```

第一版仅在协议层定义，不暴露工具 API。

---

## 6. 邀请码生成

### 词汇表

使用 PGP Word List (256 词):

| index | 词 |
|---|---|
| 0 | aardvark |
| 1 | absurd |
| ... | ... |
| 255 | zucchini |

完整列表在 `test-vectors/pgp-word-list.json`。

### 生成算法

```
1. 生成 4 字节随机数 → 对应 4 个词索引（每字节 % 256 直接映射）
2. 生成 2 字节随机 nonce → hex 编码 (4 字符)
3. 组装: word1-word2-word3-word4-XXXX (nonce)

总熵: 4×8 + 2×8 = 48 bits
```

```
function generate_code():
  words = []
  for i in 0..3:
    idx = random_byte()
    words.push(PGP_WORD_LIST[idx])
  nonce = random_bytes(2)
  nonce_str = hex_encode(nonce)
  return words.join("-") + "-" + nonce_str
```

### 哈希

```
code_hash = SHA-256(invite_code.encode("utf-8"))
```

发送到 rendezvous 时只发 `code_hash`，不发明文码。

### 安全性

- 穷举空间: 2^48 ≈ 2.8e14
- 10 分钟窗口 + max 20 次/小时/IP 速率限制 = 实际不可能暴力破解
- 一次性使用: server 在 redeem 后清除

---

## 7. Peer ID 编码

### 步骤

1. **输入**: Ed25519 公钥 = 32 bytes raw
2. **Base32 编码**: RFC 4648, 得到 52 字符
3. **Luhn mod 32 校验**: 计算 checksum，追加 1 字符 → 53 字符
4. **分组**: 每 6 字符用 `-` 分隔，最后一组 5 字符

### Luhn Mod 32 算法

```
factor = 2
sum = 0
for char in reversed(base32_string):
  value = BASE32_DECODE[char]  # A=0, B=1, ..., Z=25, 2=26, 3=27, ..., 7=31
  addend = factor * value
  factor = (factor == 2) ? 1 : 2
  sum += addend // 32 + addend % 32
checksum_value = (32 - sum % 32) % 32
checksum = BASE32_ENCODE[checksum_value]
```

### 示例格式

```
PB-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXX
   ├─ 6 ─┤├─ 6 ─┤├─ 6 ─┤├─ 6 ─┤├─ 6 ─┤├─ 6 ─┤├─ 6 ─┤├─ 6 ─┤├─ 5 ─┤
   └────────────────── 53 base32 chars ───────────────────┘
```

### 验证

1. 移除 `PB-` 前缀和所有 `-`
2. 验证长度 = 53
3. 验证所有字符在 base32 字母表
4. 对前 52 字符计算 Luhn checksum，与第 53 字符比对
5. 取前 32 bytes（base32 decode 前 52 字符的原始字节）

---

## 8. Room ID 推导

### 1:1 房间

```
input = min(peer_id_a_bytes, peer_id_b_bytes)  # lexicographic compare of raw 32 bytes
      || 0x3A  # ":"
      || max(peer_id_a_bytes, peer_id_b_bytes)

room_id = SHA-256(input)[0:16]  # first 128 bits → 16 bytes
```

编码为 UUID 格式 hex:
```
hex(room_id[0:4]) + "-" + hex(room_id[4:6]) + "-" + hex(room_id[6:8]) + "-" +
hex(room_id[8:10]) + "-" + hex(room_id[10:16])
```

### 多人房间

```
room_id = UUIDv7  # 时间排序 + 随机
```

### 性质

- 同一对 peer 的 1:1 房间 ID 始终相同
- 1:1 的 room_id 不是 UUIDv7（无时间排序），只是 UUID 格式
- 多人房间用真 UUIDv7

---

## 9. 加密细节

### Ed25519 → X25519 转换

```c
// libsodium
unsigned char x25519_pk[crypto_scalarmult_curve25519_BYTES];  // 32
crypto_sign_ed25519_pk_to_curve25519(x25519_pk, ed25519_pk);

unsigned char x25519_sk[crypto_scalarmult_curve25519_BYTES];  // 32
crypto_sign_ed25519_sk_to_curve25519(x25519_sk, ed25519_sk);
```

JavaScript (tweetnacl):
```javascript
const x25519_pk = nacl.sign.publicKey_to_curve25519(ed25519_pk);
const x25519_sk = nacl.sign.secretKey_to_curve25519(ed25519_sk);
```

### DTLS Fingerprint 签名

```
signed_payload = concat(
  SHA-256(SPKI_DER),        // 32 bytes — DTLS certificate SPKI fingerprint
  peer_id_bytes,            // 32 bytes — base32-decoded peer_id (without checksum)
  pack_be_u64(timestamp),   // 8 bytes — unix seconds, big-endian
  nonce                     // 16 bytes — random
)

signature = Ed25519_sign(secret_key, signed_payload)  // 64 bytes
```

验证方重组相同 payload，调用 `Ed25519_verify`。

### NaCl Sealed Box

```
// 加密
sealed = nacl.box.seal(payload, recipient_x25519_pk)
// sealed = ephemeral_pk (32) || encrypted || MAC (16)
// overhead: 48 bytes

// 解密
payload = nacl.box.seal.open(sealed, recipient_x25519_pk, recipient_x25519_sk)
// returns null if MAC invalid
```

**离线 notify payload**（在 sealed box 内）：
```json
{
  "sender_peer_id": "PB-...",
  "room_id": "<uuid>",
  "note": "alice 想给你发文件",
  "timestamp": 1736937600000,
  "nonce": "<base64>"
}
```

≤ 1KB（含 sealed box overhead = 48 bytes → payload ≤ 976 bytes）。

### 离线 notify 重放防护

接收方验证：
1. `timestamp` 在 ±5 分钟内（用于防重放，非精确时钟验证）
2. `nonce` 在过去 24 小时内未见过（daemon 维护 recent_nonces 集合）
3. `sender_peer_id` 在 `known_peers.toml` 中

---

## 10. Test Vectors

测试向量文件位于 `packages/protocol/test-vectors/`：

| 文件 | 内容 | 组数 |
|---|---|---|
| `peer_id.json` | Ed25519 公钥 → Peer ID | 5 |
| `invite.json` | 随机种子 → 邀请码 + SHA-256 | 3 |
| `sealed_box.json` | (message, recipient sk/pk) → sealed box + 解密 | 3 |
| `fingerprint_sig.json` | (fingerprint, peer_id, ts, nonce, sk) → sig | 3 |
| `cbor_frames.json` | 消息对象 → CBOR frame bytes | 5 |

每组包含 `input` 和 `expected` 字段。M1 的 test runner 应加载这些 JSON 文件并验证实现输出匹配 `expected`。

---

## Appendix A: Base32 Alphabet

```
A=0, B=1, C=2, D=3, E=4, F=5, G=6, H=7,
I=8, J=9, K=10, L=11, M=12, N=13, O=14, P=15,
Q=16, R=17, S=18, T=19, U=20, V=21, W=22, X=23,
Y=24, Z=25, 2=26, 3=27, 4=28, 5=29, 6=30, 7=31
```

## Appendix B: CBOR Integer Keys

| Key | 字段 |
|---|---|
| 0 | type |
| 1 | room_id / version |
| 2 | sender_peer_id / file_id / capabilities |
| 3 | body / reason / data |
| 4 | kind / name |
| 5 | seq / size |
| 6 | sha256 |
| 7 | note |
| 8 | seq (for file_offer) |
| 99 | ts (所有消息) |

## Appendix C: DataChannel 配置

| Channel | 属性 | 用途 |
|---|---|---|
| `control` | ordered=true, reliable=true | 消息、控制、文件提议 |
| `bulk` | ordered=true, reliable=true | 文件 chunk 传输 |
