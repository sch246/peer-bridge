# Decision: Federation is on Rendezvous, not TURN

> status: decided | date: 2025-01
> supersedes: none

## Context

用户最初设想 "TURN 联邦" 打通不同 TURN 域，但联邦的真正价值在 peer 发现层而非数据中继层。

## Alternatives Considered

### A. TURN 联邦（❌ 已否决）

在不同 TURN 域之间转发数据流量。

**否决理由**：
- TURN 中继的是实际文件流量（可能几百 MB），联邦成本高
- TURN 是数据平面，不是控制平面。联邦应做在控制平面
- 自托管 TURN 已经是用户自带，联邦需求弱

### B. 无联邦，单点 rendezvous（❌ 已否决）

只支持一个 rendezvous server，不互联。

**否决理由**：
- 限制社交圈扩张（好友不能在不同 server 上）
- 用户想自托管时需要说服所有好友用同一个 server

### C. Rendezvous 联邦（✅ 选定）

## Decision

联邦做在 **rendezvous server**（peer 发现入口），通过以下方式：
- 管理员手动配置受信任的 server 列表（互相加好友式配置）
- `request_id + TTL` 去重防查询风暴（mDNS/Gnutella/libp2p 验证过的模式）
- 信令代理（非重定向）：Alice 只与自己的 home rendezvous 通信

## Rendezvous 联邦流程

1. Alice@A 想找 Bob → 先查 `local_peers`，再查 `route_cache`
2. 都没有 → A 向所有 federations 广播查询 `{request_id, peer_id, ttl: 2}`
3. 收到查询的 server 用 `request_id` 去重（10s 窗口）
4. 命中则回 `{found, home: B}`，否则 ttl > 0 时继续转发
5. A 拿到结果后**代理**信令到 B

## 为什么代理而非重定向

| 代理 | 重定向 |
|---|---|
| Alice 跨 server 不需要额外 auth | Alice 需要向 Bob 的 server 认证 |
| Alice IP 不暴露给外部 server | Alice IP 暴露给 Bob 的 server |
| "我的 server = 社交圈入口" 简单心智模型 | 用户需要理解多 server 架构成 |

## Consequences

| 正面 | 负面 |
|---|---|
| 打通社交圈（跨 server 发现好友） | 联邦配置需手动维护（第一版没有自动发现） |
| 信令流量极小，联邦成本低 | 联邦查询增加延迟（但通常 < 1s） |
| 管理员控制互信关系 | server 离线 = 该 server 的全部 peer 不可见 |

## Related

- DESIGN.md §3.5
- Fact: `webrtc-datachannel-limits.md`
