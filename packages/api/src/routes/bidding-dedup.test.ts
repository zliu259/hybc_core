import { describe, it, expect } from "vitest";
import {
  parseRewriteRequest,
  parseRewriteResult,
  type RewriteParagraph
} from "./bidding-dedup";

describe("parseRewriteRequest", () => {
  it("accepts a valid paragraphs array", () => {
    const out = parseRewriteRequest({ paragraphs: [{ id: "d#0", text: "甲。" }] });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.paragraphs).toHaveLength(1);
  });

  it("rejects empty / malformed / oversized input", () => {
    expect(parseRewriteRequest({ paragraphs: [] }).ok).toBe(false);
    expect(parseRewriteRequest({ paragraphs: [{ id: "", text: "x" }] }).ok).toBe(false);
    expect(parseRewriteRequest({}).ok).toBe(false);
    const tooMany: RewriteParagraph[] = Array.from({ length: 201 }, (_, i) => ({
      id: `d#${i}`,
      text: "x"
    }));
    expect(parseRewriteRequest({ paragraphs: tooMany }).ok).toBe(false);
    expect(
      parseRewriteRequest({ paragraphs: [{ id: "d#0", text: "x".repeat(5001) }] }).ok
    ).toBe(false);
  });
});

describe("parseRewriteResult", () => {
  it("maps a completed task with parseable rewrites", () => {
    const res = parseRewriteResult({
      status: "completed",
      result_json: JSON.stringify({ output: JSON.stringify({ rewrites: [{ id: "d#0", text: "改写。" }] }) })
    });
    expect(res.status).toBe("completed");
    expect(res.rewrites).toEqual([{ id: "d#0", text: "改写。" }]);
  });

  it("returns pending/running as-is", () => {
    expect(parseRewriteResult({ status: "pending", result_json: null }).status).toBe("pending");
  });

  it("maps failed with error", () => {
    const res = parseRewriteResult({ status: "failed", result_json: null, error_message: "boom" });
    expect(res.status).toBe("failed");
    expect(res.error).toBe("boom");
  });

  it("completed but already-redacted result yields empty rewrites", () => {
    const res = parseRewriteResult({ status: "completed", result_json: "" });
    expect(res.status).toBe("completed");
    expect(res.rewrites).toEqual([]);
  });

  it("passes through the assigned in-flight status", () => {
    expect(parseRewriteResult({ status: "assigned", result_json: null }).status).toBe("assigned");
  });

  it("treats a purged '{}' result as completed with empty rewrites", () => {
    const res = parseRewriteResult({ status: "completed", result_json: "{}" });
    expect(res.status).toBe("completed");
    expect(res.rewrites).toEqual([]);
  });
});
