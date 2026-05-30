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

### Threat Model

本项目的信任模型（DESIGN.md §12）将 rendezvous server 定性为"诚实但好奇"（honest-but-curious），但 §3.5 同时假设"rendezvous 可能被攻陷或作恶"——两者共同构成了防御深度。以下威胁场景是本 decision 的依据：

#### 1. Compromised Rendezvous Server

**Attacker capability**：攻击者完全控制了 rendezvous server 进程或主机，可以读取所有明文 WebSocket 流量、修改 `invite_create` 中注册的 peer_id、替换任何 server→client 响应。

**Without manual confirmation**：inviter Alice 将 `invite_create {code_hash, pubkey_a, peer_id_a}` 发送到被攻陷的 rendezvous。攻击者将 code_hash 下的记录改写为 `{pubkey_x, peer_id_x}`（攻击者自己的 key）。invitee Bob 用 invite code 查询时，rendezvous 返回攻击者的 peer_id 和 pubkey。Bob 的客户端静默将攻击者加入 `known_peers.toml`，`trust = "verified"`。之后 Bob 与"Alice"的所有 P2P 通信都会连到攻击者。

**Manual confirmation reveals**：accept 时显示 fingerprint 必然与 Alice 通过 out-of-band 渠道（面对面、语音通话等）传达的预期 fingerprint 不匹配。Bob 输入 n 拒绝添加。攻击者获得不了 Bob 的信任。

#### 2. Network MITM (Client ↔ Rendezvous)

**Attacker capability**：攻击者在客户端与 rendezvous server 之间的网络路径上执行 MITM（如 ARP spoofing、compromised router、rogue Wi-Fi），可拦截和篡改 WebSocket 流量。但攻击者**无法伪造 Ed25519 签名**（需要 Alice 或 Bob 的私钥），因此无法伪造 C→S 消息。攻击者可篡改 S→C 消息（`invite_result`、`lookup_result`），因为服务端→客户端方向不要求服务端签名（WebSocket 连接由 TLS 认证；TLS 被 MITM 突破时此方向不再受保护）。

**Without manual confirmation**：invitee Bob 与 rendezvous 的 WSS 连接被 MITM 突破（如攻击者持有伪造的 TLS 证书或 Bob 未验证证书）。Bob 发送 `invite_redeem` 后，攻击者截获 `invite_result` 响应，将 `{peer_id_a, pubkey_a}` 替换为 `{peer_id_x, pubkey_x}`。Bob 的客户端无静默校验手段——它从未见过 Alice 的真实 pubkey。fingerprint 被静默接受。

**Manual confirmation reveals**：即使 MITM 在协议层成功替换了响应内容，accept 提示显示的 fingerprint 仍会被 Bob 的人类判断捕获："这不是 Alice 刚才在视频通话里给我看的 fingerprint"。

#### 3. Invite Code Interception (Out-of-Band)

**Attacker capability**：攻击者截获了用于传递 invite code 的 out-of-band 通道（SMS 被转发、Signal/WhatsApp 被另设备登录、email 被读取、写在便签上被看到）。攻击者知道 `4-sapphire-lighthouse-tango-cobra`。

**Without manual confirmation**：攻击者计算 `SHA-256(invite_code)` → code_hash，抢先于 invitee 向被攻陷的 rendezvous 发送 `invite_create {code_hash, pubkey_x, peer_id_x}`（或直接覆盖现有记录，如果 rendezvous 已被攻陷）。invitee Bob redeem 时得到的 peer_id 和 pubkey 是攻击者的。Bob 静默接受。

**Manual confirmation reveals**：无论 invite code 是否被盗，accept 提示显示的 fingerprint 必须与 Alice 的真实 fingerprint 匹配。攻击者的 peer_id/fingerprint 不同——Bob 会注意到不匹配。

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

| 正面                                  | 负面                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| 消除 invite 阶段 TOFU compromise 窗口 | accept 流程非一键式（需一次确认）                                            |
| 确认后 `trust = "verified"` 语义明确  | 无法脚本化 accept（by design）                                               |
| 符合 DESIGN.md §12 安全强制清单       | `trust = "tofu"` 仅在非 CLI 路径出现（如通过 daemon IPC 接受但未做人工确认） |

## Related

- Fact: [known-peers-toml-schema](../facts/known-peers-toml-schema.md) — 本决策引用的 `trust` 字段 enum 值为 `"verified" | "tofu"`，`"verified"` 即本决策的记录产物。
- DESIGN.md §3.6, §12
