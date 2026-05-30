# Decision: Agent-Blind Check Protocol

> status: decided | date: 2025-05
> supersedes: none
> triggered_by: failed experiment in commit `534fed9`

## Context

M0 阶段要求执行 agent-blind 检查：给 clean agent 仅 `.telos/` 和 `docs/protocol.md`，让它设计 daemon 收到 file_offer 后的处理流程，验证能否得出与 DESIGN.md §6 一致的方案。

## Alternatives Considered

### A. 让 subagent 自由读取（❌ 已验证会失败）

**做法**：`subagent(context: "fresh", reads: [telos, protocol])`，task prompt 只写正向要求，没有负面约束。

**结果**（commit `534fed9`）：

- subagent 开局就 `ls` 仓库根目录，发现 `DESIGN.md` 后自然读了
- 读了 §6 "答卷" 再答题 → 开卷冒充闭卷，结果作废
- 即使输出与 §6 完全一致也证明不了 telos 是自足的

**根因**：

1. pi `delegate` subagent 的 `reads` 是 _预加载_ 不是 _限制访问_
2. task prompt 没写禁止读 DESIGN.md 的负面约束
3. LLM 的默认行为是"先读项目总览"

### B. 闭卷 + 负面约束 + 父 agent diff（✅ 选定）

## Decision

**Prompt 模板**（每次 agent-blind 检查使用）：

```
你正在执行一个闭卷设计实验。规则:

【可以读的文件 / 目录】(白名单, 只能读这些)
- .telos/ 下的所有文件 (README, BACKLOG, facts/, decisions/, tensions/)
- docs/protocol.md
- packages/protocol/test-vectors/ 下的 JSON

【禁止读的文件】(读了任何一个, 实验作废, 你必须立刻停止并报告)
- DESIGN.md
- README.md (项目根目录)
- docs/ 下除了 protocol.md 之外的任何文件
- packages/ 下任何源码 (.ts, .js)
- 任何 commit message 或 git log
- 绝对禁止用 ls / find / grep 等工具探索仓库结构

【任务】
基于上述白名单内的内容, 设计 daemon 收到 file_offer (room:file_offer frame) 后
的完整处理流程。要覆盖:
1. Frame decoding & validation
2. Per-sender seq 检查
3. known_peers 信任校验
4. Room membership 检查
5. 落盘策略 (transcript / inbox / DB 字段)
6. 给 CLI / pi extension 的 IPC 通知
7. daemon 明确不做的事

【输出格式】
开头先列出你实际读了哪些文件 (绝对路径), 我会核对白名单。
然后给编号的步骤流程。
最后列出: 在白名单内你找不到答案、需要靠推断填的空 (这是 BACKLOG 候选)。
```

**校验流程**（父 agent 执行）：

1. 检查 subagent 的文件读取清单 → 确认全部在白名单内
2. 如果读了黑名单 → 实验作废，重来
3. 如果白名单合规 → diff subagent 输出 vs DESIGN.md §6：
   - **没覆盖的点** → 加进 `.telos/BACKLOG.md`（telos 缺约束）
   - **错答的点** → 加进 BACKLOG（telos 有歧义或方向错）
   - **靠推断答对的点** → 建议加进 BACKLOG（telos 没显式写但能从原理推出）
4. diff 结果可接受时 M0 才算通过

## Consequences

| 正面                               | 负面                                 |
| ---------------------------------- | ------------------------------------ |
| 排除开卷污染                       | 需要父 agent 手动 diff（不能自动化） |
| 白名单 + 黑名单双重约束            | 负面约束可能被模型忽略（需要监控）   |
| BACKLOG 从 diff 中自动充填         |                                      |
| 协议可复用（未来 M0 重做时直接套） |                                      |

## Coverage gap pattern（在 M1 reviewer 发现后补充）

Agent-blind 检查抳不到一类 bug：**telos 未规定、但实现中会却不得不面对的工程决定**。

具体例子（commit `2412765`）：protocol.md 列了字段名但没钉死 CBOR integer key 分配，实现者选了“按 message type 复用 key”，造成 `room:file_offer` wire 静默 corrupt。
- agent-blind 抳不到：subagent 会同样选复用（telos 没说不该复用）
- drift-check 抳不到：code 严格匹配 telos 详细度
- 只有 implementation review（在 frame.ts 看到同一 map 下两个字段用同 key）才能发现

这是 telos 的**覆盖盒区**问题（不是保真度问题）。

### 升级提案（概况 / 未实施）

未来 agent-blind 检查增加一个输出区段：

```
【输出格式额外要求】
... (原有要求) ...
最后一节：“我做了哪些 telos 没明说的工程决定”
  - 列出你在不得不决定但 telos 没提供明确指导的点
  - 例：“telos 没说 CBOR integer key 是否可复用，我默认按 message-type 不交的复用了。”
  - 这些都是 telos 覆盖盒区候选 → BACKLOG
```

这把 agent-blind 从“信息完整性测试”升级为“信息完整性 + 隐性决定曝光”。未实施原因：还没跨 milestone 检查机会，M4 daemon 启动时一并补。

## Related

- DESIGN.md §11.M0 (步骤 8: agent-blind 检查)
- DESIGN.md §14 (给 agent 的实现起点 — 步骤 10: 把 agent-blind 发现的缺口入 BACKLOG)
- Decision: `unique-cbor-keys-not-message-scoped.md` (触发本节 coverage gap 思考的具体 bug)
- Reviewer report: `chain-runs/4f6c4fb6/reviewer.md` F1
