import { describe, expect, it } from "vitest";

import { describeAmountChangeDelta } from "./amount-change-view";

describe("describeAmountChangeDelta", () => {
  it("labels an increase with the difference", () => {
    expect(describeAmountChangeDelta(240000, 260000)).toEqual({
      kind: "increase",
      label: "增加 20,000.00"
    });
  });

  it("labels a decrease with the absolute difference", () => {
    expect(describeAmountChangeDelta(240000, 235000.5)).toEqual({
      kind: "decrease",
      label: "减少 4,999.50"
    });
  });

  it("treats a sub-cent float difference as unchanged", () => {
    expect(describeAmountChangeDelta(0.1 + 0.2, 0.3)).toEqual({
      kind: "unchanged",
      label: "无变化"
    });
  });
});
