import { describe, expect, it } from "vitest";

import { allocateShipped } from "../src/services/warehouse/kit-allocation";

describe("已发数按清单确认先后分摊", () => {
  it("同一物资两行：先分满第一行，余下给第二行", () => {
    const lines = [
      { line_id: 1, key: "m:3", planned: 100 },
      { line_id: 2, key: "m:3", planned: 50 }
    ];
    expect([...allocateShipped(lines, new Map([["m:3", 120]]))]).toEqual([
      [1, 100],
      [2, 20]
    ]);
  });

  it("发多了也不超过计划；没发的 key 分 0；负数当 0", () => {
    const lines = [
      { line_id: 1, key: "m:3", planned: 10 },
      { line_id: 2, key: "c:1", planned: 2 },
      { line_id: 3, key: "m:4", planned: 5 }
    ];
    expect([
      ...allocateShipped(
        lines,
        new Map([
          ["m:3", 15],
          ["m:4", -2]
        ])
      )
    ]).toEqual([
      [1, 10],
      [2, 0],
      [3, 0]
    ]);
  });

  it("小数按 3 位小数分，不出现 0.30000000000000004", () => {
    const lines = [
      { line_id: 1, key: "m:3", planned: 0.1 },
      { line_id: 2, key: "m:3", planned: 0.5 }
    ];
    expect([...allocateShipped(lines, new Map([["m:3", 0.3]]))]).toEqual([
      [1, 0.1],
      [2, 0.2]
    ]);
  });
});
