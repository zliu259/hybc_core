# 已归档设计与计划文档（已实现）

本目录集中存放**已经实现或已落地**的一次性设计文档、实施计划与阶段方案，仅作历史留档与追溯，不再作为执行指引。日常执行请看 `doc/README.md`、`doc/开发计划.md`、`doc/开发记录.md`。

## 清单

### 功能特性（superpowers specs/plans）
- 车队燃油治理：`2026-05-29-fleet-fuel-governance-design.md`、`2026-05-29-fleet-fuel-governance.md`
- 车辆维保记录：`2026-06-24-vehicle-maintenance-record-design.md`、`2026-06-24-vehicle-maintenance-record.md`
- 外部项目日志：`2026-05-14-external-project-log.md`
- 投标查重（前端 + AI 去重）：`2026-06-28-bidding-dedup-design.md`、`2026-06-28-bidding-dedup-frontend.md`、`2026-06-29-bidding-dedup-ai-rewrite.md`
- 退回发起人 → 编辑业务单 → 重新提交：`2026-07-01-approval-return-resubmit-design.md`
- 对外付款 UI/UX 全面优化（付款处理台）：`2026-07-08-payment-uiux-console-design.md`、`2026-07-08-payment-uiux-console-plan.md`
- 报销付款工作台三步流水线（办公室一条龙）：`2026-07-08-reimbursement-office-workbench-design.md`、`2026-07-08-reimbursement-office-workbench-plan.md`
- 审批流转优化（统一审批台/监控台 Tabs + manager 只读/返回来源感知）：`2026-07-09-approval-flow-optimization-design.md`、`2026-07-09-approval-flow-optimization-plan.md`

### 架构与重构（历史 doc/）
- 库房与资产系统：`库房系统升级架构设计.md`、`库房与资产任务队列重构方案.md`、`库房与资产任务队列重构实施计划.md`、`库房小程序任务执行接口规划.md`
- 企业微信智能机器人（工具优先架构）：`企业微信智能机器人工具优先架构设计.md`、`企业微信智能机器人工具优先架构开发计划.md`
- 大陆访问优化（Worker 主入口 + Azure HK Bridge 兜底）：`大陆访问优化-Worker主入口与AzureHKBridge兜底方案.md`
- 部署：`Phase8本地部署与正式部署.md`
- UI 重设计（早期，已并入 `doc/UI设计文档.md`）：`Re-design UI.md`、`Re-design Miniapp UI.md`

### 手动更新
- 手动切换azure hk bridge 到 aws lighsail jp bridge