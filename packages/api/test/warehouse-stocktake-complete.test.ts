import { beforeEach, describe, expect, it } from "vitest";

import { getDevice } from "../src/services/warehouse/device";
import { createWhDoc } from "../src/services/warehouse/doc";
import { getMaterialLedger, getWhDoc, listWhDocs } from "../src/services/warehouse/doc-query";
import { reverseWhDoc } from "../src/services/warehouse/doc-reverse";
import { getMaterial } from "../src/services/warehouse/material";
import { getProjectLedger } from "../src/services/warehouse/project-ledger";
import { cancelStocktake, startStocktake } from "../src/services/warehouse/stocktake";
import { completeStocktake } from "../src/services/warehouse/stocktake-complete";
import { markStocktakeDevice, saveMaterialCount } from "../src/services/warehouse/stocktake-count";
import { getStocktake } from "../src/services/warehouse/stocktake-query";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 完成盘点：按「实盘数 − 录入那一刻的账面数」出一张 adjust 库房单，库存、时间线、盘点状态在一个批处理里一起改。

let seq = 0;
const rid = () => `req-stocktake-${String((seq += 1)).padStart(4, "0")}`;

describe.skipIf(!hasSqlite)("完成盘点", () => {
  let h;
  let st;
  let projectId;
  let cement;
  let bentonite;
  let pipe;
  let wrench;
  let d1;
  let d2;
  let d3;

  const lineOf = (materialId) => st.material_lines.find((line) => line.material_id === materialId).id;
  const record = (materialId, qty, note) =>
    saveMaterialCount(h.env, st.id, lineOf(materialId), { counted_qty: qty, note }, "kp");
  const complete = async (userid = "kp") => {
    const fresh = await getStocktake(h.env, st.id);
    return completeStocktake(h.env, st.id, { version: fresh.version }, userid);
  };
  const quantityOf = async (materialId) => (await getMaterial(h.env, materialId)).quantity;
  const shipOut = (lines, deviceIds = []) =>
    createWhDoc(
      h.env,
      {
        doc_type: "out",
        client_request_id: rid(),
        project_id: projectId,
        handover_name: "张三",
        device_lines: deviceIds.map((id) => ({ device_id: id })),
        material_lines: lines
      },
      "kp"
    );
  const adjustDocs = async () =>
    (await listWhDocs(h.env, { pageSize: "50" })).items.filter((doc) => doc.doc_type === "adjust");
  const missingEvents = (deviceId) =>
    h.database
      .prepare(
        "SELECT * FROM device_event WHERE device_id = ? AND event_type = 'stocktake_missing' ORDER BY id"
      )
      .all(deviceId);
  const justBeforeWrite = (other) => {
    let armed = true;
    h.hooks.beforeStatement = (info) => {
      if (!armed || info?.kind !== "batch") return;
      armed = false;
      other();
    };
  };

  beforeEach(async () => {
    h = createWarehouseHarness();
    projectId = h.seed.project("临河 DN1200");
    cement = h.seed.material({
      name: "水泥",
      spec: "P.O42.5",
      unit: "袋",
      kind: "consumable",
      quantity: 10
    });
    bentonite = h.seed.material({ name: "膨润土", unit: "吨", kind: "consumable", quantity: 5 });
    pipe = h.seed.material({ name: "排泥钢管", spec: "Φ114", unit: "米", quantity: 3 });
    wrench = h.seed.material({ name: "扳手", quantity: 2 });
    d1 = h.seed.device({ device_code: "SB-0001" });
    d2 = h.seed.device({ device_code: "SB-0002" });
    d3 = h.seed.device({ device_code: "SB-0003", location: "project", current_project_id: projectId });
    st = await startStocktake(h.env, { scope: "all" }, "kp");
  });

  it("盘亏盘盈各一条：出一张调整单，库存改对，流水里看得到", async () => {
    await record(cement, 8, "少两袋"); // 账面 10
    await record(bentonite, 5.5); // 账面 5
    await record(pipe, 3); // 账面 3，没差额

    const result = await complete("kp2");

    expect(result.replayed).toBe(false);
    expect(result.stocktake).toMatchObject({
      status: "done",
      completed_by_userid: "kp2",
      adjust_doc_id: result.adjust_doc.id,
      adjust_doc_no: result.adjust_doc.doc_no,
      material_diff: 2
    });
    expect(result.stocktake.completed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const doc = await getWhDoc(h.env, result.adjust_doc.id);
    expect(doc).toMatchObject({
      doc_type: "adjust",
      stocktake_id: st.id,
      operator_userid: "kp2",
      remark: `盘点 ${st.stocktake_no} 调整`,
      project_id: null
    });
    expect(
      doc.lines.map((l) => [l.material_id, l.quantity, l.stock_delta, l.balance_after, l.note])
    ).toEqual([
      [cement, 2, -2, 8, "少两袋"],
      [bentonite, 0.5, 0.5, 5.5, null]
    ]);
    expect(doc.lines.every((l) => l.outcome === "normal" && l.project_delta === 0)).toBe(true);
    expect(await quantityOf(cement)).toBe(8);
    expect(await quantityOf(bentonite)).toBe(5.5);
    expect(await quantityOf(pipe)).toBe(3);
    const ledger = await getMaterialLedger(h.env, cement, {});
    expect(ledger.items[0]).toMatchObject({ doc_type: "adjust", stock_delta: -2, balance_after: 8 });
    expect(h.database.prepare("SELECT COUNT(*) AS n FROM wh_guard").get().n).toBe(0);
  });

  it("录完之后发了 3 个货再完成：只扣盘亏的 2 个，不把发出去的当盘亏", async () => {
    await record(cement, 8); // 录的时候账面 10
    await shipOut([{ material_id: cement, quantity: 3 }]); // 账面 7
    const result = await complete();
    expect(await quantityOf(cement)).toBe(5);
    const doc = await getWhDoc(h.env, result.adjust_doc.id);
    expect(doc.lines.map((l) => [l.stock_delta, l.balance_after])).toEqual([[-2, 5]]);
  });

  it("减不动：400，说出是哪条物资，库存、盘点状态、设备行都没变", async () => {
    await record(cement, 2); // 差额 -8
    await record(bentonite, 6); // 差额 +1
    await shipOut([{ material_id: cement, quantity: 5 }]); // 账面 5
    await expect(complete()).rejects.toMatchObject({
      status: 400,
      message: "水泥 P.O42.5 现在账面只有 5袋，扣不了 8，请重新盘这一项"
    });
    expect(await quantityOf(cement)).toBe(5);
    expect(await quantityOf(bentonite)).toBe(5);
    const fresh = await getStocktake(h.env, st.id);
    expect(fresh.status).toBe("counting");
    expect(fresh.device_lines.every((line) => line.found === null)).toBe(true);
    expect(await adjustDocs()).toEqual([]);
  });

  it("预查之后又发了货、批处理里减不动：库存约束报错，整批回滚", async () => {
    await record(cement, 2); // 差额 -8，账面 10，预查能过
    justBeforeWrite(() => {
      h.database.prepare("UPDATE material SET quantity = 5 WHERE id = ?").run(cement);
    });
    await expect(complete()).rejects.toThrow(/material_quantity_non_negative/);
    h.hooks.beforeStatement = null;
    expect(await quantityOf(cement)).toBe(5);
    expect((await getStocktake(h.env, st.id)).status).toBe("counting");
    expect(await adjustDocs()).toEqual([]);
  });

  it("没有差额：不出调整单，盘点照样完成", async () => {
    await record(cement, 10);
    const result = await complete();
    expect(result.adjust_doc).toBeNull();
    expect(result.stocktake).toMatchObject({ status: "done", adjust_doc_id: null });
    expect(await adjustDocs()).toEqual([]);
    expect(h.database.prepare("SELECT COUNT(*) AS n FROM wh_guard").get().n).toBe(0);
  });

  it("没录的物资不动", async () => {
    await record(cement, 8);
    await complete();
    expect(await quantityOf(wrench)).toBe(2);
    expect(await quantityOf(bentonite)).toBe(5);
    expect((await getMaterialLedger(h.env, wrench, {})).total).toBe(0);
  });

  it("小数按 3 位算：0.3 盘成 0.1，账面变 0.1", async () => {
    h.database.prepare("UPDATE material SET quantity = 0.3 WHERE id = ?").run(bentonite);
    await record(bentonite, 0.1);
    const result = await complete();
    expect(await quantityOf(bentonite)).toBe(0.1);
    const doc = await getWhDoc(h.env, result.adjust_doc.id);
    expect(doc.lines.map((l) => [l.quantity, l.stock_delta, l.balance_after])).toEqual([
      [0.2, -0.2, 0.1]
    ]);
  });

  it("重发完成请求：返回同一张调整单，库存只改了一次", async () => {
    await record(cement, 8);
    const first = await complete();
    const again = await completeStocktake(h.env, st.id, { version: 1 }, "kp");
    expect(again).toMatchObject({ replayed: true, adjust_doc: first.adjust_doc });
    expect(again.stocktake.status).toBe("done");
    expect(await quantityOf(cement)).toBe(8);
    expect(await adjustDocs()).toHaveLength(1);
  });

  it("没有调整单的盘点重发完成请求：也是 replayed", async () => {
    await record(cement, 10);
    await complete();
    expect(await completeStocktake(h.env, st.id, { version: 1 }, "kp")).toMatchObject({
      replayed: true,
      adjust_doc: null
    });
  });

  it("版本不对：409，什么都没变", async () => {
    await record(cement, 8);
    await expect(
      completeStocktake(h.env, st.id, { version: st.version }, "kp")
    ).rejects.toMatchObject({ status: 409, message: "盘点内容有变化，请刷新后再点完成" });
    expect(await quantityOf(cement)).toBe(10);
    expect((await getStocktake(h.env, st.id)).status).toBe("counting");
  });

  it("没带版本：400", async () => {
    await record(cement, 8);
    await expect(completeStocktake(h.env, st.id, {}, "kp")).rejects.toMatchObject({ status: 400 });
    await expect(
      completeStocktake(h.env, st.id, { version: "abc" }, "kp")
    ).rejects.toMatchObject({ status: 400 });
  });

  it("预查之后有人又录了一行：批内断言失败，整批回滚，没有调整单", async () => {
    await record(cement, 8);
    justBeforeWrite(() => {
      h.database
        .prepare("UPDATE stocktake SET version = version + 1 WHERE id = ?")
        .run(st.id);
    });
    await expect(complete()).rejects.toThrow(/wh_guard/);
    h.hooks.beforeStatement = null;
    expect(await quantityOf(cement)).toBe(10);
    expect((await getStocktake(h.env, st.id)).status).toBe("counting");
    expect(await adjustDocs()).toEqual([]);
    expect(h.database.prepare("SELECT COUNT(*) AS n FROM wh_guard").get().n).toBe(0);
  });

  it("什么都没盘：400，提示去取消", async () => {
    await expect(complete()).rejects.toMatchObject({
      status: 400,
      message: "还什么都没盘。不盘了请点取消"
    });
    expect((await getStocktake(h.env, st.id)).status).toBe("counting");
  });

  it("已取消的盘点：409；不存在的：404", async () => {
    await cancelStocktake(h.env, st.id, {}, "kp");
    await expect(completeStocktake(h.env, st.id, { version: 2 }, "kp")).rejects.toMatchObject({
      status: 409,
      message: "这次盘点已经取消"
    });
    await expect(completeStocktake(h.env, 99999, { version: 1 }, "kp")).rejects.toMatchObject({
      status: 404,
      message: "盘点不存在"
    });
  });

  it("设备：没扫到的在库设备时间线上有「盘点未找到」，扫到的没有，位置都没变", async () => {
    await markStocktakeDevice(h.env, st.id, { device_id: d1, found: true }, "kp");
    const result = await complete("kp2");
    expect(result.adjust_doc).toBeNull();
    expect(result.stocktake).toMatchObject({
      status: "done",
      device_expected: 2,
      device_found: 1,
      device_missing: 1
    });
    expect(missingEvents(d1)).toEqual([]);
    const events = missingEvents(d2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      ref_type: "stocktake",
      ref_id: st.id,
      summary: `盘点未找到（${st.stocktake_no}）`,
      operator_userid: "kp2"
    });
    expect(result.stocktake.device_lines.map((line) => [line.device_id, line.found])).toEqual([
      [d1, 1],
      [d2, 0]
    ]);
    expect((await getDevice(h.env, d1)).location).toBe("warehouse");
    expect((await getDevice(h.env, d2)).location).toBe("warehouse");
  });

  it("盘点期间已经发往项目的设备不记「盘点未找到」", async () => {
    await markStocktakeDevice(h.env, st.id, { device_id: d1, found: true }, "kp");
    await shipOut([], [d2]);
    const result = await complete();
    expect(missingEvents(d2)).toEqual([]);
    expect(result.stocktake.device_missing).toBe(0);
    expect(result.stocktake.device_lines.find((line) => line.device_id === d2).found).toBeNull();
  });

  it("手动标记没找到的设备和没标记的一样处理；账上不在库但扫到的只留在报告里", async () => {
    await markStocktakeDevice(h.env, st.id, { device_id: d1, found: false, note: "找遍了" }, "kp");
    await markStocktakeDevice(h.env, st.id, { device_id: d3, found: true }, "kp");
    const result = await complete();
    expect(missingEvents(d1)).toHaveLength(1);
    expect(missingEvents(d2)).toHaveLength(1);
    expect(missingEvents(d3)).toEqual([]);
    expect(result.stocktake).toMatchObject({ device_missing: 2, device_unexpected: 1 });
    expect((await getDevice(h.env, d3)).location).toBe("project");
  });

  it("只盘物资的盘点完成时不碰设备", async () => {
    await cancelStocktake(h.env, st.id, {}, "kp");
    st = await startStocktake(h.env, { scope: "material" }, "kp");
    await record(cement, 9);
    await complete();
    expect(missingEvents(d1)).toEqual([]);
    expect(missingEvents(d2)).toEqual([]);
    expect(await quantityOf(cement)).toBe(9);
  });

  it("调整单不能冲销", async () => {
    await record(cement, 8);
    const result = await complete();
    await expect(
      reverseWhDoc(h.env, result.adjust_doc.id, { client_request_id: rid() }, "kp")
    ).rejects.toMatchObject({ status: 400 });
    expect(await quantityOf(cement)).toBe(8);
  });

  it("300 条物资都有差额也能一次完成", async () => {
    await cancelStocktake(h.env, st.id, {}, "kp");
    for (let index = 0; index < 300; index += 1) {
      h.seed.material({ name: `批量${index}`, quantity: 1 });
    }
    st = await startStocktake(h.env, { scope: "material" }, "kp");
    // 直接写成「都录了 2、当时账面 1」，省掉 300 次请求
    h.database
      .prepare(
        `UPDATE stocktake_material_line SET counted_qty = 2, book_qty = 1
          WHERE stocktake_id = ? AND material_id IN (SELECT id FROM material WHERE name LIKE '批量%')`
      )
      .run(st.id);
    const result = await complete();
    const doc = await getWhDoc(h.env, result.adjust_doc.id);
    expect(doc.lines).toHaveLength(300);
    expect(
      h.database
        .prepare("SELECT COUNT(*) AS n FROM material WHERE name LIKE '批量%' AND quantity = 2")
        .get().n
    ).toBe(300);
  });

  it("项目物资页不受盘点调整影响", async () => {
    await shipOut([{ material_id: pipe, quantity: 2 }]); // 周转件，项目在场 2，库里剩 1
    const before = await getProjectLedger(h.env, projectId);
    await cancelStocktake(h.env, st.id, {}, "kp");
    st = await startStocktake(h.env, { scope: "material" }, "kp");
    await record(pipe, 4); // 库里账面 1，盘到 4
    await complete();
    expect(await quantityOf(pipe)).toBe(4);
    expect(await getProjectLedger(h.env, projectId)).toEqual(before);
  });
});
