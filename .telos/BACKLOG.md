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

## M1 未完成（M2 启动前必须关闭）

- [ ] **`sealed_box.json` 接入 runner**（存在但未记在 test，DESIGN.md §11.M1 明文要求“通过所有 M0 vectors”）
- [ ] **`fingerprint_sig.json` 接入 runner**（同上）
- [ ] **`packages/core/src/known-peers.ts` 单测**（154 LOC 零覆盖，TOML 解析 + 文件 IO + trust 判断）
- [ ] **`packages/core/src/invite.ts` 单测**（createInvite / redeemInvite / addPeerFromInvite）
- [ ] **三平台 CI matrix**（DESIGN.md §11.M1）

## 其他 BACKLOG（不阻塞 M2）

- [ ] **Resync 消息重新引入 M4 时遵守 `unique-cbor-keys-not-message-scoped`**（之前的半成品把 `from_seq`/`to_seq` 填进 `seq`/`sha256` key，是反例）
- [ ] **v2 room management 重新引入同上约束**
- [ ] **同步函数不调 sodium 的 ESLint 规则**（现在是 `crypto-library-mapping.md` 里的 prose discipline，reviewer F11 建议 enforceable化）
- [ ] **PGP word list 减量**（256 个 dead entries，reviewer F2）
- [ ] **agent-blind protocol 升级**：让 subagent 输出“我做了哪些 telos 没规定的工程决定”——这些是 telos 覆盖盲区候选（见 `decisions/agent-blind-check-protocol.md` 未来增添）

## 下阶段

→ **M2: 信令与走纪服务器**（上面 M1 未完成全部关闭后）
