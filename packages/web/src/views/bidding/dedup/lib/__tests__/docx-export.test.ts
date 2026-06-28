import { describe, it, expect } from "vitest";
import { buildDocxBuffer } from "../docx-export";

describe("buildDocxBuffer", () => {
  it("produces a non-empty docx buffer from paragraph texts", async () => {
    const buf = await buildDocxBuffer(["第一段。", "第二段。"]);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("handles empty input without throwing", async () => {
    const buf = await buildDocxBuffer([]);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
