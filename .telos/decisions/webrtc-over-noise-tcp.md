# Decision: WebRTC DataChannel over bare TCP + Noise

> status: decided | date: 2025-01
> supersedes: none

## Context

需要选择 P2P 通信的传输层协议。

## Alternatives Considered

### A. 裸 TCP + Noise Protocol（❌ 已否决）

自己实现 NAT 穿透 + Noise 加密 + 流控 + 分片。

**否决理由**：
- 自研 NAT 穿透是深坑（UDP hole punching、TCP simultaneous open、各种 NAT 类型行为）
- Noise 提供了加密通道但缺少 NAT 穿透能力
- 需要自己实现可靠传输、流控、分片、多路复用（等于重新实现 SCTP）
- 对于团队规模是过度工程化

### B. libp2p（❌ 已否决）

使用 libp2p 的完整协议栈。

**否决理由**：
- 学习曲线陡峭
- 对 peer-bridge 这种单一应用是 overkill
- libp2p webrtc transport 是较新的，文档和成熟度不如直接 WebRTC

### C. WebRTC DataChannel via node-datachannel（✅ 选定）

使用 `node-datachannel`（基于 C++ libdatachannel）的 WebRTC 实现。

## Decision

选择 **WebRTC DataChannel** + `node-datachannel`：
- ICE 框架处理 NAT 穿透（主机候选、STUN、TURN）
- DTLS 提供加密通道
- SCTP DataChannel 提供：
  - Ordered/reliable 传输（控制消息）
  - 内置分片（≤64 KiB payload 自动分片）
  - 流控（`bufferedAmount` + `bufferedAmountLow` 事件）
- Fingerprint pinning 模型天然支持 pubkey 验证

## Consequences

| 正面 | 负面 |
|---|---|
| ICE 成熟可靠，NAT 穿透不是工程问题 | C++ 模块依赖（libdatachannel 的 node 绑定） |
| DTLS + SCTP 省下大量自研代码 | node-datachannel 的 npm 包较大 |
| Fingerprint pinning 天然可扩展为 ed25519 签名验证 |  |
| node-datachannel 提供三平台预编译二进制 | 对 daemon 形态可接受（不要求浏览器兼容） |
| | WebRTC 协商过程较复杂（SDP offer/answer + ICE 连接建立） |

## Alternatives Evidence

### A. 裸 TCP + Noise
- 缺少 ICE：需要自己实现 STUN/TURN 客户端和 NAT 穿透策略
- 缺少 SCTP 的多流、可靠传输、流控
- 缺少 DTLS 的证书交换和 fingerprint 验证

### B. libp2p
- Protocol stack 完整：multiformats, libp2p, identify, autonat, circuit relay, etc.
- 用 webrtc transport 兼容 DataChannel，但抽象层多
- 未选中的核心原因：概念复杂度 > peer-bridge 实际需求

## Related

- Fact: `webrtc-datachannel-limits.md`
