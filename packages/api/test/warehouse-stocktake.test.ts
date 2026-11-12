import { beforeEach, describe, expect, it } from "vitest";

import { cancelStocktake, startStocktake } from "../src/services/warehouse/stocktake";
import { getStocktake, listStocktakes } from "../src/services/warehouse/stocktake-query";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 发起、查看、取消盘点。「只能有一个进行中」既有预查也有数据库的唯一索引兜底。

describe.skipIf(!hasSqlite)("发起和取消盘点", () => {
  let h;

  beforeEach(() => {
    h = createWarehouseHarness();
  });

  const count = (sql, ...params) =>
    Number(
      h.database
        .prepare(sql)
        .get(...params).n
    );

  /** 让「别人的操作」正好落在本次请求写库之前。只插一次。 */
  const justBeforeWrite = (other) => {
    let armed = true;
    h.hooks.beforeStatement = (info) => {
      if (!armed || info?.kind !== "batch") return;
      armed = false;
      other();
    };
  };

  it("范围是全部：每条启用的物资、每台在库的设备各一行，停用的物资和不在库的设备没有", async () => {
    const helmet = h.seed.material({ name: "安全帽", category: "劳动保护", quantity: 12 });
    const wrench = h.seed.material({ name: "扳手", category: "工具", quantity: 3 });
    h.seed.material({ name: "停用的", status: "disabled" });
    const projectId = h.seed.project("临河 DN1200");
    const inWarehouse = h.seed.device({ device_code: "SB-0001" });
    h.seed.device({ device_code: "SB-0002", location: "project", current_project_id: projectId });
    h.seed.device({ device_code: "SB-0003", location: "scrapped" });

    const detail = await startStocktake(h.env, { scope: "all", remark: " 年底盘点 " }, "kp");

    expect(detail.stocktake_no).toMatch(/^PD-\d{8}-\d+$/);
    expect(detail).toMatchObject({
      scope: "all",
      status: "counting",
      remark: "年底盘点",
      created_by_userid: "kp",
      version: 1,
      adjust_doc_id: null,
      adjust_doc_no: null,
      material_total: 2,
      material_counted: 0,
      material_diff: 0,
      device_expected: 1,
      device_found: 0,
      // 一台设备都还没标记：现在点完成不会给设备记「没找到」
      device_missing: 0,
      device_unexpected: 0
    });
    // 物资按类别、品名排
    expect(detail.material_lines.map((line) => line.material_id)).toEqual([helmet, wrench]);
    expect(detail.material_lines[0]).toMatchObject({
      name: "安全帽",
      category: "劳动保护",
      unit: "个",
      current_qty: 12,
      counted_qty: null,
      book_qty: null,
      diff: null
    });
    expect(detail.device_lines.map((line) => [line.device_id, line.expected, line.found])).toEqual([
      [inWarehouse, 1, null]
    ]);
    expect(detail.device_lines[0]).toMatchObject({
      device_code: "SB-0001",
      location: "warehouse",
      project_name: null
    });
  });

  it("范围是物资就没有设备行，范围是设备就没有物资行", async () => {
    h.seed.material({ name: "扳手" });
    h.seed.device();
    const materialOnly = await startStocktake(h.env, { scope: "material" }, "kp");
    expect([materialOnly.material_lines.length, materialOnly.device_lines.length]).toEqual([1, 0]);
    await cancelStocktake(h.env, materialOnly.id, {}, "kp");
    const deviceOnly = await startStocktake(h.env, { scope: "device" }, "kp");
    expect([deviceOnly.material_lines.length, deviceOnly.device_lines.length]).toEqual([0, 1]);
  });

  it("范围不对、备注太长：400，不建盘点", async () => {
    await expect(startStocktake(h.env, { scope: "everything" }, "kp")).rejects.toMatchObject({
      status: 400
    });
    await expect(startStocktake(h.env, {}, "kp")).rejects.toMatchObject({ status: 400 });
    await expect(
      startStocktake(h.env, { scope: "all", remark: "长".repeat(201) }, "kp")
    ).rejects.toMatchObject({ status: 400 });
    expect(count("SELECT COUNT(*) AS n FROM stocktake")).toBe(0);
  });

  it("已有进行中的盘点时再发起：409，带上那次的单号，不多出行", async () => {
    h.seed.material({ name: "扳手" });
    const first = await startStocktake(h.env, { scope: "material" }, "kp");
    await expect(startStocktake(h.env, { scope: "device" }, "kp2")).rejects.toMatchObject({
      status: 409,
      message: `已有进行中的盘点 ${first.stocktake_no}，先完成或取消它`
    });
    expect(count("SELECT COUNT(*) AS n FROM stocktake")).toBe(1);
  });

  it("两个发起请求都过了预查，第二个撞唯一索引：也是 409，整批回滚", async () => {
    h.seed.material({ name: "扳手" });
    h.seed.device();
    justBeforeWrite(() => {
      h.database
        .prepare(
          `INSERT INTO stocktake (stocktake_no, scope, status, created_by_userid, created_at, updated_at)
           VALUES ('PD-OTHER', 'material', 'counting', 'kp2', '2026-11-12T00:00:00.000Z', '2026-11-12T00:00:00.000Z')`
        )
        .run();
    });
    await expect(startStocktake(h.env, { scope: "all" }, "kp")).rejects.toMatchObject({
      status: 409,
      message: "已有进行中的盘点 PD-OTHER，先完成或取消它"
    });
    h.hooks.beforeStatement = null;
    expect(count("SELECT COUNT(*) AS n FROM stocktake")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM stocktake_material_line")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM stocktake_device_line")).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM wh_guard")).toBe(0);
  });

  it("300 条物资一次建好（不超 D1 的参数上限）", async () => {
    for (let index = 0; index < 300; index += 1) h.seed.material({ name: `物资${index}` });
    const detail = await startStocktake(h.env, { scope: "material" }, "kp");
    expect(detail.material_total).toBe(300);
    expect(detail.material_lines).toHaveLength(300);
  });

  it("取消后状态是已取消，记下原因和人；可以再发起一次", async () => {
    h.seed.material({ name: "扳手" });
    const first = await startStocktake(h.env, { scope: "material" }, "kp");
    const cancelled = await cancelStocktake(h.env, first.id, { reason: " 点错了 " }, "kp2");
    expect(cancelled).toMatchObject({
      status: "cancelled",
      cancel_reason: "点错了",
      cancelled_by_userid: "kp2",
      version: 2
    });
    expect(cancelled.cancelled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const second = await startStocktake(h.env, { scope: "material" }, "kp");
    expect(second.status).toBe("counting");
    expect(second.stocktake_no).not.toBe(first.stocktake_no);
  });

  it("取消原因可以不填", async () => {
    const first = await startStocktake(h.env, { scope: "material" }, "kp");
    expect((await cancelStocktake(h.env, first.id, {}, "kp")).cancel_reason).toBeNull();
  });

  it("取消已取消的盘点：409；不存在的：404", async () => {
    const first = await startStocktake(h.env, { scope: "material" }, "kp");
    await cancelStocktake(h.env, first.id, {}, "kp");
    await expect(cancelStocktake(h.env, first.id, {}, "kp")).rejects.toMatchObject({
      status: 409,
      message: "这次盘点已经结束"
    });
    await expect(cancelStocktake(h.env, 9999, {}, "kp")).rejects.toMatchObject({
      status: 404,
      message: "盘点不存在"
    });
  });

  it("取消已完成的盘点：409", async () => {
    const first = await startStocktake(h.env, { scope: "material" }, "kp");
    h.database.prepare("UPDATE stocktake SET status = 'done' WHERE id = ?").run(first.id);
    await expect(cancelStocktake(h.env, first.id, {}, "kp")).rejects.toMatchObject({ status: 409 });
  });

  it("预查之后盘点被别人完成了：取消的批内断言失败，状态不变", async () => {
    const first = await startStocktake(h.env, { scope: "material" }, "kp");
    justBeforeWrite(() => {
      h.database.prepare("UPDATE stocktake SET status = 'done' WHERE id = ?").run(first.id);
    });
    await expect(cancelStocktake(h.env, first.id, {}, "kp")).rejects.toThrow(/wh_guard/);
    h.hooks.beforeStatement = null;
    expect((await getStocktake(h.env, first.id))?.status).toBe("done");
  });

  it("查不存在的盘点返回 null", async () => {
    expect(await getStocktake(h.env, 12345)).toBeNull();
  });

  it("列表新的在前，带各自的汇总数和调整单号；可以按状态筛", async () => {
    h.seed.material({ name: "扳手" });
    const first = await startStocktake(h.env, { scope: "material" }, "kp");
    h.database.prepare("UPDATE stocktake SET status = 'done' WHERE id = ?").run(first.id);
    h.database
      .prepare(
        `INSERT INTO wh_doc (doc_no, doc_type, stocktake_id, operator_userid, occurred_at, client_request_id, created_at)
         VALUES ('KFD-TEST-1', 'adjust', ?, 'kp', '2026-11-12T00:00:00.000Z', 'stocktake-test', '2026-11-12T00:00:00.000Z')`
      )
      .run(first.id);
    const second = await startStocktake(h.env, { scope: "material" }, "kp");

    const all = await listStocktakes(h.env, {});
    expect(all).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    expect(all.items.map((row) => row.id)).toEqual([second.id, first.id]);
    expect(all.items[1]).toMatchObject({
      status: "done",
      material_total: 1,
      adjust_doc_no: "KFD-TEST-1"
    });
    expect(all.items[0].adjust_doc_no).toBeNull();

    const counting = await listStocktakes(h.env, { status: "counting", pageSize: "1" });
    expect(counting.items.map((row) => row.id)).toEqual([second.id]);
    expect(counting).toMatchObject({ total: 1, pageSize: 1 });
    await expect(listStocktakes(h.env, { status: "paused" })).rejects.toMatchObject({ status: 400 });
  });
});
