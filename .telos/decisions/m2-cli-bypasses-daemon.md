---
id: m2-cli-bypasses-daemon
kind: decision
status: stable
since: 2026-05-30
---

# Decision: M2 CLI Bypasses Daemon（M4 回退）

## Content

M2 阶段 CLI 直接使用 `packages/core/src/signaling.ts`（RendezvousClient）与 rendezvous server 通信，**绕过 daemon socket/pipe**。

这是 M2-only 的异常路径。DESIGN.md §6.4 的 steady-state 架构是 "CLI 通过 daemon socket/pipe 完成所有操作"，但 daemon 组件（`packages/daemon`）属于 M4 里程碑，M2 时不存在。

**M4 回退**：当 `packages/daemon` 实现完成后，CLI 的 rendezvous 通信**必须迁回 daemon socket/pipe**。本 decision 在 M4 交付时过期。

**回退验证**（M4 退出条件之一）：
- CLI 不再 import `signaling.ts` 直接使用 WebSocket。
- `peer-bridge invite/accept` 的 rendezvous 信令通过 daemon IPC 发送。
- 如无 daemon 运行，CLI 按 DESIGN.md §6.4 自动 spawn daemon（foreground 模式）。

## Source

- DESIGN.md §6.4 — steady-state CLI 架构（CLI → daemon socket/pipe → rendezvous）。
- Decision: [daemon-no-pi-spawn](../decisions/daemon-no-pi-spawn.md) — 确认 daemon 的 scope（M4 交付物）。
- BACKLOG.md — M2 in-scope 确认 M2 不含 daemon 实现。

## Boundaries

- **仅适用于 M2**。M3（P2P 传输）的 CLI 通信路径不在本 decision 范围内——M3 CLI 可能需要通过 signaling.ts 或 daemon，取决于 daemon 在 M3 时的完成度。
- 不改变 `core/signaling.ts` 的 API 设计——该模块同时被 CLI（M2）和未来的 daemon（M4）使用，API 必须兼容两者。
- `config.toml` 中的 `[rendezvous] url` 在 M2 CLI 中直接读取（不经 daemon）。M4 时由 daemon 读取并透传给 CLI（透明迁移）。

## Why

**动机**：M2 deliverable 要求"邀请码端到端流程跑通（CLI 层）"（DESIGN.md §11.M2），但 daemon 是 M4 组件。CLI 必须直接与 rendezvous 通信才能验证 E2E 流程。这是 slice-scoped 技术债，非永久架构。

**替代方案与否决理由**：

### A. 构建最小 daemon stub 用于 M2（❌ 已否决）

实现一个仅转发 rendezvous 信令的最小 daemon。

否决理由：M2 scope 明确不含 daemon（DESIGN.md §11.M2：单 server 实现 + rendezvous-client + CLI invite/accept + CI）。daemon stub 会引入 IPC protocol 选择（pipe/socket schema）、data_dir 布局、daemon 生命周期管理等 M4 决策，膨胀 M2 scope。

### B. 跳过 rendezvous 信令，CLI 的 invite/accept 不经过 rendezvous（❌ 已否决）

CLI 之间直接交换 invite code，不通过 rendezvous。

否决理由：invite/accept 的核心价值是"通过 rendezvous 转发 sealed-box 确认"——不经过 rendezvous 等于不验证 rendezvous-client。M2 milestone 的 rendezvous-client 和 invite/accept E2E 目标无法达成。

### C. 将此作为永久架构（❌ 已否决）

让 CLI 永远直接使用 `core/signaling.ts`，不经过 daemon。

否决理由：违反 DESIGN.md §6.4："CLI 通过 daemon socket/pipe 完成所有操作"。daemon 引入后 CLI 不经 daemon 会造成：
- CLI 和 daemon 各自维护独立 WS 连接到 rendezvous（两倍信令资源）
- CLI 无法利用 daemon 的连接池、离线通知排队、信号路由
- CLI 独立模式下用户需手动管理 rendezvous 连接，打破"daemon 对用户透明"的心智模型

**git 历史**：`git log --oneline -- DESIGN.md` 仅返回一条 commit（`488dc15 Initial commit`）。no prior alternatives in commit history；CLI 经 daemon 通信的设计约束是 DESIGN.md 原始架构。

## Consequences

| 正面 | 负面 |
|---|---|
| M2 可独立验证 invite/accept E2E | 引入 M4-revert 技术债 |
| `signaling.ts` 为双消费者（CLI + daemon）设计 | M4 迁移时 CLI 需去掉直接 WS 逻辑 |
| 不膨胀 M2 scope | M4 退出条件增加一项（CLI 迁回 daemon） |

## Related

- Fact: [signaling-message-fields](../facts/signaling-message-fields.md) — CLI 直接使用的消息字段规格。
- Decision: [daemon-no-pi-spawn](../decisions/daemon-no-pi-spawn.md) — daemon scope（M4 交付物）。
- DESIGN.md §6.4, §11.M2
