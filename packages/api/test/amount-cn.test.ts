// 人民币大写金额写法（《正确填写票据和结算凭证的基本规定》）：
// - 每四位一级，级末尾的零不写；其余位置一个或连续几个零只写一个"零"；
// - 万位是零而千位不是零时不写"零"（规定允许写或不写，这里统一不写）；
// - 元位是零而角位不是零时不写"零"（同上）；
// - 角位是零而分位不是零时，元后必须写"零"；
// - 到元为止写"整"，有角或分不写"整"。
import { describe, it, expect } from "vitest";
import { canConvertAmount, toAmountChinese } from "../src/services/amount-cn";

const expectAll = (cases: Array<[number, string]>): void => {
  for (const [input, expected] of cases) {
    expect(toAmountChinese(input), String(input)).toBe(expected);
  }
};

describe("toAmountChinese", () => {
  it("线上写错的单据（PM-20261102-0003）", () => {
    expect(toAmountChinese(107750.91)).toBe("壹拾万柒仟柒佰伍拾元玖角壹分");
  });

  it("尾零不写", () => {
    expectAll([
      [1, "壹元整"],
      [10, "壹拾元整"],
      [120, "壹佰贰拾元整"],
      [1000, "壹仟元整"],
      [5600, "伍仟陆佰元整"],
      [100000, "壹拾万元整"],
      [240000, "贰拾肆万元整"],
      [246400, "贰拾肆万陆仟肆佰元整"],
      [5000000, "伍佰万元整"],
      [2600000, "贰佰陆拾万元整"]
    ]);
  });

  it("内部连续零合并为一个零", () => {
    expectAll([
      [105, "壹佰零伍元整"],
      [1001, "壹仟零壹元整"],
      [1005, "壹仟零伍元整"],
      [1010, "壹仟零壹拾元整"],
      [1409.5, "壹仟肆佰零玖元伍角"],
      [6007.14, "陆仟零柒元壹角肆分"],
      [127010.44, "壹拾贰万柒仟零壹拾元肆角肆分"]
    ]);
  });

  it("跨万：低一级不足四位时补零，千位非零时不补", () => {
    expectAll([
      [10001, "壹万零壹元整"],
      [10005, "壹万零伍元整"],
      [10200, "壹万零贰佰元整"],
      [200400, "贰拾万零肆佰元整"],
      [240040, "贰拾肆万零肆拾元整"],
      [107000.53, "壹拾万柒仟元伍角叁分"],
      [1001000, "壹佰万壹仟元整"],
      [10005000, "壹仟万伍仟元整"]
    ]);
  });

  it("跨亿：整级为零时补零", () => {
    expectAll([
      [100000000, "壹亿元整"],
      [100000001, "壹亿零壹元整"],
      [100001000, "壹亿零壹仟元整"],
      [100010000, "壹亿零壹万元整"],
      [100002222, "壹亿零贰仟贰佰贰拾贰元整"],
      [110000000, "壹亿壹仟万元整"],
      [120000000, "壹亿贰仟万元整"],
      [1000000010, "壹拾亿零壹拾元整"],
      [1234567890.12, "壹拾贰亿叁仟肆佰伍拾陆万柒仟捌佰玖拾元壹角贰分"]
    ]);
  });

  it("万亿量级写作「X万Y亿」而不是「X万亿Y亿」", () => {
    expectAll([
      [1000000000000, "壹万亿元整"],
      [1000000000001, "壹万亿零壹元整"],
      [1234567890123, "壹万贰仟叁佰肆拾伍亿陆仟柒佰捌拾玖万零壹佰贰拾叁元整"]
    ]);
  });

  it("只有角分时不写元", () => {
    expectAll([
      [0.01, "壹分"],
      [0.05, "伍分"],
      [0.1, "壹角"],
      [0.5, "伍角"],
      [0.12, "壹角贰分"],
      [0.55, "伍角伍分"]
    ]);
  });

  it("角位是零而分位不是零时元后写零，元位是零时不写", () => {
    expectAll([
      [100.05, "壹佰元零伍分"],
      [325.04, "叁佰贰拾伍元零肆分"],
      [16409.02, "壹万陆仟肆佰零玖元零贰分"],
      [100.5, "壹佰元伍角"],
      [100.55, "壹佰元伍角伍分"],
      [1680.32, "壹仟陆佰捌拾元叁角贰分"]
    ]);
  });

  it("零、负数、四舍五入到分", () => {
    expectAll([
      [0, "零元整"],
      [-100.5, "负壹佰元伍角"],
      [-0.001, "零元整"],
      [0.999, "壹元整"],
      [0.005, "壹分"],
      [0.004, "零元整"]
    ]);
  });

  it("两位小数不受浮点误差影响", () => {
    expectAll([
      [1.15, "壹元壹角伍分"],
      [4.35, "肆元叁角伍分"],
      [0.07, "柒分"],
      [0.29, "贰角玖分"],
      [19532.03, "壹万玖仟伍佰叁拾贰元零叁分"]
    ]);
  });

  it("非有限数抛 TypeError，不写入错误文本", () => {
    expect(() => toAmountChinese(Number.NaN)).toThrow(TypeError);
    expect(() => toAmountChinese(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("超出分值安全整数范围抛 RangeError", () => {
    expect(() => toAmountChinese(Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  // payment 路由直接把 JSON body 断言成类型，没有运行时校验，字符串金额能走到这里。
  it("数字字符串按数值转换", () => {
    expect(toAmountChinese("5000" as unknown as number)).toBe("伍仟元整");
    expect(toAmountChinese("-100.5" as unknown as number)).toBe("负壹佰元伍角");
    expect(() => toAmountChinese("abc" as unknown as number)).toThrow(TypeError);
  });

  it("canConvertAmount 与 toAmountChinese 的报错范围一致", () => {
    expect(canConvertAmount(10000000000000)).toBe(true);
    expect(toAmountChinese(10000000000000)).toBe("壹拾万亿元整");
    expect(canConvertAmount(100000000000000)).toBe(false);
    expect(() => toAmountChinese(100000000000000)).toThrow(RangeError);
    expect(canConvertAmount(Number.NaN)).toBe(false);
  });

  describe("大写能还原成原金额", () => {
    const DIGIT_VALUE = new Map(
      [..."零壹贰叁肆伍陆柒捌玖"].map((char, value) => [char, value] as const)
    );
    const SMALL_UNIT = new Map([
      ["拾", 10],
      ["佰", 100],
      ["仟", 1000]
    ]);

    const parseBelowWan = (text: string): number => {
      let total = 0;
      let digit = 0;
      for (const char of text) {
        const unit = SMALL_UNIT.get(char);
        if (unit !== undefined) {
          total += digit * unit;
          digit = 0;
        } else {
          digit = DIGIT_VALUE.get(char) ?? Number.NaN;
        }
      }
      return total + digit;
    };

    const parseBelowYi = (text: string): number => {
      const [high, low] = text.includes("万") ? text.split("万") : ["", text];
      return parseBelowWan(high) * 1e4 + parseBelowWan(low);
    };

    const parseYuan = (text: string): number => {
      const [high, low] = text.includes("亿") ? text.split("亿") : ["", text];
      return parseBelowYi(high) * 1e8 + parseBelowYi(low);
    };

    const parseCents = (text: string): number => {
      const [yuanText, rest] = text.includes("元") ? text.split("元") : ["", text];
      const jiao = /(.)角/.exec(rest)?.[1];
      const fen = /(.)分/.exec(rest)?.[1];
      return (
        parseYuan(yuanText) * 100 +
        (jiao ? (DIGIT_VALUE.get(jiao) ?? Number.NaN) * 10 : 0) +
        (fen ? (DIGIT_VALUE.get(fen) ?? Number.NaN) : 0)
      );
    };

    // 固定种子的线性同余序列：失败可复现。
    const samples = (count: number, max: number): number[] => {
      let state = 20261106;
      return Array.from({ length: count }, () => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state % max;
      });
    };

    const assertRoundTrip = (cents: number): void => {
      const text = toAmountChinese(cents / 100);
      expect(parseCents(text), `${cents / 100} → ${text}`).toBe(cents);
      expect(text, `${cents / 100} 连续零`).not.toMatch(/零零/);
      expect(text, `${cents / 100} 零后接单位`).not.toMatch(/零[拾佰仟万亿元角分整]/);
    };

    it("一元内外的所有分值", () => {
      for (let cents = 1; cents <= 20000; cents += 1) assertRoundTrip(cents);
    });

    it("整万附近带零的整数", () => {
      for (let yuan = 99900; yuan <= 110100; yuan += 1) assertRoundTrip(yuan * 100);
    });

    it("千万以内的随机金额", () => {
      for (const cents of samples(5000, 1_000_000_000)) {
        if (cents > 0) assertRoundTrip(cents);
      }
    });

    it("百亿以内只保留一两位非零数字的整数", () => {
      for (const a of [1, 3, 9]) {
        for (let i = 0; i <= 10; i += 1) {
          for (let j = 0; j < i; j += 1) {
            assertRoundTrip((a * 10 ** i + 7 * 10 ** j) * 100);
          }
          assertRoundTrip(a * 10 ** i * 100);
        }
      }
    });
  });
});
