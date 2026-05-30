---
id: manual-fingerprint-confirmation-on-accept
kind: decision
status: stable
since: 2026-05-30
---

# Decision: Manual Fingerprint Confirmation on Accept

## Content

`peer-bridge accept <code>` 时**必须在写入 `known_peers.toml` 之前**向用户展示对方 fingerprint 并要求手动确认。不得自动添加。

确认提示格式（DESIGN.md §3.6）：
```
Found peer "alice".
Fingerprint: PB-7X4J2-M9KQR-ABCDE-FGHIJ-KLMNO-PQRST
Add to known peers as [alice]? [Y/n]
```

用户确认后，`trust` 字段设为 `"verified"`。未经确认而接受（如 TOFU 路径）则 `trust` 为 `"tofu"`。

**安全含义**：如果不强制确认，TOFU 变为静默信任升级——invite code 窃听者可替换 rendezvous 上的注册信息，使接收方添加攻击者的 peer_id 而不自知。

## Source

- DESIGN.md §3.6 — accept 流程中展示 "Add to known peers as [alice]? [Y/n]" 提示。
- DESIGN.md §12 — 安全/隐私要点："known_peers 添加时强制人工确认 fingerprint"。

## Boundaries

- 仅在 `accept` 路径要求确认。从 rendezvous 已注册 peer 查找后直接通信（lookup → signal）不要求额外的确认——对方 identity 在 rendezvous 注册时已自证。
- M4 daemon 实现本约束；M5 pi extension 通过 daemon IPC 调用时也须遵循（不可绕过）。

## Why

**动机**：安全性 —— TOFU (Trust On First Use) 如无确认步骤，在 invite 阶段存在 compromise 窗口。invite code 可被中间 rendezvous server 或网络窃听者截获，攻击者将自身的 peer_id 注册到 rendezvous 的 `code_hash` 下，接收方静默添加攻击者为 known peer。

**替代方案与否决理由**：

### A. 信任首次使用，不提示确认（❌ 已否决）

仅靠 invite code 一次性使用 + 过期机制，不要求 fingerprint 确认。

否决理由：invite code（4-word + nonce, ~57 bit 熵）不足以抵抗定向攻击——rendezvous server 知道 code 时可主动替换 peer_id。TOFU 无确认等于 open compromise window。

### B. `--no-verify` CLI flag 跳过确认（❌ 已否决）

CLI 提供 `--no-verify` flag 允许用户绕过确认。

否决理由：DESIGN.md §12 使用"强制"一词——"必须做: known_peers 添加时强制人工确认 fingerprint"。`--no-verify` flag 与"强制"冲突。

### C. 可选 config flag 跳过确认（❌ 已否决）

在 `config.toml` 中设 `[security] skip_fingerprint_confirmation = true`。

否决理由：同 B——DESIGN.md §12 禁止绕过。config 级绕过比 CLI flag 更危险（用户可能忘记了）。

**git 历史**：`git log --oneline -- DESIGN.md` 仅返回一条 commit（`488dc15 Initial commit`）。no prior alternatives in commit history；constraint is original to DESIGN.md。

## Consequences

| 正面                                   | 负面                               |
| -------------------------------------- | ---------------------------------- |
| 消除 invite 阶段 TOFU compromise 窗口  | accept 流程非一键式（需一次确认）  |
| 确认后 `trust = "verified"` 语义明确   | 无法脚本化 accept（by design）     |
| 符合 DESIGN.md §12 安全强制清单        | `trust = "tofu"` 仅在非 CLI 路径出现（如通过 daemon IPC 接受但未做人工确认） |

## Related

- Fact: [known-peers-toml-schema](../facts/known-peers-toml-schema.md) — 本决策引用的 `trust` 字段 enum 值为 `"verified" | "tofu"`，`"verified"` 即本决策的记录产物。
- DESIGN.md §3.6, §12
