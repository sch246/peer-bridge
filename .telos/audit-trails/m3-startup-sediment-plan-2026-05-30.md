# M3 启动期 Sediment 计划 — Diff Audit + Blind 合并报告

> **日期**: 2026-05-30
> **输入**: `.telos/audit-trails/m3-startup-audit-2026-05-30.md` (audit) + `.telos/audit-trails/m3-blind-design-2026-05-30.md` (blind)
> **输出**: sediment brief plan — 零 telos 编辑，纯分类
> **A19 PREAMBLE**: 本报告是分类工作，不写 telos 内容。方向性判断标"推荐方向"，不展开。

---

## 读取日志

| 文件                                            | 读取范围               | 用途                               |
| ----------------------------------------------- | ---------------------- | ---------------------------------- |
| `m3-startup-audit-2026-05-30.md`                | 全文                   | U-1..U-17, B-1..B-12, §C           |
| `m3-blind-design-2026-05-30.md`                 | 全文                   | I-1..I-12, D-1..D-14, C-1..C-5     |
| `.telos/BACKLOG.md`                             | 全文 (M3 段 + Post-M2) | 现有 BACKLOG 条目，避免重复        |
| `docs/protocol.md` §3                           | lines 253-305          | 验证 C-1/C-2/C-3                   |
| `docs/protocol.md` §5                           | lines 343-504          | 验证 `seq` 字段分布                |
| `.telos/decisions/per-sender-seq-numbering.md`  | 全文                   | 验证 C-1 ("所有 room:\* 共享 seq") |
| `.telos/decisions/transcript-jsonl-per-room.md` | 全文                   | 验证 C-2 (ts 要求)                 |
| `.telos/facts/webrtc-datachannel-limits.md`     | grep "500 MiB"         | 验证 C-5                           |
| `.telos/facts/inbox-directory-structure.md`     | grep "500 MiB"         | 验证 C-5                           |
| `.telos/decisions/` + `.telos/facts/`           | `ls` 全量              | 文件名碰撞检查 (§C.1 6 文件)       |

---

## §A: Item-level diff matrix

### 分类键

| 缩写           | 含义                                                 |
| -------------- | ---------------------------------------------------- |
| **AGREE**      | audit 和 blind 都点到同一 topic                      |
| **AUDIT-ONLY** | 仅 audit 提到（如 scope ledger，blind 不涉及）       |
| **BLIND-ONLY** | 仅 blind 提到（如 telos 内部矛盾分析，audit 视野外） |
| **CONFLICT**   | audit 和 blind 给出不同方向                          |
| **MUST**       | block-M3-start — M3 实施前必须 sediment              |
| **CAN**        | block-M3-exit — 边实施边 sediment，M3 退出时必须完成 |
| **DEFER**      | 不 sediment 入 telos，归 BACKLOG                     |
| **NONE**       | 实施细节或已知结论，不沉淀                           |

### A.1 核心架构与 P2P 传输

| #   | Source                         | Topic                                  | Audit say                                                                                                                                                        | Blind say                                                                                                                                                                                                                                                                                                | Overlap               | Resolution | Sediment target                                        |
| --- | ------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------- | ------------------------------------------------------ |
| 1   | U-1, I-6, D-9, D-13, D-14, C-4 | M3 CLI 绕过 daemon 的 P2P 接入路径     | §A.1 U-1: "M3 CLI 是像 M2 一样直接 import node-datachannel 自建 PeerConnection？构建最小 daemon stub？还是放 packages/core？" — **block-M3-start**               | §2.6: CLI bypasses daemon，三个命令 (send/send-text/recv) 直接使用 signaling.ts + node-datachannel<br>§3 I-6: medium confidence<br>§4 D-9: recv 是阻塞前台进程<br>§4 D-13: 两个包 packages/p2p + packages/cli<br>§4 D-14: send 完成后关闭连接<br>§5 C-4: U-1 未决策                                      | **AGREE**             | **MUST**   | `decisions/m3-cli-p2p-bypass-daemon.md`                |
| 2   | U-2, I-3, D-6                  | DataChannel 双通道协商方式             | §A.1 U-2: "control + bulk 两个 channel，谁创建？非 negotiated / negotiated / control 内协商？" — **block-M3-start**                                              | §2.3(a): non-negotiated, 发起方 createDataChannel, 接收方 ondatachannel<br>§3 I-3: medium confidence<br>§4 D-6: file_accept/reject 无 seq                                                                                                                                                                | **AGREE**             | **MUST**   | `decisions/datachannel-negotiation-two-channels.md`    |
| 3   | U-3, I-2, D-1                  | 默认 STUN / ICE servers 配置           | §A.1 U-3: "config.toml 示例里有 Google STUN 但不是决策。p2p-probe 用 iceServers: [] （纯本地）。M3 实际部署用什么默认 STUN？privacy 披露？" — **block-M3-start** | §2.2(a): stun:stun.l.google.com:19302<br>§3 I-2: medium confidence ("引入外部依赖和 privacy 问题")<br>§4 D-1: 同上，标注为 telos 覆盖盲区                                                                                                                                                                | **AGREE**             | **MUST**   | `facts/default-ice-servers.md`                         |
| 4   | U-4, I-7, D-4, D-5, I-8        | PeerConnection 生命周期                | §A.1 U-4: "何时建立？何时关闭？闲置超时？持久连接池还是每次发送重建？" — **block-M3-start**                                                                      | §2.7(b): 发送完等 5s → close; idle 300s → ping → 10s 无 pong → close<br>§2.7(d): PC failed → 放弃不重连<br>§3 I-7: low confidence ("telos 完全沉默")<br>§3 I-8: medium confidence<br>§4 D-4: PC failed 不重连<br>§4 D-5: idle/ping/pong 超时参数                                                         | **AGREE**             | **MUST**   | `facts/peerconnection-lifecycle.md`                    |
| 5   | U-5                            | Ed25519 fingerprint verify 失败行为    | §A.1 U-5: "verify 失败后 (a) 关闭无错误消息 (b) room:error 后关闭 (c) 允许连接但拒绝消息？错误码未入 types.ts" — **block-M3-start**                              | §2.2(c): "在 setRemoteDescription 之前就拒绝（关闭 PeerConnection、不设置 remote description、CLI 退出码 1）" — 给出了具体方案但 blind 标记为设计而非 gap                                                                                                                                                | **AGREE** (substance) | **MUST**   | `decisions/datachannel-error-protocol.md`              |
| 6   | U-6, I-4                       | room:hello 版本协商与 capabilities     | §A.1 U-6: "版本不匹配谁降级？capabilities key set 未枚举。如有不兼容怎么办？" — **block-M3-start**                                                               | §2.4(c): major mismatch → close; minor mismatch → proceed<br>§2.4(d): capabilities = {webrtc, bulk_transfer, version}<br>§3 I-4: low confidence                                                                                                                                                          | **AGREE**             | **MUST**   | `decisions/datachannel-error-protocol.md` (与 #5 合并) |
| 7   | U-7, I-1, D-2, D-11, C-3       | P2P signal payload 格式 (SDP/ICE 信令) | §A.1 U-7: "signal.payload 内容 sub-envelope 格式。webrtc_offer / webrtc_answer / ice_candidate 的字段枚举。是否需要加密？" — **block-M3-start**                  | §2.1(a): 给出完整 JSON sub-envelope 含 {subtype, sdp, candidate, sdp_mid, sdp_mline_index, fingerprint, signature, peer_id, timestamp, nonce}<br>§3 I-1: low (超时值)<br>§4 D-2: SDP 超时 30s<br>§4 D-11: trickle ICE<br>§5 C-3: protocol.md §3 已定义 webrtc_offer 但未定义 answer/ice_candidate 子类型 | **AGREE**             | **MUST**   | `facts/p2p-signal-payload-format.md`                   |

### A.2 block-M3-exit 项（可边实施边 sediment）

| #   | Source   | Topic                                              | Audit say                                                                                                                                                 | Blind say                                                                                      | Overlap             | Resolution | Sediment target                                                        |
| --- | -------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------- | ---------- | ---------------------------------------------------------------------- |
| 8   | U-8, I-5 | Bulk channel 流控阈值 (bufferedAmount)             | §A.2 U-8: "bufferedAmountLowThreshold 设多少？64 KiB/512 KiB/1 MiB？" — **block-M3-exit**                                                                 | §2.5(b): bufferedAmountLowThreshold = 1 MiB (16 chunks); 背压超时 5s<br>§3 I-5: low confidence | **AGREE**           | **CAN**    | `facts/webrtc-datachannel-limits.md` (amend 现有)                      |
| 9   | U-9      | 文件传输进度上报频率 N                             | §A.2 U-9: "N = 1 (每 chunk) vs 10 vs 按时间间隔？" — **block-M3-exit**                                                                                    | 无直接对应                                                                                     | **AUDIT-ONLY**      | **CAN**    | `decisions/m3-file-transfer-details.md` (见注)                         |
| 10  | U-10     | SHA-256 校验时机 — post-receive vs incremental     | §A.2 U-10: "现有 telos 隐含 post-receive。是否拒绝 incremental？" — **block-M3-exit**                                                                     | §2.5(c): "所有 chunk 接收完毕 → compute SHA-256 → 比对" (post-receive)                         | **AGREE**           | **CAN**    | `facts/inbox-directory-structure.md` (amend 现有, § 文件落盘流程)      |
| 11  | U-11     | M3 CLI recv 模式                                   | §A.2 U-11: "阻塞等待？一次性超时？后台进程？两个 peer 同时 recv 死锁？" — **block-M3-exit**                                                               | §2.6: recv 是监听循环 (前台)，支持 --timeout 和 --accept-all<br>已在 #1 U-1 集群中覆盖         | **AGREE** (含于 #1) | **CAN**    | `decisions/m3-cli-p2p-bypass-daemon.md` (含于 #1 sediment)             |
| 12  | U-12     | P2P 错误码 taxonomy                                | §A.2 U-12: "P2P DataChannel 层零覆盖：DTLS fail / DataChannel timeout / chunk gap / SHA-256 mismatch / ICE failed / abort … 需要枚举" — **block-M3-exit** | §2.8: 完整错误处理表 (13 行, 含协议行为 + CLI 退出码)                                          | **AGREE**           | **CAN**    | `decisions/datachannel-error-protocol.md` (含于 #5 sediment)           |
| 13  | D-7      | 文件进度报告机制                                   | —                                                                                                                                                         | §4 D-7: FileSender.onProgress event emitter — telos 未定义进度报告 API                         | **BLIND-ONLY**      | **CAN**    | `decisions/m3-file-transfer-details.md` (与 #9 合并)                   |
| 14  | D-8      | bulk channel 创建失败 → 退化为纯消息连接           | —                                                                                                                                                         | §4 D-8: "不中断连接，标记 capabilities.bulk_transfer = false"                                  | **BLIND-ONLY**      | **CAN**    | `decisions/datachannel-negotiation-two-channels.md` (含于 #2 sediment) |
| 15  | D-10     | 无应用层 chunk 重传/ACK                            | —                                                                                                                                                         | §4 D-10: "默认 SCTP 可靠传输保证 chunk 按序到达。seq_num 跳号 → 直接 abort"                    | **BLIND-ONLY**      | **CAN**    | `decisions/m3-file-transfer-details.md` (与 #9 合并)                   |
| 16  | I-10     | file_chunk 终止检测 — size 计数 + file_done 双保险 | —                                                                                                                                                         | §3 I-10: medium confidence — "接收方用 size 做字节计数，同时等 room:file_done 显式终止"        | **BLIND-ONLY**      | **CAN**    | `decisions/m3-file-transfer-details.md` (与 #9 合并)                   |

> **注**: `m3-file-transfer-details.md` 是新增 sediment 文件，聚合 U-9 + D-7 + D-10 + I-10 四个 block-M3-exit 项。如子项各自可独立决策，也可分散到现有文件中 (#8 入 webrtc-datachannel-limits, #10 入 inbox-directory-structure)。

### A.3 cross-slice / defer 项

| #   | Source    | Topic                                      | Audit say                                                                                        | Blind say                                                                                                    | Overlap                 | Resolution                           | Notes                           |
| --- | --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------ | ------------------------------- |
| 17  | U-13, I-8 | PeerConnection 重连与 SDP 重交换           | §A.3 U-13: "WebRTC DataChannel 断开后重连协议完全未定义" — **cross-slice**                       | §2.7(d): DC 意外关闭 → 同 PC 内重开 DataChannel; PC failed → 放弃；文件从头重传<br>§3 I-8: medium confidence | **AGREE**               | **DEFER** → M4                       | 已在 BACKLOG B-10 (ICE restart) |
| 18  | U-14      | capabilities 字段的内容枚举与安全语义      | §A.3 U-14: "capabilities 是纯 informational 还是有安全语义？key set 是什么？" — **cross-slice**  | §2.4(d): capabilities = {webrtc, bulk_transfer, version} — informational only                                | **AGREE**               | **DEFER** → M4+                      | 已在 BACKLOG Post-M2 B-4        |
| 19  | U-15      | M4 transcripts 与 M3 CLI 文件格式兼容性    | §A.3 U-15: "M3 CLI 无 daemon 无 transcript.jsonl。M4 迁移时如何承认 M3 文件？" — **cross-slice** | 无直接对应                                                                                                   | **AUDIT-ONLY**          | **DEFER** → M4                       | 未入 BACKLOG，需新增            |
| 20  | U-16      | room:resync 实现                           | §A.4 U-16: "M3 只打 warn 日志，不强求 resync" — **defer**                                        | 无直接对应 (blind 不触及 resync)                                                                             | **AUDIT-ONLY**          | **DEFER** → M4                       | 已在 BACKLOG (下阶段)           |
| 21  | U-17      | file_chunk seq_num vs 消息层 seq 分野      | §A.4 U-17: "chunk 不计入房间消息 seq 是有意设计，但未显式 documented" — **defer**                | I-12: file_accept 无 seq，与 per-sender-seq-numbering 冲突                                                   | **AUDIT-ONLY** (seq 端) | **DEFER** → 与 §D C-1 amendment 联动 | 澄清后即解决                    |
| 22  | D-12      | known_peers trust:tofu 在 P2P 连接时的行为 | —                                                                                                | §4 D-12: "tofu peer 允许连接但 CLI 警告。M3 P2P 连接时对已有 tofu peer 的行为未规定"                         | **BLIND-ONLY**          | **DEFER** → M4                       | 新 BACKLOG 条目                 |

### A.4 Scope ledger (B-1..B-12) — 全 AUDIT-ONLY

| #   | Source | Topic                                 | Resolution              |
| --- | ------ | ------------------------------------- | ----------------------- |
| 23  | B-1    | 文件断点续传 (Resume)                 | **DEFER** → M4+         |
| 24  | B-2    | SQLite room state + transcript 持久化 | **DEFER** → M4          |
| 25  | B-3    | daemon 进程 + 跨平台 IPC server       | **DEFER** → M4          |
| 26  | B-4    | 通知 hook (Windows .bat 示例)         | **DEFER** → M4          |
| 27  | B-5    | 离线暂存拉取与解密                    | **DEFER** → M4          |
| 28  | B-6    | 多人房间 / room invite / room:join    | **DEFER** → M4+         |
| 29  | B-7    | room:resync 跨设备/会话消息同步       | **DEFER** → M4          |
| 30  | B-8    | 联邦协议 (rendezvous ↔ rendezvous)   | **DEFER** → M6          |
| 31  | B-9    | pi extension (7 工具 + /peer-pull)    | **DEFER** → M5          |
| 32  | B-10   | ICE restart / 网络切换重连            | **DEFER** → M4          |
| 33  | B-11   | 文件预览 / 缩略图                     | **DEFER** → unscheduled |
| 34  | B-12   | 群组加密 (PSK 之外) / forward secrecy | **DEFER** → unscheduled |

> 注: B-1..B-12 已全部在 `.telos/BACKLOG.md` 的 "M3 启动准入 → Scope ledger" 中枚举。此处仅做交叉引用，不在 §C 重复添加。

### A.5 Telos 内部矛盾 (C-1..C-5) — 全 BLIND-ONLY

| #   | Source    | Topic                                                                            | Conflict summary                                                                             | Resolution       | 详情见 §D |
| --- | --------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------- | --------- |
| 35  | C-1, I-12 | `room:file_accept/reject/done/abort` 缺少 `seq` vs `per-sender-seq-numbering.md` | per-sender-seq-numbering 说 "所有 room:\* 共享 seq"，protocol.md §5 仅 msg/file_offer 带 seq | **AMEND**        | §D.1      |
| 36  | C-2       | `room:file_chunk` 无 `ts` vs `transcript-jsonl-per-room.md`                      | transcript-jsonl 说 "记录原始消息帧的完整数据"，但 file_chunk 无 ts                          | **NOT-CONFLICT** | §D.2      |
| 37  | C-3       | BACKLOG U-7 vs protocol.md §3 已有 sub-envelope                                  | protocol.md §3 仅定义 webrtc_offer，未定义 answer/ice_candidate                              | **NOT-CONFLICT** | §D.3      |
| 38  | C-4       | M3 CLI 与 daemon 的关系 — 标记为 U-1 但未有决策文件                              | 这是 gap tracking，不是 contradiction                                                        | **NOT-CONFLICT** | §D.4      |
| 39  | C-5       | 500 MiB 文件上限来源不一致                                                       | 两个 telos 文件一致 (都 500 MiB)；blind 质疑是否 aesthetic choice                            | **NOT-CONFLICT** | §D.5      |

### A.6 低置信度推断 — 纯信息项

| #   | Source | Topic               | Blind inference                                                  | Confidence  | Resolution                                      |
| --- | ------ | ------------------- | ---------------------------------------------------------------- | ----------- | ----------------------------------------------- |
| 40  | I-9    | npm 包名和 API 结构 | packages/p2p + PeerConnectionManager / FileSender / FileReceiver | low         | **NONE** (实施细节，不 sediment)                |
| 41  | I-11   | room_id 计算时机    | P2P 连接建立前计算 SHA-256(min,max)                              | high (隐含) | **NONE** (已有 `deterministic-1to1-room-id.md`) |

---

## §A 汇总

| 分类                                  | 计数                               |
| ------------------------------------- | ---------------------------------- |
| Total rows (去重后)                   | 41                                 |
| **AGREE** (双方都点到)                | 12 行                              |
| **AUDIT-ONLY** (scope ledger + defer) | 14 行                              |
| **BLIND-ONLY** (工程决定 + 矛盾)      | 14 行                              |
| **CONFLICT** (方向不一致)             | 0 行                               |
| **MUST** (block-M3-start)             | 7 行 → 6 个 sediment 文件          |
| **CAN** (block-M3-exit)               | 9 行 → 分散到 3-4 个 sediment 文件 |
| **DEFER** (post-M3)                   | 17 行 (含 B-1..B-12)               |
| **NONE** (不沉淀)                     | 2 行                               |
| **AMEND** (需修现有 telos)            | 1 行 (C-1)                         |

---

## §B: Sediment work plan — block-M3-start

### §B.1 Brief #1: M3 CLI 架构 + PeerConnection 生命周期

**标题**: "M3 startup sediment #A — CLI architecture + PeerConnection lifecycle"

**包含的 telos 文件** (2 files):

1. **`decisions/m3-cli-p2p-bypass-daemon.md`** (新建)

   - M3 CLI 绕过 daemon, 直接使用 `signaling.ts` + `node-datachannel` 管理 PeerConnection
   - M4 daemon 迁移契约: 明确 M3→M4 接口升级路径
   - CLI 三个命令 (send / send-text / recv) 的调用链与包边界
   - recv 模式: 前台阻塞监听循环, 支持 --timeout 和 --accept-all
   - 包结构: `packages/p2p` 独立包, `packages/cli` 新增 p2p 命令组
   - send/send-text 完成后默认关闭连接 (非持久), 与 M4 daemon 持久连接区分

2. **`facts/peerconnection-lifecycle.md`** (新建)
   - 建立触发: CLI send 被调用 / recv 收到 webrtc_offer 时
   - 关闭触发: send 完成后等 5s → close; Ctrl+C → abort 当前传输 → close
   - 闲置超时: 300s 无活动 → ping → 10s 无 pong → close
   - PC failed → 完全放弃不重连 (与 #1 的 M3 非持久语义一致)
   - 参数表: idle_timeout_ms, ping_interval_ms, pong_timeout_ms, send_grace_period_ms

**涉及的 audit/blind ID**: Resolves U-1, U-4, U-11; D-4, D-5, D-9, D-13, D-14; I-6, I-7, I-8 (部分), C-4

**估计大小**: **L** brief (2 files, 但每文件覆盖面广 — 架构级决策 + 完整生命周期状态机)

**推荐顺序**: **第 1 个跑**。理由:

- U-1 (CLI 架构路径) 是 M3 所有其他决策的基础 — 必须先定包结构和调用链，才能决定其他 sediment 文件中引用的模块路径
- U-4 (PeerConnection 生命周期) 直接影响 CLI 命令语义 (recv 是阻塞还是后台？超时多久？)，必须早于 CLI 实现
- 与 M4 daemon 的迁移契约在此 brief 中一锤定音，后续 sediment 文件可以引用

---

### §B.2 Brief #2: DataChannel 协商 + P2P 信令载荷格式

**标题**: "M3 startup sediment #B — DataChannel negotiation + P2P signal payload"

**包含的 telos 文件** (2 files):

1. **`decisions/datachannel-negotiation-two-channels.md`** (新建)

   - 协商方式: non-negotiated (发起方 `createDataChannel`，接收方 `onDataChannel`)
   - 角色分工: 发起 offer 的 peer 创建两个 channel, 接收方按 label 路由
   - 双通道配置: control (label="control", ordered, reliable) + bulk (label="bulk", ordered, reliable)
   - 竞态消解: 由 offer/answer 角色保证 (发起方创建, 接收方接收)
   - bulk channel 创建失败 → 退化为纯消息连接 (capabilities 不含 bulk_transfer)

2. **`facts/p2p-signal-payload-format.md`** (新建)
   - JSON sub-envelope 格式: `{subtype, sdp?, candidate?, sdp_mid?, sdp_mline_index?, fingerprint?, signature?, peer_id?, timestamp?, nonce?}`
   - 三种 subtype 完整字段定义: webrtc_offer / webrtc_answer / ice_candidate
   - webrtc_answer 是否需要签名？(protocol.md §3 step 6 说 "Bob 侧同样流程"，但 answer 的字段集未明说)
   - ICE candidate trickle vs vanilla: 选 trickle (现代 WebRTC 标准，减信令延迟)
   - signal.payload 是否需要额外加密？明确: 不加密 — SDP 不暴露文件内容，rendezvous 可看到 who signaled who 但看不到文件
   - 信令超时: offer→answer 30s, ICE completion 60s

**涉及的 audit/blind ID**: Resolves U-2, U-7; D-2, D-6, D-8, D-11; I-1, I-3; C-3

**估计大小**: **M** brief (2 files, protocol-level, 字段定义为主)

**推荐顺序**: **第 2 个跑** (可在 Brief #1 完成前并行起草，但最终依赖 #1 的 CLI 架构路径 — signal payload 格式需要知道谁持有 signaling client)

---

### §B.3 Brief #3: ICE/STUN 配置 + DataChannel 错误协议

**标题**: "M3 startup sediment #C — Default ICE servers + DataChannel error protocol"

**包含的 telos 文件** (2 files):

1. **`facts/default-ice-servers.md`** (新建)

   - 默认 STUN 服务器: `stun:stun.l.google.com:19302`
   - Privacy 声明: "仅用于 NAT 打洞，用户可在 config.toml 替换或清空"
   - TURN 空数组的不穿透警告: 对称 NAT / 企业防火墙后无 STUN+TURN 则无法直连
   - config.toml 示例路径: `[ice_servers]` 段，用户可覆盖
   - 与 `rendezvous-federation-not-turn.md` 的关系: 联邦不提供 TURN，用户 BYO

2. **`decisions/datachannel-error-protocol.md`** (新建)
   - DTLS fingerprint Ed25519 verify 失败 → 关闭 PeerConnection, 不发送任何 error 给对端 (对端身份未验证)
   - peer_id 不在 known_peers 中 → 同上拒绝
   - DTLS certificate mismatch (WebRTC 自动检测) → connectionState→failed → CLI exit 1
   - room:hello 版本不兼容: major mismatch → 关闭 DataChannel + CLI exit 1; minor mismatch → 接受 + capabilities 协商
   - DataChannel open 超时 30s → 关闭 PeerConnection
   - SDP answer 超时 30s → 关闭 PeerConnection
   - 确定 P2P 错误码枚举 (至少: fingerprint_mismatch, peer_unknown, version_mismatch, datachannel_timeout, sdp_timeout, ice_failed)
   - CLI 退出码约定: 0=成功, 1=失败, 2=信号中断

**涉及的 audit/blind ID**: Resolves U-3, U-5, U-6, U-12; D-1, D-3; I-2, I-4, I-5

**估计大小**: **M** brief (2 files, 配置 + 错误路径)

**推荐顺序**: **第 3 个跑** (依赖最少 — 可以最早跑或并行跑, 但 error protocol 中的 DataChannel open 超时 和 SDP answer 超时 依赖 #B 的 signal payload 定义)

---

### §B 汇总

| Brief                             | 文件数 | 大小 | 解决 MUST 项        | 推荐顺序 |
| --------------------------------- | ------ | ---- | ------------------- | -------- |
| #A — CLI architecture + lifecycle | 2      | L    | U-1, U-4, U-11      | 1st      |
| #B — DataChannel + signal payload | 2      | M    | U-2, U-7            | 2nd      |
| #C — ICE/STUN + error protocol    | 2      | M    | U-3, U-5, U-6, U-12 | 3rd      |

**总 MUST-SEDIMENT-BEFORE-M3 文件数**: 6 (与 audit §C.1 完全一致)

**依赖图**:

```
#A (CLI architecture)  ← 基础，其他 brief 引用
  ├── #B (DataChannel + signal payload) ← 引用 #A 的模块路径
  └── #C (ICE/STUN + error protocol)    ← 引用 #B 的 signal 超时值
```

---

## §C: BACKLOG additions (DEFER-POST-M3)

以下为 **不在现有 BACKLOG.md 中** 的新条目，来源为 blind-only 发现或 audit cross-slice 项未入 BACKLOG 者。

| #   | Source    | Topic                                                      | 说明                                                                                                                                                                                     | 建议 revisit        |
| --- | --------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| C-1 | U-15      | M4 transcripts 与 M3 CLI 文件格式兼容                      | M3 CLI 无 daemon 无 transcript.jsonl。如果 M3 CLI 把文件存在 `~/Downloads/` 不写 transcript，M4 daemon 启动时如何发现和承认这些文件？需在 M4 实施时设计迁移路径。                        | M4                  |
| C-2 | D-12      | known_peers trust:tofu 在 P2P 连接时的 CLI 行为            | `facts/known-peers-toml-schema.md` 定义 trust: "tofu"，但 M3 P2P 连接时对 tofu peer 的行为未定义（是否允许 DataChannel 建立？CLI 警告程度？）。Daemon 阶段 (M4) 的长期 tofu 策略应统一。 | M4                  |
| C-3 | D-8       | bulk channel 创建失败 → 退化为纯消息连接的正式策略         | Blind 选了 graceful degradation，但这是 telos 盲区。M4 引入 daemon 后可能有不同的连接降级策略（如自动重试 bulk channel）。                                                               | M4                  |
| C-4 | I-8, U-13 | DataChannel 同 PC 内重开 vs 完全重建 PeerConnection 的策略 | Blind 选了 "同 PC 内重开 DataChannel + 文件从头重传"，但 telos 未沉积。与 U-13 (PeerConnection 重连) 关联 — M4 可能需要更完整的重连策略（含 ICE restart）。                              | M4                  |
| C-5 | D-10      | 无应用层 chunk 重传/ACK — 依赖 SCTP 可靠传输               | Blind 确认不做 chunk ACK，但 SCTP 的可靠传输在极端网络条件下（packet loss > 30%）可能有 tail latency 问题。如未来性能问题浮现，此决策需要重访。                                          | M4 (性能数据积累后) |

> **不重复添加**: B-1..B-12、U-16 (resync)、U-17 (chunk seq semantics) 已在现有 BACKLOG.md 中跟踪。

---

## §D: Telos amendments needed (existing files)

### §D.1 C-1: `room:file_accept/reject/done/abort` 缺少 `seq` vs `per-sender-seq-numbering.md`

- **Existing file**: `.telos/decisions/per-sender-seq-numbering.md` (primary); `docs/protocol.md` §5 (secondary, field tables)
- **Conflict**: `per-sender-seq-numbering.md` line 37 说 "`room:msg`、`room:file_offer`、`room:system` 等**所有** `room:*` 消息类型共享同一个 seq 空间"。但 `protocol.md` §5 的字段表中只有 `room:msg` 和 `room:file_offer` 有 `seq` 字段。`room:file_accept`、`room:file_reject`、`room:file_done`、`room:file_abort`、`room:hello`、`room:ping`、`room:pong` 均无 `seq`。
- **真矛盾**: ✅ — 逐字验证了 `per-sender-seq-numbering.md` 原文 ("所有 room:_ 消息类型共享同一个 seq 空间") 与 `protocol.md` §5 所有消息类型字段表。`protocol.md` §5 给予 seq 的类型仅为 msg + file_offer，其他 7 种 room:_ 类型均无 seq。
- **Amendment direction** (推荐):
  - **朝向 A** (amend telos): 将 `per-sender-seq-numbering.md` 的 "所有 room:_ 消息类型" 改为 "所有 sender-generated 应用层 room:_ 消息 (room:msg, room:file_offer, room:file_done, room:file_abort)"。明确 receiver-generated 消息 (file_accept, file_reject) 和协议管理消息 (hello, ping, pong) 不参与 seq。
  - **朝向 B** (amend protocol.md): 给 `room:file_done`、`room:file_abort` 加 `seq` 字段 (sender 生成时)。`room:file_accept`、`room:file_reject` 不加 (receiver one-shot ack)。`room:hello`/`ping`/`pong` 不加 (协议管理层)。
  - **推荐**: **同时做 A + B** — amend telos 的 "所有" → "sender-generated application messages"，同时在 protocol.md 给 file_done/file_abort 加 seq (因为它们由 sender 生成，且在 transcript 中按 seq 排序是合理的)。
- **A19 边界**: 只指出方向和两个文件各需改什么，不写具体 markdown 内容。

### §D.2 C-2: `room:file_chunk` 无 `ts` vs `transcript-jsonl-per-room.md`

- **Existing file**: `.telos/decisions/transcript-jsonl-per-room.md`
- **Alleged conflict**: transcript-jsonl 说 "记录原始消息帧的完整数据" — blind 认为这暗示所有消息都有 ts
- **真矛盾**: ❌ **NOT-CONFLICT**
- **分析**: `transcript-jsonl-per-room.md` 的 "完整数据" 指的是不截断字段值，不是说每个 frame 必须有 ts。`protocol.md` §5 明确给 `room:file_chunk` 仅 4 个字段 (type, file_id, seq_num, data) — 无 ts 是**有意设计** (bulk channel 上千 chunk, 每个 8-byte ts 浪费带宽)。transcript 会忠实地记录 chunk frame 的 CBOR 内容 (不含 ts)，这与 "记录原始消息帧" 完全一致。
- **Amendment direction**: **不需要 amend**。如追求极致清晰，可在 `transcript-jsonl-per-room.md` 加一句 "部分帧类型 (如 room:file_chunk) 不含 ts 字段，transcript 以帧原样记录"。

### §D.3 C-3: BACKLOG U-7 vs protocol.md §3 已有 sub-envelope

- **Existing file**: `docs/protocol.md` §3
- **Alleged conflict**: protocol.md §3 已给出 `{subtype, sdp, fingerprint, signature, peer_id, timestamp, nonce}` — U-7 要 sediment 的 fact 是否多余？
- **真矛盾**: ❌ **NOT-CONFLICT**
- **分析**: `protocol.md` §3 step 3 仅定义 `webrtc_offer` 子类型。`webrtc_answer` 的字段集 (是否也需要 fingerprint + signature? per step 6 "Bob 侧同样流程" — 但未显式列出) 和 `ice_candidate` 的字段集 (sdp? candidate? sdp_mid? sdp_mline_index?) 是空白的。U-7 的 `facts/p2p-signal-payload-format.md` 恰好填补这些空白 — 这是**互补**而非矛盾。
- **Amendment direction**: **不需要 amend**。U-7 sediment 完成后 protocol.md 和 fact 各司其职 — protocol.md 定义 webrtc_offer 的字节级格式，fact 枚举所有 3 种子类型。

### §D.4 C-4: M3 CLI 与 daemon 的关系 — U-1 未决策

- **Existing file**: `.telos/BACKLOG.md`
- **Alleged conflict**: BACKLOG 标记 U-1 为 block-M3-start 但未有决策文件
- **真矛盾**: ❌ **NOT-CONFLICT**
- **分析**: 这是正确的 gap-tracking workflow — BACKLOG 说"需要 sediment U-1"，U-1 确实还没 sediment。这是 work-in-progress 状态，不是 telos 内部矛盾。`m2-cli-bypasses-daemon.md` 的 Boundary 说 "M3 CLI 通信路径不在本 decision 范围内" — 这是**有意划界**，不是遗漏。Brief #A 将解决此 gap。
- **Amendment direction**: **不需要 amend**。Brief #A 产出 `decisions/m3-cli-p2p-bypass-daemon.md` 后此 gap 关闭。

### §D.5 C-5: 500 MiB 文件上限来源

- **Existing file**: `.telos/facts/webrtc-datachannel-limits.md` + `.telos/facts/inbox-directory-structure.md`
- **Alleged conflict**: 两个文件都说 500 MiB 但可能是 "aesthetic choice" 而非协议推导
- **真矛盾**: ❌ **NOT-CONFLICT**
- **分析**: 两个 telos 文件**完全一致** — 都写 "500 MiB（可配置）"。blind 质疑的是 "这个数字是不是人为选的"，不构成 telos 内部矛盾。500 MiB 作为一个合理上限（约 8000 chunks, ~2 小时在 5 Mbps 链路上），两个文件一致声明是可接受的。
- **Amendment direction**: **不需要 amend**。如果未来有人追问来源，可以在 `webrtc-datachannel-limits.md` 加一句来源说明 (如 "based on practical transfer time and memory budget at 64 KiB chunk size")。

### §D 汇总

| C-# | 真矛盾? | 需 amend?                                                   | 文件                 |
| --- | ------- | ----------------------------------------------------------- | -------------------- |
| C-1 | ✅ YES  | ✅ amend `per-sender-seq-numbering.md` + 可选 `protocol.md` | 1 telos + 1 protocol |
| C-2 | ❌      | ❌ (可选 minor clarify)                                     | —                    |
| C-3 | ❌      | ❌ (complementary)                                          | —                    |
| C-4 | ❌      | ❌ (gap tracking, resolved by Brief #A)                     | —                    |
| C-5 | ❌      | ❌ (consistent)                                             | —                    |

---

## §E: Final summary

### 数字

| 指标                                 | 值                                     |
| ------------------------------------ | -------------------------------------- |
| 总 finding 数 (去重后)               | **41**                                 |
| block-M3-start sediment 文件数       | **6** (3 briefs, 2 files each)         |
| block-M3-exit 项 (边实施边 sediment) | **9** 行 → 分散到 3-4 个 sediment 文件 |
| BACKLOG 新添加 (不在现有 BACKLOG 中) | **5** 条                               |
| Telos amendment (真矛盾)             | **1** → `per-sender-seq-numbering.md`  |
| audit/blind 方向冲突 (CONFLICT)      | **0**                                  |

### M3 可启动判断

**M3 在所有 §B brief 落地后即可启动。**

理由:

1. **6 个 block-M3-start 项** 覆盖了 M3 实施前必须解决的所有架构/protocol/安全未知:

   - Brief #A 明确 CLI 架构路径 (U-1) 和 PeerConnection 生命周期 (U-4) — M3 CLI 实现的直接前置
   - Brief #B 明确 DataChannel 协商 (U-2) 和 signal payload 格式 (U-7) — P2P 连接的协议基础
   - Brief #C 明确 ICE servers (U-3) 和错误路径 (U-5, U-6, U-12) — 功能门槛 + 安全关键路径

2. **9 个 block-M3-exit 项** 可用 reasonable defaults 推进，在 M3 实施中逐项 sediment — 不阻塞启动。

3. **1 个真矛盾** (C-1) 的 amendment (per-sender-seq-numbering.md) 的推荐方向 (朝向 A+B) 已在 §D.1 中标出。amendment 内容小 (一句话 scope clarification + protocol.md 两个字段)，可在 Brief #B 或 #C 执行时顺手修正，或作为独立的一行 amend。

4. **0 个 CONFLICT** — audit 和 blind 在所有方向性判断上一致 (AGREE 12 行)。blind 的 14 个 D-items 和 5 个 C-items 全部是补充信息，没有推翻 audit 的任何结论。

### 实施路径

```
Phase 0 (本计划) ─ 当前
  │
Phase 1: Amend per-sender-seq-numbering.md (C-1) ─ 10 分钟, 独立 amend
  │
Phase 2: Brief #A (CLI architecture + lifecycle) ─ L brief, 预计 45-60 分钟
  │
Phase 3: Brief #B (DataChannel negotiation + signal payload) ─ M brief, 预计 30 分钟
  │   (可与 Phase 2 并行起草，最终依赖 #A 的模块路径)
  │
Phase 4: Brief #C (ICE/STUN + error protocol) ─ M brief, 预计 30 分钟
  │   (可与 Phase 2/3 并行起草)
  │
  ├─ 全部 MUST sediment 文件就绪 ─ M3 可启动 ✅
  │
Phase 5: M3 实施启动 ─ 4-6 个实现 briefs
  │   同步 sediment block-M3-exit 项 (U-8~U-12 + D-7/D-8/D-10/I-10)
  │
Phase 6: M3 退出条件 ─ 全 platform CI 绿 (send/send-text/recv E2E)
```

### 文件碰撞检查

Audit §C.1 推荐的 6 个文件名全部无碰撞 (`.telos/decisions/` 和 `.telos/facts/` 中均无同名文件):

- ✅ `decisions/m3-cli-p2p-bypass-daemon.md` — not found
- ✅ `decisions/datachannel-negotiation-two-channels.md` — not found
- ✅ `facts/default-ice-servers.md` — not found
- ✅ `facts/peerconnection-lifecycle.md` — not found
- ✅ `decisions/datachannel-error-protocol.md` — not found
- ✅ `facts/p2p-signal-payload-format.md` — not found

### Spot-check 日志

| Check          | Target                                                                  | Result                                                                               |
| -------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| C-1 真矛盾验证 | `per-sender-seq-numbering.md` line 37 vs `protocol.md` §5 全表          | ✅ CONFIRMED — "所有 room:\* 共享 seq" overstates; only msg+file_offer have seq      |
| C-2 真矛盾验证 | `transcript-jsonl-per-room.md` vs `protocol.md` §5 file_chunk table     | ❌ NOT-CONFLICT — transcript records frames as-is; file_chunk intentionally lacks ts |
| C-3 真矛盾验证 | `protocol.md` §3 step 3 vs U-7 scope                                    | ❌ NOT-CONFLICT — proto.md covers webrtc_offer only; answer/ice_candidate are gaps   |
| C-4 真矛盾验证 | BACKLOG U-1 checkbox vs `m2-cli-bypasses-daemon.md`                     | ❌ NOT-CONFLICT — gap tracking, not contradiction                                    |
| C-5 真矛盾验证 | `webrtc-datachannel-limits.md` + `inbox-directory-structure.md` 500 MiB | ❌ NOT-CONFLICT — both consistent                                                    |
| 文件碰撞检查   | 6 x `ls .telos/{decisions,facts}/`                                      | ✅ ALL CLEAR                                                                         |
