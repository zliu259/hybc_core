import { describe, expect, it } from "vitest";

import { normalizeAnomalyResult } from "./anomaly-result";

describe("normalizeAnomalyResult", () => {
  it.each([
    ["低", "low"],
    ["中", "medium"],
    ["中等", "medium"],
    ["待核验", "medium"],
    ["高", "high"],
    ["high", "high"],
    ["HIGH", "high"],
    ["low", "low"],
    ["medium", "medium"],
    ["未知", null]
  ])("%s 映射为 %s", (input, expected) => {
    expect(normalizeAnomalyResult({ risk_level: input }).risk_level).toBe(expected);
  });

  it("没有结果时全是空值", () => {
    expect(normalizeAnomalyResult(null)).toEqual({
      risk_level: null,
      summary: null,
      anomalies: [],
      recommendation: null
    });
  });

  it("anomalies 缺 level 或 reason 的丢弃", () => {
    const result = normalizeAnomalyResult({
      anomalies: [
        { attachment_id: 1, level: "高", reason: "日期异常" },
        { attachment_id: 2, reason: "没有等级" },
        { attachment_id: 3, level: "high" },
        { attachment_id: 4, level: "看不懂", reason: "等级不认识" },
        { attachment_id: 5, level: "high", reason: "  " },
        "字符串"
      ]
    });
    expect(result.anomalies).toEqual([{ attachment_id: 1, level: "high", reason: "日期异常" }]);
  });

  it("anomalies 不是数组时是空数组", () => {
    expect(normalizeAnomalyResult({ anomalies: "无" }).anomalies).toEqual([]);
  });

  it("attachment_id 可为 null，数字字符串转成数字，其他算 null", () => {
    const result = normalizeAnomalyResult({
      anomalies: [
        { attachment_id: null, level: "low", reason: "a" },
        { level: "low", reason: "b" },
        { attachment_id: "12", level: "low", reason: "c" },
        { attachment_id: "附件", level: "low", reason: "d" }
      ]
    });
    expect(result.anomalies.map((item) => item.attachment_id)).toEqual([null, null, 12, null]);
  });

  it("summary 没有时用 comment，都没有是 null", () => {
    expect(normalizeAnomalyResult({ summary: "合理" }).summary).toBe("合理");
    expect(normalizeAnomalyResult({ comment: "旧格式" }).summary).toBe("旧格式");
    expect(normalizeAnomalyResult({ summary: 1 }).summary).toBeNull();
  });

  it("recommendation 只认字符串", () => {
    expect(normalizeAnomalyResult({ recommendation: "核对" }).recommendation).toBe("核对");
    expect(normalizeAnomalyResult({ recommendation: ["核对"] }).recommendation).toBeNull();
  });
});
