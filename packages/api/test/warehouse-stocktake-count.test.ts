import { beforeEach, describe, expect, it } from "vitest";

import { cancelStocktake, startStocktake } from "../src/services/warehouse/stocktake";
import { markStocktakeDevice, saveMaterialCount } from "../src/services/warehouse/stocktake-count";
import { getStocktake } from "../src/services/warehouse/stocktake-query";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 盘点中的两种写入：录实盘数（同时记下那一刻的账面数）、标记设备找到没找到。

describe.skipIf(!hasSqlite)("盘点录数和标记设备", () => {
  let h;
  let st;
  let materialA;
  let lineA;
  let lineB;
  let inWarehouse;
  let onProject;
  let scrapped;

  const lineOf = (detail, materialId) =>
    detail.material_lines.find((line) => line.material_id === materialId).id;

  /** 让「别人的操作」正好落在本次请求写库之前。只插一次。 */
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
    materialA = h.seed.material({ name: "水泥", spec: "P.O42.5", unit: "袋", quantity: 10 });
    const materialB = h.seed.material({ name: "膨润土", quantity: 5 });
    const projectId = h.seed.project("临河 DN1200");
    inWarehouse = h.seed.device({ device_code: "SB-0001" });
    onProject = h.seed.device({
      device_code: "SB-0002",
      location: "project",
      current_project_id: projectId
    });
    scrapped = h.seed.device({ device_code: "SB-0003", location: "scrapped" });
    st = await startStocktake(h.env, { scope: "all" }, "kp");
    lineA = lineOf(st, materialA);
    lineB = lineOf(st, materialB);
  });

  describe("录实盘数", () => {
    it("记下实盘数和那一刻的账面数、谁录的；盘点版本加一", async () => {
      const line = await saveMaterialCount(
        h.env,
        st.id,
        lineA,
        { counted_qty: 8, note: " 少两个 " },
        "kp"
      );
      expect(line).toMatchObject({
        id: lineA,
        counted_qty: 8,
        book_qty: 10,
        diff: -2,
        note: "少两个",
        counted_by_userid: "kp",
        name: "水泥",
        current_qty: 10
      });
      expect(line.counted_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const fresh = await getStocktake(h.env, st.id);
      expect(fresh).toMatchObject({
        version: st.version + 1,
        material_counted: 1,
        material_diff: 1
      });
    });

    it("录完之后账面变了，再录一次会按新的账面数重记", async () => {
      await saveMaterialCount(h.env, st.id, lineA, { counted_qty: 8 }, "kp");
      h.database.prepare("UPDATE material SET quantity = 7 WHERE id = ?").run(materialA);
      // 不重录的话，记下的还是当时的 10
      expect((await getStocktake(h.env, st.id)).material_lines.find((l) => l.id === lineA)).toMatchObject(
        { book_qty: 10, diff: -2, current_qty: 7 }
      );
      const again = await saveMaterialCount(h.env, st.id, lineA, { counted_qty: 7 }, "kp2");
      expect(again).toMatchObject({
        counted_qty: 7,
        book_qty: 7,
        diff: 0,
        counted_by_userid: "kp2"
      });
    });

    it("实盘数可以是 0；null 是清掉这一行", async () => {
      const zero = await saveMaterialCount(h.env, st.id, lineB, { counted_qty: 0 }, "kp");
      expect(zero).toMatchObject({ counted_qty: 0, book_qty: 5, diff: -5 });
      const cleared = await saveMaterialCount(h.env, st.id, lineB, { counted_qty: null }, "kp");
      expect(cleared).toMatchObject({
        counted_qty: null,
        book_qty: null,
        diff: null,
        counted_by_userid: null,
        counted_at: null
      });
      expect((await getStocktake(h.env, st.id)).material_counted).toBe(0);
    });

    it("小数最多 3 位，存进去是原样", async () => {
      const line = await saveMaterialCount(h.env, st.id, lineA, { counted_qty: 9.125 }, "kp");
      expect(line).toMatchObject({ counted_qty: 9.125, diff: -0.875 });
    });

    it.each([
      [-1, "实盘数不能是负数"],
      [1.2345, "实盘数最多 3 位小数"],
      ["abc", "实盘数请填数字"],
      ["1e3", "实盘数请填数字"],
      [true, "实盘数请填数字"],
      [Number.NaN, "实盘数请填数字"],
      [1_000_001, "实盘数太大了"]
    ])("实盘数是 %s：400「%s」，行不变", async (value, message) => {
      await expect(
        saveMaterialCount(h.env, st.id, lineA, { counted_qty: value }, "kp")
      ).rejects.toMatchObject({ status: 400, message });
      const fresh = await getStocktake(h.env, st.id);
      expect(fresh.material_lines.find((line) => line.id === lineA).counted_qty).toBeNull();
      expect(fresh.version).toBe(st.version);
    });

    it("只改备注：实盘数和记下的账面数都不变，哪怕账面已经变了", async () => {
      await saveMaterialCount(h.env, st.id, lineA, { counted_qty: 8, note: "少两个" }, "kp");
      h.database.prepare("UPDATE material SET quantity = 7 WHERE id = ?").run(materialA);
      const line = await saveMaterialCount(h.env, st.id, lineA, { note: " 找到一袋破的 " }, "kp2");
      expect(line).toMatchObject({
        counted_qty: 8,
        book_qty: 10,
        diff: -2,
        note: "找到一袋破的",
        counted_by_userid: "kp"
      });
      expect((await getStocktake(h.env, st.id)).version).toBe(st.version + 2);
    });

    it("没盘的行也可以先写备注；备注可以清掉", async () => {
      const noted = await saveMaterialCount(h.env, st.id, lineB, { note: "库里没看到" }, "kp");
      expect(noted).toMatchObject({ counted_qty: null, book_qty: null, note: "库里没看到" });
      const cleared = await saveMaterialCount(h.env, st.id, lineB, { note: "" }, "kp");
      expect(cleared.note).toBeNull();
    });

    it("录数时不带备注，原来的备注留着", async () => {
      await saveMaterialCount(h.env, st.id, lineA, { counted_qty: 8, note: "少两个" }, "kp");
      const line = await saveMaterialCount(h.env, st.id, lineA, { counted_qty: 9 }, "kp");
      expect(line).toMatchObject({ counted_qty: 9, note: "少两个" });
    });

    it("实盘数和备注都没带：400", async () => {
      await expect(saveMaterialCount(h.env, st.id, lineA, {}, "kp")).rejects.toMatchObject({
        status: 400,
        message: "实盘数请填数字"
      });
    });

    it("别的盘点的行、不存在的行：404", async () => {
      await expect(
        saveMaterialCount(h.env, st.id, 99999, { counted_qty: 1 }, "kp")
      ).rejects.toMatchObject({ status: 404, message: "这次盘点里没有这一行" });
      await expect(
        saveMaterialCount(h.env, 99999, lineA, { counted_qty: 1 }, "kp")
      ).rejects.toMatchObject({ status: 404, message: "盘点不存在" });
      await cancelStocktake(h.env, st.id, {}, "kp");
      const next = await startStocktake(h.env, { scope: "material" }, "kp");
      await expect(
        saveMaterialCount(h.env, next.id, lineA, { counted_qty: 1 }, "kp")
      ).rejects.toMatchObject({ status: 404, message: "这次盘点里没有这一行" });
    });

    it("盘点已取消或已完成：409", async () => {
      await cancelStocktake(h.env, st.id, {}, "kp");
      await expect(
        saveMaterialCount(h.env, st.id, lineA, { counted_qty: 1 }, "kp")
      ).rejects.toMatchObject({ status: 409, message: "这次盘点已经结束，不能再改" });
    });

    it("预查之后盘点被取消：批内断言失败，整批回滚", async () => {
      justBeforeWrite(() => {
        h.database.prepare("UPDATE stocktake SET status = 'cancelled' WHERE id = ?").run(st.id);
      });
      await expect(
        saveMaterialCount(h.env, st.id, lineA, { counted_qty: 1 }, "kp")
      ).rejects.toThrow(/wh_guard/);
      h.hooks.beforeStatement = null;
      const fresh = await getStocktake(h.env, st.id);
      expect(fresh.material_lines.find((line) => line.id === lineA).counted_qty).toBeNull();
      expect(fresh.version).toBe(st.version);
    });
  });

  describe("标记设备", () => {
    it("按编号标记找到；记下谁扫的；盘点版本加一", async () => {
      const result = await markStocktakeDevice(
        h.env,
        st.id,
        { device_code: " SB-0001 ", found: true },
        "kp"
      );
      expect(result).toMatchObject({
        unexpected: false,
        hint: null,
        line: {
          device_id: inWarehouse,
          device_code: "SB-0001",
          expected: 1,
          found: 1,
          scanned_by_userid: "kp"
        }
      });
      expect(await getStocktake(h.env, st.id)).toMatchObject({
        version: st.version + 1,
        device_found: 1,
        device_missing: 0
      });
    });

    it("账上在项目的设备：加一行 expected = 0，提示补返库单", async () => {
      const result = await markStocktakeDevice(h.env, st.id, { device_id: onProject, found: true }, "kp");
      expect(result).toMatchObject({
        unexpected: true,
        hint: "账上在「临河 DN1200」，盘完后补一张返库单",
        line: { device_id: onProject, expected: 0, found: 1, project_name: "临河 DN1200" }
      });
      expect((await getStocktake(h.env, st.id)).device_unexpected).toBe(1);
    });

    it("账上已报废的设备：也记下来，提示已报废", async () => {
      const result = await markStocktakeDevice(h.env, st.id, { device_id: scrapped, found: true }, "kp");
      expect(result).toMatchObject({
        unexpected: true,
        hint: "账上已报废",
        line: { expected: 0, found: 1 }
      });
    });

    it("发起之后才入库的设备：加一行，不算意外", async () => {
      const late = h.seed.device({ device_code: "SB-0009" });
      const result = await markStocktakeDevice(h.env, st.id, { device_id: late, found: true }, "kp");
      expect(result).toMatchObject({
        unexpected: false,
        hint: null,
        line: { expected: 0, found: 1 }
      });
    });

    it("同一台扫两次只有一行", async () => {
      await markStocktakeDevice(h.env, st.id, { device_id: onProject, found: true }, "kp");
      await markStocktakeDevice(h.env, st.id, { device_code: "SB-0002", found: true }, "kp2");
      const lines = (await getStocktake(h.env, st.id)).device_lines.filter(
        (line) => line.device_id === onProject
      );
      expect(lines).toHaveLength(1);
      expect(lines[0].scanned_by_userid).toBe("kp2");
    });

    it("可以标记没找到并写备注，也可以清掉标记；不带备注时原来的备注留着", async () => {
      const missing = await markStocktakeDevice(
        h.env,
        st.id,
        { device_id: inWarehouse, found: false, note: "借给二队了" },
        "kp"
      );
      expect(missing.line).toMatchObject({ found: 0, note: "借给二队了", scanned_by_userid: "kp" });
      const found = await markStocktakeDevice(h.env, st.id, { device_id: inWarehouse, found: true }, "kp");
      expect(found.line).toMatchObject({ found: 1, note: "借给二队了" });
      const cleared = await markStocktakeDevice(
        h.env,
        st.id,
        { device_id: inWarehouse, found: null, note: "" },
        "kp"
      );
      expect(cleared.line).toMatchObject({
        found: null,
        note: null,
        scanned_by_userid: null,
        scanned_at: null
      });
    });

    it("不在这次盘点里的设备只能标记找到", async () => {
      await expect(
        markStocktakeDevice(h.env, st.id, { device_id: onProject, found: false }, "kp")
      ).rejects.toMatchObject({ status: 400, message: "这台设备不在这次盘点里，只能标记找到" });
      expect(
        (await getStocktake(h.env, st.id)).device_lines.some((line) => line.device_id === onProject)
      ).toBe(false);
    });

    it("查不到的编号 404；没给设备、标记不对 400", async () => {
      await expect(
        markStocktakeDevice(h.env, st.id, { device_code: "SB-9999", found: true }, "kp")
      ).rejects.toMatchObject({ status: 404, message: "没有这台设备" });
      await expect(
        markStocktakeDevice(h.env, st.id, { device_id: 99999, found: true }, "kp")
      ).rejects.toMatchObject({ status: 404, message: "没有这台设备" });
      await expect(markStocktakeDevice(h.env, st.id, { found: true }, "kp")).rejects.toMatchObject({
        status: 400,
        message: "请给出设备"
      });
      await expect(
        markStocktakeDevice(h.env, st.id, { device_id: inWarehouse, found: "yes" }, "kp")
      ).rejects.toMatchObject({ status: 400, message: "标记只能是找到、没找到或清掉" });
      await expect(
        markStocktakeDevice(h.env, st.id, { device_id: inWarehouse }, "kp")
      ).rejects.toMatchObject({ status: 400 });
    });

    it("范围只有物资 400；盘点已结束 409；盘点不存在 404", async () => {
      await cancelStocktake(h.env, st.id, {}, "kp");
      await expect(
        markStocktakeDevice(h.env, st.id, { device_id: inWarehouse, found: true }, "kp")
      ).rejects.toMatchObject({ status: 409, message: "这次盘点已经结束，不能再改" });
      const materialOnly = await startStocktake(h.env, { scope: "material" }, "kp");
      await expect(
        markStocktakeDevice(h.env, materialOnly.id, { device_id: inWarehouse, found: true }, "kp")
      ).rejects.toMatchObject({ status: 400, message: "这次盘点不盘设备" });
      await expect(
        markStocktakeDevice(h.env, 99999, { device_id: inWarehouse, found: true }, "kp")
      ).rejects.toMatchObject({ status: 404, message: "盘点不存在" });
    });

    it("范围只有设备时录物资：这次盘点里没有这一行", async () => {
      await cancelStocktake(h.env, st.id, {}, "kp");
      const deviceOnly = await startStocktake(h.env, { scope: "device" }, "kp");
      await expect(
        saveMaterialCount(h.env, deviceOnly.id, lineA, { counted_qty: 1 }, "kp")
      ).rejects.toMatchObject({ status: 404, message: "这次盘点里没有这一行" });
    });

    it("预查之后盘点被取消：批内断言失败，不多出行", async () => {
      justBeforeWrite(() => {
        h.database.prepare("UPDATE stocktake SET status = 'cancelled' WHERE id = ?").run(st.id);
      });
      await expect(
        markStocktakeDevice(h.env, st.id, { device_id: onProject, found: true }, "kp")
      ).rejects.toThrow(/wh_guard/);
      h.hooks.beforeStatement = null;
      expect(
        (await getStocktake(h.env, st.id)).device_lines.some((line) => line.device_id === onProject)
      ).toBe(false);
    });
  });
});
