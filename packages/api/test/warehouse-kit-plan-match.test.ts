import { describe, expect, it } from "vitest";

import { matchGenerated } from "../src/services/warehouse/kit-plan-match";

// 清单行保存时整份替换，行号每次都变。算式靠「分节、类型、品名、第几次出现」配回去。纯函数，CI 上也跑。

const gen = (name, qty, calc = null, section = "控制照明系统", kind = "material") => ({
  section,
  line_kind: kind,
  name_text: name,
  spec_text: null,
  qty,
  calc_text: calc
});
const cur = (name, section = "控制照明系统", kind = "material") => ({
  section,
  line_kind: kind,
  name_text: name,
  planned_qty: 1
});
const pairs = (lines) => lines.map((line) => [line.generated_qty, line.calc_text]);

describe("matchGenerated", () => {
  it("同品名出现多次，按第几次出现配对", () => {
    const generated = [
      gen("橡套电缆", 20, "a"),
      gen("橡套电缆", 100, "b"),
      gen("控制线", 200, "c")
    ];
    expect(
      pairs(matchGenerated([cur("橡套电缆"), cur("橡套电缆"), cur("控制线")], generated))
    ).toEqual([
      [20, "a"],
      [100, "b"],
      [200, "c"]
    ]);
  });

  it("中间加了一行别的品名、删了一行、换了位置：其余行不串", () => {
    const generated = [gen("橡套电缆", 20, "a"), gen("控制线", 200, "c"), gen("视频线", 400, "d")];
    expect(
      pairs(matchGenerated([cur("视频线"), cur("新加的"), cur("橡套电缆")], generated))
    ).toEqual([
      [400, "d"],
      [null, null],
      [20, "a"]
    ]);
  });

  it("品名相同但分节或类型不同，不配对", () => {
    const generated = [gen("三通", 4, "x", "辅助设备")];
    expect(pairs(matchGenerated([cur("三通", "注浆设备")], generated))).toEqual([[null, null]]);
    expect(pairs(matchGenerated([cur("三通", "辅助设备", "text")], generated))).toEqual([
      [null, null]
    ]);
  });

  it("同品名的两行换了顺序：规格相同的先认回原来那一行", () => {
    const generated = [
      { ...gen("橡套电缆", 105, "a"), spec_text: "5芯10平方" },
      { ...gen("橡套电缆", 53, "b"), spec_text: "5芯6平方" }
    ];
    const lines = [
      { ...cur("橡套电缆"), spec_text: "5芯6平方" },
      { ...cur("橡套电缆"), spec_text: "5芯10平方" }
    ];
    expect(pairs(matchGenerated(lines, generated))).toEqual([
      [53, "b"],
      [105, "a"]
    ]);
  });

  it("规格被改过的行，按同品名里剩下的顺序配", () => {
    const generated = [
      { ...gen("止水圈", 1, "a"), spec_text: null },
      { ...gen("止水圈", 2, "b"), spec_text: "DN600*1400" }
    ];
    const lines = [
      { ...cur("止水圈"), spec_text: "DN600*1400" },
      // 生成时是待选规格，库管后来选了一条
      { ...cur("止水圈"), spec_text: "1600*2300" }
    ];
    expect(pairs(matchGenerated(lines, generated))).toEqual([
      [2, "b"],
      [1, "a"]
    ]);
  });

  it("同品名现在比生成时多一行，多出来的那行配不上", () => {
    expect(pairs(matchGenerated([cur("三通"), cur("三通")], [gen("三通", 4)]))).toEqual([
      [4, null],
      [null, null]
    ]);
  });

  it("没有生成时的原样：每一行都是空的；保留行上原有的字段", () => {
    const [line] = matchGenerated([{ ...cur("三通"), id: 7 }], []);
    expect(line).toEqual({
      section: "控制照明系统",
      line_kind: "material",
      name_text: "三通",
      planned_qty: 1,
      id: 7,
      calc_text: null,
      generated_qty: null
    });
  });

  it("不改传进来的数组和对象", () => {
    const lines = Object.freeze([Object.freeze(cur("三通"))]);
    const generated = Object.freeze([Object.freeze(gen("三通", 4, "x"))]);
    expect(pairs(matchGenerated(lines, generated))).toEqual([[4, "x"]]);
    expect(lines[0]).not.toHaveProperty("generated_qty");
  });
});
