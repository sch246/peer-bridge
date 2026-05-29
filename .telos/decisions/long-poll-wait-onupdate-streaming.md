# Decision: Long-Poll Wait with onUpdate Streaming

> status: decided | date: 2025-01
> supersedes: none

## Context

`peer_chat_wait` 工具需要让 AI 等待聊天室新消息。需要同时解决两个问题：
1. 如何等待新消息（阻塞/长轮询/事件）？
2. 新消息到达后如何传递给 AI（一次性返回/流式推送）？

## Alternatives Considered

### A. 事件驱动 callback + `sendUserMessage`（❌ 已否决）

daemon 的 `/events` WS 推事件给 extension → extension 调 `pi.sendUserMessage` 注入消息。

**否决理由**：
- `sendUserMessage` 的语义是"代表用户提问"，不是"推送聊天消息"
- 会被 compaction 计入用户消息，语义污染
- 注入 user message 会触发 agent turn，失去 AI 的拉取控制

### B. 文件监听 / inotify（❌ 已否决）

daemon 写 inbox 目录 → extension 监听文件变化。

**否决理由**：
- 跨平台文件监听实现各异
- 竞态和部分写入处理复杂
- 本质上是 hack，不是 API

### C. Long-Poll via IPC + onUpdate Streaming（✅ 选定）

## Decision

**Long-Poll wait**：AI 调用 `peer_chat_wait(room?, timeout_s?)` 时：

1. **Inbox 有未读** → 立即返回所有未读消息
2. **Inbox 无未读** → 挂起到 `timeout_s`（默认 300s）
3. 新消息到达时 → 通过 `onUpdate` 回调**逐条**推送给 AI（partial result）
4. **超时** → 返回 `{ messages: [], timed_out: true }`
5. **中断** → `ctx.signal` abort 时中断等待，返回已收到的消息
6. **限制**：单次 wait 最多 50 条，超过强制返回防洪水

`onUpdate` 是 pi 工具 API 的原生流式能力（见 fact `pi-extension-api-surface.md`），无需 hack。

## Consequences

| 正面 | 负面 |
|---|---|
| AI 对流式到达的消息反应更及时 | 长轮询占用 HTTP/IPC 连接（但 daemon 只服务本地连接，数量很小） |
| 通过 onUpdate 逐条推 partial result，符合 pi 原生 API | `timeout_s` 需合理设置，太短导致频繁轮询开销 |
| `ctx.signal` abort 语义清晰 | |
| 50 条上限防资源耗尽 | |
| 超时优雅降级为 timed_out | |

## Related

- Fact: `pi-extension-api-surface.md`（pi.registerTool + onUpdate）
- Decision: `chatroom-abstraction.md`
- DESIGN.md §6.3
