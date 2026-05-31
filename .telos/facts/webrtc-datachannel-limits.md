---
id: webrtc-datachannel-limits
kind: fact
status: stable
since: 2026-05
revised: 2026-05-31
---

# Fact: WebRTC DataChannel Limits

> 外部约束。WebRTC DataChannel 的协议级限制，来自 SCTP/DTLS 规范和 node-datachannel 文档。

## SCTP DataChannel 约束

来源：RFC 8831（WebRTC DataChannel Protocol）、SCTP RFC 4960 + RFC 8261

| 约束               | 值                                      | 说明                                             |
| ------------------ | --------------------------------------- | ------------------------------------------------ |
| **消息最大尺寸**   | 64 KiB / 65536 bytes                    | SCTP 单条消息上限。超过此值需应用层分片          |
| **有序 vs 无序**   | `ordered: true/false`                   | 有序保证消息顺序，无序允许乱序到达               |
| **可靠 vs 不可靠** | `maxRetransmits` 或 `maxPacketLifeTime` | 可靠模式重传到成功，不可靠模式可设重试次数或超时 |
| **流的数量**       | 理论 65535，实际受 SCTP 协商限制        | 每个 DataChannel 对应 SCTP stream                |

## bufferedAmount 流控

来源：W3C WebRTC DataChannel 规范、node-datachannel API

| 属性                         | 说明                                 |
| ---------------------------- | ------------------------------------ |
| `bufferedAmount`             | 发送缓冲区中等待传输的字节数（只读） |
| `bufferedAmountLowThreshold` | 设置阈值                             |
| `bufferedAmountLow` 事件     | bufferedAmount 降到阈值以下时触发    |

流控模式：

1. 应用不应无视 bufferedAmount 持续发送
2. 标准做法：发送数据后检查 bufferedAmount，超过阈值时暂停发送，等 `bufferedAmountLow` 事件后恢复
3. node-datachannel 通过 `bufferLowThreshold` 和 `onBufferedAmountLow()` 暴露此机制

## node-datachannel 约束

来源：node-datachannel GitHub (paullouisageneau/libdatachannel 的 Node.js 绑定)

| 特性                      | 限制                                                     |
| ------------------------- | -------------------------------------------------------- |
| **平台**                  | Linux x64/arm64, macOS x64/arm64, Windows x64 — 预编译包 |
| **依赖**                  | libdatachannel (C++17)，通过 N-API 绑定                  |
| **创建 DataChannel 时机** | 在 `negotiated` 模式、或 `onDataChannel` 回调中接收      |
| **默认 reliability**      | `ordered` + 可靠（无 maxRetransmits/maxPacketLifeTime）  |

## 验证（M3 sanity probe）

`packages/p2p-probe` 在 commit `7f2e7ac` 上跳通：

- `node-datachannel@0.32.3` 通过 `prebuild-install` 在三平台 Node 22 都装上了预编译二进制；CI run [26687227899](https://github.com/sch246/peer-bridge/actions/runs/26687227899) 三 cell 全绿（`ubuntu-latest` / `macos-latest` / `windows-latest`）。
- 本地两个 in-process `PeerConnection` 握手 ~1s，DataChannel 字符串往返正常。
- ESM `import nodeDataChannel from 'node-datachannel'` 打开即用，类型从包内解析。
- 不需要系统依赖（无 apt/brew 附加包），`pnpm install` 不触发源码编译。

## 对 peer-bridge 的影响

1. **文件 chunk payload 大小 = 60 KiB**（M3 Phase 7a 落地选择）：SCTP 单消息上限是 64 KiB **gross**——CBOR 帧编码 (`encodeFrame` 在 `packages/protocol/src/frame.ts`) 会增加 ~70 字节 overhead（4 字节 length prefix + map header + bstr length tags + 3 个 uint key + `room_id`/`file_id` payload）。60 KiB chunk + 70 byte overhead = ~61510 bytes，留约 4 KiB 安全 margin 给将来 schema 增长。
   - 早期 `m3-blind-design-2026-05-30.md` §2.5(a) 估算 64 KiB；落地时 `file-sender.ts` 选 60 KiB。Phase 6 `bulk-channel.test.ts` 测了 32 KiB（更保守），Phase 7a/7b 在 60 KiB 上验证 1 MiB / 10 MiB 完整传输。
   - 用户层 caller 不要传 > 60 KiB 的 chunk payload 给 `RoomSession.sendBulk`/`sendBulkWithBackpressure`；超过后行为依赖 `frame.ts` overhead 实际值，可能踩 SCTP 上限。
2. **两个 DataChannel**：`control` (ordered/reliable) 用于消息和控制；`bulk` (ordered/reliable) 用于文件 chunk。SCTP 流控由 SCTP 层背压提供。详见 [datachannel-negotiation-two-channels](../decisions/datachannel-negotiation-two-channels.md)。
3. **bufferedAmount 阈值默认 256 KiB**（M3 Phase 7b 落地选择）：`RoomSession.sendBulkWithBackpressure` 在 `room-session.ts` 默认 `threshold = 256 * 1024`。约 4 个 chunk 的积压。`bufferedAmountLow` 事件 5 秒内未触发 → 视为对端背压超时，发 `room:file_abort{reason: 'backpressure_timeout'}`。详见 [datachannel-error-protocol](../decisions/datachannel-error-protocol.md) scenario #16。
4. **续传**：第一版不做。失败重传整个文件（简化实现）。
5. **500 MiB 文件上限**（可配置但 M3 Phase 7b 实现为硬编码）：合理上限，约 8500 个 60 KiB chunk。`file-receiver.ts` 在收到 `room:file_offer` 时校验 `size > 500 MiB`，超过即发 `room:file_reject{reason: 'file_too_large'}`，此校验先于用户 `onFileOffer` 回调。
6. **节点端 API 形态**：node-datachannel 0.32.3 把 channel state（`bufferedAmount` / `getLabel` / `isOpen`）暴露为方法不是属性；详见 [node-datachannel-api-quirks](node-datachannel-api-quirks.md) Q1。

## 参考

- RFC 8831: WebRTC Data Channels
- RFC 4960: Stream Control Transmission Protocol
- W3C WebRTC DataChannel API: https://www.w3.org/TR/webrtc/#peer-to-peer-data-api
- node-datachannel: https://github.com/murat-dogan/node-datachannel
