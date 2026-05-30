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
| 2   | sealed-box 通知队列容量上限与 TTL 清理策略                    | §3.8 sealed-box-for-offline-notify                   | decision `sealed-box-for-offline-notify.md` 仅规定加密原语选择，未定义 per-peer 队列容量、溢出策略（drop-oldest? reject-new?）或 TTL 过期清理的触发时机（lazy-clean? cron tick?） → tracked as T-7, T-8 in M2 退出条件                                    |
| 3   | WebSocket 信令消息的 JSON schema 与错误码枚举                 | §5.1 信令格式                                        | DESIGN.md §5.1 给了 prose 描述 + 示例，但 M0 test vectors 未生成信令级的 (input, output) 向量；M2 实现需要 validate 字段齐全、错误码枚举不漂移 → ✅ resolved: `facts/signaling-message-fields.md`                                                         |
| 4   | rendezvous 的速率限制与 DoS 防御姿态                          | §12.5 "rendezvous 对单 IP 的 invite/lookup 速率限制" | §12.5 只说"必须做"但未给出具体阈值、窗口算法、驳回响应码；是 prose 约束不是可测 spec → tracked as T-12 in M2 退出条件                                                                                                                                     |
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

- [ ] **Re-run agent-blind check**：M2 实现完成后重跑 agent-blind 闭卷实验。上次回填的 6 个 telos 文件（commit `a89920e`）包括 WRONG-class 缺口：G-10（known_peers schema 被 blind 误用 `[[peers]]`/`name`/`trust = "trusted"`）和 G-18（blind 选择 raw Node.js `http` 而非 Fastify）。按 `decisions/agent-blind-check-protocol.md` 的"Re-run after backfill"准则（REFERENCE.md §Re-run after backfill）：回填包含 WRONG 级缺口时重跑**必须**而非可选——否则无法确认修正后的 telos 是否消除了此前误导。
- [ ] **Resolve block-M2-exit known-unknowns**（来自 M2 agent-blind 表 T-4, T-7, T-8, T-10, T-12, T-13）：
  - T-4: health check response fields 规格化（`facts/rendezvous-server-config.md` 已覆盖 server config surface，health check field spec 仍仅存于 DESIGN.md §6.1 / protocol.md Server Limits）
  - T-7: per-peer 通知队列容量上限与溢出策略（drop-oldest vs reject-new）→ 需 decision 文件
  - T-8: 通知队列 TTL 清理 schedule（lazy-clean vs cron tick）→ 需 decision 文件
  - T-10: register 去重策略（同一 peer_id 重复 register 的行为）→ 需 decision 文件
  - T-12: 除 `invite_create` 外的 per-IP rate limit 具体阈值（DESIGN.md §12 仅写"必须做"未枚举数值）→ 需 fact 文件绑定数值
  - T-13: error response envelope 完整 spec（当前仅 `invite_result.error: "not_found"` 定义了一个错误值）→ 需 fact 文件
- [ ] **Resolve timing/state-machine MISSING items**（来源：本 commit 的 pre-M2 audit `m2-pre-impl-checks.md` §3）：
  - Q3 (peer disconnect behavior: immediate offline vs grace period) — ✅ resolved by `decisions/disconnect-immediate-offline.md`（commit `4146b95`）
  - Q4 (concurrent in-flight requests + response correlation) — ✅ resolved by `decisions/signaling-fifo-no-request-id.md`（commit `4146b95`）
  - Q7 (invite_record deletion criteria: cancel + disconnect cases) — [choice] 实现者可在已知约束（expiry + single-use）下决定，但应记录决策
  - Q8 (reconnect: client re-sends register vs server preserves session) — ✅ resolved by `decisions/reconnect-requires-reregister.md`（commit `4146b95`）
- [x] **Verify rendezvous dependencies**：`packages/rendezvous/package.json` 添加 `fastify` + `ws` + `@fastify/websocket`（`facts/rendezvous-tech-stack.md` 已将其标注为 gap："M2 实现时添加"）（commit 3f192e7）

## 其他 BACKLOG（不阻塞 M2）

- [ ] **Resync 消息重新引入 M4 时遵守 `unique-cbor-keys-not-message-scoped`**（之前的半成品把 `from_seq`/`to_seq` 填进 `seq`/`sha256` key，是反例）
- [ ] **v2 room management 重新引入同上约束**
- [ ] **同步函数不调 sodium 的 ESLint 规则**（现在是 `crypto-library-mapping.md` 里的 prose discipline，reviewer F11 建议 enforceable化）
- [ ] **PGP word list 减量**（256 个 dead entries，reviewer F2）
- [ ] **agent-blind protocol 升级**：让 subagent 输出"我做了哪些 telos 没规定的工程决定"——这些是 telos 覆盖盲区候选（见 `decisions/agent-blind-check-protocol.md` 未来增添）

## 下阶段

→ **M3: P2P 传输**（M2 退出条件满足后）
