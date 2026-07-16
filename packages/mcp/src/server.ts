import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { HybcApiClient } from "./api-client.js";
import { INSTRUCTIONS } from "./instructions.js";
import { registerAllTools } from "./tools/index.js";

export const buildServer = (client: HybcApiClient): McpServer => {
  const server = new McpServer(
    { name: "hybc", version: "0.1.0" },
    { instructions: INSTRUCTIONS }
  );
  registerAllTools(server, client);
  return server;
};
