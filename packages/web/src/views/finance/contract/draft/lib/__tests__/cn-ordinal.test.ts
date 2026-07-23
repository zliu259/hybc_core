import { describe, expect, it } from "vitest";
import { numberToChinese } from "../cn-ordinal";

describe("numberToChinese", () => {
  it("maps 1..19", () => {
    expect(numberToChinese(1)).toBe("一");
    expect(numberToChinese(9)).toBe("九");
    expect(numberToChinese(10)).toBe("十");
    expect(numberToChinese(11)).toBe("十一");
    expect(numberToChinese(19)).toBe("十九");
  });

  it("maps tens 20..99", () => {
    expect(numberToChinese(20)).toBe("二十");
    expect(numberToChinese(21)).toBe("二十一");
    expect(numberToChinese(35)).toBe("三十五");
    expect(numberToChinese(99)).toBe("九十九");
  });

  it("returns the raw string for out-of-range or invalid input", () => {
    expect(numberToChinese(0)).toBe("0");
    expect(numberToChinese(100)).toBe("100");
    expect(numberToChinese(-3)).toBe("-3");
    expect(numberToChinese(2.5)).toBe("2.5");
  });
});
