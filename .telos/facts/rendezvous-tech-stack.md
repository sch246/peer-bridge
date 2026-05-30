---
id: rendezvous-tech-stack
kind: fact
status: stable
since: 2026-05-30
---

# Rendezvous Tech Stack

## Content

Rendezvous server 技术栈：**Node.js + TypeScript + Fastify（HTTP 路由）+ ws（WebSocket 处理）**。

DESIGN.md §6.1 明确规定。不是 raw Node.js `http` 模块。

含义：
- **依赖体积**：引入 `fastify`（≥ ~2MB）和 `ws`。`ws` 库通过 Fastify 的 `@fastify/websocket` plugin 接入。
- **错误处理风格**：Fastify 原生支持 JSON schema validation、请求/回复 lifecycle hooks，错误响应格式统一。
- **集成测试方式**：Fastify 支持 `inject`（无需绑定端口）做 HTTP 层的单元测试。WebSocket 层仍需实际 socket 连接。

## Source

derived from DESIGN.md §6.1 + `packages/rendezvous/package.json`

- DESIGN.md §6.1: "技术栈：Node.js + TypeScript + Fastify + ws。"
- `packages/rendezvous/package.json`: 当前仅列 `@peer-bridge/protocol` 为 dependency。`fastify`、`ws`、`@fastify/websocket` 等依赖将在 M2 实现时添加——本 fact 签发时 package.json 尚未反映完整依赖。

## Boundaries

- 仅覆盖 rendezvous server 的技术栈选择。CLI、daemon、core 有各自独立的 tech stack 约束。
- Fastify 的具体版本号不在本 fact 范围内（跟随实现时的 latest stable）。
- 不规定 Fastify plugin 的注册顺序或 route 组织结构。
