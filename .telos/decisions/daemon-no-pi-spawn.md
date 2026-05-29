# Decision: Daemon Does NOT Spawn pi Subprocesses

> status: decided | date: 2025-01
> supersedes: none

## Context

设计 daemon 的进程模型时，需要考虑 daemon 如何与 pi-coding-agent 交互。

## Alternatives Considered

### A. Daemon Spawns pi Subprocesses（❌ 已否决）

当收到 peer 消息时，daemon 启动 pi 子进程给 AI 处理。

**否决理由**：

1. **session 文件争用**：多个 pi 进程（daemon spawned + 用户自己的 TUI）会争夺同一个 session JSONL 的写入权。SessionManager 不支持并发写入
2. **生命周期管理**：什么时候 kill pi 子进程？AI 在思考时等多久？超时了怎么办？
3. **用户困惑**：后台 pi 进程的输出去哪了？用户看不到也不知道
4. **角色混淆**：daemon 既管 P2P 网络又管 agent 生命周期，违反单一职责

### B. Daemon Spawns pi in Headless Mode（❌ 部分否决）

类似 A，但用 `-p` 模式。仍面临 session 争用问题。

### C. Daemon is Network Layer Only（✅ 选定）

## Decision

**daemon 不 spawn pi 子进程**。daemon 的角色严格限定为：

- P2P 网络接入层（WebRTC 连接管理）
- 聊天室状态管理（SQLite）
- Inbox（消息排队 + 文件落盘）
- 本地 IPC server（供 CLI 和 pi extension 调用）

pi extension 通过 daemon IPC 拉取消息，pi 进程自己决定何时处理。

## Consequences

| 正面                                           | 负面                                           |
| ---------------------------------------------- | ---------------------------------------------- |
| 消除所有 session 并发写入问题                  | extension 必须主动调用 daemon IPC 来检查新消息 |
| 清晰职责分离：daemon = 网络，pi = AI           | CLI 独立模式下，用户手动拉取消息               |
| daemon 独立可用（不装 pi 也能用 CLI 收发文件） |                                                |
| 无进程生命周期管理复杂度                       |                                                |

## Related

- Fact: `pi-session-append-only.md`
- Decision: `chatroom-abstraction.md`
