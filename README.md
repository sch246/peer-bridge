# Peer-Bridge

> 多机 AI Agent 协作网络。点对点、端到端加密、可联邦的开源协议与实现。

## 状态

**M2 阶段已通过实施层** — invite/accept 端到端流程、rendezvous 信令服务端、跨平台 CI 全部完工；M2 退出仪式（agent-blind 重跑、known-unknowns 沉淀、telos consolidation）待履行。M3 (P2P 传输) 未开始。

**实现进度**：262 tests pass / 1 skip · CI 三平台 × Node 22 LTS 全绿 · 16 facts + 22 decisions + 2 tensions in `.telos/`

## 快速上手

要求：Node.js ≥ 22 LTS，pnpm。

```bash
pnpm install
pnpm -r build       # 构建 protocol + core
pnpm -r test        # 跑全部测试 (262 + 1 skip)
pnpm format:check   # prettier 检查
```

CLI 试用：

```bash
cd packages/cli
pnpm dev init       # 生成 identity + 配置
pnpm dev invite     # 生成邀请码 (需 rendezvous 服务在线)
pnpm dev accept     # 接收邀请并交换 fingerprint
```

## 项目结构

```
packages/
├── protocol/        # CBOR/PGP word list 编解码 + test vectors  (M1 闭)
├── core/            # identity / sealed-box / known-peers / signaling-client  (M1+M2 闭)
├── rendezvous/      # Fastify + ws 信令服务端 (in-memory, 单 server)  (M2 闭)
├── daemon/          # P2P 网络接入 + 聊天室 + inbox  (M4)
├── cli/             # invite / accept / init 端到端命令  (M2 闭)
└── pi-bridge/       # pi-coding-agent 集成扩展  (M5)
```

## 依赖关系

```
protocol ← core ← daemon ← pi-bridge
            ↑        ↑
            cli ─────┘

rendezvous 仅依赖 protocol
```

## 开发工作流

- pnpm workspace, TypeScript strict + ESM
- husky + lint-staged 预提交：自动 prettier
- Node 22 LTS 最低要求 (见 `.telos/decisions/node-22-minimum.md`)
- 决策与事实沉淀在 `.telos/`，参见 `.telos/README.md`

## 进一步阅读

- `DESIGN.md` — 完整设计文档（§11 里程碑表）
- `docs/protocol.md` — 字节级协议规范
- `.telos/` — 决策、事实、张力的因果索引

## 许可证

AGPL-3.0
