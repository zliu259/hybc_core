import type { ScheduledController } from "@cloudflare/workers-types";

import { checkTimeouts } from "./services/ai-slot";
import { checkApprovalTimeouts } from "./services/approval/engine";
import { checkNodeHeartbeat, detectMissingLogs, requeueTimedOutTasks } from "./services/cron-jobs";
import type { Env } from "./types/env";

export const scheduled = async (
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext
): Promise<void> => {
  ctx.waitUntil(
    (async () => {
      const cron = event.cron;

      if (cron === "*/5 * * * *") {
        await Promise.all([
          checkNodeHeartbeat(env),
          checkTimeouts(env),
          requeueTimedOutTasks(env)
        ]);
        return;
      }

      if (cron === "0 * * * *") {
        await checkApprovalTimeouts(env);
        return;
      }

      if (cron === "0 18 * * *") {
        await detectMissingLogs(env);
        return;
      }

      await Promise.all([
        checkNodeHeartbeat(env),
        checkTimeouts(env),
        requeueTimedOutTasks(env),
        checkApprovalTimeouts(env)
      ]);
    })()
  );
};
