import { z } from "zod";

import type { HybcApiClient, QueryParams } from "../api-client.js";
import { textResult, type ToolDef } from "./types.js";

export const approvalTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "list_my_approvals",
    title: "我相关的审批",
    description:
      "分页查询与我相关(发起或待我处理)的审批实例。可按业务类型、状态、发起人(me)、关键词过滤。",
    inputSchema: {
      biz_type: z.string().optional().describe("如 payment/contract/reimbursement"),
      status: z.string().optional(),
      initiator: z.string().optional().describe('传 "me" 只看我发起的'),
      keyword: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional()
    },
    handler: async (args) => {
      const env = await client.get("/approval", args as QueryParams);
      return textResult({ items: env.data, pagination: env.pagination });
    }
  },
  {
    name: "list_pending_approvals",
    title: "待我审批",
    description: "分页查询当前待我处理(pending)的审批任务。",
    inputSchema: {
      biz_type: z.string().optional(),
      status: z.string().optional(),
      keyword: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional()
    },
    handler: async (args) => {
      const env = await client.get("/approval/pending", args as QueryParams);
      return textResult({ items: env.data, pagination: env.pagination });
    }
  },
  {
    name: "get_approval",
    title: "审批详情",
    description:
      "按审批实例 id 获取完整详情（实例、模板、各节点、任务、转办、AI 门评审、可用动作）。",
    inputSchema: { id: z.number().int().describe("审批实例 id") },
    handler: async (args) => {
      const env = await client.get(`/approval/${args.id as number}`);
      return textResult(env.data);
    }
  }
];
