# Peer-Bridge 设计文档（最终版）

> 多机 AI Agent 协作网络。点对点、端到端加密、可联邦的开源协议与实现。

---

## 1. 项目概览

**目标**：让分布在不同网络环境（家庭、公司、CGNAT 后）的 AI agent 能互相发送文件和消息，触发跨机器的协作。

**协议许可**：AGPL-3.0。防止 SaaS 套壳，鼓励改进回流。

**范围内**：
- P2P 加密通信，支持任意类型文件传输
- 邀请式好友发现（无需中央账号系统）
- 可自托管的 rendezvous server，server 间可联邦
- 与 pi-coding-agent 集成的桥接 extension
- 独立 CLI（不依赖 pi 也能用作 P2P 文件传输工具）
- 多人聊天室（数据模型原生支持，工具集第一版只暴露 1:1）

**范围外**（第一版明确不做）：
- 浏览器客户端（命令行优先）
- 官方 TURN 服务（用户自带）
- 端到端通信的更强匿名性（PAKE、洋葱路由等）
- daemon 插件系统（多 agent 接入）
- 移动端
- 托盘图标、桌面通知客户端（只提供 hook 脚本接口）
- 同一身份多设备共享（每设备独立 peer_id，第一版接受这个约束）

**平台支持**：Linux、macOS、Windows 全部为 first-class。Windows 用 named pipe 替代 Unix socket，所有 CLI/daemon/extension 行为一致，CI 矩阵覆盖三平台。

---

## 2. 总体架构

```
┌─────────────────────────────────────────────────────────────┐
│ Rendezvous Server (公网, 可自托管, 可联邦)                    │
│  - WebSocket 信令转发 (SDP/ICE)                              │
│  - Peer 在线状态                                             │
│  - 邀请码配对 (短期, ≤10min)                                 │
│  - 离线通知暂存 (≤1KB sealed-box 密文, TTL 24h)              │
│  - 联邦查询 (request_id 去重防风暴)                          │
│  不解读任何加密数据, 看不到文件/消息内容                       │
└─────────────────────────────────────────────────────────────┘
         ▲ WSS                                  ▲ WSS
         │                                      │
   ┌─────┴───────────┐                  ┌───────┴─────────┐
   │ daemon (alice)  │                  │ daemon (bob)    │
   │  room state     │                  │  room state     │
   │  inbox          │                  │  inbox          │
   └────────┬────────┘                  └────────▲────────┘
            │ IPC                                  │ IPC
   ┌────────┴────────┐                  ┌─────────┴────────┐
   │ pi + ext        │                  │ pi + ext         │
   │ peer_chat_wait  │                  │ peer_chat_wait   │
   │ peer_chat_send  │                  │ peer_chat_send   │
   └─────────────────┘                  └──────────────────┘
            │                                    │
            └────────────── WebRTC ──────────────┘
                  DTLS + SCTP DataChannel
                  P2P 直连优先, 用户自备 TURN 兜底
```

**四大可执行进程：**

| 组件 | 形态 | 是否依赖 pi |
|---|---|---|
| `peer-bridge-rendezvous` | 公网常驻 | 否 |
| `peer-bridge-daemon` | 本地常驻 | 否（核心传输 + room 管理） |
| `peer-bridge` (CLI) | 按需调用 | 否 |
| `pi-peer-bridge` (extension) | pi 插件 | 是 |

**关键架构决策**：daemon **不** spawn pi 子进程。daemon 的角色是 P2P 网络接入层 + 聊天室状态管理 + inbox。pi 通过 extension 中的工具调用 daemon IPC 来收发消息。这个设计消除了 session 文件争用、pi 进程生命周期管理、角色混淆等一系列问题。详见 §3.10。

---

## 3. 关键决策与理由

### 3.1 传输层：WebRTC DataChannel（不是裸 TCP + Noise）

**决策**：用 `node-datachannel`（基于 libdatachannel）实现 P2P 通道。

**理由**：
- NAT 穿透是真实痛点（朋友家 CGNAT 普遍），WebRTC 的 ICE 框架成熟可靠
- DTLS 自带加密，SCTP 自带分片/可靠传输/流控，省下大量自研代码
- Fingerprint pinning 模型天然支持 pubkey 验证
- 缺点（C++ 模块依赖）对 daemon 形态可接受，且 `node-datachannel` 提供三大平台预编译包

**放弃的方案**：
- *裸 TCP + Noise + 自己打洞*：自研 NAT 穿透是深坑，且没有理由重新发明 ICE
- *libp2p*：协议栈完整但学习曲线陡，对单一应用是 overkill

### 3.2 身份模型：独立 Ed25519，不复用 SSH 密钥

**决策**：每个节点生成独立的 Ed25519 长期密钥，存放在 `<data_dir>/identity.key`。

**理由**：
- SSH 密钥可能有 passphrase，会让 daemon 启动卡死
- 用途隔离：peer-bridge 的密钥泄漏不应影响 SSH 安全
- 复用 Ed25519 **算法**和 **known_hosts 思想**已足够，无需复用文件本身

**Peer ID 格式**（仿 Syncthing）：
```
PB-7X4J2-M9KQR-ABCDE-FGHIJ-KLMNO-PQRST
```
即 base32(pubkey) + Luhn mod 32 校验码，每 5 字符插连字符。自验证，无需 CA。

**第一版限制**：peer_id 与设备一一对应。同一用户的笔记本和台式机是两个独立 peer_id，需要分别加好友。这是 §3.11 记录的 open tension。

### 3.3 加密通道：DTLS fingerprint + Ed25519 长期身份签名

**决策**：WebRTC 的 DTLS 证书每次连接重新生成（短期），但 fingerprint 必须用 Ed25519 长期密钥签名后一并发送。

**握手流程**：
1. Alice 生成 ephemeral DTLS 证书，计算 SHA-256 fingerprint
2. Alice 用长期 Ed25519 私钥签名 `(fingerprint, peer_id, timestamp, nonce)`
3. 通过信令通道把 `(SDP含fingerprint, signature, alice_peer_id)` 发给 Bob
4. Bob 校验：
   - signature 用 alice_peer_id 解出的公钥验证通过
   - alice_peer_id 在自己的 `known_peers.toml` 里
   - timestamp 在 ±5 分钟内
5. WebRTC DTLS 握手时验证证书 fingerprint 与签名内容一致
6. 双向（Bob 侧同样流程）

**理由**：libp2p webrtc transport 同款做法。比 "DTLS 上再叠 Noise" 更干净，无冗余加密层。

### 3.4 不提供官方 TURN，用户 BYO

**决策**：daemon 配置里支持填 TURN credentials（任意 RFC 5766 兼容服务）。文档推荐两条路径：
- 自托管 coturn（家用 VPS 即可）
- 使用 Cloudflare TURN（每月 1TB 免费额度）

**理由**：TURN 流量等于实际文件流量，运营成本不可承担。开源项目应"提供技术不提供资源"。

### 3.5 Rendezvous 联邦（不是 TURN 联邦）

**澄清**：用户原本说的是"TURN 联邦"，但 TURN 是数据中继（流量大、联邦意义小），rendezvous 才是 peer 发现入口（流量极小、联邦能打通社交圈）。联邦做在 rendezvous 上。

**联邦协议**（管理员手动配置受信任的 server 列表）：

每个 server 维护：
```
local_peers:   peer_id → ws_conn, last_seen
federations:   [{ url, pubkey }]   # 互相加好友式配置
route_cache:   peer_id → home_url, expires_at (5min TTL)
seen_queries:  request_id → expires_at (10s TTL)  # 防风暴
```

查询流程：
1. Alice@A 想找 Bob → 先查 local_peers，再查 cache
2. 都没有 → A 向所有 federations 广播 `{query, request_id, peer_id, ttl: 2}`
3. 收到查询的 server 用 `request_id` 去重（10s 窗口），不去重则丢弃
4. 命中则回 `{found, home: B}`，否则 ttl > 0 时继续转发
5. A 拿到结果后**代理**信令到 B（Alice 始终只和自己的 home rendezvous 通信）

**为什么用 request_id 去重而不是"已知不广播"**：拓扑会变（peer 上下线、server 故障）。`request_id + TTL` 是 mDNS、Gnutella、libp2p 都验证过的成熟做法，环路保护和拓扑灵活性兼顾。

**为什么用代理而非重定向**：Alice 跨 server 不需要 auth；Alice 的 IP 不暴露给外部 server；心智模型简单（"我的 server 是我社交圈的入口"）。

### 3.6 邀请流程：仿 Magic Wormhole

**决策**：4 词邀请码，10 分钟过期，一次性使用。

```
$ peer-bridge invite
Invite code: 4-sapphire-lighthouse-tango-cobra
(expires in 10 min, single use)
```

```
$ peer-bridge accept 4-sapphire-lighthouse-tango-cobra
Found peer "alice".
Fingerprint: PB-7X4J2-M9KQR-ABCDE-FGHIJ-KLMNO-PQRST
Add to known peers as [alice]? [Y/n]
```

**底层实现**：
- 4 词来自 PGP word list（256 词典 → 32 bit 熵）+ 1 个 5 字母 nonce → 共 ~57 bit
- 邀请方注册 `(code_hash, pubkey, peer_id)` 到 rendezvous（≤10 分钟过期）
- 接受方查询 `SHA-256(code)` → 拿到对方信息
- 双方互相确认 fingerprint 后写入 `known_peers.toml`

**不做 PAKE 的理由**：rendezvous server 看到 `(code, alice_pubkey, bob_pubkey)` 关联不是大问题（不影响后续通信安全）。PAKE 复杂度对第一版不值得。

### 3.7 项目结构：与 pi 解耦

**决策**：monorepo 分包，`core` 不依赖 pi，CLI 可独立用作 P2P 文件传输工具。

**不做 daemon 插件系统**：第三方想接 aider/claude-code 时直接基于 `core` 写新桥接进程即可。插件系统是过早抽象。

### 3.8 离线通知暂存（rendezvous）：NaCl Sealed Box

**决策**：rendezvous 允许暂存 ≤1KB 通知，TTL 24h。**payload 必须用 NaCl sealed box 加密**。

**加密方案**：
- 接收方的 Ed25519 公钥通过 `crypto_sign_ed25519_pk_to_curve25519` 转换为 X25519 公钥
- 发送方用 `crypto_box_seal(payload, recipient_x25519_pk)` 加密
- 发送方不需要暴露自己的身份给加密层（sealed box 一次性 ephemeral key）
- 接收方用自己的 Ed25519 私钥转换出的 X25519 私钥解密

**为什么这个方案**：
- libsodium / `tweetnacl` 在三平台都有原生支持
- sealed box 不要求 sender 提供 X25519 keypair，简化了发送方逻辑
- Ed25519 → X25519 转换是标准操作（RFC 7748 + libsodium 文档）

**payload 内容**：发送方 peer_id、room_id、提示语（"alice 想给你发文件"）、timestamp、nonce。**不携带文件内容或消息正文**。

**理由**：纯 P2P 要求"严格同时在线"，UX 太差。允许 server 暂存极小密文极大改善 UX，同时不违背"server 透明"原则——server 看不到 sender 是谁、消息是什么。

### 3.9 Peer 注册方式：长连

**决策**：daemon 启动时连接 home rendezvous，保持长连直到关闭。

**理由**：小规模社交网络（每用户几十个好友），server 维护几千 ws 连接毫无压力。轮询/push 通道徒增复杂度。

### 3.10 聊天室抽象（核心架构决定）

**问题**：pi 的 session 模型是 user ↔ AI 一对一。把外部 peer 的 AI 消息作为 user message 注入到 Bob 的 session 会导致：
- Bob 回看 session 时看到"自己说过的话"，实际是 Alice 的 AI
- session 文件语义污染：无法区分"Bob 本人输入"和"Alice 的 AI 的发言"
- daemon spawn 的 RPC 子进程和 Bob 的 TUI 进程争夺 session JSONL 的写权（pi 的 SessionManager 不支持并发写入）

**决策**：外部 AI 通信走**工具调用**。核心工具 `peer_chat_wait` 的语义是"阻塞等待聊天室新消息"，AI 通过网络 IO 工具收发消息，而不是收到注入的 user message。

**pi 能力依据**（来自 pi v0.76.0 文档）：

| pi 能力 | 文档位置 | 用法 |
|---|---|---|
| `pi.registerTool()` 自定义工具 | `extensions.md` | `peer_chat_wait`、`peer_chat_send` 等工具注册 |
| 工具的 `onUpdate` 流式回调 | `extensions.md` §Custom Tools | `peer_chat_wait` 收到消息时逐条推 partial result |
| `pi.sendUserMessage()` 注入 user 消息 | `extensions.md` | `/peer-pull` 命令让 AI 主动调 wait |
| `pi.registerCommand()` 注册斜杠命令 | `extensions.md` | `/peer-pull` 命令 |
| `ctx.ui.setStatus()` footer 状态 | `extensions.md` §ctx.ui | 显示 "alice: 3 unread" |
| `ctx.signal` abort 信号 | `extensions.md` §ctx.signal | 用户 Ctrl+C 中断 wait |
| `pi.sendMessage()` custom message | `extensions.md` | 发件镜像 entry（标注 peer-bridge-outgoing）|
| SessionManager append-only | `sessions.md`, `session-format.md` | **利用它不争抢写入权** |
| auto-compaction | `compaction.md` | 长对话自动压缩，无需干预 |

**为什么这解决了所有硬问题**：

| 之前的问题 | 聊天室模型下的解决 |
|---|---|
| Bob 的 session 里 user 角色被 Alice 的 AI 污染 | session 只有 Bob ↔ Bob 的 AI。外部 AI 永远在 `tool_result` 中 |
| Single-writer：daemon 和 TUI 抢写 session JSONL | pi 进程是唯一 writer。daemon 不碰 session 文件 |
| AI 互打无限回合 | Bob 不调 `peer_chat_wait` 就不消费消息。回信是显式决策 |
| Q2 "用户在 session 时被外部消息打断" | 永远不打断。消息在 daemon inbox 里排队，等 AI 主动 fetch |
| 复杂的 (peer_id, session_id) → pi 子进程映射表 | 只有 `room_id`，状态在 daemon 的 SQLite 里 |
| pi 子进程生命周期 | daemon 不 spawn pi 子进程，整个问题消失 |

**多人聊天室**：数据模型按多成员 room 做（见 §9），第一版工具只暴露 1:1 语义（`peer_chat_send(to, ...)`），但底层已经是 room-based，后续加多人 API 无需迁移。

### 3.11 Open Tensions（已知未解决约束）

以下条目在 `.telos/tensions/` 中以 `status: open` 入库，第一版不解决：

**T1: 单设备身份 vs 跨设备同身份**
- 用户在多台设备上想以"alice"出现，但当前每设备独立 peer_id
- 候选方向：客户端侧 device group（一个 alias 映射到多个 peer_id）、或 sub-key 派生
- 第一版接受："alice-laptop / alice-desktop 是两个好友"

**T2: wait 间隙的消息可见性**
- AI 调 `peer_chat_send` 之前可能有刚到达的消息，AI 不知道
- 缓解：daemon 的 send 响应中附带 `pending_unread_count` 和最新一条预览
- AI system prompt 提示："send 后看响应里的 pending_unread，可能需要先 wait"
- 这个缓解在 §6.3 的 IPC 规范里落地

### 3.12 消息序号语义

**决策**：`seq` 是 **per-sender** 单调递增整数，从 0 开始。房间消息的全局顺序由 `(timestamp, sender_peer_id, seq)` 三元组决定。

**理由**：
- 1:1 房间没有共识机制，无法分配全局 seq
- per-sender seq 让接收方能检测**自己接收某 sender 时的丢消息**（seq 跳号 → 触发 resync）
- timestamp 用于 UI 展示和粗排序，sender + seq 用于精确定位
- 多人房间下未来可加 vector clock，per-sender seq 是兼容的基础

**resync 机制**：接收方发现 seq 跳号 → 发 `room:resync_request{room_id, sender, from_seq, to_seq}` → sender 重发缺失消息（保留在本地 transcript 即可）。第一版可以简化为打日志告警，先不强求 resync。

---

## 4. 身份与文件

平台相关的 data_dir：
- Linux/macOS: `~/.peer-bridge/`
- Windows: `%APPDATA%\peer-bridge\`

```
<data_dir>/
├── identity.key           # Ed25519 私钥 (Unix: mode 0600; Windows: NTFS ACL 仅当前用户可读)
├── identity.pub           # 公钥 + peer_id
├── config.toml
├── known_peers.toml
├── daemon.sock            # Unix socket (Linux/macOS)
├── daemon.pipe            # Windows: \\.\pipe\peer-bridge-<user> 的占位文件
├── daemon.db              # daemon 状态持久化（SQLite）
├── rooms/
│   └── <room_id>/
│       ├── transcript.jsonl
│       └── inbox/
└── sessions/              # （保留，仅供 CLI 独立模式）
```

`known_peers.toml`：
```toml
[[peer]]
alias = "alice"
peer_id = "PB-7X4J2-M9KQR-ABCDE-FGHIJ-KLMNO-PQRST"
added_at = "2025-01-15T10:30:00Z"
trust = "verified"          # verified | tofu
home_rendezvous = "wss://rdv.example.com"
```

**Windows 权限策略**：daemon 启动时检查 `identity.key` 的 NTFS ACL，要求 owner = 当前用户，且不存在其他 user/group 的 read 权限。不满足时拒绝启动并提示修复命令。

---

## 5. 协议规范

### 5.1 信令协议（client ↔ rendezvous，WebSocket，JSON）

所有 client → server 消息都附 `{sig, ts}`，sig = Ed25519(payload + ts)。

| 方向 | 类型 | 字段 |
|---|---|---|
| C→S | `register` | `{peer_id, capabilities}` |
| S→C | `register_ok` | `{server_id, federation_size}` |
| C→S | `lookup` | `{peer_id}` |
| S→C | `lookup_result` | `{found: bool, home?: url}` |
| C→S | `invite_create` | `{code_hash, pubkey, peer_id, expires_at}` |
| C→S | `invite_redeem` | `{code_hash}` |
| S→C | `invite_result` | `{peer_id, pubkey}` |
| C→S | `signal` | `{to: peer_id, payload: encrypted}` |
| S→C | `signal_in` | `{from: peer_id, payload}` |
| C→S | `notify` | `{to: peer_id, sealed_box: ≤1KB}` (离线暂存) |
| S→C | `notify_in` | `{sealed_box, queued_at}` |

`notify` 的 `sealed_box` 是 §3.8 描述的 NaCl sealed box 密文。server 不能解密，因此不能验证 from 字段——from 信息在密文里。

### 5.2 联邦协议（server ↔ server，HTTP + 长轮询或 WS）

```
POST /federation/query
{ request_id, peer_id, ttl, origin_server }
→ { found: bool, home?: url }

POST /federation/proxy_signal
{ request_id, from_server, from_peer_id, to_peer_id, payload }
→ ack
```

每个 server 周期性同步对方公钥指纹，签名验证防伪造。

### 5.3 P2P 握手（基于 WebRTC）

1. **信令交换**（通过 rendezvous）：
   - Alice → Bob: `offer{ sdp, ed25519_sig_of_fingerprint, alice_peer_id, ts, nonce }`
   - Bob → Alice: `answer{ sdp, ed25519_sig_of_fingerprint, bob_peer_id, ts, nonce }`
   - ICE candidates 双向交换
2. **DTLS 握手**：WebRTC 内部自动完成，验证证书 fingerprint 匹配 SDP 中的声明
3. **应用层验证**：双方各自校验对方的 Ed25519 签名 + peer_id 在 known_peers
4. **DataChannel 建立**：默认开两个 channel：
   - `control` (ordered, reliable)：消息、控制
   - `bulk` (ordered, reliable)：文件 chunk

### 5.4 应用消息协议（DataChannel 内，length-prefixed CBOR）

```
Frame: [4-byte BE length] [CBOR payload]
```

消息类型：

```
{ type: "room:hello", version, capabilities }
{ type: "room:ping" } / { type: "room:pong" }

# 聊天室消息
{ type: "room:msg", room_id, sender_peer_id, body, kind: "text"|"system", seq, ts }
{ type: "room:file_offer", room_id, file_id, sender_peer_id, name, size, sha256, note, seq, ts }
{ type: "room:file_accept", room_id, file_id }
{ type: "room:file_reject", room_id, file_id, reason }
{ type: "room:file_chunk", file_id, seq_num, data }         # bulk channel
{ type: "room:file_done", file_id }
{ type: "room:file_abort", room_id, file_id, reason }
{ type: "room:resync_request", room_id, sender, from_seq, to_seq }
{ type: "room:resync_response", room_id, messages: [...] }

# 房间管理（第二版暴露，第一版仅在协议层定义）
{ type: "room:invite", room_id, inviter_peer_id, room_name }
{ type: "room:join", room_id }
{ type: "room:leave", room_id }
```

`room_id` 由发起方生成（UUIDv7，按时间排序），整个对话生命周期复用。1:1 房间的 `room_id` 由 `min(peer_id_a, peer_id_b) || ":" || max(peer_id_a, peer_id_b)` 取 SHA-256 后再 UUIDv7 风格编码，双方独立计算得相同 ID。

`seq` 是 per-sender 房间内单调递增（§3.12）。

### 5.5 文件传输

- Chunk 大小：64 KiB（DataChannel 推荐上限）
- 流控：依赖 SCTP 自带 backpressure（DataChannel `bufferedAmount` + `bufferedAmountLow`）
- 进度上报：发送方每 N chunks emit 一次 progress event 到 daemon IPC
- 校验：完成后比对全文件 SHA-256
- 续传：第一版不做。失败重传整个文件。
- 大小上限：500 MiB（可配置）
- 文件落盘：`<data_dir>/rooms/<room_id>/inbox/`

### 5.6 邀请码生成

```
words = pgp_word_list  # 256 个三音节词
nonce = randomBytes(2) → 4 hex chars
code = `${random_word()}-${random_word()}-${random_word()}-${random_word()}-${nonce}`
code_hash = SHA-256(code)
```

接受方先 `SHA-256(input_code)` 再发给 server 查询。

---

## 6. 组件详细设计

### 6.1 rendezvous server (`packages/rendezvous`)

技术栈：Node.js + TypeScript + Fastify + ws。

存储：内存 + 可选 SQLite（仅持久化 federation 配置和管理员设置，运行时数据全内存，重启丢失可接受）。

启动：
```
peer-bridge-rendezvous --config /etc/peer-bridge/server.toml
```

`server.toml`：
```toml
[server]
listen = "0.0.0.0:443"
public_url = "wss://rdv.example.com"
identity_key = "/etc/peer-bridge/server.key"

[limits]
max_peers = 10000
max_invites_per_ip_per_hour = 20
max_offline_notify_size = 1024
offline_notify_ttl_hours = 24

[[federation]]
url = "wss://rdv.friend.example.com"
pubkey = "ed25519:..."
```

健康检查：`GET /health` 返回 peer 数量、federation 状态。

### 6.2 daemon (`packages/daemon`)

**角色**：P2P 网络接入层 + 聊天室状态管理 + inbox。**不 spawn pi 子进程**。

进程模型：单进程 Node。
- Linux: systemd user service
- macOS: launchd LaunchAgent
- Windows: 默认前台运行；提供 `peer-bridge-daemon install-service` 安装为 Windows Service（基于 `node-windows` 或类似工具）

启动：
```
peer-bridge-daemon                  # 默认 <data_dir>/config.toml
peer-bridge-daemon --foreground     # 不 daemonize, 输出到 stderr
```

**核心职责**：

1. **WebRTC 连接管理**：按需建立/拆除与 peer 的 P2P 连接
2. **房间状态**：维护 `room_id → { members, transcript, last_seq }` 在 SQLite
3. **inbox**：到达的消息写入房间 transcript；到达的文件写入房间 inbox 目录
4. **本地 IPC**：暴露 Unix socket（Linux/macOS）或 named pipe（Windows）供 pi extension 和 CLI 调用
5. **通知 hook**：消息到达时触发用户配置的外部脚本

**daemon 不做什么**：
- ❌ 不 spawn pi 子进程
- ❌ 不维护 (peer_id, session_id) → pi_session_file 映射
- ❌ 不注入 user message 到 pi session
- ❌ 不管理 pi 进程生命周期

**本地 IPC**：

跨平台抽象层暴露统一的 HTTP-like API。Unix 用 `http` over Unix socket，Windows 用 `http` over named pipe（`\\.\pipe\peer-bridge-<username>`）。Node 的 `net.createServer` 在两个平台都支持。

```
# 状态查询
GET    /status                        daemon 状态 + 在线 peer 列表
GET    /rooms                         活跃房间列表
GET    /rooms/:id                     房间详情（成员、消息数、最后活跃时间）
GET    /rooms/:id/messages            消息历史（支持 since / limit 参数）
GET    /rooms/:id/unread_count        未读消息数

# 消息发送
POST   /rooms/:id/send                { body, kind } → { delivered, pending_unread_count, latest_unread_preview? }
POST   /rooms/:id/send_file           { path, note } → { file_id, status, pending_unread_count }

# 消息等待（长轮询）
POST   /rooms/:id/wait                { timeout_s? } → 阻塞等待新消息
POST   /rooms/wait_any                { timeout_s? } → 等任意房间有新消息

# 房间管理
POST   /rooms/create                  { peer_ids[], topic? } → room_id
POST   /rooms/:id/invite              { peer_id }
POST   /rooms/:id/leave

# 邀请
POST   /invite/create                 → { code, expires_at }
POST   /invite/accept                 { code } → { peer_id, pubkey }

# 事件流
WS     /events                        实时推送（新消息、文件到达、peer 上线/下线）
```

**send 响应附带未读信息**（缓解 §3.11 T2）：每次 send 完成后，daemon 检查发起方所有房间的未读消息。如果有，响应里返回 `pending_unread_count` 和一条最新预览，让 AI 决定是否需要立即去 wait。

**长轮询 `/rooms/:id/wait` 的行为**：
- 如果 room 有未读消息 → 立即返回所有未读
- 如果没有 → 挂起连接，最长 `timeout_s` 秒（默认 300）
- 新消息到达时逐条以 SSE 风格推送给调用方
- 超时返回 `{ messages: [], timed_out: true }`
- 调用方断开连接即取消等待

**SQLite schema**：
```sql
CREATE TABLE rooms (
  room_id TEXT PRIMARY KEY,
  name TEXT,
  created_at TEXT,
  last_active_at TEXT,
  last_seq INTEGER DEFAULT 0
);

CREATE TABLE room_members (
  room_id TEXT,
  peer_id TEXT,
  joined_at TEXT,
  PRIMARY KEY (room_id, peer_id)
);

CREATE TABLE room_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT,
  seq INTEGER,
  sender_peer_id TEXT,
  kind TEXT,
  body TEXT,
  file_id TEXT,
  file_name TEXT,
  timestamp TEXT,
  read_at TEXT
);

CREATE INDEX idx_messages_room_seq ON room_messages(room_id, sender_peer_id, seq);
CREATE INDEX idx_messages_room_unread ON room_messages(room_id, read_at);
```

### 6.3 pi extension (`packages/pi-bridge`)

放在用户的 pi extensions 目录（由 `pi-peer-bridge install` 自动放置）。

**核心工具集**：

| 工具 | 描述 | 对应 IPC 调用 |
|---|---|---|
| `peer_chat_send` | 发送文本到 peer / room | `POST /rooms/:id/send` |
| `peer_chat_send_file` | 发送文件 + 附言 | `POST /rooms/:id/send_file` |
| `peer_chat_wait` | 等待指定房间新消息（长轮询） | `POST /rooms/:id/wait` |
| `peer_chat_wait_any` | 等待任意房间新消息 | `POST /rooms/wait_any` |
| `peer_chat_status` | 查看各房间未读数 / peer 在线状态 | `GET /rooms`, `GET /rooms/:id/unread_count` |
| `peer_chat_history` | 调阅房间历史消息 | `GET /rooms/:id/messages` |
| `peer_list` | 列出 known peers 及在线状态 | `GET /status` |

**`peer_chat_send` 响应里附 `pending_unread`**，AI 在 system prompt 中被告知"send 后查看是否有未读，可能需要先 wait"。

**`peer_chat_wait` 流式行为**：
- 进入时先 drain inbox 中的所有未读
- 没有则挂起到 `timeout_s`
- 每条新消息通过 `onUpdate` 推 partial result
- `ctx.signal` 被 abort 时中断等待并返回已收到的消息
- 单次 wait 最多 50 条消息，超过强制返回，防对端洪水
- timeout 优雅降级为 `{ messages: [], timed_out: true }`

**1:1 房间的隐式管理**：当 AI 调用 `peer_chat_send(to="alice", text="...")` 且尚不存在与 alice 的 1:1 房间时，daemon 用 §5.4 描述的确定性规则计算 room_id 并隐式创建房间。

**system prompt 注入**（在 `session_start` 事件中通过 `addContextFile` 注入）：

```
你是一个能与其他机器上的 AI 通信的助手。你可以使用以下工具：

- peer_chat_send: 发送消息给其他 peer 或房间
- peer_chat_wait: 等待聊天室的新消息（会阻塞直到有消息或超时）
- peer_chat_send_file: 发送文件给其他 peer
- peer_chat_status: 查看各房间未读消息和 peer 在线状态
- peer_chat_history: 查看房间历史消息

使用建议：
1. 发完消息后通常应该调用 peer_chat_wait 等待回复，除非用户明确让你先做别的事
2. peer_chat_send 的返回值里会有 pending_unread_count, 如果非零说明有别的房间有未读, 你应该评估是否要先去处理
3. peer_chat_wait 在超时或无消息时返回 timed_out=true，你可以决定继续等待还是干别的
4. 发送文件时附带清晰的附言，说明文件内容和期望对方做什么
5. 如果有未读消息（用 peer_chat_status 查看），应该先去拉取
6. 处理完对方请求后，用 peer_chat_send 回信告知结果
```

**`/peer-pull` 命令**（用户手动介入）：

```typescript
pi.registerCommand("peer-pull", {
  description: "拉取聊天室未读消息",
  handler: async (args, ctx) => {
    const rooms = await dc.listRooms();
    const unread = rooms.filter(r => r.unread > 0);
    if (unread.length === 0) {
      ctx.ui.notify("No unread messages", "info");
      return;
    }
    const names = unread.map(r => r.name).join(", ");
    ctx.ui.notify(`Pulling from: ${names}`, "info");
    pi.sendUserMessage(`请去聊天室看看消息。用 peer_chat_wait 拉取。`);
  },
});
```

**footer 状态**：扩展通过 `ctx.ui.setStatus("peer-bridge", "📬 alice: 2 unread | bob: online")` 在 footer 显示状态。

**发件镜像**：当 AI 调用 `peer_chat_send` / `peer_chat_send_file` 时，扩展用 `pi.sendMessage` 写入一个 `customType: "peer-bridge-outgoing"` 的 entry，内容为发送摘要。这是 audit-only，不参与 LLM 上下文。

### 6.4 CLI (`packages/cli`)

```
peer-bridge init                       生成身份密钥, 写默认配置
peer-bridge invite                     创建邀请码
peer-bridge accept <code>              接受邀请
peer-bridge peers                      列出好友 + 在线状态
peer-bridge rooms                      列出活跃房间
peer-bridge send <peer> <file> [-m]    单次发送文件 (不依赖 pi)
peer-bridge send-text <peer> <text>    单次发送文本 (不依赖 pi)
peer-bridge recv <peer>                接收文件 (不依赖 pi)
peer-bridge inbox                      查看未读消息
peer-bridge log [--room <id>] [--since 1h]  查看消息历史
peer-bridge daemon status              查询 daemon 状态
peer-bridge daemon start/stop          启动/停止 daemon
peer-bridge daemon install-service     (Windows) 安装为 Windows Service
peer-bridge daemon install-systemd     (Linux) 安装 systemd user unit
peer-bridge daemon install-launchd     (macOS) 安装 launchd LaunchAgent
```

CLI 通过 daemon socket/pipe 完成所有操作。如果 daemon 没启动，`send/recv` 等会自动 spawn daemon（foreground 模式）。

---

## 7. 用户感知与介入

### 7.1 通知分级

| 状态 | 通知路径 |
|---|---|
| **A. Bob 在 pi session 里** | 扩展用 `ctx.ui.setStatus()` 显示 footer 提示。用户用 `/peer-pull` 让 AI 去拉取。**不打断**。 |
| **B. pi 没开但 daemon 在** | daemon 触发 `[notify] on_event` hook + `/events` WS 推事件。消息存入 inbox。 |
| **C. daemon 也没开** | rendezvous 离线暂存 sealed box（§3.8），TTL 24h。daemon 启动后拉取，做 B。 |
| **D. 机器整个关机** | 同 C。TTL 过期后发起方需重发。 |

### 7.2 通知 hook

```toml
[notify]
on_event = "/home/bob/bin/peer-notify.sh"   # Linux/macOS
# on_event = "C:\\Users\\bob\\bin\\peer-notify.bat"   # Windows
```

参数通过环境变量传入：`PEER_FROM`、`PEER_ROOM`、`PEER_KIND`、`PEER_BODY`（截断到 256 字符）。

daemon **不内置**任何通知客户端。Windows 上常见做法是 hook 脚本调 `powershell -c "New-BurntToastNotification ..."` 或 `msg`，由用户自配。

### 7.3 用户介入

用户在普通 pi chat 里说 `帮我和 alice 协作分析这份报告` → AI 自然调 peer_chat_send + peer_chat_wait。AI 在 wait 过程中收到 steer 会通过 `ctx.signal` abort wait → 处理用户新指令。

### 7.4 审计

- daemon `transcript.jsonl`：完整消息历史
- pi session：AI 的工具调用记录（不重复消息内容）
- `peer-bridge log --room <id> --since 24h`：导出原始审计日志

---

## 8. 配置参考

### daemon `config.toml`

```toml
[identity]
key_file = "<data_dir>/identity.key"

[rendezvous]
url = "wss://rdv.example.com"

[webrtc]
ice_servers = [
  { urls = ["stun:stun.l.google.com:19302"] },
  # { urls = ["turn:turn.example.com:3478"], username = "...", credential = "..." },
]

[daemon]
# Linux/macOS: socket 路径
listen = "<data_dir>/daemon.sock"
# Windows: 自动用 \\.\pipe\peer-bridge-<username>
data_dir = "<data_dir>"

[notify]
on_event = ""   # 可选

[limits]
max_file_size_mb = 500
max_messages_per_wait = 50
```

---

## 9. 多人协作的设计预留

数据模型原生支持 multi-member room。第一版工具集只提供 1:1 语义，但 SQLite schema、消息 frame、room_id 生成规则都已是多人就绪。

```
# 第一版:
peer_chat_send(to="alice", text="...")
peer_chat_wait(room?, timeout_s?)

# 第二版引入:
peer_chat_room_create(peers[], topic?)
peer_chat_room_invite(room, peer)
peer_chat_room_leave(room)
```

---

## 10. 项目结构

```
peer-bridge/                          AGPL-3.0
├── .telos/                           (M0 阶段产生)
├── packages/
│   ├── protocol/
│   ├── core/
│   ├── rendezvous/
│   ├── daemon/
│   ├── cli/
│   └── pi-bridge/
├── docs/
│   ├── protocol.md                   字节级协议规范
│   ├── self-hosting.md
│   ├── federation.md
│   ├── security.md
│   ├── pi-integration.md
│   └── platform-windows.md           Windows-specific 部署/调试
├── examples/
│   ├── docker-compose.yml
│   ├── systemd/
│   ├── launchd/
│   └── windows-service/
├── LICENSE
└── README.md
```

依赖关系：
```
protocol  ←  core  ←  daemon  ←  pi-bridge
              ↑          ↑
              cli ───────┘

rendezvous 仅依赖 protocol
```

---

## 11. 实施里程碑

### M0：约束先行（产出物为文档，不写实现代码）

**目标**：把所有 cross-cutting 约束、决策、协议字节布局固化在 `.telos/` 和 `docs/protocol.md` 中。M0 的 deliverable 是文档与 test vectors，不是可运行代码。

**必须产出**：

1. **`.telos/` bootstrap**
   - `.telos/README.md`（索引）
   - `.telos/BACKLOG.md`（已知缺口分类）
   - `facts/` 至少包含：
     - `pi-extension-api-surface.md`（从 pi 文档抓取，每行带文档锚点）
     - `pi-session-append-only.md`
     - `webrtc-datachannel-limits.md`（64KiB、bufferedAmount、ordered/reliable）
     - `ed25519-x25519-conversion.md`（RFC 7748 + libsodium 引用）
     - `peer-id-encoding.md`（base32 + Luhn mod 32）
     - `nacl-sealed-box-properties.md`
     - `platform-ipc-mechanisms.md`（Unix socket / named pipe 各自约束）
   - `decisions/` 至少包含：
     - `chatroom-abstraction.md`（§3.10，alternatives 必须包含 "注入 user message"）
     - `daemon-no-pi-spawn.md`（§6.2）
     - `webrtc-over-noise-tcp.md`（§3.1）
     - `rendezvous-federation-not-turn.md`（§3.5）
     - `long-poll-wait-onupdate-streaming.md`（§6.3）
     - `deterministic-1to1-room-id.md`（§5.4）
     - `per-sender-seq-numbering.md`（§3.12）
     - `sealed-box-for-offline-notify.md`（§3.8）
     - `windows-first-class.md`（CI 矩阵 + named pipe 等价）
   - `tensions/` 至少包含：
     - `single-identity-per-device.md`（status: open，§3.11 T1）
     - `wait-gap-message-visibility.md`（status: open，§3.11 T2，记录 send response 缓解但未根除）

2. **`docs/protocol.md`**：字节级协议规范
   - 所有信令消息的 JSON schema + 示例
   - 所有 P2P frame 的 CBOR 字段 + 示例
   - 邀请码生成的位序、字典选择、校验
   - peer_id 编码的步骤（pubkey → base32 → 分组 → Luhn）
   - room_id 推导（1:1 确定性 + 多人 UUIDv7）
   - 加密细节：Ed25519 → X25519 转换调用、sealed_box 参数、签名内容拼接顺序

3. **Test vectors**（`packages/protocol/test-vectors/`）：每个加密/编码原语提供至少 3 组 (input, output) 测试向量。M1 实现必须通过这些向量。
   - peer_id 编码（5 组）
   - 邀请码生成与 hash（3 组）
   - sealed box 加密/解密（3 组，包含一组带边界条件）
   - Ed25519 签名 fingerprint 拼接（3 组）
   - CBOR frame 编码（5 组各类消息）

4. **agent-blind 检查**：M0 收尾前，开一个新 context 的 agent，仅给它 `.telos/` 和 `docs/protocol.md`，让它"设计 daemon 收到 file_offer 后的处理流程"。如果它能给出和 §6 一致的方案，M0 通过。如果不行，把缺口加进 `.telos/BACKLOG.md` 后再补。

**M0 的退出条件**：
- 所有 §3 关键决策都有对应的 telos decision 文件（含 alternatives）
- §3.11 列出的两个 tension 入库为 status: open
- protocol.md 中的二进制布局每个字节都有归属
- test vectors 覆盖所有加密/编码原语
- agent-blind 实验通过

### M1：协议骨架 + 单机闭环

依据 M0 文档实现：
- `packages/protocol`：类型定义 + test vectors runner
- `packages/core`：identity / known-peers / invite / 消息编解码 / sealed box
- 单元测试通过 M0 给出的所有 test vectors
- 三平台 CI 矩阵就绪（Linux + macOS + Windows）

### M2：rendezvous + 信令

- 单 server 实现，无联邦
- `core` 的 rendezvous-client（含 sealed box 离线 notify）
- 邀请码端到端流程跑通（CLI 层）
- 三平台 CI 跑通 invite/accept

### M3：P2P 传输

- WebRTC 握手 + DTLS fingerprint pinning
- DataChannel 消息收发
- 文件传输 + 进度
- CLI `send` / `send-text` / `recv` 在三平台可用

### M4：daemon + room 管理

- SQLite room state + inbox
- 跨平台 IPC server（Unix socket + named pipe）
- 通知 hook（含 Windows .bat 示例）
- 离线暂存拉取与解密
- Windows Service 安装脚本

### M5：pi 集成

- extension 实现（7 个工具 + `/peer-pull` + footer 状态 + 发件镜像）
- 端到端 AI 协作 demo
- `pi-peer-bridge install` 命令在三平台正确放置 extension

### M6：联邦 + 自托管文档

- 联邦协议实现
- self-hosting 文档（含三平台 daemon 部署）
- Docker rendezvous 部署示例

每个里程碑独立可测、可发布。

---

## 12. 安全/隐私要点

写入 `docs/security.md`：

- **威胁模型**：诚实但好奇的 rendezvous server、被动网络监听、被动 TURN（如果用）
- **不防御**：被攻陷的 peer、流量分析
- **必须做**：
  - daemon 启动时检查 `identity.key` 权限（Unix: 0600；Windows: NTFS ACL 仅当前用户可读）
  - known_peers 添加时强制人工确认 fingerprint
  - 所有 timestamp 校验防重放
  - 邀请码一次性、限时
  - rendezvous 对单 IP 的 invite/lookup 速率限制
  - `peer_chat_wait` 单次上限 50 条
  - sealed box 离线 notify 防 server 解密
- **第一版不做**：
  - 前向保密的长期消息存储
  - 抗流量分析
  - 恶意 peer 内容过滤

---

## 13. 用户偏好与约束

1. **AGPL-3.0**：所有包统一许可
2. **不提供官方资源**：rendezvous 自托管，TURN 自带
3. **与 pi 解耦**：`core` 严禁 import `@earendil-works/pi-coding-agent`
4. **CLI 独立可用**：不装 pi 也能用 `peer-bridge send`
5. **不做的事别做**：浏览器、PAKE、daemon 插件系统、移动端、官方 TURN
6. **配置文件用 TOML**
7. **平台**：Linux + macOS + **Windows 全部 first-class**。Windows 用 named pipe、NTFS ACL、Windows Service。CI 矩阵覆盖三平台，每个 milestone 必须三平台绿灯才能合并
8. **代码风格**：TypeScript strict、ESM、prettier 默认配置
9. **测试**：core 和 protocol 必须有单元测试 + test vectors。集成测试用 docker-compose 起 rendezvous + 多个 daemon，daemon 容器分别基于 `node:lts-slim` (Linux) 和 mock Windows 行为的测试 harness（Windows native CI 单独跑）
10. **错误信息面向人**：可操作的下一步，不要只丢 stack trace
11. **通知只做 hook**：不做托盘图标/桌面 UI/移动 push
12. **daemon 不 spawn pi 子进程**
13. **房间数据模型按多人做，工具先暴露 1:1**
14. **telos 优先**：M0 阶段产出 telos 是硬约束。M1+ 写代码前必须读相关 telos 文件，违反相关 fact 时停下与用户确认（不要静默"调和"）

---

## 14. 给 agent 的实现起点

**从 M0 开始**。M0 的 deliverable 是文档（`.telos/` + `docs/protocol.md` + test vectors），不是可运行代码。M1 才开始写代码。

M0 工作步骤建议：
1. 读完本 spec 全文
2. bootstrap `.telos/` 三个目录 + README + BACKLOG
3. 把 §3 每个决策写成 decision 文件（alternatives 从对话历史摘）
4. 把 §3.11 两个 tension 写成 tension 文件
5. 写 fact 文件，每条 native fact 必须有 evidence 链接（pi 文档锚点、RFC 编号、libsodium 函数名）
6. 写 `docs/protocol.md`，逐字段定义二进制布局
7. 写 test vectors，每个加密/编码原语 3-5 组
8. 跑 agent-blind 检查
9. 把 agent-blind 发现的缺口入 BACKLOG 或补 telos
10. M0 退出条件全部满足后，才开始 M1

实现前请确认对以下点的理解无误：

1. M0 是文档阶段，不写实现代码（§11.M0）
2. 聊天室抽象（§3.10）—— 外部 AI 通信走工具调用，不走注入 user message
3. daemon 不 spawn pi 子进程（§6.2）
4. pi extension 的 7 个工具集（§6.3）
5. send 响应附带 pending_unread 缓解 wait gap 问题（§3.11 T2）
6. per-sender seq 语义（§3.12）
7. sealed box 用于离线 notify 加密（§3.8）
8. Windows 与 Linux/macOS 同等优先级（§13.7）

有疑问先和我讨论再写代码。