import { z } from "zod";

import type { HybcApiClient, QueryParams } from "../api-client.js";
import { textResult, type ToolDef } from "./types.js";

/** 设备状态是系统按位置和未完成的任务算出来的，不是人填的。 */
const DEVICE_STATES = [
  "available",
  "pending_inspection",
  "repairing",
  "blocked",
  "on_project",
  "scrapped"
] as const;

export const warehouseTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "warehouse_inventory",
    title: "库存查询",
    description:
      "查询物资库存：每条物资的编号、品名、规格、单位、在库数量、最低库存，以及是否低库存。返回数组（不分页）。",
    inputSchema: {},
    handler: async (args) => {
      const env = await client.get("/warehouse/inventory", args as QueryParams);
      return textResult(env.data);
    }
  },
  {
    name: "warehouse_low_stock",
    title: "低库存物资",
    description: "查询在库数量不高于最低库存的物资。返回数组。",
    inputSchema: {},
    handler: async (args) => {
      const env = await client.get("/warehouse/inventory/alert", args as QueryParams);
      return textResult(env.data);
    }
  },
  {
    name: "list_devices",
    title: "设备查询",
    description:
      "分页查询库房设备（一机一码）：编号、名称、类别、状态、在哪个项目。可按状态、关键词、项目、设备类别过滤。返回 items + pagination。",
    inputSchema: {
      state: z
        .enum(DEVICE_STATES)
        .optional()
        .describe(
          "设备状态：available 可用、pending_inspection 待检、repairing 维修中、blocked 暂不可用、on_project 在项目、scrapped 已报废"
        ),
      keyword: z.string().optional().describe("设备编号、名称、现场叫法或型号里的关键词"),
      project_id: z.number().int().optional().describe("只看这个项目上的设备"),
      category_id: z.number().int().optional().describe("设备类别 id"),
      page: z.number().int().min(1).optional(),
      pageSize: z.number().int().min(1).max(200).optional()
    },
    handler: async (args) => {
      const env = await client.get("/warehouse/device", args as QueryParams);
      return textResult({ items: env.data, pagination: env.pagination });
    }
  }
];
