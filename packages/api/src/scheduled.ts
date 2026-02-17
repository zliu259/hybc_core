import type { ScheduledController } from "@cloudflare/workers-types";

import { checkTimeouts } from "./services/ai-slot";
import { checkApprovalTimeouts } from "./services/approval/engine";
import type { Env } from "./types/env";

export const scheduled = async (
  _event: ScheduledController,
  env: Env,
  ctx: ExecutionContext
): Promise<void> => {
  ctx.waitUntil(
    (async () => {
      await Promise.all([checkApprovalTimeouts(env), checkTimeouts(env)]);
    })()
  );
};
