import { z } from "zod";

import type { HybcApiClient, QueryParams } from "../api-client.js";
import { textResult, type ToolDef } from "./types.js";

export const paymentTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "list_payments",
    title: "付款申请列表",
    description:
      "分页查询付款申请。可按状态、项目、合同、关键词(编号/内容)、是否本人(mine)、日期区间过滤。默认排除已取消。",
    inputSchema: {
      status: z.string().optional().describe("draft/pending_approval/approved/paid/rejected"),
      project_id: z.number().int().optional(),
      contract_id: z.number().int().optional(),
      project_name: z.string().optional().describe("按项目名过滤"),
      keyword: z.string().optional(),
      mine: z.boolean().optional().describe("仅本人发起的"),
      date_from: z.string().optional().describe("预计付款日起(YYYY-MM-DD)"),
      date_to: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional()
    },
    handler: async (args) => {
      const env = await client.get("/payment", args as QueryParams);
      return textResult({ items: env.data, pagination: env.pagination });
    }
  },
  {
    name: "get_payment",
    title: "付款申请详情",
    description: "按 id 获取付款申请详情（含合同、收款方摘要）。",
    inputSchema: { id: z.number().int().describe("付款申请 id") },
    handler: async (args) => {
      const env = await client.get(`/payment/${args.id as number}`);
      return textResult(env.data);
    }
  }
];
