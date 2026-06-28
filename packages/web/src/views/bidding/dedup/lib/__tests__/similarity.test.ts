import { describe, it, expect } from "vitest";
import { jaccard } from "../similarity";

describe("jaccard", () => {
  it("computes intersection over union", () => {
    expect(jaccard(new Set([1, 2, 3]), new Set([2, 3, 4]))).toBeCloseTo(0.5, 5);
  });

  it("returns 1 for identical sets", () => {
    expect(jaccard(new Set([1, 2]), new Set([1, 2]))).toBe(1);
  });

  it("returns 0 when both empty", () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccard(new Set([1]), new Set([2]))).toBe(0);
  });

  it("returns 0 when one set is empty and the other is not", () => {
    expect(jaccard(new Set(), new Set([1, 2]))).toBe(0);
  });
});
