---
name: hybc-backend
description: 通过恒越百川(HYBC)MCP 只读查询公司后台——项目、付款、审批、合同、库房。需先用 `hybc-mcp login` 授权。
---

# 恒越百川后台（只读）

本 skill 配合 `@hybc/mcp` 使用：以你的员工身份只读查询公司后台系统。

## 首次使用
1. 在终端运行 `hybc-mcp login`，浏览器会打开授权页，用企业微信登录并点“授权”（有效期约 6 个月）。
2. 授权后凭证存于 `~/.hybc/credentials.json`（仅本机可读）。
3. 之后智能体即可调用下列工具。

## 可用工具（只读）
- 项目：`search_projects`、`get_project`、`get_project_financial_summary`
- 付款：`list_payments`、`get_payment`
- 合同：`list_contracts`、`get_contract`
- 审批：`list_my_approvals`、`list_pending_approvals`、`get_approval`
- 库房：`warehouse_inventory`、`warehouse_low_stock`、`list_stock_orders`

## 规范
- 列表工具返回 `{ items, pagination }`；结果可能分页，需要更多用 `page`/`pageSize`。
- 金额单位为元；状态字段原样呈现，不要臆测。
- 遇到 403 说明你的角色无权访问该数据，如实告知用户。
- 当前**没有写操作**（付款/审批/建单等）；用户要写时，说明只读并引导其在网页端完成。后续版本的写操作将要求本人微信确认。
- 报“未登录/令牌过期”时，提示用户重跑 `hybc-mcp login`。
