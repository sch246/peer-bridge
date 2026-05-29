# Tension: Wait-Gap Message Visibility

> status: open | date: 2025-01
> first_version: mitigate_with_send_response_hint

## Description

AI 调用 `peer_chat_send` 和下一个 `peer_chat_wait` 之间存在时间间隙。在这个间隙中到达的消息对 AI 不可见（AI 正在做其他事，直到显式调 wait）。

## Why It's a Tension

- P2P 消息是异步到达的，没有推送机制到 AI 的 attention
- AI 可能在 send 之后去做别的事（用户让做别的），错过回复
- 用户期望 "发完消息就应该能收到回复"，而不是过了很久才发现有未读

## Mitigation (First Version)

`peer_chat_send` 的响应中附带未读信息：

```json
{
  "delivered": true,
  "pending_unread_count": 3,
  "latest_unread_preview": "alice: 已经分析完那份报告了"
}
```

AI 在 system prompt 中被告知：

> "send 后看响应里的 pending_unread，可能需要先 wait"

**为什么只是缓解未能根除**：

- AI 可能忽略 system prompt 的建议
- 如果有多个房间的未读，preview 只显示一条
- 如果 send 后用户立即让 AI 做别的事（steer），AI 优先响应用户而非检查未读

## Future Directions

- **自动注入 context**：daemon 发现未读到达后在 extension session 中注入一条 custom_message 提示
- **实时事件**：extension 通过 `/events` WS 接收消息事件，通过 `ctx.ui.setStatus` 更新 footer，但不在 agent 处理时打断
- **回调式工具**：pi 支持 trigger 回调后，extension 可在消息到达时回调给 AI

## Related

- Decision: `chatroom-abstraction.md`
- Decision: `long-poll-wait-onupdate-streaming.md`
- DESIGN.md §3.11 T2
- DESIGN.md §6.2（send response with pending_unread）
