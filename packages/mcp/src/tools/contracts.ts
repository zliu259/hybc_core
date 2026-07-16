import { z } from "zod";

import type { HybcApiClient, QueryParams } from "../api-client.js";
import { textResult, type ToolDef } from "./types.js";

export const contractTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "list_contracts",
    title: "合同列表",
    description:
      "分页查询合同。可按方向(outbound/inbound)、项目、实体、状态、关键词(编号/对方/备注)、日期区间过滤。已删除的不返回。",
    inputSchema: {
      direction: z.enum(["outbound", "inbound"]).optional(),
      project_id: z.number().int().optional(),
      project_name: z.string().optional().describe("按项目名过滤"),
      entity_id: z.number().int().optional(),
      status: z.string().optional(),
      keyword: z.string().optional(),
      date_from: z.string().optional().describe("合同日期起(YYYY-MM-DD)"),
      date_to: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional()
    },
    handler: async (args) => {
      const env = await client.get("/contract", args as QueryParams);
      return textResult({ items: env.data, pagination: env.pagination });
    }
  },
  {
    name: "get_contract",
    title: "合同详情",
    description: "按 id 获取合同详情（含金额变更记录、关联付款）。",
    inputSchema: { id: z.number().int().describe("合同 id") },
    handler: async (args) => {
      const env = await client.get(`/contract/${args.id as number}`);
      return textResult(env.data);
    }
  }
];
