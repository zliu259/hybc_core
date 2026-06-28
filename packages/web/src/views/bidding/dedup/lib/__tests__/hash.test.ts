import { describe, it, expect } from "vitest";
import { hashString } from "../hash";

describe("hashString", () => {
  it("returns a 32-bit unsigned integer", () => {
    const h = hashString("质量管理");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it("is deterministic", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
  });

  it("differs for different inputs", () => {
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});
