# Phase 8 本地部署与正式部署

## 1. 目标与策略
- Phase 8 当前策略：**全部计算节点均部署在本机**，用于产品交付测试。
- 正式部署启动条件：**交付测试完成后**，再进入正式部署流程。
- 本文覆盖：本地三节点计算部署、n8n 本地编排、上线门禁与正式部署步骤。

## 2. 本地部署架构
- 计算节点（task-runner）
  - `hybc-task-runner-primary`
  - `hybc-task-runner-secondary`
  - `hybc-task-runner-standby`
- 编排服务（n8n）
  - `hybc-n8n`（`http://localhost:5678`）

## 3. 配置文件
- 计算节点编排：`task-runner/docker-compose.local.yml`
- 节点环境变量：
  - `task-runner/env/node-primary.env`
  - `task-runner/env/node-secondary.env`
  - `task-runner/env/node-standby.env`
- n8n 编排：`n8n/docker-compose.yml`
- n8n 环境变量模板：`n8n/.env.example`
- Phase 8 脚本：`scripts/phase8/*.sh`

## 4. 本地一键部署

### 4.1 启动
```bash
./scripts/phase8/start-local.sh
```

### 4.2 查看状态
```bash
./scripts/phase8/status-local.sh
```

### 4.3 查看日志
```bash
# 同时查看 n8n + task-runner
./scripts/phase8/logs-local.sh

# 仅看 n8n
./scripts/phase8/logs-local.sh n8n

# 仅看 task-runner
./scripts/phase8/logs-local.sh runner
```

### 4.4 停止
```bash
./scripts/phase8/stop-local.sh
```

## 5. n8n 工作流
- 工作流目录：`n8n/workflows/`
- 当前已包含：审批通知、高风险警报、日/周报、月报、合同到期、日志缺失、通讯录同步、新项目初始化、库存预警。
- 工作流导入脚本（列表与导入提示）：
```bash
./n8n/scripts/import-workflows.sh
```

## 6. 交付测试门禁（必须通过）
- 正式部署前必须满足：
  - 产品交付测试完成
  - 核心流程验证通过（审批、报销、收款、资产仓库、施工日志）
  - 本地三节点稳定运行并可持续心跳

## 7. 正式部署启动方式
- 脚本门禁：`scripts/phase8/formal-deploy.sh`
- 默认会阻止部署；仅当显式传入测试通过标志时允许继续。

```bash
# 未通过交付测试时（会被阻止）
./scripts/phase8/formal-deploy.sh

# 交付测试通过后，允许开始正式部署流程
DELIVERY_TEST_PASSED=true ./scripts/phase8/formal-deploy.sh
```

## 8. 正式部署流程（交付测试通过后执行）
1. 冻结当前版本（tag/发布清单）。
2. 将本地验证通过的 `task-runner` 配置映射到正式环境。
3. 导入 `n8n/workflows` 并配置正式凭据（企微/通知渠道/API token）。
4. 执行回归验证（核心业务 + 异常场景）。
5. 观察运行 24 小时后再切换为生产常态。

## 9. 注意事项
- 当前为本地优先部署，不包含跨机器 mTLS 联通验证。
- `n8n/.env.example` 中 `N8N_API_TOKEN` 需在真实环境填充。
- 若 API 不在本机，请同步调整 `API_BASE_URL`。
- 若历史单节点容器 `hybc-task-runner` 正在运行，请先停止，避免多节点重复消费任务。
