# 文档索引

> 文档分三处：`doc/`（长期有效的核心文档与手册）、`docs/archive/`（已实现的历史设计与计划，仅留档）、`docs/planned/`（尚未实现的计划文档）。

## 核心文档（doc/，长期有效）

- 架构与约束：`doc/CLAUDE.md`
- 开发计划：`doc/开发计划.md`
- 业务背景：`doc/background_inv.md`
- 本地开发指南：`doc/local-dev-setup.md`
- UI 页面级设计：`doc/UI设计文档.md`
- 统一开发记录：`doc/开发记录.md`
- 库房与资产重构进度与下一阶段：`doc/库房与资产重构进度与下一阶段.md`
- 企业微信智能机器人任务包 0 配置教程：`doc/企业微信智能机器人任务包0配置教程.md`

## 岗位培训手册（doc/guide/）

- 培训总览：`doc/guide/00-总览与快速开始.md`
- 超级管理员手册：`doc/guide/01-超级管理员手册.md`
- 经理手册：`doc/guide/02-经理手册.md`
- 现场管理员手册：`doc/guide/03-现场管理员手册.md`
- 现场操作员手册：`doc/guide/04-现场操作员手册.md`
- 财务手册：`doc/guide/05-财务手册.md`
- 运维与部署手册：`doc/guide/06-运维与部署手册.md`
- 附录（命令与参考）：`doc/guide/07-附录-命令与参考.md`

## 旧数据迁移（doc/legacy_data/）

- 旧数据迁移兼容计划（测试阶段）：`doc/legacy_data/迁移兼容计划.md`
- 财务旧数据结构映射（fin_data）：`doc/legacy_data/SCHEMA_MAP.md`
- 财务旧数据迁移检查清单（fin_data）：`doc/legacy_data/MIGRATION_CHECKLIST.md`

## 已归档设计与计划（docs/archive/，已实现，仅留档）

- 详见 `docs/archive/README.md`。含：库房系统升级 / 任务队列重构、企业微信智能机器人工具优先架构、大陆访问优化（Azure HK Bridge 兜底）、Phase 8 部署、早期 UI 重设计，以及 superpowers 各功能特性 specs/plans。
- Azure 企业微信桥接说明：`bridge/README.md`（随包，非归档）。

## 待实现计划（docs/planned/，尚未实现）

- 详见 `docs/planned/README.md`。当前暂无待实现计划。

## 开发记录规则（强制）

- 仅允许在 `doc/开发记录.md` 续写开发记录。
- 禁止新增 `开发记录-日期.md` 或其他分散记录文件。
- 每次记录使用时间 section：`## YYYY-MM-DD HH:mm (TZ)`。
- 每次记录包含：目标、变更、影响范围、下一步。

## 文档维护规则

- 功能或流程变更时，需同步更新相关文档指向。
- UI 页面新增时，必须在 `doc/UI设计文档.md` 增加页面条目与路径指向。
- 若目录结构变动，先更新本索引，再改具体文档。
- 计划文档实现落地后，从 `docs/planned/` 移动到 `docs/archive/`，并在 `doc/开发记录.md` 追加实现记录。
