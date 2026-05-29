# Fact: pi Extension API Surface

> 外部约束。来源：pi v0.76.0 文档。此文件记录 peer-bridge pi-bridge 扩展可使用的 pi API 表面。

## 核心 API（pi.registerTool）

```typescript
pi.registerTool({
  name: string;            // 工具名，LLM 可见
  label: string;           // 短标签
  description: string;     // 工具描述
  promptSnippet?: string;  // 一行摘要，出现于 Available tools
  promptGuidelines?: string[]; // 工具专属 guidelines
  parameters: TypeBox schema;
  execute(toolCallId, params, signal, onUpdate, ctx): ToolResult;
  renderCall?(args, theme, context): Component;
  renderResult?(result, options, theme, context): Component;
});
```

**来源**: `extensions.md` §Custom Tools + `pi.registerTool()` 签名  
**关键约束**:
- `parameters` 用 TypeBox schema 定义，由 pi 自动生成 JSON Schema 给 LLM
- `execute` 的 `onUpdate` 可选回调，支持流式推送 partial result
- `ctx.signal` 提供 AbortSignal，用户 Ctrl+C 时触发
- `renderCall` / `renderResult` 可选自定义 TUI 渲染

## pi.sendUserMessage()

注入 user message 到对话，**触发 agent turn**。

```typescript
pi.sendUserMessage("text");
pi.sendUserMessage([{ type: "text", text: "..." }]);
pi.sendUserMessage("focus on X", { deliverAs: "steer" });
pi.sendUserMessage("and then Y", { deliverAs: "followUp" });
```

**来源**: `extensions.md` §pi.sendUserMessage  
**关键约束**:
- `deliverAs: "steer"` — 在 assistant 当前 tool calls 完成后投递
- `deliverAs: "followUp"` — 等 agent 完全 idle 后投递
- `deliverAs: "nextTurn"` — 排队等下个用户 prompt
- 不 streaming 时不需 deliverAs，立即发送

## pi.sendMessage()

注入 custom message（非 user role），可选参与或不参与 LLM 上下文。

```typescript
pi.sendMessage({
  customType: "peer-bridge-outgoing",
  content: "Sent file to alice",
  display: true,
  details: { ... }
}, { deliverAs: "steer", triggerTurn: false });
```

**来源**: `extensions.md` §pi.sendMessage

## pi.registerCommand()

注册 `/command`：

```typescript
pi.registerCommand("peer-pull", {
  description: "拉取聊天室未读消息",
  handler: async (args, ctx) => { ... }
});
```

**来源**: `extensions.md` §pi.registerCommand

## ctx.ui（用户交互）

| 方法 | 用途 |
|---|---|
| `ctx.ui.notify(text, "info"\|"warning"\|"error")` | 弹通知 |
| `ctx.ui.setStatus(key, text)` | footer 状态行 |
| `ctx.ui.setWidget(key, lines\|factory)` | 编辑器上方/下方 widget |
| `ctx.ui.confirm(title, message)` | 确认对话框 |
| `ctx.ui.custom(component)` | 自定义 TUI 组件 |
| `ctx.ui.setEditorComponent(factory)` | 替换编辑器 |

**来源**: `extensions.md` §ctx.ui + `tui.md`

## session_start 事件

```typescript
pi.on("session_start", async (event, ctx) => {
  // event.reason: "startup" | "reload" | "new" | "resume" | "fork"
  // ctx.sessionManager.getSessionFile() — 获取 session 文件路径
});
```

**来源**: `extensions.md` §Session Events → session_start  
**关键约束**: pi 启动时触发一次 reason="startup"。这是注入 system prompt context 的最佳时机。

## before_agent_start 事件

```typescript
pi.on("before_agent_start", async (event, ctx) => {
  return {
    message: { customType: "...", content: "...", display: true },
    systemPrompt: event.systemPrompt + "\nExtra instructions",
  };
});
```

**来源**: `extensions.md` §before_agent_start  
**关键约束**: 可注入 context file 式消息到 LLM 上下文。system prompt 修改是链式叠加的。

## ctx.signal（AbortSignal）

```typescript
pi.on("tool_result", async (event, ctx) => {
  const response = await fetch(url, { signal: ctx.signal });
});
```

**来源**: `extensions.md` §ctx.signal  
**关键约束**: 在 active turn 事件中有效。peer_chat_wait 的 execute 中可用，用户 Ctrl+C 时 signal aborted。

## session 格式

Session 文件是 JSONL，每行一个 entry。类型包括 message、compaction、custom、label 等。详见 `session-format.md`。

**关键约束**:
- SessionManager 是唯一的 writer。外部进程不应直接写 session 文件
- append-only 追加。通过 `pi.appendEntry()` 或 `ctx.sessionManager.append*()` 写入
- auto-compaction 自动压缩旧消息，保留压缩摘要

**来源**: `session-format.md`, `compaction.md`

## 扩展放置

扩展放在 `~/.pi/agent/extensions/`（全局）或 `.pi/extensions/`（项目本地）。

**来源**: `extensions.md` §Extension Locations

## 总结：peer-bridge 需要使用的 API

| API | 用途 |
|---|---|
| `pi.registerTool()` + `onUpdate` | peer_chat_wait 流式推消息 |
| `pi.sendUserMessage()` | /peer-pull 命令触发 AI 拉取 |
| `pi.sendMessage()` | 发件镜像 entry（audit-only） |
| `pi.registerCommand()` | /peer-pull |
| `ctx.ui.setStatus()` | footer 显示 "alice: 3 unread" |
| `ctx.signal` | wait 被 Ctrl+C 中断 |
| `before_agent_start` | 注入 system prompt guidelines |
| `session_start` | 初始化扩展状态 |
