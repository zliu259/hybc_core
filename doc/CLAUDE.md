# CLAUDE.md — 恒越百川后台管理系统

## 项目概述

恒越百川建设集团后台管理系统，覆盖财务管理、项目管理、施工日志、资产仓库管理，深度融合AI与企业微信。

- **客户**: 恒越百川建设集团（中国大陆，顶管施工与技术研发）
- **系统类型**: 全栈后台管理系统（Web + 企微小程序）
- **多实体**: 集团下辖多个法律实体（劳务、机械、市政等），不做实体切换，在财务操作时选择对应账户

## 技术栈

### 后端
- **Runtime**: Cloudflare Workers
- **Framework**: Hono (TypeScript)
- **Database**: Cloudflare D1 (SQLite) — 主库 + 旧数据只读库(legacy_前缀)
- **Cache/Session**: Cloudflare KV — JWT会话、配置缓存、企微通讯录缓存
- **File Storage**: Cloudflare R2 — 合同、照片、文档、报表
- **Queue**: Cloudflare Queue — 事件总线 + 任务分发
- **Cron**: Cloudflare Cron Triggers — 定时报表、超时检测、心跳监控

### Web前端
- **Framework**: PureAdmin (Vue 3 + Element Plus + TypeScript)
- **Deploy**: Cloudflare Pages
- **Build**: Vite

### 小程序
- **Platform**: 企业微信小程序
- **Framework**: uni-app 或原生

### 计算节点 (Python分布式)
- **Language**: Python 3.11+
- **Deploy**: Docker
  - PRIMARY: AWS Lightsail SG (AI调用、OCR、文件生成)
  - SECONDARY: 树莓派 (通知、轻量计算)
  - STANDBY: AU NAS (备用，故障转移)
- **通信**: IPv6直连 + mTLS + API Key，Pull模式轮询(3-5秒)

### 自动化编排
- **Platform**: n8n (Docker)
- **Deploy**: Lightsail SG (主) / AU NAS (冷备)

## 项目结构

```
hengyue-system/
├── CLAUDE.md
├── README.md
│
├── docs/                            # 文档
│   ├── design-v5.docx               # 系统设计文档
│   ├── database-schema.sql          # 完整建表SQL
│   └── dev-plan.md                  # 开发计划
│
├── packages/
│   ├── api/                         # Hono后端 (Cloudflare Workers)
│   │   ├── src/
│   │   │   ├── index.ts             # 入口，Hono app
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts          # JWT认证中间件
│   │   │   │   ├── rbac.ts          # RBAC权限中间件
│   │   │   │   ├── rate-limit.ts    # 限流
│   │   │   │   └── logger.ts        # 请求日志
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts          # 认证路由 (企微OAuth)
│   │   │   │   ├── user.ts          # 用户信息
│   │   │   │   ├── entity.ts        # 经营实体
│   │   │   │   ├── project.ts       # 项目管理
│   │   │   │   ├── contract.ts      # 统一合同
│   │   │   │   ├── payment.ts       # 付款管理
│   │   │   │   ├── reimbursement.ts # 报销管理
│   │   │   │   ├── receipt.ts       # 收款管理(发票+收款登记)
│   │   │   │   ├── log.ts           # 施工日志
│   │   │   │   ├── survey.ts        # 现场勘查
│   │   │   │   ├── approval.ts      # 审批操作
│   │   │   │   ├── asset.ts         # 资产管理
│   │   │   │   ├── warehouse.ts     # 仓库管理
│   │   │   │   ├── task.ts          # 计算节点任务API
│   │   │   │   ├── dict.ts          # 数据字典
│   │   │   │   ├── upload.ts        # 文件上传(R2)
│   │   │   │   ├── admin.ts         # 超管管理
│   │   │   │   └── dashboard.ts     # 仪表盘数据
│   │   │   ├── services/
│   │   │   │   ├── approval-engine.ts    # 审批流引擎核心
│   │   │   │   ├── ai-slot.ts            # AI Slot Manager
│   │   │   │   ├── event-bus.ts          # 事件总线
│   │   │   │   ├── serial-no.ts          # 流水号生成
│   │   │   │   ├── amount-cn.ts          # 金额大写转换
│   │   │   │   ├── wechat-work.ts        # 企微API封装
│   │   │   │   └── task-dispatcher.ts    # 任务队列调度
│   │   │   ├── models/
│   │   │   │   └── *.ts                  # D1数据访问层
│   │   │   ├── types/
│   │   │   │   └── *.ts                  # TypeScript类型定义
│   │   │   └── utils/
│   │   │       └── *.ts
│   │   ├── migrations/               # D1数据库迁移
│   │   │   ├── 0001_init.sql
│   │   │   ├── 0002_approval.sql
│   │   │   └── ...
│   │   ├── wrangler.toml             # Cloudflare配置
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                          # PureAdmin Web前端
│   │   ├── src/
│   │   │   ├── views/
│   │   │   │   ├── dashboard/        # 仪表盘
│   │   │   │   ├── project/          # 项目管理
│   │   │   │   ├── finance/
│   │   │   │   │   ├── payment/      # 对外付款
│   │   │   │   │   ├── receipt/      # 收款
│   │   │   │   │   └── reimbursement/ # 报销
│   │   │   │   ├── construction/     # 施工日志
│   │   │   │   ├── asset/            # 资产仓库
│   │   │   │   ├── entity/           # 实体管理
│   │   │   │   ├── approval/         # 审批中心
│   │   │   │   └── admin/            # 系统管理
│   │   │   ├── api/                  # API调用封装
│   │   │   ├── stores/               # Pinia状态管理
│   │   │   ├── composables/          # 组合式函数
│   │   │   ├── components/           # 通用组件
│   │   │   └── utils/
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   └── miniapp/                      # 企微小程序
│       ├── pages/
│       │   ├── index/                # 首页/工作台
│       │   ├── log/                  # 日志填报
│       │   ├── approval/             # 审批
│       │   ├── reimbursement/        # 报销
│       │   ├── asset/                # 设备扫码
│       │   └── survey/               # 现场勘查
│       ├── utils/
│       └── app.json
│
├── task-runner/                      # Python计算节点
│   ├── runner/
│   │   ├── __init__.py
│   │   ├── main.py                   # 入口: 轮询+执行循环
│   │   ├── config.py                 # 配置管理
│   │   ├── poller.py                 # 任务拉取器
│   │   ├── executor.py               # 任务执行调度
│   │   ├── heartbeat.py              # 心跳上报
│   │   ├── providers/                # AI Provider适配器
│   │   │   ├── base.py
│   │   │   ├── claude.py
│   │   │   ├── openai_provider.py
│   │   │   └── local_rules.py
│   │   ├── tasks/                    # 具体任务处理器
│   │   │   ├── base.py
│   │   │   ├── contract_review.py
│   │   │   ├── risk_assessment.py
│   │   │   ├── reimbursement_check.py
│   │   │   ├── log_analysis.py
│   │   │   ├── equipment_recommend.py
│   │   │   ├── ocr_extract.py
│   │   │   └── file_generator.py
│   │   └── security/
│   │       ├── mtls.py
│   │       └── auth.py
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── requirements.txt
│   └── tests/
│
└── n8n/                              # n8n配置与工作流
    ├── docker-compose.yml
    ├── workflows/                    # 导出的工作流JSON
    │   ├── approval-notification.json
    │   ├── daily-report.json
    │   ├── weekly-report.json
    │   ├── inventory-alert.json
    │   └── ...
    └── .env.example
```

## 核心业务域

### 1. 项目管理
- 项目是系统核心关联实体，所有业务围绕项目展开
- 生命周期: planning → preparing → active → completing → archived
- 包含标段管理、设备规划(AI辅助)、进度监控

### 2. 财务管理 (需迁移旧数据)
- **对外付款**: 合同驱动，合同审批→付款申请→金额控制(不超合同总额)
- **收款**: 合同→发票签发(可多张，不超合同)→收款登记(实际入账)
- **报销**: 信封制(实物+电子双通道)，UUID标识，AI查重

### 3. 施工日志
- 操作员日志(AI辅助填写)、管理员日志(富文本+照片)
- 贯通报告、现场勘查
- AI生成日报/周报，进度异常预警
- 施工参数异常检测留给二期专用模型

### 4. 资产仓库
- **有状态资产**: 唯一身份码(激光雕刻)、可维修改造、有性能参数、完整设备档案(文档库+事件时间线)
- **无状态资产**: 耐用件/易损件/消耗品，按数量管理
- 出入库、调拨、项目设备规划(AI推荐)、库存预警

### 5. 审批引擎
- 自建审批引擎，不用企微原生审批
- 节点类型: sequential(顺序签), countersign(会签), or_sign(或签), ai_gate, auto, cc
- 支持: 退回(发起人/上一节点/指定节点)、拒绝、转签、撤回、取消、重新提交
- 金额阈值动态配置，实例级二次设置

## 四大引擎

1. **审批流引擎**: 动态路由 + 多种签署方式 + 退回/转签
2. **AI决策引擎**: AI Slot抽象层，可切换Provider，事前(审查/评估) + 事中(辅助) + 事后(审计)
3. **事件总线**: Cloudflare Queue，连接所有引擎
4. **自动化编排**: n8n，通知/报表/同步

## AI介入范围 (一期)

### 参与
- 合同AI审查、付款风险评估、报销异常检测+查重
- 财务审计报告、收付款匹配异常、成本超支预警
- 项目可行性分析、审批辅助建议
- 施工日志智能填写、日报/周报生成、进度异常预警
- 设备推荐、耗材估算、库存预警分析、消耗异常检测

### 不参与 (二期)
- 施工参数异常检测(压力/电流/土质)
- 设备故障预测、施工安全评估

## 权限模型

| 角色 | 说明 |
|------|------|
| 超级管理员 | 全部权限，系统配置，高风险决策 |
| 经理 | 项目管理，审批，合同，跨项目查看 |
| 现场管理员 | 管理员日志，付款申请，设备管理，所属项目范围 |
| 现场操作员 | 操作员日志，报销提交，设备扫码，仅自己的数据 |

## 认证模型（WeCom-first + Passkey）

### 核心原则
- Canonical identity 始终是企业微信 `userid`。
- Passkey 是绑定到 `userid` 的可选认证器，不替代 WeCom 首次登录。
- 首次登录必须走 WeCom OAuth；仅在已有 WeCom 会话后允许注册 Passkey。

### 平台边界
- Web 浏览器：支持 Passkey（WebAuthn）。
- 企业微信小程序 WebView：不作为 Passkey 承载端。
- 企业微信内置 WebView：不保证稳定支持 WebAuthn，按版本灰度验证。

### 会话与凭证约束
- JWT 会话必须携带 `auth_method`（`wecom_oauth` 或 `passkey`）和 `wecom_verified_at`。
- Passkey challenge 存储在 KV，TTL 5 分钟，且必须单次消费。
- Passkey 公钥凭证持久化在 D1，`public_key` 使用 `BLOB`。
- 必须校验 signature counter；发现回退或异常时执行吊销并要求重新 WeCom 验证。

### 安全与审计
- 所有 Passkey 注册、认证、吊销、失败事件必须写入审计日志（`passkey_audit_log`）。
- Feature Flag 由 KV 控制（`passkey:feature:config`），默认支持灰度与回滚。
- 任何灰度关闭场景下，系统必须可完整回退至 WeCom-only 登录路径。

### 实施约束
- 迁移只允许增量建表，不得破坏现有认证链路（`/api/v1/auth/login/web`、`/api/v1/user/me`）。
- Worker 若启用 `@simplewebauthn/server`，`wrangler.toml` 需开启 `nodejs_compat`。

## 开发约定

### 后端
- 所有时间字段使用 ISO 8601 TEXT 类型
- 人员关联使用企微 userid，不建独立用户表
- 流水号由系统生成，格式: {业务前缀}-{年月日}-{序号}
- API路径统一 /api/v1 前缀
- 金额大写由后端自动生成
- 删除操作使用软删除 (status字段或deleted_at)
- 合同金额控制在API层强制校验

### 前端
- 遵循 PureAdmin 规范和目录结构
- 使用 Pinia 管理状态
- API调用封装在 api/ 目录
- 组件复用通过 composables/ 和 components/

### 计算节点
- 所有任务通过 task_queue 表分发
- 节点不监听入站端口，仅出站轮询
- AI调用通过 AI Slot 路由，不直接硬编码Provider
- 任务结果必须写入 ai_audit_log

### 数据库
- 主库表名无前缀
- 旧数据库表名 legacy_ 前缀
- 迁移文件按序号命名: 0001_init.sql, 0002_xxx.sql
- 索引命名: idx_{表名}_{字段}

## 常用命令

```bash
# 后端开发
cd packages/api
npm run dev                    # 本地开发 (wrangler dev)
npm run deploy                 # 部署到CF Workers
npx wrangler d1 migrations apply hybcdg-prod-db  # 执行数据库迁移（远程加 --remote）

# 前端开发
cd packages/web
npm run dev                    # 本地开发
npm run build                  # 构建
npm run deploy                 # 部署到CF Pages

# 计算节点
cd task-runner
docker-compose up -d           # 启动
docker-compose logs -f         # 查看日志

# n8n
cd n8n
docker-compose up -d
```

## 注意事项

- D1单库上限5GB，历史数据定期归档到R2
- CF Worker执行时间限制，重计算任务必须走外部计算节点
- AI任务异步执行(Queue)，不阻塞用户提交
- 企微API有限流，通讯录缓存到KV，消息通过Queue削峰
- 旧数据库只读，不可写入
- 有状态资产的properties字段是JSON，按asset_type的property_schema验证
- 报销信封UUID同时作为二维码内容和识别码
