---
id: p2p-signal-payload-format
kind: fact
status: stable
since: 2026-05
---

# Fact: M3 P2P Signal Payload Format

M3 在 rendezvous 的 `signal` / `signal_in` 信道上传输 WebRTC 协商载荷（SDP offer / answer + ICE candidate）。本 fact 定义 `signal.payload`（M2 视为 opaque binary）在 M3 视角下的内部 JSON sub-envelope 格式。

## Overview

`signal` / `signal_in` 的 envelope 层由 [signaling-message-fields.md](signaling-message-fields.md) 定义：

- `signal { to, payload }` — 发送方 → rendezvous → 目标 peer
- `signal_in { from, payload }` — rendezvous → 接收方

`payload` 在 M2 中为 opaque binary / string，在 M3 中解析为 JSON sub-envelope。本 fact 枚举 `payload` 内部的所有 subtype 及字段。

## Sub-envelope field tables

### 通用字段（所有 subtype）

| 字段      | 类型        | 必需 | 说明                                                     |
| --------- | ----------- | ---- | -------------------------------------------------------- |
| `subtype` | enum string | 是   | `"webrtc_offer"` / `"webrtc_answer"` / `"ice_candidate"` |

### `webrtc_offer` / `webrtc_answer`（相同字段集）

| 字段          | 类型              | 必需 | 说明                                                                              |
| ------------- | ----------------- | ---- | --------------------------------------------------------------------------------- |
| `sdp`         | string            | 是   | SDP 字符串，含 `a=fingerprint:sha-256 ...`                                        |
| `fingerprint` | 32-byte hex       | 是   | 从 SDP 提取的 DTLS fingerprint raw bytes hex                                      |
| `signature`   | base64 string     | 是   | Ed25519 签名 of `(fingerprint \|\| peer_id \|\| timestamp \|\| nonce)` — 88 bytes |
| `peer_id`     | string            | 是   | 发起 / 响应方的 peer_id（`PB-...`）                                               |
| `timestamp`   | uint (Unix sec)   | 是   | 当前时间戳                                                                        |
| `nonce`       | base64 (16 bytes) | 是   | 随机 nonce，防 replay                                                             |

`webrtc_answer` 的 `nonce` 由 responder 独立生成，不与 offer 共享 nonce。

`signed_payload` 结构与 `docs/protocol.md` §3 步骤 2 一致：

```
fingerprint_bytes(32) || peer_id_bytes(32) || timestamp_be(8) || nonce(16) = 88 bytes
```

`test-vectors/fingerprint_sig.json` 的 `signed_payload_hex` 精确匹配此 88-byte 结构。

### `ice_candidate`

| 字段              | 类型   | 必需 | 说明                 |
| ----------------- | ------ | ---- | -------------------- |
| `candidate`       | string | 是   | ICE candidate 字符串 |
| `sdp_mid`         | string | 是   | SDP m-line ID        |
| `sdp_mline_index` | uint   | 是   | SDP m-line 索引      |

## ICE candidate 不签名的理由

- SDP offer / answer 已经签名 — DTLS fingerprint 在 SDP 内部，验证一次即可
- ICE candidate 是 ICE 层的增量更新，不引入新的 identity 威胁
- 中间人无法伪造能与 fingerprint 匹配的有效 candidate（DTLS 层会拒绝）
- 不签 candidate 简化 trickle ICE 时序（candidate 流频繁，避免每 candidate 都重 sign）

## Trickle ICE

- 默认采用 **trickle ICE** — candidate 在 ICE gathering 时增量发送，不等到 gathering 完成
- 减少信令延迟（vanilla ICE 需等所有 candidate 才能发 offer）
- 实现：`peerconnection.onicecandidate((evt) => { if (evt.candidate) signal(...); })`

## Payload 不加密

- Signal 信道走 rendezvous，server 看不到 SDP 内容明文（TLS 终止在 rendezvous）
- SDP 内容不暴露文件元数据（文件名 / 大小在 control channel 上传输）
- Rendezvous 可看到 who signaled who（`peer_id` pair），这是 M2 已接受的元数据泄露（see [signaling-message-fields.md](signaling-message-fields.md)）
- 额外 E2E 加密会复杂化 — Ed25519 签名 + DTLS 已提供 identity 校验和通信加密
- **区别于 `notify`**: `notify` 的 `sealed_box` payload 走 NaCl sealed box 加密（[sealed-box-for-offline-notify.md](../decisions/sealed-box-for-offline-notify.md)），但 `signal` 不需要 — `signal` 是实时 WebRTC 握手，SDP 本身不携带 payload 数据，离线场景 not applicable

## Signal timeouts

| 超时类型       | 默认值  | 说明                                                                               |
| -------------- | ------- | ---------------------------------------------------------------------------------- |
| offer → answer | **30s** | 发起方发 `webrtc_offer` 后 30s 内未收到 `webrtc_answer`（经 `signal_in`）→ 关闭 PC |
| ICE completion | **60s** | PC 60s 内未达 `connectionState=connected` → 关闭 PC                                |

这些值对应 [peerconnection-lifecycle.md](peerconnection-lifecycle.md) 的 `connecting` 状态超时。具体参数名 + 默认值在 `P2PConfig` 中由 M3 实施确定，CLI `--timeout` flag 可覆盖。

**来源**: blind §2.1(c) + §3 I-1。Agent-blind 推断 30s / 60s，plan 采纳为 sediment 值。WebRTC 默认 ICE candidate pair 传输超时约 30s（控制面 RTT 上限），offer-answer 加一层 rendezvous message relay，30s 合理。ICE 60s 是 worst-case 网络下 candidate gathering + pair selection 窗口，覆盖多 candidate 收集。

## Boundaries

- **不覆盖**: signal payload 在 M2 layer 的 envelope 格式（`signal {to, payload}` / `signal_in {from, payload}`）— 见 [signaling-message-fields.md](signaling-message-fields.md)
- **不覆盖**: `webrtc_answer` 的 `fingerprint` 字段是否与 `webrtc_offer` 共享 `nonce` — 答案是不共享（responder 用自己的 nonce，见上方 offer/answer 字段表注释）
- **不覆盖**: ICE restart / 网络切换 — 属 M4 重连策略（BACKLOG cross-slice U-13）
- **不覆盖**: signal 发送失败后的重试 / 背压 — 该类路由错误由 rendezvous 层或 `RendezvousClient` 处理，不在 signal payload 格式定义范围内

## Reference

- Envelope layer: [signaling-message-fields.md](signaling-message-fields.md)
- Lifecycle: [peerconnection-lifecycle.md](peerconnection-lifecycle.md) — timeouts cite
- Caller side: [m3-cli-p2p-bypass-daemon.md](../decisions/m3-cli-p2p-bypass-daemon.md)
- DataChannel: [datachannel-negotiation-two-channels.md](../decisions/datachannel-negotiation-two-channels.md) — post-handshake DataChannel
- Protocol spec: `docs/protocol.md` §3 steps 2–6 (handshake 流程，含 fingerprint 签名)
- Test vector: `test-vectors/fingerprint_sig.json` (88-byte signed_payload structure)
- Sealed box (notify): [sealed-box-for-offline-notify.md](../decisions/sealed-box-for-offline-notify.md) — 确认 sealed-box 是 notify 的加密方案，不与 signal payload 混淆
