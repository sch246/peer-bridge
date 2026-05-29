# BACKLOG — 已知缺口

M0 阶段追踪，agent-blind 检查后更新。

## 当前状态

- [x] M0 telos bootstrap（7 facts + 9 decisions + 2 tensions）
- [x] docs/protocol.md（字节级协议规范）
- [x] Test vectors（5 个原语，peer_id/invite/sealed_box/fingerprint_sig/cbor_frames）
- [ ] **agent-blind 检查** — M0 收尾前必须完成
- [ ] 根据 agent-blind 结果补 telos 或填充此处缺口

## Agent-blind 检查计划

1. 开一个新 context 的 agent
2. 仅提供 `.telos/` 和 `docs/protocol.md`
3. 让它"设计 daemon 收到 file_offer 后的处理流程"
4. 如果与 DESIGN.md §6 一致 → 通过
5. 否则将缺口记录于此

---

*M0 退出条件达成后更新此文件为最终状态。*
