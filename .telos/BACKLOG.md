# BACKLOG — 已知缺口

M0 agent-blind 检查已完成。

## M0 退出状态 ✅

- [x] M0 telos bootstrap（7 facts + 9 decisions + 2 tensions）
- [x] docs/protocol.md（字节级协议规范，10 节 + 3 附录）
- [x] Test vectors（6 文件，覆盖 5 个原语）
- [x] **agent-blind 检查 — 通过** ✅

## Agent-blind 结果

**任务**：给定 `.telos/` + `docs/protocol.md`，设计 "daemon 收到 file_offer 后的处理流程"

**结果**：agent 产出了 13 步完整流程，与 DESIGN.md §6 完全一致：
- ✅ Frame 解码、CBOR 字段验证
- ✅ 身份交叉验证（connection.peer_id vs frame.sender_peer_id）
- ✅ known_peers trust 检查
- ✅ room_members 查询
- ✅ Per-sender seq 跳号检测
- ✅ 文件大小/磁盘空间策略检查
- ✅ SQLite + transcript.jsonl 持久化
- ✅ Unread 计数、长轮询 waiter 中断
- ✅ /events WebSocket 广播
- ✅ Notification hook
- ✅ 明确列出不做什么（不 spawn pi、不注入 session、不自动接受）

**判定**：M0 通过。无新增缺口。

## 下阶段

→ **M1: 协议骨架 + 单机闭环**（开始写代码）
  - `packages/protocol`: 类型定义 + test vectors runner
  - `packages/core`: identity / known-peers / invite / 消息编解码 / sealed box
  - 三平台 CI 矩阵就绪
