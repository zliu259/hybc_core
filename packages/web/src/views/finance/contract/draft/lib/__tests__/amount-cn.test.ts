import { describe, it, expect } from "vitest";
import { amountToChinese } from "../amount-cn";

describe("amountToChinese", () => {
  const cases: [number, string][] = [
    [0, "零元整"],
    [1, "壹元整"],
    [10, "壹拾元整"],
    [100, "壹佰元整"],
    [1000, "壹仟元整"],
    [10000, "壹万元整"],
    [246400, "贰拾肆万陆仟肆佰元整"],
    [1000000, "壹佰万元整"],
    [100000000, "壹亿元整"],
    [240040, "贰拾肆万零肆拾元整"],
    [200400, "贰拾万零肆佰元整"],
    [1001, "壹仟零壹元整"],
    [10001, "壹万零壹元整"],
    [100.5, "壹佰元伍角"],
    [100.05, "壹佰元零伍分"],
    [1234.56, "壹仟贰佰叁拾肆元伍角陆分"],
    [2600000, "贰佰陆拾万元整"]
  ];
  for (const [n, expected] of cases) {
    it(`${n} => ${expected}`, () => {
      expect(amountToChinese(n)).toBe(expected);
    });
  }
});
