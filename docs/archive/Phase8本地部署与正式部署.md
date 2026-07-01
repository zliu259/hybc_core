# Phase 8 本地部署与正式部署

## 1. 目标与策略
- Phase 8 当前策略：**全部计算节点均部署在本机**，用于产品交付测试。
- 正式部署启动条件：**交付测试完成后**，再进入正式部署流程。
- 本文覆盖：本地三节点计算部署、Worker Cron + Runner 自动化链路、上线门禁与正式部署步骤。

## 2. 本地部署架构
- 计算节点（task-runner）
  - `hybc-task-runner-primary`
  - `hybc-task-runner-secondary`
  - `hybc-task-runner-standby`
- 自动化执行服务
  - `Cloudflare Worker Cron`（任务调度）
  - `task-runner`（AI任务执行）

## 3. 配置文件
- 计算节点编排：`task-runner/docker-compose.local.yml`
- 节点环境变量：
  - `task-runner/env/node-primary.env`
  - `task-runner/env/node-secondary.env`
  - `task-runner/env/node-standby.env`
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
# 查看 task-runner
./scripts/phase8/logs-local.sh
```

### 4.4 停止
```bash
./scripts/phase8/stop-local.sh
```

## 5. 自动化任务（无 n8n）
- 自动化入口通过 API 暴露在 `/api/v1/system/automation/*`。
- 定时任务由 Worker `scheduled` 统一执行，AI任务经 `task_queue` 投递后由 `task-runner` 轮询执行。
- 手动触发入口：
```bash
curl -X POST http://127.0.0.1:8787/api/v1/system/automation/cron/run \
  -H "Content-Type: application/json" \
  -H "X-API-Key: local-dev-task-api-key" \
  -d '{"job":"all"}'
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
3. 配置 Worker Cron 与 `task-runner` 正式环境参数（API、密钥、能力列表）。
4. 执行回归验证（核心业务 + 异常场景）。
5. 观察运行 24 小时后再切换为生产常态。

## 9. 注意事项
- 当前为本地优先部署，不包含跨机器 mTLS 联通验证。
- 若 API 不在本机，请同步调整 `API_BASE_URL`。
- 若历史单节点容器 `hybc-task-runner` 正在运行，请先停止，避免多节点重复消费任务。

## 10. 已执行测试记录（本次）
- 脚本语法测试：
  - `bash -n scripts/phase8/start-local.sh`
  - `bash -n scripts/phase8/stop-local.sh`
  - `bash -n scripts/phase8/status-local.sh`
  - `bash -n scripts/phase8/logs-local.sh`
  - `bash -n scripts/phase8/formal-deploy.sh`
- 编排配置测试：
  - `docker-compose -f task-runner/docker-compose.local.yml config`
- 启停联调测试：
  - 启动：`./scripts/phase8/start-local.sh`
  - 状态：`./scripts/phase8/status-local.sh`
  - 停止：`./scripts/phase8/stop-local.sh`
  - 停止后复查：`./scripts/phase8/status-local.sh`
- 正式部署门禁测试：
  - 未设置标志：`./scripts/phase8/formal-deploy.sh` → 正常阻止
  - 设置标志：`DELIVERY_TEST_PASSED=true ./scripts/phase8/formal-deploy.sh` → 正常放行
