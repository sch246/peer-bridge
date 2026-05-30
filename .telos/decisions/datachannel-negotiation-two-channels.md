---
id: datachannel-negotiation-two-channels
kind: decision
status: decided
since: 2026-05
supersedes: none
---

# Decision: DataChannel Negotiation — Two Channels (Non-Negotiated)

## Context

M3 P2P 应用层在 PeerConnection 上开两个 DataChannel：`control`（消息 + 控制）和 `bulk`（文件 chunk）。

WebRTC 提供两种 DataChannel 协商方式：

- **Non-negotiated**: 一方调用 `createDataChannel`（不指定 `negotiated: true`），SDP 中声明该 channel；另一方通过 `peer.ondatachannel` 事件接收。单侧创建，对侧自动感知。
- **Negotiated**: 双方各自调用 `createDataChannel({negotiated: true, id: N})`，channel 通过预先约定的 `id` 建立，不经过 SDP 协商。

需要决策选哪种模式 + 谁创建。

## Decision

**Non-negotiated 模式。**

### 角色分工

- **发起 SDP offer 的 peer**（主动方）：调用 `createDataChannel("control")` 和 `createDataChannel("bulk")`（按此顺序）
- **接收 SDP answer 的 peer**（被动方）：通过 `peer.ondatachannel((dc) => switch dc.label)` 接收，按 `label` 路由到 control 或 bulk 处理路径

### Channel 配置

| Channel | Label       | Ordered | Reliable | 用途                                                        |
| ------- | ----------- | ------- | -------- | ----------------------------------------------------------- |
| control | `"control"` | true    | true     | `room:hello`, `room:msg`, `room:file_offer` 等控制+应用消息 |
| bulk    | `"bulk"`    | true    | true     | `room:file_chunk` only                                      |

DataChannel options 全部使用 default：`ordered=true`、无 `maxRetransmits`、无 `maxPacketLifeTime`。匹配 [webrtc-datachannel-limits.md](../facts/webrtc-datachannel-limits.md) 默认 reliable 语义（SCTP 可靠传输，应用层不重传 — 见 blind D-10）。

### Graceful degradation

Bulk channel 创建失败（`createDataChannel("bulk")` 抛出异常）→ **不中断连接**，退化为纯消息连接。Sender 在随后的 `room:hello` 中 `capabilities` 不含 `bulk_transfer: true`，对端据此感知退化。

## Rationale

- Non-negotiated 是 WebRTC 的默认 / 最简模式，无需双方手工协商 channel ID
- 角色分工（offerer 创建 / answerer 接收）由 SDP 协商时序自然消解竞态 — 只有一方发 offer，该方就是创建者
- 默认 `ordered + reliable` 匹配 SCTP 的 stream 模式，与文件 chunk 顺序传输 + 应用层不重传（blind D-10）一致
- Bulk channel 创建失败时 graceful degrade 到纯消息模式，不阻塞 chat（M3 `send-text` 可正常运行）

## Boundaries

- **不覆盖**: `bufferedAmount` / `bufferedAmountLowThreshold` 流控阈值 — Brief #C 待 sediment，数字暂定见 [webrtc-datachannel-limits.md](../facts/webrtc-datachannel-limits.md)
- **不覆盖**: 应用层消息体的 CBOR 帧编码 — 见 [unique-cbor-keys-not-message-scoped.md](unique-cbor-keys-not-message-scoped.md) + `docs/protocol.md` §4
- **不覆盖**: DataChannel-level 错误响应（open 超时、DTLS fail、fingerprint mismatch）— 见 Brief #C `datachannel-error-protocol.md` 待 sediment
- **不覆盖**: control / bulk 之间的并发竞争 — 默认两个 channel 独立 SCTP stream，无需同步

## Consequences

| 正面                                                                                    | 负面                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| API 简单 — 发起方一处创建两个 channel 即可；接收方按 `label` 路由清晰                   | 双 channel 的 SCTP 资源（~2 个 stream）— 对绝大多数场景可忽略，但比单 channel 略多一次 SCTP negotiation                                           |
| Bulk channel 失败时 graceful degrade 到纯消息模式，不阻塞 chat                          | 如果 offer / answer 角色因网络延迟交换错误（双方都尝试 `createDataChannel`），可能出现重复 channel 创建竞态 — 但 SDP 协商时序保证只有一方发 offer |
| Offer / answer 角色明确指派 channel 创建者，避免 negotiated 模式的 ID 协商协议 overhead | 仅 offerer 能主动创建新 channel — 如需后续动态增删 channel 需重建 PC，但 M3 不需要此能力                                                          |

## Related

- Caller side: [m3-cli-p2p-bypass-daemon.md](m3-cli-p2p-bypass-daemon.md) — `PeerConnectionManager` 拥有这两个 channel
- Lifecycle: [peerconnection-lifecycle.md](../facts/peerconnection-lifecycle.md) — PC `connected` + DataChannel `open` 在状态机中是 `transferring` 的触发条件
- DataChannel limits: [webrtc-datachannel-limits.md](../facts/webrtc-datachannel-limits.md) — SCTP stream limit + ordered / reliable defaults
- CBOR frame: [unique-cbor-keys-not-message-scoped.md](unique-cbor-keys-not-message-scoped.md) — control channel 上的 CBOR 帧用 unique key
- Protocol spec: `docs/protocol.md` Appendix C — channel labels + 属性
