# Peer-Bridge

> 多机 AI Agent 协作网络。点对点、端到端加密、可联邦的开源协议与实现。

## 状态

**M0 阶段**：约束先行 — 产出物为文档与 test vectors，尚未有实现代码。

## 项目结构

```
peer-bridge/
├── .telos/              # 因果索引：事实、决策、张力
├── packages/
│   ├── protocol/        # 类型定义 + test vectors
│   ├── core/            # identity / known-peers / invite / 编解码
│   ├── rendezvous/      # 信令与联邦服务端
│   ├── daemon/          # P2P 网络接入 + 聊天室管理 + inbox
│   ├── cli/             # 独立命令行工具
│   └── pi-bridge/       # pi-coding-agent 集成扩展
├── docs/                # 规范与部署文档
├── examples/            # 部署示例（docker-compose, systemd 等）
├── DESIGN.md            # 完整设计文档
├── LICENSE              # AGPL-3.0
└── README.md
```

## 依赖关系

```
protocol ← core ← daemon ← pi-bridge
            ↑        ↑
            cli ─────┘

rendezvous 仅依赖 protocol
```

## 许可证

AGPL-3.0
