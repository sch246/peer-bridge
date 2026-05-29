# Fact: WebRTC DataChannel Limits

> 外部约束。WebRTC DataChannel 的协议级限制，来自 SCTP/DTLS 规范和 node-datachannel 文档。

## SCTP DataChannel 约束

来源：RFC 8831（WebRTC DataChannel Protocol）、SCTP RFC 4960 + RFC 8261

| 约束 | 值 | 说明 |
|---|---|---|
| **消息最大尺寸** | 64 KiB / 65536 bytes | SCTP 单条消息上限。超过此值需应用层分片 |
| **有序 vs 无序** | `ordered: true/false` | 有序保证消息顺序，无序允许乱序到达 |
| **可靠 vs 不可靠** | `maxRetransmits` 或 `maxPacketLifeTime` | 可靠模式重传到成功，不可靠模式可设重试次数或超时 |
| **流的数量** | 理论 65535，实际受 SCTP 协商限制 | 每个 DataChannel 对应 SCTP stream |

## bufferedAmount 流控

来源：W3C WebRTC DataChannel 规范、node-datachannel API

| 属性 | 说明 |
|---|---|
| `bufferedAmount` | 发送缓冲区中等待传输的字节数（只读） |
| `bufferedAmountLowThreshold` | 设置阈值 |
| `bufferedAmountLow` 事件 | bufferedAmount 降到阈值以下时触发 |

流控模式：
1. 应用不应无视 bufferedAmount 持续发送
2. 标准做法：发送数据后检查 bufferedAmount，超过阈值时暂停发送，等 `bufferedAmountLow` 事件后恢复
3. node-datachannel 通过 `bufferLowThreshold` 和 `onBufferedAmountLow()` 暴露此机制

## node-datachannel 约束

来源：node-datachannel GitHub (paullouisageneau/libdatachannel 的 Node.js 绑定)

| 特性 | 限制 |
|---|---|
| **平台** | Linux x64/arm64, macOS x64/arm64, Windows x64 — 预编译包 |
| **依赖** | libdatachannel (C++17)，通过 N-API 绑定 |
| **创建 DataChannel 时机** | 在 `negotiated` 模式、或 `onDataChannel` 回调中接收 |
| **默认 reliability** | `ordered` + 可靠（无 maxRetransmits/maxPacketLifeTime） |

## 对 peer-bridge 的影响

1. **文件 chunk 大小 = 64 KiB**：SCTP 单消息上限，应用层分片必需
2. **两个 DataChannel**：`control` (ordered/reliable) 用于消息和控制；`bulk` (ordered/reliable) 用于文件 chunk。SCTP 流控由 SCTP 层背压提供
3. **续传**：第一版不做。失败重传整个文件（简化实现）
4. **500 MiB 文件上限**（可配置）：合理上限，约 8000 个 chunk

## 参考

- RFC 8831: WebRTC Data Channels
- RFC 4960: Stream Control Transmission Protocol  
- W3C WebRTC DataChannel API: https://www.w3.org/TR/webrtc/#peer-to-peer-data-api
- node-datachannel: https://github.com/murat-dogan/node-datachannel
