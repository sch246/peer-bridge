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
- I-4: seq 跨连接生命周期 — 待明确（restart 后从 transcript 恢复）
- I-5: IPC 事件 schema — 待补充到 protocol 附录
- I-6: msg 与 file_offer 共享 seq 空间 — 根据 per-sender-seq 决定：是，共享同一序列
- I-7: Room membership state machine — 第二版功能，第一版不暴露 API

## 下阶段

→ **M1: 协议骨架 + 单机闭环**（开始写代码）
