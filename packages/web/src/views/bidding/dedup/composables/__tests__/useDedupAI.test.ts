import { describe, it, expect, vi } from "vitest";
import { useDedupAI } from "../useDedupAI";
import type { RewriteParagraph } from "../../lib/rewrite";

const paras: RewriteParagraph[] = [{ id: "c#0", text: "原文甲。" }];

describe("useDedupAI", () => {
  it("requests, polls until completed, and exposes rewrites + accept state", async () => {
    const request = vi.fn(async () => 42);
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({
        status: "completed",
        rewrites: [{ id: "c#0", text: "改写甲。" }]
      });
    const ai = useDedupAI({ request, poll, sleep: async () => {} });

    await ai.start(paras);

    expect(request).toHaveBeenCalledWith(paras);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(ai.status.value).toBe("completed");
    expect(ai.rewrites.value.get("c#0")).toBe("改写甲。");

    ai.accept("c#0");
    expect(ai.accepted.value.get("c#0")).toBe("改写甲。");
    ai.skip("c#0");
    expect(ai.accepted.value.has("c#0")).toBe(false);
    ai.acceptAll();
    expect(ai.accepted.value.get("c#0")).toBe("改写甲。");
  });

  it("surfaces failed status", async () => {
    const request = vi.fn(async () => 7);
    const poll = vi.fn().mockResolvedValue({ status: "failed", error: "boom" });
    const ai = useDedupAI({ request, poll, sleep: async () => {} });
    await ai.start(paras);
    expect(ai.status.value).toBe("failed");
    expect(ai.error.value).toBe("boom");
  });

  it("sets failed status when poll throws", async () => {
    const request = vi.fn(async () => 9);
    const poll = vi.fn().mockRejectedValue(new Error("network down"));
    const ai = useDedupAI({ request, poll, sleep: async () => {} });
    await ai.start([{ id: "c#0", text: "原文。" }]);
    expect(ai.status.value).toBe("failed");
    expect(ai.error.value).toBe("network down");
  });

  it("times out after maxPolls exhausted", async () => {
    const request = vi.fn(async () => 9);
    const poll = vi.fn().mockResolvedValue({ status: "running" });
    const ai = useDedupAI({ request, poll, sleep: async () => {}, maxPolls: 1 });
    await ai.start([{ id: "c#0", text: "原文。" }]);
    expect(ai.status.value).toBe("timeout");
  });
});
