# Telos 因果索引

> 记录 peer-bridge 的**事实**（约束条件）、**决策**（为什么这样而不是那样）、**张力**（已知未解决的矛盾）。

## 目录

### facts/ — 外部约束
不会被同项目决策改变的外部事实。如 pi 的 API surface、WebRTC 限制、加密原语属性。

### decisions/ — 架构决策
曾经可以选择不同方向的关键决策。每条记录 alternatives、选中的方案、理由。

### tensions/ — 未解决约束
已知矛盾或取舍，尚未找到满意的解决方案。状态为 open，随项目演进而关闭。

## 使用方式

1. 写代码前：阅读相关 fact 文件 → 相关 decision 文件 → 检查是否触及 tension
2. 违反 fact 时：停下，与用户确认
3. 触动 tension 时：评估是否可以做决策关闭它

## 演进规则

- facts 不直接被同项目决策改变，但可以被"发现新事实"取代
- decisions 可以被后续决策明确 supersede（标注 superseded_by）
- tensions 关闭时 status 从 open → closed，并引用决策
