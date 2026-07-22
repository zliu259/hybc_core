/**
 * cron 接线的钉子 —— 只证明「小时级批次确实调用了 agent 高危写清扫」，不重测清扫内部语义
 * （那由 services/agent-pending.test.ts 的 sweepStalePendingActions 一组覆盖）。
 *
 * 为什么这条接线值得单独钉：sweepStalePendingActions 是唯一给 request_snapshot 里那枚
 * 180 天有效的 agent bearer 令牌【封顶驻留时间】的东西。它兜的三类静止状态（卡死的 executing、
 * 从未被 claim 的 confirmed、已过期的 pending）都没有任何后续请求路径会再碰到，
 * 全靠这一次小时级调用把令牌抹掉。而在本文件出现之前，把 `sweepStaleAgentActions(env)`
 * 从 scheduled.ts 的小时分支里整行删掉，全套测试依然全绿——接线本身无人看守。
 *
 * scheduled() 把全部工作塞进 ctx.waitUntil(...)，故此处的假 ctx 必须【收集并 await】
 * 那个 promise；否则断言会跑在任何 cron 任务开始之前，测试将永远为真（即空转）。
 *
 * 同批次的其它 cron 任务与本次断言无关，且它们要真实的 D1/KV/WeCom 绑定——全部替成桩，
 * 这样 env 可以是空对象，测试也不会因为无关任务炸掉而变得脆弱。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { sweepStalePendingActions } from "./services/agent-pending";
import { scheduled } from "./scheduled";
import type { Env } from "./types/env";

vi.mock("./services/agent-pending", () => ({
  sweepStalePendingActions: vi.fn(async () => 0)
}));

vi.mock("./services/ai-slot", () => ({ checkTimeouts: vi.fn(async () => {}) }));

vi.mock("./services/approval/engine", () => ({
  checkApprovalTimeouts: vi.fn(async () => {})
}));

vi.mock("./services/cf-ai", () => ({
  sweepPendingCfAiTasks: vi.fn(async () => {})
}));

vi.mock("./services/cron-jobs", () => ({
  checkNodeHeartbeat: vi.fn(async () => {}),
  detectMissingLogs: vi.fn(async () => {}),
  markOverdueRentalTerms: vi.fn(async () => {}),
  refreshWeComContactsCache: vi.fn(async () => {}),
  runReimbursementIntegrityCheck: vi.fn(async () => {}),
  shouldWakeRunner: vi.fn(async () => false),
  wakeRunner: vi.fn(async () => {}),
  requeueTimedOutTasks: vi.fn(async () => {})
}));

vi.mock("./services/fleet-notification", () => ({
  createFleetTimeoutNotifications: vi.fn(async () => {}),
  deliverPendingFleetNotifications: vi.fn(async () => {})
}));

const env = { DB: {}, KV: {} } as unknown as Env;

/** 跑一次指定 cron 批次，并等到 waitUntil 登记的全部工作真正结束。 */
const runCron = async (cron: string): Promise<void> => {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => {}
  } as unknown as ExecutionContext;

  await scheduled({ cron } as never, env, ctx);
  await Promise.all(pending);
};

describe("scheduled · agent 高危写清扫的接线", () => {
  beforeEach(() => {
    vi.mocked(sweepStalePendingActions).mockClear();
  });

  it("runs the stale-agent-action sweep on the hourly batch", async () => {
    await runCron("0 * * * *");

    // 挂在小时级而非日级：宽限期本就是 1 小时，日级会让泄漏的令牌快照最长多驻留一整天。
    expect(sweepStalePendingActions).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sweepStalePendingActions).mock.calls[0][0]).toBe(env.DB);
  });

  it.each(["*/2 * * * *", "0 18 * * *"])(
    "does not run the sweep on the %s batch",
    async (cron) => {
      await runCron(cron);
      expect(sweepStalePendingActions).not.toHaveBeenCalled();
    }
  );

  /**
   * 与本文件其它 cron 任务一致：清扫失败绝不能把整批次带崩，否则同批的审批超时检查、
   * 通讯录刷新等会被一次 D1 抖动连坐。
   */
  it("swallows a sweep failure instead of taking the whole hourly batch down", async () => {
    vi.mocked(sweepStalePendingActions).mockRejectedValueOnce(new Error("D1 unavailable"));

    await expect(runCron("0 * * * *")).resolves.toBeUndefined();
    expect(sweepStalePendingActions).toHaveBeenCalledTimes(1);
  });
});
