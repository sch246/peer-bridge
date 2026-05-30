# BACKLOG — 已知缺口

M0 agent-blind 检查已完成（闭卷重做）。所有 gap 已回填。

## M0 退出状态 ✅

- [x] M0 telos bootstrap（9 facts + 12 decisions + 2 tensions）
- [x] docs/protocol.md（字节级协议规范，10 节 + 3 附录）
- [x] Test vectors（6 文件，覆盖 5 个原语）
- [x] agent-blind 检查 — 闭卷重做 + diff + 回填全部完成
- [x] G1-G5 全部修复（新增 2 facts + 2 decisions）

## Agent-Blind Diff 结果

**G1-G5 已修复**（新增文件）：

- ✅ G1: 文件落盘路径 → `facts/inbox-directory-structure.md`
- ✅ G2: SQLite schema → `facts/daemon-sqlite-schema.md`
- ✅ G3: read_at 未读管理 → `facts/daemon-sqlite-schema.md`（含未读计数查询）
- ✅ G4: transcript.jsonl 位置与格式 → `decisions/transcript-jsonl-per-room.md`
- ✅ G5: 1:1 房间隐式创建 → `decisions/implicit-1to1-room-creation.md`

**Agent 推断 I-1 到 I-7**（低优先级，M1 实现前可补）：

- I-1: known_peers.toml schema — 已在 protocol.md 中有格式，fact 可补
- I-2: SQLite schema — 已补（G2）
- I-3: transcript.jsonl 格式 — 已补（G4）
- I-4: seq 跨连接生命周期 — 已落地在 `decisions/per-sender-seq-numbering.md`（持久化 seq，跨重启不归零）
- I-5: IPC 事件 schema — 待补充到 protocol 附录
- I-6: msg 与 file_offer 共享 seq 空间 — 已落地在 `decisions/per-sender-seq-numbering.md`（类型间共享同一 seq）
- I-7: Room membership state machine — 第二版功能，第一版不暴露 API

## M1 阔清状态

- [x] `packages/protocol`：types / peer-id / frame / invite + 13/13 vectors
- [x] `packages/core`：identity / sealed-box / fingerprint / known-peers / invite + 15/15 round-trip tests
- [x] crypto 库切 libsodium-wrappers + 集中化 `crypto-init.ts`
- [x] CBOR 语义匹配 runner
- [x] `room:file_offer` CBOR key collision 修复 + regression-guard vector
- [x] Resync 和 v2 room management 从 M1 `RoomMessage` union 移除

## M1 退出状态 ✅

- [x] **`sealed_box.json` 接入 runner**（commit `218fa11` — `vectors.test.ts` 中 3 组 sealed-box 向量全部通过）
- [x] **`fingerprint_sig.json` 接入 runner**（commit `218fa11` — `vectors.test.ts` 中 3 组 fingerprint 向量全部通过）
- [x] **`packages/core/src/known-peers.ts` 单测**（commit `c215449` — 35 个单测覆盖 parse、serialize、file I/O、findPeer、isTrusted）
- [x] **`packages/core/src/invite.ts` 单测**（commit `4e55b28` — 29 个单测覆盖 createInvite / buildInviteCreatePayload / buildInviteRedeemPayload / addPeerFromInvite / verifyPeerTrust）
- [x] **三平台 CI matrix**（commit `3dba86f` — `.github/workflows/ci.yml`，3 OS × 2 Node version = 6 matrix cells）

## M2 启动准入（已通过；保留供历史参考）

M2 启动准入条件已于 brief #1 之前满足：M1 全部关闭 + telos 存量足够 + CI matrix 就绪（M2 内已收敛至 3 cells per `decisions/node-22-minimum.md`）。当前 telos 计数以 `ls .telos/` 为准，不在本表重复。

## M2 in-scope（DESIGN.md §11.M2）

- [x] 单 server 实现，无联邦（commit 3f192e7）
- [x] `core` 的 rendezvous-client（含 sealed box 离线 notify）（briefs #2a-#2d: 3e2c287, bc83c0b, 093510e, 42903e9）
- [x] 邀请码端到端流程跑通（CLI 层）（briefs #3a/#3b/#3c: ffe7789, 1f0d27f, 18e0e97）
- [x] 三平台 CI 跑通 invite/accept（brief #4 cascade: 981f09f, 035455c, 8e2ca6e, 0b38158, 775f546）

**M2 实施层关闭**：262 pass + 1 skip 全绿，CI 三平台 × Node 22 全绿。退出条件 (下方) 待履行。

下一步：M2 退出仪式（agent-blind 重跑 + 6 个 block-exit unknowns + Q7 决策 + telos consolidation pass）。

## M2 known unknowns

以下项 M2 实现需要决策，但 telos 尚未沉淀为 fact/decision：

| #   | 未知项                                                        | 所属 DESIGN.md §                                     | 缺失原因                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | rendezvous server 的持久化模型                                | §6.1                                                 | **已决定：in-memory only**。DESIGN.md §6.1: "运行时数据全内存，重启丢失可接受"。无需单独 telos 文件；约束已沉淀在 `facts/rendezvous-server-config.md`。可选 SQLite 仅用于持久化 federation 配置和管理员设置                                               |
| 2   | sealed-box 通知队列容量上限与 TTL 清理策略                    | §3.8 sealed-box-for-offline-notify                   | ✅ resolved → `decisions/m2-notification-queue-unbounded.md`（unbounded queue, lazy TTL on delivery, no periodic sweep for M2）                                                                                                                           |
| 3   | WebSocket 信令消息的 JSON schema 与错误码枚举                 | §5.1 信令格式                                        | DESIGN.md §5.1 给了 prose 描述 + 示例，但 M0 test vectors 未生成信令级的 (input, output) 向量；M2 实现需要 validate 字段齐全、错误码枚举不漂移 → ✅ resolved: `facts/signaling-message-fields.md`                                                         |
| 4   | rendezvous 的速率限制与 DoS 防御姿态                          | §12.5 "rendezvous 对单 IP 的 invite/lookup 速率限制" | ✅ resolved → `decisions/m2-rate-limit-invite-create-only.md`（M2 仅 rate-limit invite_create per IP；lookup/register/redeem/signal/notify defer to M3+）                                                                                                 |
| 5   | 联邦协议的 hook 预留（M6 才实现但 M2 信令格式不能 foreclose） | §3.5 rendezvous-federation-not-turn                  | decision `rendezvous-federation-not-turn.md` 记录了 JSON-RPC 联邦的 strategy 选择，但 M2 单-server 的 WebSocket 消息是否携带 `federation_id` / `origin_server` 字段作为 forward-compat 占位，目前未决策 → ✅ deferred to M6 — M2 信令不含 federation 字段 |

## M2 agent-blind 检查结果

**Date**: 2026-05-30 | **Protocol**: `decisions/agent-blind-check-protocol.md` | **Source diff**: `m2-blind-design.md` vs `m2-design-diff.md`

### 总览

18 declared gaps (G-1..G-18) classified against DESIGN.md:

| Classification                      | Count | Gaps                                                                          |
| ----------------------------------- | ----- | ----------------------------------------------------------------------------- |
| Resolved-in-DESIGN（blind-correct） | 2     | G-1 (in-memory persistence), G-13 (sealed-box encryption)                     |
| Resolved-in-DESIGN（blind-wrong）   | 3     | G-10 (known-peers schema), G-16 (CLI→daemon path), G-18 (Fastify vs raw http) |
| Partially-resolved                  | 8     | G-2, G-5, G-6, G-8, G-9, G-14, G-15, G-17                                     |
| Genuinely-undecided                 | 5     | G-3, G-4, G-7, G-11, G-12                                                     |

### 14 telos coverage findings (T-1..T-14)

**Resolved this turn — new telos files backfilled**:

| #    | Finding                                        | Resolution       | File                                                     |
| ---- | ---------------------------------------------- | ---------------- | -------------------------------------------------------- |
| T-1  | known-peers TOML schema wrong in blind report  | fact created     | `facts/known-peers-toml-schema.md`                       |
| T-2  | Missing fingerprint confirmation during accept | decision created | `decisions/manual-fingerprint-confirmation-on-accept.md` |
| T-3  | Rendezvous framework: Fastify not raw http     | fact created     | `facts/rendezvous-tech-stack.md`                         |
| T-5  | server.toml config format not addressed        | fact created     | `facts/rendezvous-server-config.md`                      |
| T-6  | register_ok field drift (origin_server)        | fact created     | `facts/signaling-message-fields.md`                      |
| T-14 | M2 CLI bypasses daemon (M4-revert)             | decision created | `decisions/m2-cli-bypasses-daemon.md`                    |

**T-4 (health check response fields)**: partially resolved — `facts/rendezvous-server-config.md` covers server config surface; health check field spec lives in DESIGN.md §6.1 and protocol.md Server Limits. Not yet a separate telos fact (lower priority than block-M2-start items).

**Remaining — genuinely undecided (T-7..T-13)**:

| #    | Item                                                     | Status                                                        |
| ---- | -------------------------------------------------------- | ------------------------------------------------------------- |
| T-7  | Per-peer notification queue capacity + overflow strategy | block-M2-exit — DESIGN.md silent. Needs decision file         |
| T-8  | Notification queue TTL cleanup schedule                  | block-M2-exit — DESIGN.md silent. Needs decision file         |
| T-9  | Rendezvous WebSocket keepalive (ping/pong intervals)     | cross-slice — affects M4 daemon too                           |
| T-10 | Register deduplication strategy                          | block-M2-exit — DESIGN.md silent                              |
| T-12 | Per-IP rate limiting thresholds beyond invite_create     | block-M2-exit — DESIGN.md says "必须做" but doesn't enumerate |
| T-13 | Error response format beyond invite_result               | block-M2-exit — partially in §5.1, not exhaustive             |

**T-11 (WebSocket close reason codes)**: cross-slice, low priority — can be decided during implementation.

### 3 outright errors caught

1. **known-peers schema**: blind used `[[peers]]` (plural), `name` (not `alias`), `trust = "trusted"` (not enum). → `facts/known-peers-toml-schema.md`
2. **Fastify**: blind chose raw Node.js `http`. DESIGN.md §6.1 requires Fastify + ws. → `facts/rendezvous-tech-stack.md`
3. **Fingerprint confirmation**: blind auto-adds without prompt. DESIGN.md §3.6 + §12 require manual confirmation. → `decisions/manual-fingerprint-confirmation-on-accept.md`

---

## M2 退出条件 (实现完成时检查)

以下条目必须在 M2 标记为"完成"前满足。每个条目 cite 来源（agent-blind 表、本 audit、或 telos fact）。

- [x] **Re-run agent-blind check**：M2 实现完成后重跑 agent-blind 闭卷实验。✅ Done in this commit. Audit trails at `.telos/audit-trails/m2-blind-client-2026-05-30.md` (闭卷设计) and `.telos/audit-trails/m2-blind-diff-2026-05-30.md` (分类 + impl diff). Diff classified 10 items: 1 telos-amend (close-code response → this commit), 4 impl-detail, 3 already-covered, 2 audit-trail moves. Plus 1 BACKLOG entry: capabilities not declared from constructor (see Post-M2). 上次回填的 6 个 telos 文件（commit `a89920e`）包括 WRONG-class 缺口：G-10（known_peers schema 被 blind 误用 `[[peers]]`/`name`/`trust = "trusted"`）和 G-18（blind 选择 raw Node.js `http` 而非 Fastify）。按 `decisions/agent-blind-check-protocol.md` 的"Re-run after backfill"准则（REFERENCE.md §Re-run after backfill）：回填包含 WRONG 级缺口时重跑**必须**而非可选——否则无法确认修正后的 telos 是否消除了此前误导。
- [x] **Resolve block-M2-exit known-unknowns**（来自 M2 agent-blind 表 T-4, T-7, T-8, T-10, T-12, T-13）：
  - T-4 ✅ — health check response fields → `facts/rendezvous-health-endpoint.md`（this brief）
  - T-7 + T-8 ✅ — notification queue capacity + TTL cleanup → `decisions/m2-notification-queue-unbounded.md`（commit `7d2683e`）
  - T-10 ✅ — register dedup + orphan-socket edge → amended `decisions/reconnect-requires-reregister.md`（this brief）
  - T-12 ✅ — rate limit scope: invite_create-only for M2 → `decisions/m2-rate-limit-invite-create-only.md`（commit `7d2683e`）
  - T-13 ✅ — error transport envelope → `facts/signaling-message-fields.md` §Error transport（commit `7d2683e` + `92fade4`）
- [x] **Resolve timing/state-machine MISSING items**（来源：本 commit 的 pre-M2 audit `m2-pre-impl-checks.md` §3）：
  - Q3 (peer disconnect behavior: immediate offline vs grace period) — ✅ resolved by `decisions/disconnect-immediate-offline.md`（commit `4146b95`）
  - Q4 (concurrent in-flight requests + response correlation) — ✅ resolved by `decisions/signaling-fifo-no-request-id.md`（commit `4146b95`）
  - Q7 (invite_record deletion criteria: cancel + disconnect cases) — ✅ resolved by D1 (disconnect-immediate-offline): invite_records 不依赖 socket，由 redeem/expiry/60s sweep 三路径删除。详见 m2-exit-investigation §Q7
  - Q8 (reconnect: client re-sends register vs server preserves session) — ✅ resolved by `decisions/reconnect-requires-reregister.md`（commit `4146b95`）
- [x] **Verify rendezvous dependencies**：`packages/rendezvous/package.json` 添加 `fastify` + `ws` + `@fastify/websocket`（`facts/rendezvous-tech-stack.md` 已将其标注为 gap："M2 实现时添加"）（commit 3f192e7）

## 其他 BACKLOG（不阻塞 M2）

- [ ] **Resync 消息重新引入 M4 时遵守 `unique-cbor-keys-not-message-scoped`**（之前的半成品把 `from_seq`/`to_seq` 填进 `seq`/`sha256` key，是反例）
- [ ] **v2 room management 重新引入同上约束**
- [ ] **同步函数不调 sodium 的 ESLint 规则**（现在是 `crypto-library-mapping.md` 里的 prose discipline，reviewer F11 建议 enforceable化）
- [ ] **PGP word list 减量**（256 个 dead entries，reviewer F2）
- [x] **agent-blind protocol 升级**：让 subagent 输出"我做了哪些 telos 没规定的工程决定"——这些是 telos 覆盖盲区候选（见 `decisions/agent-blind-check-protocol.md` 未来增添）。✅ 实际在 M2 退出仪式里实施：`audit-trails/m2-blind-client-2026-05-30.md` §4 是升级定义的首次实践（出 5 项 "telos 没明说的工程决定"），§4 分类产出于 `m2-blind-diff-2026-05-30.md`。

## Post-M2 BACKLOG (surfaced during M2 exit investigation)

Items found during M2 exit investigation that are NOT block-M2-exit but should be tracked:

- **§A1** `{type:"error"}` envelope is server-emitter-less today (only client handler exists). Treat as reserved forward-compat per `signaling-message-fields.md` Error transport. Decision: actually emit it from server, OR remove from client. Defer to M3+.
- **§A3** DESIGN.md §12 promises lookup rate limiting; M2 ships invite_create-only (per `m2-rate-limit-invite-create-only.md`). Either implement lookup rate limit or update DESIGN.md to match. Defer to M5 production deployment.
- **§A5** Rate limiter integration test gap: `RateLimiter` class is unit-tested but not exercised through full server WS dispatch (no test sends 21 invite_create + verifies 1013 close). Add integration test in M3+.
- **B-4** `RendezvousClient` constructor does not accept or send `capabilities` (current impl sends `{ capabilities: {} }`). M3+ may gate WebRTC signaling on capability flags. Source: `m2-blind-diff-2026-05-30.md` §B-4 + `signaling.ts:307`.

Source: `.telos/audit-trails/m2-exit-investigation-2026-05-30.md` §8.

## M3 启动准入

M3 sanity probe 过（commit `7f2e7ac`）：`node-datachannel@0.32.3` 三平台 × Node 22 全绿（CI run [26687227899](https://github.com/sch246/peer-bridge/actions/runs/26687227899)）。选型可行。

M3 启动 audit 进行中：`.telos/audit-trails/m3-startup-audit-2026-05-30.md`。Audit 结论是 **M3 不可直接启动，必须先 sediment 6 个 block-M3-start telos 项**（§C.1）：

- [x] **U-1**: `decisions/m3-cli-p2p-bypass-daemon.md` — M3 CLI 绕过 daemon 的 P2P 接入路径（commit `14c2e62`）
- [x] **U-2**: `decisions/datachannel-negotiation-two-channels.md` — control + bulk 双通道协商方式（commit `0ec442b`）
- [x] **U-3**: `facts/default-ice-servers.md` — 默认 STUN 服务器列表 + privacy 声明（commit `d862be4`）
- [x] **U-4**: `facts/peerconnection-lifecycle.md` — PeerConnection 建立/关闭/忽略超时触发（commit `14c2e62`）
- [x] **U-5+U-6**: `decisions/datachannel-error-protocol.md` — fingerprint verify / capabilities / DataChannel open 超时等错误路径。含 `room:hello` 版本不匹配行为（commit `d862be4`）
- [x] **U-7**: `facts/p2p-signal-payload-format.md` — `signal.payload` 内容 JSON sub-envelope（webrtc_offer/webrtc_answer/ice_candidate）（commit `0ec442b`）

另有 5 个 block-M3-exit 项（U-8 · bulk 流控阈值 / U-9 · 进度上报频率 / U-10 · SHA-256 校验时机 / U-11 · CLI recv 模式 / U-12 · P2P 错误码 taxonomy）及 3 个 cross-slice 项（U-13 · DataChannel 重连 / U-14 · capabilities 枚举 / U-15 · M3 文件与 M4 transcript 兼容）可边实施边沉淀。

Scope ledger（详 audit §B，12 项明确不在 M3）作为隐性 scope creep 护栏：文件断点续传 / SQLite room state / daemon + IPC / 通知 hook / 离线暂存拉取 / 多人房间 / resync / 联邦 / pi extension / ICE restart / 预览缩略图 / 群组加密 forward secrecy。

下一步：pre-impl agent-blind check（闭卷 M3 设计 vs telos）→ diff vs audit → 合并后一次性 sediment。

### M3 启动 sediment 完结

6 个 block-M3-start telos 文件全部落地 (Phases 1–4，commit `2b49c4d` → `14c2e62` → `0ec442b` → `d862be4`)。C-1 真矛盾在 Phase 1 以 amend `per-sender-seq-numbering.md` + `docs/protocol.md` §5 关闭。264/264 测试全绿。**M3 可启动实施。**

### Post-M3 BACKLOG（sediment plan §C 出）

- **MC-1** M4 transcripts 与 M3 CLI 文件格式兼容（U-15）— M3 CLI 无 daemon 无 transcript.jsonl。如果 M3 CLI 把文件存在 `~/Downloads/` 不写 transcript，M4 daemon 启动时如何发现和承认这些文件？需在 M4 实施时设计迁移路径。Revisit M4。
- **MC-2** known_peers `trust:tofu` 在 P2P 连接时的 CLI 行为（D-12）— `facts/known-peers-toml-schema.md` 定义 trust: "tofu"，但 M3 P2P 连接时对 tofu peer 的行为未定义（是否允许 DataChannel 建立？CLI 警告程度？）。Daemon 阶段 (M4) 的长期 tofu 策略应统一。Cross-link: 与 `manual-fingerprint-confirmation-on-accept.md` 的 "manual confirm" 严格度有 tension。Revisit M4。
- **MC-3** bulk channel 创建失败 → 退化为纯消息连接的正式策略（D-8）— Blind 选了 graceful degradation，但这是 telos 盲区。M4 引入 daemon 后可能有不同的连接降级策略（如自动重试 bulk channel）。Revisit M4。
- **MC-4** DataChannel 同 PC 内重开 vs 完全重建 PeerConnection 的策略（I-8 + U-13）— Blind 选了 "同 PC 内重开 DataChannel + 文件从头重传"，但 telos 未沉积。与 U-13 (PeerConnection 重连) 关联 — M4 可能需要更完整的重连策略（含 ICE restart）。Revisit M4。
- **MC-5** 无应用层 chunk 重传/ACK — 依赖 SCTP 可靠传输（D-10）— Blind 确认不做 chunk ACK，但 SCTP 的可靠传输在极端网络条件下（packet loss > 30%）可能有 tail latency 问题。如未来性能问题浮现，此决策需要重访。Revisit M4（性能数据积累后）。

> Origin annotation: verbatim from `.telos/audit-trails/m3-startup-sediment-plan-2026-05-30.md` §C (原文 C-1..C-5). Recovery commit `74f8038` from compressed-from-memory predecessor `beb436b`.

### Audit trail housekeeping (M4 startup)

- **MC-6** `.telos/audit-trails/README.md` — 补一份简要说明：这些是 brief sequence 留下的 traceable graph，从 commit hash 可反向找到设计源头。Audience 在 M4+ 启动时出现 (audit/blind/sediment plan 贯穿多 milestone)。Revisit M4 启动前。

## 下阶段

→ **M3: P2P 传输**（M2 退出条件满足后）
