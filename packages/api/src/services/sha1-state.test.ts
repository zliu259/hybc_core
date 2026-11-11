import { describe, expect, it } from "vitest";

import { sha1StateHex } from "./sha1-state";

const hex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

describe("sha1StateHex", () => {
  it("空输入给出 SHA1 初始状态", () => {
    expect(sha1StateHex(new Uint8Array(0), "big")).toBe("67452301efcdab8998badcfe10325476c3d2e1f0");
  });

  it("little 端序只翻转每个字的字节序", () => {
    expect(sha1StateHex(new Uint8Array(0), "little")).toBe(
      "0123456789abcdeffedcba9876543210f0e1d2c3"
    );
  });

  it("64 字节零块的状态是 40 位十六进制，且不等于标准摘要", async () => {
    const block = new Uint8Array(64);
    const state = sha1StateHex(block, "big");
    const digest = hex(await crypto.subtle.digest("SHA-1", block));
    expect(state).toMatch(/^[0-9a-f]{40}$/);
    expect(state).not.toBe(digest);
  });

  it("压缩函数正确：输入恰好是 abc 的填充块时，状态等于 abc 的标准摘要", () => {
    // "abc" 加上 SHA1 的结尾填充正好是一个 64 字节块，处理完它的状态就是最终摘要。
    const block = new Uint8Array(64);
    block.set([0x61, 0x62, 0x63, 0x80]);
    block[63] = 24;
    expect(sha1StateHex(block, "big")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
  });

  it("多个块时每个块都参与计算", () => {
    const data = new Uint8Array(128).map((_, index) => index);
    expect(sha1StateHex(data, "big")).not.toBe(sha1StateHex(data.subarray(0, 64), "big"));
  });

  it("长度不是 64 的倍数时报错", () => {
    expect(() => sha1StateHex(new Uint8Array(10), "big")).toThrow("64");
  });
});
