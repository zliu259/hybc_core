import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { HybcApiClient } from "../api-client.js";
import { approvalWriteTools } from "./approvals-write.js";
import { approvalTools } from "./approvals.js";
import { contractTools } from "./contracts.js";
import { paymentTools } from "./payments.js";
import { projectTools } from "./projects.js";
import type { ToolDef } from "./types.js";
import { warehouseTools } from "./warehouse.js";

export const allToolDefs = (client: HybcApiClient): ToolDef[] => [
  ...projectTools(client),
  ...paymentTools(client),
  ...contractTools(client),
  ...approvalTools(client),
  ...warehouseTools(client),
  ...approvalWriteTools(client)
];

export const registerAllTools = (server: McpServer, client: HybcApiClient): void => {
  for (const def of allToolDefs(client)) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema
      },
      def.handler
    );
  }
};
