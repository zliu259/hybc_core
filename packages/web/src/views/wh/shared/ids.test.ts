import { describe, expect, it } from "vitest";

import { batchRequestId } from "./ids";

describe("导入批次的请求号", () => {
  const session = "3f2b8c1e-1111-4222-8333-944455556666";
  const rows = [{ name: "排泥钢管", spec: "Φ114" }];

  it("同一次打开、同样的内容重发，请求号不变（后端据此认出是重发）", () => {
    expect(batchRequestId(session, rows)).toBe(
      batchRequestId(session, [{ name: "排泥钢管", spec: "Φ114" }])
    );
  });

  it("内容改了或者重新打开了对话框，请求号就变", () => {
    const base = batchRequestId(session, rows);
    expect(
      batchRequestId(session, [{ name: "排泥钢管", spec: "Φ80" }])
    ).not.toBe(base);
    expect(
      batchRequestId("9a9a9a9a-1111-4222-8333-944455556666", rows)
    ).not.toBe(base);
  });

  it("长度在后端要求的 8 到 64 之间", () => {
    const id = batchRequestId(session, rows);
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id.length).toBeLessThanOrEqual(64);
  });
});
