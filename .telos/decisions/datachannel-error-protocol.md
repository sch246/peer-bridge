---
id: datachannel-error-protocol
kind: decision
status: decided
since: 2026-05
supersedes: none
---

# Decision: DataChannel Error Protocol

## Context

M3 P2P 层会出现多种错误：fingerprint verify 失败、peer_id 未在 known_peers、版本不兼容、DataChannel open 超时、SDP 超时、文件传输失败等。需要决策每种错误的协议响应行为 + CLI 退出码。

来源：M3 startup sediment Brief #C，综合 blind §2.8 错误处理表 (17 scenarios) + audit U-5 (verify 失败行为) + U-6 (version mismatch) + U-12 (P2P 错误码 taxonomy)。

## Decision Matrix

按 error scenario 列出协议响应 + CLI 退出码。

| #   | Scenario                                                   | 协议响应                                                                                                        | CLI exit              |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1   | Ed25519 fingerprint signature verify 失败                  | 不调用 setRemoteDescription, 关闭 PC, 不发 error 给对端 (对端身份未验证)                                        | 1                     |
| 2   | DTLS certificate fingerprint mismatch                      | WebRTC 自动检测; PC connectionState=failed; 关闭                                                                | 1                     |
| 3   | peer_id 不在 known_peers (trust=verified)                  | 同 #1, 拒绝 setRemoteDescription                                                                                | 1                     |
| 4   | peer_id 在 known_peers 但 trust=tofu                       | 接受连接, CLI 显示 warning "TOFU peer connecting"; 不阻塞                                                       | 0 (warning)           |
| 5   | room:hello version major mismatch                          | 关闭 control DataChannel; 不发其他应用消息; 日志记录 version diff                                               | 1                     |
| 6   | room:hello version minor mismatch                          | 接受连接; 按 capabilities 协商可用功能                                                                          | 0                     |
| 7   | DataChannel open 超时 (30s)                                | 关闭 PC                                                                                                         | 1                     |
| 8   | SDP answer 超时 (30s, cite `p2p-signal-payload-format.md`) | 关闭 PC                                                                                                         | 1                     |
| 9   | ICE completion 超时 (60s)                                  | 关闭 PC                                                                                                         | 1                     |
| 10  | chunk seq_num gap (不连续)                                 | room:file_abort{reason:"chunk_gap"}; 删除 .part                                                                 | 1                     |
| 11  | 文件 SHA-256 mismatch                                      | room:file_abort{reason:"sha256_mismatch"}; 删除 .part                                                           | 1                     |
| 12  | 文件 size > 500 MiB                                        | room:file_reject{reason:"file_too_large"}                                                                       | 1 sender / 0 receiver |
| 13  | 接收方拒绝 file_offer                                      | room:file_reject{reason:"user_rejected"}                                                                        | 1 sender / 0 receiver |
| 14  | Bulk channel 创建失败                                      | 不中断 PC; capabilities 不含 bulk_transfer (per `datachannel-negotiation-two-channels.md` graceful degradation) | 0 (warning)           |
| 15  | Unknown message type on control channel                    | 日志记录, 不中断 PC                                                                                             | 0 (warning)           |
| 16  | bufferedAmount 背压超时 (5s 无 low event)                  | room:file_abort{reason:"backpressure_timeout"}                                                                  | 1                     |
| 17  | Ctrl+C 信号                                                | abort 当前传输 (room:file_abort or 直接 close), 关闭 PC                                                         | 2                     |

## Error 消息 envelope

- 应用层 abort/reject 消息走 control channel: `room:file_abort{file_id, reason}` / `room:file_reject{file_id, reason}` 已在 `docs/protocol.md` §5 定义
- PC-level 错误不发任何应用消息 (因为 DataChannel 可能根本未 open)
- 协议错误 (version mismatch / fingerprint fail) 在 control channel open 后发，但只是 informational — 主动方负责关闭

## CLI 退出码约定

| code | 含义 |
| 0 | 成功 |
| 1 | 任意错误 (协议/网络/文件) |
| 2 | 信号中断 (Ctrl+C, SIGTERM) |

## Boundaries

- 不覆盖: rendezvous 信令层错误 (close codes 1008/1011/1013) — 见 `signaling-message-fields.md` Channel B
- 不覆盖: 应用消息体 (room:msg) 内容验证 — 属 M3 实施 brief
- 不覆盖: PC 重连策略 — 见 `peerconnection-lifecycle.md` (不重连)
- 不覆盖: 文件传输 resume / partial recovery — defer to M4 (BACKLOG B-1)

## Consequences

- 正面: 错误路径明确, 实施时无歧义
- 正面: CLI 退出码标准化, scripting 友好
- 负面: 17 个 error scenario 实施层有 17 个分支处理 — 测试覆盖压力大
- 负面: TOFU peer 的 warning-but-allow 策略与 `manual-fingerprint-confirmation-on-accept.md` 的 "manual confirm" 严格度有 tension — 需要 M3 实施时统一 (是否也提示用户在 TOFU 状态下 confirm?)

## Related

- `peerconnection-lifecycle.md` (Close triggers)
- `m3-cli-p2p-bypass-daemon.md` (CLI 退出码)
- `p2p-signal-payload-format.md` (signal 超时)
- `manual-fingerprint-confirmation-on-accept.md` (peer 验证基准)
- `known-peers-toml-schema.md` (trust enum)
- `signaling-message-fields.md` (signal 层 close codes)
- `docs/protocol.md` §5 (room:file_abort / room:file_reject)
