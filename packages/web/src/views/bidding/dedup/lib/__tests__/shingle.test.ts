import { describe, it, expect } from "vitest";
import { toShingles } from "../shingle";
import { hashString } from "../hash";

describe("toShingles", () => {
  it("produces (len - k + 1) shingles for normal input", () => {
    const set = toShingles("abcd", 3);
    expect(set.size).toBe(2);
    expect(set.has(hashString("abc"))).toBe(true);
    expect(set.has(hashString("bcd"))).toBe(true);
  });

  it("returns one shingle when input shorter than k", () => {
    const set = toShingles("ab", 3);
    expect(set.size).toBe(1);
    expect(set.has(hashString("ab"))).toBe(true);
  });

  it("returns empty set for empty input", () => {
    expect(toShingles("", 3).size).toBe(0);
  });
});
