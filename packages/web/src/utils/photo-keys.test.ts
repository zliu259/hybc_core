import { describe, expect, it } from "vitest";

import { countPhotoKeys, parsePhotoKeys } from "./photo-keys";

describe("parsePhotoKeys", () => {
  it("为空值返回空数组", () => {
    expect(parsePhotoKeys(null)).toEqual([]);
    expect(parsePhotoKeys(undefined)).toEqual([]);
    expect(parsePhotoKeys("")).toEqual([]);
    expect(parsePhotoKeys("   ")).toEqual([]);
  });

  it("解析字符串数组并去掉空元素", () => {
    expect(
      parsePhotoKeys(
        JSON.stringify([
          "fuel-application/a.jpg",
          "  ",
          "fuel-application/b.jpg"
        ])
      )
    ).toEqual(["fuel-application/a.jpg", "fuel-application/b.jpg"]);
  });

  it("兼容 { file_key } / { key } 对象数组", () => {
    expect(
      parsePhotoKeys(
        JSON.stringify([
          { file_key: "fuel-application/a.jpg", file_name: "a.jpg" },
          { key: "fuel-application/b.jpg" }
        ])
      )
    ).toEqual(["fuel-application/a.jpg", "fuel-application/b.jpg"]);
  });

  it("按出现顺序去重", () => {
    expect(
      parsePhotoKeys(
        JSON.stringify([
          "fuel-application/a.jpg",
          "fuel-application/b.jpg",
          "fuel-application/a.jpg"
        ])
      )
    ).toEqual(["fuel-application/a.jpg", "fuel-application/b.jpg"]);
  });

  it("非法 JSON、非数组、无效元素一律返回空数组", () => {
    expect(parsePhotoKeys("not-json")).toEqual([]);
    expect(parsePhotoKeys(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parsePhotoKeys(JSON.stringify([null, {}, "", 42]))).toEqual([]);
  });
});

describe("countPhotoKeys", () => {
  it("返回有效照片数量", () => {
    expect(countPhotoKeys(null)).toBe(0);
    expect(countPhotoKeys(JSON.stringify(["fuel-application/a.jpg", ""]))).toBe(
      1
    );
  });
});
