import { beforeEach, describe, expect, it } from "vitest";

import { setSystemConfig } from "../src/services/system-config";
import {
  addCall,
  callMonth,
  getCallCount,
  getWedriveSettings,
  mirrorActive,
  saveWedriveSetting
} from "../src/services/wedrive/settings";
import type { Env } from "../src/types/env";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 微盘镜像的设置（system_config）和每月调用次数（KV）。

const at = (iso: string): Date => new Date(iso);
const MB = 1024 * 1024;

describe.skipIf(!hasSqlite)("镜像设置", () => {
  let h: ReturnType<typeof createWarehouseHarness>;
  let env: Env;

  beforeEach(() => {
    h = createWarehouseHarness();
    env = h.env as unknown as Env;
  });

  it("什么都没配：没初始化、关着、没开放、没暂停，上限 200 MB，预算 900", async () => {
    expect(await getWedriveSettings(env)).toEqual({
      space_id: null,
      enabled: false,
      space_open: false,
      paused_reason: null,
      mirror_max_bytes: 200 * MB,
      monthly_budget: 900
    });
  });

  it("存下空间、开关、开放、暂停原因；暂停原因可以清掉", async () => {
    await saveWedriveSetting(env, { space_id: "s.1", enabled: true }, "boss");
    const paused = await saveWedriveSetting(
      env,
      { space_open: true, paused_reason: " 本月次数用完了 " },
      "boss"
    );
    expect(paused).toMatchObject({
      space_id: "s.1",
      enabled: true,
      space_open: true,
      paused_reason: "本月次数用完了"
    });
    const resumed = await saveWedriveSetting(env, { paused_reason: null, enabled: false }, "boss");
    expect(resumed).toMatchObject({ paused_reason: null, enabled: false, space_id: "s.1" });
  });

  it("mirrorActive：三个条件缺一个都是 false", async () => {
    const base = await getWedriveSettings(env);
    const on = { ...base, space_id: "s.1", enabled: true };
    expect(mirrorActive(on)).toBe(true);
    expect(mirrorActive({ ...on, space_id: null })).toBe(false);
    expect(mirrorActive({ ...on, enabled: false })).toBe(false);
    expect(mirrorActive({ ...on, paused_reason: "停了" })).toBe(false);
  });

  it("调用次数按北京时间的月份记；跨月从 0 开始", async () => {
    expect(callMonth(at("2026-11-30T15:59:59Z"))).toBe("2026-11");
    expect(callMonth(at("2026-11-30T16:00:00Z"))).toBe("2026-12");
    expect(await getCallCount(env, at("2026-11-12T00:00:00Z"))).toBe(0);
    expect(await addCall(env, at("2026-11-12T00:00:00Z"))).toBe(1);
    expect(await addCall(env, at("2026-11-20T00:00:00Z"))).toBe(2);
    expect(await getCallCount(env, at("2026-11-12T00:00:00Z"))).toBe(2);
    expect(await getCallCount(env, at("2026-12-01T00:00:00Z"))).toBe(0);
    expect(h.kv.get("wedrive:calls:2026-11")).toBe("2");
  });

  it("上限和预算可以改；配成乱七八糟的值时用默认值", async () => {
    await setSystemConfig(env, "warehouse.wedrive_mirror_max_mb", "50", "boss");
    await setSystemConfig(env, "warehouse.wedrive_monthly_budget", "300", "boss");
    expect(await getWedriveSettings(env)).toMatchObject({
      mirror_max_bytes: 50 * MB,
      monthly_budget: 300
    });
    await setSystemConfig(env, "warehouse.wedrive_mirror_max_mb", "abc", "boss");
    await setSystemConfig(env, "warehouse.wedrive_monthly_budget", "-5", "boss");
    expect(await getWedriveSettings(env)).toMatchObject({
      mirror_max_bytes: 200 * MB,
      monthly_budget: 900
    });
    await setSystemConfig(env, "warehouse.wedrive_mirror_max_mb", "999999", "boss");
    await setSystemConfig(env, "warehouse.wedrive_monthly_budget", "5000", "boss");
    expect(await getWedriveSettings(env)).toMatchObject({
      mirror_max_bytes: 200 * MB,
      monthly_budget: 900
    });
  });

  it("KV 里的次数被写坏时当 0", async () => {
    h.kv.set("wedrive:calls:2026-11", "oops");
    expect(await getCallCount(env, at("2026-11-12T00:00:00Z"))).toBe(0);
  });
});
