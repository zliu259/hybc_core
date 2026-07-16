import type { z } from "zod";

import type { HybcApiClient } from "../api-client.js";

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  handler: (
    args: Record<string, unknown>
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

export const textResult = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }]
});

export type ToolFactory = (client: HybcApiClient) => ToolDef[];
