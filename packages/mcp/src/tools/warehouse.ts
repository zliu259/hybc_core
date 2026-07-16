import { z } from "zod";

import type { HybcApiClient, QueryParams } from "../api-client.js";
import { textResult, type ToolDef } from "./types.js";

export const warehouseTools = (client: HybcApiClient): ToolDef[] => [
  {
    name: "warehouse_inventory",
    title: "库存查询",
    description: "查询库存（可按库房、资产类型过滤）。返回库存行数组（非分页）。",
    inputSchema: {
      warehouse_id: z.number().int().optional(),
      asset_type_id: z.number().int().optional()
    },
    handler: async (args) => {
      const env = await client.get("/warehouse/inventory", args as QueryParams);
      return textResult(env.data);
    }
  },
  {
    name: "warehouse_low_stock",
    title: "低库存告警",
    description: "查询低于最小库存阈值的库存行。",
    inputSchema: {},
    handler: async (args) => {
      const env = await client.get("/warehouse/inventory/alert", args as QueryParams);
      return textResult(env.data);
    }
  },
  {
    name: "list_stock_orders",
    title: "出入库单列表",
    description: "查询出入库/调拨单。可按状态、单据类型过滤。返回数组（非分页）。",
    inputSchema: {
      status: z.string().optional(),
      order_type: z.string().optional()
    },
    handler: async (args) => {
      const env = await client.get("/warehouse/stock-order", args as QueryParams);
      return textResult(env.data);
    }
  }
];
