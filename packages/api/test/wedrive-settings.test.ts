import { beforeEach, describe, expect, it } from "vitest";

import { setSystemConfig } from "../src/services/system-config";
import {
  callMonth,
  countCall,
  getCallCount,
  getWedriveSettings,
  mirrorActive,
  saveWedriveSetting
} from "../src/services/wedrive/settings";
import type { Env } from "../src/types/env";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 微盘镜像的设置和每月调用次数，都在 system_config 里。

const at = (iso: string): Date => new Date(iso);
const MB = 1024 * 1024;

describe.skipIf(!hasSqlite)("镜像设置", () => {
  let h: ReturnType<typeof createWarehouseHarness>;
  let env: Env;

  beforeEach(() => {
    h = createWarehouseHarness();
    env = h.env as unknown as Env;
  });

  it("什么都没配：没初始化、关着、没开放、没暂停，上限 100 MB，预算 900", async () => {
    expect(await getWedriveSettings(env)).toEqual({
      space_id: null,
      enabled: false,
      space_open: false,
      space_open_confirmed: false,
      paused_reason: null,
      mirror_max_bytes: 100 * MB,
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
    expect(await countCall(env, at("2026-11-12T00:00:00Z"), 900)).toBe(1);
    expect(await countCall(env, at("2026-11-20T00:00:00Z"), 900)).toBe(2);
    expect(await getCallCount(env, at("2026-11-12T00:00:00Z"))).toBe(2);
    expect(await getCallCount(env, at("2026-12-01T00:00:00Z"))).toBe(0);
    // 十二月的第一次调用从 1 开始，不带着十一月的数
    expect(await countCall(env, at("2026-11-30T16:00:00Z"), 900)).toBe(1);
    expect(await getCallCount(env, at("2026-11-30T15:59:59Z"))).toBe(2);
  });

  it("到了预算就不再加，返回 null", async () => {
    const now = at("2026-11-12T00:00:00Z");
    expect(await countCall(env, now, 2)).toBe(1);
    expect(await countCall(env, now, 2)).toBe(2);
    expect(await countCall(env, now, 2)).toBeNull();
    expect(await getCallCount(env, now)).toBe(2);
    // 预算调高之后接着数
    expect(await countCall(env, now, 3)).toBe(3);
  });

  it("次数不记在 KV 里（KV 同一个键一秒只能写一次，连着调用会被拒）", async () => {
    const now = at("2026-11-12T00:00:00Z");
    await Promise.all([countCall(env, now, 900), countCall(env, now, 900)]);
    expect(await getCallCount(env, now)).toBe(2);
    expect([...h.kv.keys()].filter((key) => key.includes("wedrive"))).toEqual([]);
  });

  it("开放有三种状态：没开放、已开放、问过但没收到答复（按已开放处理，但没确认）", async () => {
    await saveWedriveSetting(env, { space_open: "asked" }, "boss");
    expect(await getWedriveSettings(env)).toMatchObject({
      space_open: true,
      space_open_confirmed: false
    });
    await saveWedriveSetting(env, { space_open: true }, "boss");
    expect(await getWedriveSettings(env)).toMatchObject({
      space_open: true,
      space_open_confirmed: true
    });
    await saveWedriveSetting(env, { space_open: false }, "boss");
    expect(await getWedriveSettings(env)).toMatchObject({
      space_open: false,
      space_open_confirmed: false
    });
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
      mirror_max_bytes: 100 * MB,
      monthly_budget: 900
    });
    await setSystemConfig(env, "warehouse.wedrive_mirror_max_mb", "999999", "boss");
    await setSystemConfig(env, "warehouse.wedrive_monthly_budget", "5000", "boss");
    expect(await getWedriveSettings(env)).toMatchObject({
      mirror_max_bytes: 100 * MB,
      monthly_budget: 900
    });
  });

  it("库里的次数被写坏时当 0", async () => {
    await setSystemConfig(env, "warehouse.wedrive_calls.2026-11", "oops", "x");
    expect(await getCallCount(env, at("2026-11-12T00:00:00Z"))).toBe(0);
  });
});
