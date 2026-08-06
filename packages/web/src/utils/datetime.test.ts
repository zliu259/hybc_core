import { describe, expect, it } from "vitest";
import { formatBeijingDateTime } from "./datetime";

describe("formatBeijingDateTime", () => {
  it("converts UTC ISO timestamps (with Z suffix) to Beijing time", () => {
    // 后端 nowIso() 产出的标准格式：UTC 22:30 = 北京时间次日 06:30
    expect(formatBeijingDateTime("2026-07-16T22:30:00.000Z")).toBe(
      "2026-07-17 06:30:00"
    );
  });

  it("converts ISO timestamps without milliseconds", () => {
    expect(formatBeijingDateTime("2026-01-01T16:00:00Z")).toBe(
      "2026-01-02 00:00:00"
    );
  });

  it("returns '-' for null, undefined, and empty values", () => {
    expect(formatBeijingDateTime(null)).toBe("-");
    expect(formatBeijingDateTime(undefined)).toBe("-");
    expect(formatBeijingDateTime("")).toBe("-");
  });

  it("returns '-' for unparseable input", () => {
    expect(formatBeijingDateTime("not-a-date")).toBe("-");
  });
});
