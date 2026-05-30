import type { ScheduledController } from "@cloudflare/workers-types";

import { checkTimeouts } from "./services/ai-slot";
import { checkApprovalTimeouts } from "./services/approval/engine";
import {
  checkNodeHeartbeat,
  detectMissingLogs,
  markOverdueRentalTerms,
  refreshWeComContactsCache,
  shouldWakeRunner,
  wakeRunner,
  requeueTimedOutTasks
} from "./services/cron-jobs";
import {
  createFleetTimeoutNotifications,
  deliverPendingFleetNotifications
} from "./services/fleet-notification";
import type { Env } from "./types/env";

export const scheduled = async (
  event: ScheduledController,
  env: Env,
  ctx: ExecutionContext
): Promise<void> => {
  ctx.waitUntil(
    (async () => {
      const cron = event.cron;

      if (cron === "*/2 * * * *") {
        if (await shouldWakeRunner(env)) {
          await wakeRunner(env);
        }
        await Promise.all([
          checkNodeHeartbeat(env),
          checkTimeouts(env),
          deliverPendingFleetNotifications(env)
        ]);
        await requeueTimedOutTasks(env);
        return;
      }

      if (cron === "0 * * * *") {
        await Promise.all([
          checkApprovalTimeouts(env),
          refreshWeComContactsCache(env),
          markOverdueRentalTerms(env)
        ]);
        await createFleetTimeoutNotifications(env);
        await deliverPendingFleetNotifications(env);
        return;
      }

      if (cron === "0 18 * * *") {
        await detectMissingLogs(env);
        return;
      }

      await Promise.all([
        checkNodeHeartbeat(env),
        checkTimeouts(env),
        checkApprovalTimeouts(env),
        deliverPendingFleetNotifications(env)
      ]);
      await requeueTimedOutTasks(env);
    })()
  );
};
