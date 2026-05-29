# Fact: pi Session Append-Only Model

> 外部约束。pi 的 SessionManager 是 session 文件的唯一 writer。外部进程不应直接写 session 文件。

## 证据

### SessionManager 的唯一写权

`session-format.md` 中定义的 SessionManager 实例方法包括:
- `appendMessage(message)` — 追加消息
- `appendCompaction(summary, ...)` — 追加压缩条目
- `appendCustomEntry(customType, data?)` — 扩展状态
- `appendCustomMessageEntry(...)` — 扩展消息
- `appendLabelChange(targetId, label)` — 追加标签
- `appendSessionInfo(name)` — 会话元数据

所有写入操作都必须通过 SessionManager。pi 内部通过 `SessionManager.create()` / `open()` 持有 session 文件的写权。

### 并发写入问题

`extensions.md` §session-format 明确指出：
- SessionManager 维护 `id`/`parentId` 树结构
- 每个 entry 都链接到 parent，形成连贯的分支历史
- 外部进程直接写 JSONL 会导致树结构破坏，且 pi 运行时不会自动检测

### Auto-Compaction

`compaction.md` 详细说明了自动压缩机制：
- 当 context 超过阈值时触发
- 生成压缩摘要，追加 CompactionEntry
- 重新加载 session，从 `firstKeptEntryId` 开始
- 这是 pi SessionManager 的独占操作

## 对 peer-bridge 的影响

1. **daemon 不能写 pi session 文件**：daemon 没有 SessionManager 实例，直接写 JSONL 会破坏树结构
2. **daemon 不能 spawn pi 子进程来间接写**：即使通过 pi 进程，也存在两个 SessionManager 实例竞争的问题
3. **唯一安全方式**：pi extension 内的工具调用或 `pi.sendMessage()` / `pi.sendUserMessage()`

## 验证

来源文档锚点：
- `session-format.md` — 完整 SessionManager API 和 entry types
- `compaction.md` — CompactionEntry 结构和自动触发条件
- `extensions.md` §pi.appendEntry — 扩展如何安全持久化状态
