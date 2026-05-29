# Fact: Inbox Directory Structure

> 外部约束。定义 daemon 如何组织接收到的消息和文件的本地存储。

## 目录结构

```
<data_dir>/
├── rooms/
│   └── <room_id>/
│       ├── transcript.jsonl      # 完整消息审计日志（所有 room:* frame 的 JSONL 记录）
│       └── inbox/                # 接收到的文件落盘目录
│           ├── <file_id>.part    # 传输中的文件（临时）
│           └── <file_id>         # 传输完成的文件
```

## transcript.jsonl

**路径**：`<data_dir>/rooms/<room_id>/transcript.jsonl`

**格式**：每行一个 JSON 对象，`\n` 分隔。Append-only。

**内容**：所有 `room:msg`、`room:file_offer`、`room:file_done`、`room:system` 消息的**完整帧数据**。

```jsonl
{"type":"room:hello","version":"0.1.0","ts":1736937600000}
{"type":"room:msg","room_id":"<hex>","sender":"PB-...","body":"Hello","kind":"text","seq":0,"ts":1736937601000}
{"type":"room:file_offer","room_id":"<hex>","file_id":"<uuid>","sender":"PB-...","name":"report.pdf","size":1048576,"sha256":"<hex>","note":"Q4 analysis","seq":1,"ts":1736937602000}
{"type":"room:file_done","room_id":"<hex>","file_id":"<uuid>","ts":1736937630000}
```

**用途**：

- Per-sender seq 跨连接恢复（daemon 重启后从 transcript 反向计算 last_seen_seq）
- `room:resync_request` 的重传数据源
- 审计与调试

**写入顺序**：先 append transcript.jsonl → 再写入 SQLite。

## inbox/

**路径**：`<data_dir>/rooms/<room_id>/inbox/`

**文件落盘流程**：

1. `room:file_offer` 到达 → 不创建文件，仅记录在 SQLite + transcript
2. 用户接受 offer → daemon 发送 `room:file_accept`
3. Sender 开始发送 `room:file_chunk` on `bulk` channel
4. Daemon 创建 `inbox/<file_id>.part`，追加 chunk 数据
5. 所有 chunk 到达 → 校验 SHA-256 → 重命名 `inbox/<file_id>.part` → `inbox/<file_id>`
6. 校验失败 → 删除 `.part`，发 `room:file_abort(reason="sha256_mismatch")`

**文件大小限制**：单个文件 ≤500 MiB（可配置）。总 inbox 大小不限制策略，由用户自行管理磁盘。

## data_dir 平台路径

| 平台        | 路径                     |
| ----------- | ------------------------ |
| Linux/macOS | `~/.peer-bridge/`        |
| Windows     | `%APPDATA%\peer-bridge\` |

## 对 peer-bridge 的影响

- `file_offer` 到达后文件数据**不**立即落盘 — 等待用户显式 accept
- transcript.jsonl 是 seq 恢复的 source of truth（daemon 重启后需要知道 last_seq）
- inbox 使用 `.part` 后缀区分配输中/已完成文件
- 平台无关路径，daemon 启动时解析 `data_dir`

## 参考

- DESIGN.md §4（data_dir 目录结构）
- DESIGN.md §5.5（文件落盘路径）
- DESIGN.md §6.2（SQLite schema 与 transcript 关系）
