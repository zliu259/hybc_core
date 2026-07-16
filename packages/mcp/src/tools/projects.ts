import { z } from "zod";

import type { HybcApiClient, QueryParams } from "../api-client.js";
import { textResult, type ToolDef } from "./types.js";

export const projectTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "search_projects",
    title: "搜索项目",
    description:
      "分页搜索项目列表。可按关键词(项目名/编号)、状态、类型(internal/external)、地点过滤。返回 items + pagination。",
    inputSchema: {
      keyword: z.string().optional().describe("项目名或编号关键词"),
      status: z.string().optional().describe("项目状态，如 active/planning/archived"),
      project_kind: z.enum(["internal", "external"]).optional(),
      location: z.string().optional(),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(100).optional()
    },
    handler: async (args) => {
      const env = await client.get("/project", args as QueryParams);
      return textResult({ items: env.data, pagination: env.pagination });
    }
  },
  {
    name: "get_project",
    title: "项目详情",
    description: "按数字 id 获取单个项目的完整详情。",
    inputSchema: { id: z.number().int().describe("项目 id") },
    handler: async (args) => {
      const env = await client.get(`/project/${args.id as number}`);
      return textResult(env.data);
    }
  },
  {
    name: "get_project_financial_summary",
    title: "项目财务概览",
    description:
      "获取某项目的财务汇总：对外已付、对内已收/已开票、报销额、收据数。",
    inputSchema: { id: z.number().int().describe("项目 id") },
    handler: async (args) => {
      const env = await client.get(`/project/${args.id as number}/financial-summary`);
      return textResult(env.data);
    }
  }
];
