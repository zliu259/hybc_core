import type { ScheduledController } from "@cloudflare/workers-types";

import { checkTimeouts } from "./services/ai-slot";
import { sweepStalePendingActions } from "./services/agent-pending";
import { checkApprovalTimeouts } from "./services/approval/engine";
import { sweepPendingCfAiTasks } from "./services/cf-ai";
import {
  checkNodeHeartbeat,
  detectMissingLogs,
  markOverdueRentalTerms,
  refreshWeComContactsCache,
  runReimbursementIntegrityCheck,
  shouldWakeRunner,
  wakeRunner,
  requeueTimedOutTasks
} from "./services/cron-jobs";
import {
  createFleetTimeoutNotifications,
  deliverPendingFleetNotifications
} from "./services/fleet-notification";
import type { Env } from "./types/env";

/**
 * 清扫卡死的 agent 高危写（executing 行里残留 agent bearer 令牌快照）。
 * 与本文件其它 cron 任务一致：永不抛出，异常吞掉并 console.error，避免拖垮同批次其它任务。
 * 挂在小时级而非日级——宽限期本就是 1 小时，日级会让泄漏的令牌快照最长多驻留一整天。
 */
const sweepStaleAgentActions = async (env: Env): Promise<void> => {
  try {
    const swept = await sweepStalePendingActions(env.DB);
    if (swept > 0) {
      console.warn("Swept stale agent pending actions", { count: swept });
    }
  } catch (error) {
    console.error("Stale agent pending action sweep failed", error);
  }
};

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
        // cf_ai 任务重试/超时后回 pending 无新事件，cron 兜底补执行。
        await sweepPendingCfAiTasks(env, 5);
        return;
      }

      if (cron === "0 * * * *") {
        await Promise.all([
          checkApprovalTimeouts(env),
          refreshWeComContactsCache(env),
          markOverdueRentalTerms(env),
          sweepStaleAgentActions(env)
        ]);
        await createFleetTimeoutNotifications(env);
        await deliverPendingFleetNotifications(env);
        return;
      }

      if (cron === "0 18 * * *") {
        await Promise.all([detectMissingLogs(env), runReimbursementIntegrityCheck(env)]);
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
