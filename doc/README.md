# 文档索引

## 核心文档
- 架构与约束：`doc/CLAUDE.md`
- 开发计划：`doc/开发计划.md`
- 业务背景：`doc/background_inv.md`
- 本地开发指南：`doc/local-dev-setup.md`
- UI 页面级设计：`doc/UI设计文档.md`
- 统一开发记录：`doc/开发记录.md`
- 旧数据迁移兼容计划（测试阶段）：`doc/legacy_data/迁移兼容计划.md`
- Phase 8 本地与正式部署：`doc/Phase8本地部署与正式部署.md`

## 当前执行主线（2026-02）
- Phase 12（Passkey + 项目化视图）：`doc/开发计划.md`
- Web 项目工作区 IA 设计：`doc/UI设计文档.md`（3.4）
- 小程序项目模块重构约束：`doc/UI设计文档.md`（4.4）
- WeCom-first + Passkey 安全边界：`doc/CLAUDE.md`（认证模型章节）
- 决策与风险记录：`doc/开发记录.md`

## 开发记录规则（强制）
- 仅允许在 `doc/开发记录.md` 续写开发记录。
- 禁止新增 `开发记录-日期.md` 或其他分散记录文件。
- 每次记录使用时间 section：`## YYYY-MM-DD HH:mm (TZ)`。
- 每次记录包含：目标、变更、影响范围、下一步。

## 文档维护规则
- 功能或流程变更时，需同步更新相关文档指向。
- UI 页面新增时，必须在 `doc/UI设计文档.md` 增加页面条目与路径指向。
- 若目录结构变动，先更新本索引，再改具体文档。
