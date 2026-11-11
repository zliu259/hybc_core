import { describe, expect, it } from "vitest";

import { WarehouseError } from "../src/services/warehouse/errors";
import {
  optionalDate,
  optionalId,
  optionalNumber,
  optionalText,
  requireEnum,
  requireId,
  requireQuantity,
  requireText
} from "../src/services/warehouse/validation";

// 库房接口在路由边界的输入校验：不合规一律 400，文案是给库管看的中文。

const QUANTITY_MESSAGE = "数量必须是大于 0 的数字，最多 3 位小数";

describe("requireQuantity", () => {
  it.each([
    [1, 1],
    [0.125, 0.125],
    ["2.5", 2.5],
    [" 60 ", 60],
    [1000000, 1000000]
  ])("接受 %j", (input, expected) => {
    expect(requireQuantity(input, "数量")).toBe(expected);
  });

  it.each([
    0,
    -1,
    1.2345,
    "25米",
    "",
    "  ",
    null,
    undefined,
    Number.NaN,
    Infinity,
    1000001,
    [],
    {},
    true
  ])("拒绝 %j", (input) => {
    expect(() => requireQuantity(input, "数量")).toThrow(QUANTITY_MESSAGE);
  });

  it("报错是 400 的 WarehouseError，文案带字段名", () => {
    try {
      requireQuantity("x", "期初数量");
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(WarehouseError);
      expect(error).toMatchObject({
        status: 400,
        message: "期初数量必须是大于 0 的数字，最多 3 位小数"
      });
    }
  });
});

describe("文本", () => {
  it("requireText 去掉首尾空白，空白串算空", () => {
    expect(requireText("  泥浆泵 ", "名称", 50)).toBe("泥浆泵");
    expect(() => requireText("   ", "名称", 50)).toThrow("名称不能为空");
    expect(() => requireText(undefined, "名称", 50)).toThrow("名称不能为空");
    expect(() => requireText(12, "名称", 50)).toThrow("名称不能为空");
    expect(() => requireText("x".repeat(51), "名称", 50)).toThrow("名称不能超过50个字");
  });

  it("optionalText 空串和缺省都返回 null，超长报错", () => {
    expect(optionalText(undefined, "备注", 10)).toBeNull();
    expect(optionalText(null, "备注", 10)).toBeNull();
    expect(optionalText("  ", "备注", 10)).toBeNull();
    expect(optionalText(" 好 ", "备注", 10)).toBe("好");
    expect(() => optionalText("x".repeat(11), "备注", 10)).toThrow("备注不能超过10个字");
    expect(() => optionalText(5, "备注", 10)).toThrow("备注格式不对");
  });
});

describe("ID", () => {
  it("requireId 只接受正整数", () => {
    expect(requireId(3, "项目")).toBe(3);
    expect(requireId("3", "项目")).toBe(3);
    for (const bad of [0, -1, 1.5, "abc", null, undefined]) {
      expect(() => requireId(bad, "项目")).toThrow("请选择项目");
    }
  });

  it("optionalId 缺省返回 null", () => {
    expect(optionalId(undefined, "项目")).toBeNull();
    expect(optionalId(null, "项目")).toBeNull();
    expect(optionalId("", "项目")).toBeNull();
    expect(optionalId(7, "项目")).toBe(7);
    expect(() => optionalId(-2, "项目")).toThrow("请选择项目");
  });
});

describe("数字、枚举、日期", () => {
  it("optionalNumber 检查范围和整数", () => {
    expect(optionalNumber(undefined, "口径", { min: 100, max: 6000, integer: true })).toBeNull();
    expect(optionalNumber("", "口径", { min: 100, max: 6000, integer: true })).toBeNull();
    expect(optionalNumber("1200", "口径", { min: 100, max: 6000, integer: true })).toBe(1200);
    expect(() => optionalNumber(1200.5, "口径", { min: 100, max: 6000, integer: true })).toThrow(
      "口径必须是 100 到 6000 之间的整数"
    );
    expect(() => optionalNumber("一千二", "单价", { min: 0, max: 100 })).toThrow(
      "单价必须是 0 到 100 之间的数字"
    );
  });

  it("requireEnum 只接受列出的值", () => {
    expect(requireEnum("turnover", "管法", ["turnover", "consumable"] as const)).toBe("turnover");
    expect(() => requireEnum("周转", "管法", ["turnover", "consumable"] as const)).toThrow(
      "管法不对"
    );
  });

  it("optionalDate 只接受真实存在的 YYYY-MM-DD", () => {
    expect(optionalDate("2026-11-11", "日期")).toBe("2026-11-11");
    expect(optionalDate(undefined, "日期")).toBeNull();
    expect(optionalDate("", "日期")).toBeNull();
    expect(() => optionalDate("2026/11/11", "日期")).toThrow("日期格式应为 YYYY-MM-DD");
    expect(() => optionalDate("2026-02-30", "日期")).toThrow("日期格式应为 YYYY-MM-DD");
  });
});
