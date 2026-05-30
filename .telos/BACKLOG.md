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

## M2 启动准入

| 准入项 | 状态 |
|--------|------|
| M1 全部关闭 | ✅ |
| telos 存量 | 11 facts + 14 decisions + 2 tensions |
| CI matrix 就绪 | ✅（6 cells，`fail-fast: false`） |
| test vectors runner | ✅（sealed_box + fingerprint_sig + peer_id + invite + cbor） |
| 已知测试覆盖 | known-peers (35), invite (29), crypto* (15), vectors (6) |

## M2 in-scope（DESIGN.md §11.M2）

- [ ] 单 server 实现，无联邦
- [ ] `core` 的 rendezvous-client（含 sealed box 离线 notify）
- [ ] 邀请码端到端流程跑通（CLI 层）
- [ ] 三平台 CI 跑通 invite/accept

## M2 known unknowns

以下项 M2 实现需要决策，但 telos 尚未沉淀为 fact/decision：

| # | 未知项 | 所属 DESIGN.md § | 缺失原因 |
|---|--------|-------------------|----------|
| 1 | rendezvous server 的持久化模型（in-memory only? disk-backed SQLite?） | §2 架构图 + §3.5 rendezvous | DESIGN.md §2 说"离线通知暂存 (≤1KB sealed-box 密文, TTL 24h)"但未规定存储引擎；in-memory 在重启时丢通知，disk-backed 引入 schema migration 复杂度 |
| 2 | sealed-box 通知队列容量上限与 TTL 清理策略 | §3.8 sealed-box-for-offline-notify | decision `sealed-box-for-offline-notify.md` 仅规定加密原语选择，未定义 per-peer 队列容量、溢出策略（drop-oldest? reject-new?）或 TTL 过期清理的触发时机（lazy-clean? cron tick?） |
| 3 | WebSocket 信令消息的 JSON schema 与错误码枚举 | §5.1 信令格式 | DESIGN.md §5.1 给了 prose 描述 + 示例，但 M0 test vectors 未生成信令级的 (input, output) 向量；M2 实现需要 validate 字段齐全、错误码枚举不漂移 |
| 4 | rendezvous 的速率限制与 DoS 防御姿态 | §12.5 "rendezvous 对单 IP 的 invite/lookup 速率限制" | §12.5 只说"必须做"但未给出具体阈值、窗口算法、驳回响应码；是 prose 约束不是可测 spec |
| 5 | 联邦协议的 hook 预留（M6 才实现但 M2 信令格式不能 foreclose） | §3.5 rendezvous-federation-not-turn | decision `rendezvous-federation-not-turn.md` 记录了 JSON-RPC 联邦的 strategy 选择，但 M2 单-server 的 WebSocket 消息是否携带 `federation_id` / `origin_server` 字段作为 forward-compat 占位，目前未决策 |

## 其他 BACKLOG（不阻塞 M2）

- [ ] **Resync 消息重新引入 M4 时遵守 `unique-cbor-keys-not-message-scoped`**（之前的半成品把 `from_seq`/`to_seq` 填进 `seq`/`sha256` key，是反例）
- [ ] **v2 room management 重新引入同上约束**
- [ ] **同步函数不调 sodium 的 ESLint 规则**（现在是 `crypto-library-mapping.md` 里的 prose discipline，reviewer F11 建议 enforceable化）
- [ ] **PGP word list 减量**（256 个 dead entries，reviewer F2）
- [ ] **agent-blind protocol 升级**：让 subagent 输出"我做了哪些 telos 没规定的工程决定"——这些是 telos 覆盖盲区候选（见 `decisions/agent-blind-check-protocol.md` 未来增添）

## 下阶段

→ **M3: P2P 传输**（M2 退出条件满足后）
