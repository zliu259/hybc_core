import { describe, expect, it } from "vitest";
import { toAmountChinese } from "../../../api/src/services/amount-cn";
import { toChineseAmount } from "./amount-cn";

describe("toChineseAmount", () => {
  const cases: Array<[number, string]> = [
    [0, "零元整"],
    [1, "壹元整"],
    [10, "壹拾元整"],
    [100, "壹佰元整"],
    [1000, "壹仟元整"],
    [10000, "壹万元整"],
    [100000, "壹拾万元整"],
    [246400, "贰拾肆万陆仟肆佰元整"],
    [1000000, "壹佰万元整"],
    [2600000, "贰佰陆拾万元整"],
    // 内部零
    [105, "壹佰零伍元整"],
    [1001, "壹仟零壹元整"],
    [1010, "壹仟零壹拾元整"],
    [1234.56, "壹仟贰佰叁拾肆元伍角陆分"],
    // 跨万、跨亿
    [10001, "壹万零壹元整"],
    [10200, "壹万零贰佰元整"],
    [200400, "贰拾万零肆佰元整"],
    [240040, "贰拾肆万零肆拾元整"],
    [107750.91, "壹拾万柒仟柒佰伍拾元玖角壹分"],
    [1001000, "壹佰万壹仟元整"],
    [100000000, "壹亿元整"],
    [100000001, "壹亿零壹元整"],
    [100001000, "壹亿零壹仟元整"],
    [120000000, "壹亿贰仟万元整"],
    [1234567890.12, "壹拾贰亿叁仟肆佰伍拾陆万柒仟捌佰玖拾元壹角贰分"],
    // 角分
    [0.05, "伍分"],
    [0.5, "伍角"],
    [0.12, "壹角贰分"],
    [100.5, "壹佰元伍角"],
    [100.05, "壹佰元零伍分"],
    [16409.02, "壹万陆仟肆佰零玖元零贰分"]
  ];

  for (const [amount, expected] of cases) {
    it(`${amount} → ${expected}`, () => {
      expect(toChineseAmount(amount)).toBe(expected);
    });
  }

  it("非法输入显示占位文本，不抛错", () => {
    expect(toChineseAmount(Number.NaN)).toBe("金额格式错误");
    expect(toChineseAmount(Number.POSITIVE_INFINITY)).toBe("金额格式错误");
    expect(toChineseAmount(-1)).toBe("金额格式错误");
    expect(toChineseAmount(Number.MAX_SAFE_INTEGER)).toBe("金额格式错误");
  });

  // 两份实现分属两个包，只能靠这个用例防止再次漂移。
  it("与落库口径 toAmountChinese 逐值一致", () => {
    let state = 20261106;
    const amounts = cases.map(([amount]) => amount);
    for (let i = 0; i < 5000; i += 1) {
      state = (state * 1103515245 + 12345) % 2147483648;
      amounts.push((state % 10 ** (i % 10)) / 100);
    }
    for (const amount of amounts) {
      expect(toChineseAmount(amount), String(amount)).toBe(
        toAmountChinese(amount)
      );
    }
  });
});
