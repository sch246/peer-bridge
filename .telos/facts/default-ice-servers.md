---
id: default-ice-servers
kind: fact
status: stable
since: 2026-05
---

# Fact: Default ICE Servers

M3 PeerConnectionManager 在用户不显式覆盖时使用的默认 STUN 服务器配置。

## 默认 ICE servers

```
iceServers = [{ urls: "stun:stun.l.google.com:19302" }]
```

这是 M3 PeerConnectionManager 构造时的默认值。配置通过 `P2PConfig.iceServers` 传递。

## Privacy 含义

- 用户在 NAT 后建立 P2P 连接时，公网 IP/端口映射会暴露给所选 STUN 服务器
- Google STUN (`stun.l.google.com:19302`) 是行业默认（Chrome 内建、绝大多数 WebRTC 应用选用）
- **暴露面**: 仅 IP 映射查询 + 时间戳。没有 SDP / 文件元数据 / 用户身份信息发往 STUN 服务器
- **不暴露**: 文件内容、消息内容、对话双方关系（这些只在 P2P channel 上传输）

## 用户覆盖

- **M3 阶段**: 通过 `P2PConfig.iceServers` 字段在 PeerConnectionManager 构造时覆盖
- **M3 阶段示例**: 如要禁用所有 STUN（仅本地网络），传 `iceServers: []`
- **M4+ daemon 阶段**: 通过 `~/.peer-bridge/config.toml` `[ice_servers]` 段配置
- **空数组的影响**: 没有 STUN 时，仅有主机 candidate (本机网络接口) 可达。跨 NAT 连接将失败。

## TURN 不提供

- peer-bridge 不自托管 TURN — 与 `rendezvous-federation-not-turn.md` 决策一致 (rendezvous 不做 relay)
- 用户 BYO TURN: 在 `iceServers` 中加 `{ urls: "turn:...", username, credential }`
- **对称 NAT / 严格防火墙后无 TURN 则无法直连** — 是 M3 已知约束，非 bug

## Boundaries

- 不覆盖: STUN 服务器选型审计 (是否选 Google 之外更隐私的 STUN) — 属 M5+ 隐私加固
- 不覆盖: TURN credential 自动协商 — 属用户自行配置
- 不覆盖: ICE 协商内部时序 (gathering / candidate pair 选择) — WebRTC 内部

## Reference

- `peerconnection-lifecycle.md` (PC 创建时引用 iceServers)
- `m3-cli-p2p-bypass-daemon.md` (CLI 命令通过 P2PConfig 传递)
- `rendezvous-federation-not-turn.md` (无官方 TURN 来源决策)
- WebRTC IETF: RFC 5389 (STUN), RFC 8445 (ICE)
