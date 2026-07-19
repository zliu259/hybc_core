---
name: hybc-backend
description: 通过恒越百川(HYBC)MCP 查询公司后台——项目、付款、审批、合同、库房；并可发起需本人企业微信确认的审批通过/驳回。需先用 `hybc-mcp login` 授权。
---

# 恒越百川后台（查询 + 需本人确认的审批写）

本 skill 配合 `@hybc/mcp` 使用：以你的员工身份查询公司后台系统，并可**发起**审批通过/驳回——发起的动作必须由该员工本人在企业微信确认后才会真正执行。

## 首次使用
1. 在终端运行 `hybc-mcp login`，浏览器会打开授权页，用企业微信登录并点“授权”（有效期约 6 个月）。
2. 授权后凭证存于 `~/.hybc/credentials.json`（仅本机可读）。
3. 之后智能体即可调用下列工具。

## 可用工具

### 查询
- 项目：`search_projects`、`get_project`、`get_project_financial_summary`
- 付款：`list_payments`、`get_payment`
- 合同：`list_contracts`、`get_contract`
- 审批：`list_my_approvals`、`list_pending_approvals`、`get_approval`
- 库房：`warehouse_inventory`、`warehouse_low_stock`、`list_stock_orders`

### 写（需本人企业微信确认）
- `approve_task(id, comment?)`：发起审批**通过**
- `reject_task(id, comment?)`：发起审批**驳回**
- `check_pending(pending_action_id)`：查询待确认动作的终态

## 写操作工作流

写工具**不会立即生效**。服务端收到后只是把动作暂存，并向本人推送一张企业微信确认卡片；本人确认后服务端才重放请求、真正写库。典型流程：

1. **先查清楚**：用 `get_approval(id)` 拿到单号、金额、事由，向用户复述并确认其意图。
2. **发起**：`approve_task({ id, comment })` → 返回 `status: "awaiting_confirmation"` 与 `pending_action_id`、`summary`、`expires_at`。
3. **提示用户去微信**：明确告诉用户「已发起，请打开企业微信核对卡片并点确认」，并把单号/金额等关键信息亮出来，不要含糊概括。
4. **查终态**：用户说确认过后，用 `check_pending(pending_action_id)` 查询，得到已执行/已拒绝/已过期。
5. **如实回报**结果；查不到就说查不到，不要说成还在等待。

## 规范
- 列表工具返回 `{ items, pagination }`；结果可能分页，需要更多用 `page`/`pageSize`。
- 金额单位为元；状态字段原样呈现，不要臆测。
- 查询遇到 403 说明你的角色无权访问该数据，如实告知用户。
- **绝不能代替用户确认**，也不得寻找绕过本人确认的途径——那一步确认就是用户对该笔操作的授权本身。
- **同一动作不要反复发起**：每次发起都占用一个待确认名额，重复发起会撞上限（429）并给用户制造重复卡片；此时提示用户先去处理已有卡片。
- 写工具返回 403「只读」说明该能力当前未对你的令牌开放，如实说明并引导用户在网页端完成。
- 报“未登录/令牌过期”时，提示用户重跑 `hybc-mcp login`。
