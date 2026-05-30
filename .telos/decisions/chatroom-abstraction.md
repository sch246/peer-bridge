# Decision: Chatroom Abstraction (Tool-Call Instead of User Message Injection)

> status: decided | date: 2025-01
> supersedes: none

## Context

pi 的 session 模型是 user ↔ AI 一对一对话。当另一台机器上的 AI（peer-bridge 对端）发送消息时，面临如何传递到 Bob 的 pi session 的问题。

## Alternatives Considered

### A. 注入 User Message（❌ 已否决）

将 Alice 的 AI 消息作为 user message 注入到 Bob 的 session：

- `pi.sendUserMessage("Alice 的 AI 说：...")`

**否决理由**：

1. **角色污染**：Bob 回看 session 时看到"自己说过的话"，实际是 Alice 的 AI 的发言
2. **session 文件语义污染**：无法区分"Bob 本人输入"和"外部 agent 发言"
3. **并发写入冲突**：daemon spawn 的 RPC 子进程和 Bob 的 TUI 进程会争夺 session JSONL 的写权（SessionManager 不支持并发写入 — 见 `pi-session-append-only.md` fact）
4. **无限回合**：双方 AI 互相注入 user message → 无限对话循环

### B. Context File / System Prompt 注入（❌ 部分否决）

将外部消息作为 context 或 system prompt 注入。仍面临并发写入问题。

### C. 工具调用 — peer_chat_wait / peer_chat_send（✅ 选定）

外部 AI 通信走**工具调用**。AI 主动调工具来收/发消息。

## Decision

采用选项 C：**聊天室抽象**。

- **peer_chat_wait**：阻塞等待聊天室新消息。AI 决定何时拉取
- **peer_chat_send**：发送消息。AI 显式选择发送
- 消息到达 daemon inbox 队列，不打断 session
- ai 不调 `peer_chat_wait` 就不消费消息，回信是显式决策

## Consequences

| 正面                                      | 负面                                                               |
| ----------------------------------------- | ------------------------------------------------------------------ |
| session 语义纯净（只有 Bob ↔ Bob 的 AI） | AI 不知道"新消息到了"，需要主动 pull                               |
| daemon 不碰 session 文件，无并发冲突      | wait 间隙可能有消息到达（见 tension：wait-gap-message-visibility） |
| AI 互打的无限循环被避免                   | 用户需要 `/peer-pull` 或 AI 自行周期检查                           |
| pi 进程是唯一 writer                      |                                                                    |
| 不管理 pi 进程生命周期                    |                                                                    |
| 数据模型原生支持多人 room                 |                                                                    |

## Related

- Fact: `pi-session-append-only.md`
- Fact: `pi-extension-api-surface.md`
- Decision: `daemon-no-pi-spawn.md`
- Tension: `wait-gap-message-visibility.md`
