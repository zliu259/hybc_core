import { describe, it, expect } from "vitest";
import { useContractDraftAI } from "../useContractDraftAI";
import type { ContractDraftSection } from "@/api/contract-draft";

const sectionWith = (
  over: Partial<ContractDraftSection>
): ContractDraftSection => ({
  id: 1,
  draft_id: 9,
  section_key: "payment",
  title: "付款",
  variant_key: "default",
  source: "default_template",
  instruction: null,
  content: "",
  risk_annotations_json: null,
  ai_task_id: null,
  ai_status: null,
  review_task_id: null,
  review_status: null,
  review_result_json: null,
  sort_order: 70,
  status: "active",
  created_at: "",
  updated_at: "",
  ...over
});

describe("useContractDraftAI", () => {
  it("生成：轮询至 done 并返回最新节", async () => {
    const polls = [
      sectionWith({ ai_status: "generating" }),
      sectionWith({ ai_status: "done", content: "生成完成正文" })
    ];
    let i = 0;
    const ai = useContractDraftAI({
      generate: async () => 42,
      getSection: async () => polls[Math.min(i++, polls.length - 1)],
      sleep: async () => undefined,
      intervalMs: 1,
      maxPolls: 10
    });
    const result = await ai.generateForSection(9, 1, "");
    expect(result?.content).toBe("生成完成正文");
    expect(ai.stateOf(1).phase).toBe("done");
  });

  it("生成失败：phase=error 且携带信息", async () => {
    const ai = useContractDraftAI({
      generate: async () => 42,
      getSection: async () => sectionWith({ ai_status: "error" }),
      sleep: async () => undefined,
      intervalMs: 1,
      maxPolls: 5
    });
    const result = await ai.generateForSection(9, 1, "");
    expect(result).toBeNull();
    expect(ai.stateOf(1).phase).toBe("error");
  });

  it("超过轮询上限：phase=error", async () => {
    const ai = useContractDraftAI({
      generate: async () => 42,
      getSection: async () => sectionWith({ ai_status: "generating" }),
      sleep: async () => undefined,
      intervalMs: 1,
      maxPolls: 3
    });
    const result = await ai.generateForSection(9, 1, "");
    expect(result).toBeNull();
    expect(ai.stateOf(1).phase).toBe("error");
    expect(ai.stateOf(1).error).toContain("超时");
  });

  it("恢复生成：只轮询不入队，至 done 回填并携带 startedAt", async () => {
    const polls = [
      sectionWith({ ai_status: "generating" }),
      sectionWith({ ai_status: "done", content: "恢复后回填正文" })
    ];
    let i = 0;
    let generateCalls = 0;
    const ai = useContractDraftAI({
      generate: async () => {
        generateCalls++;
        return 42;
      },
      getSection: async () => polls[Math.min(i++, polls.length - 1)],
      sleep: async () => undefined,
      intervalMs: 1,
      maxPolls: 10
    });
    const result = await ai.resumeSection(9, 1, "ai_status", 1_700_000_000_000);
    expect(result?.content).toBe("恢复后回填正文");
    expect(ai.stateOf(1).phase).toBe("done");
    expect(generateCalls).toBe(0); // 恢复不重新入队
  });

  it("恢复审查：只轮询不入队，reviewing→done", async () => {
    const polls = [
      sectionWith({ review_status: "generating" }),
      sectionWith({ review_status: "done" })
    ];
    let i = 0;
    let reviewCalls = 0;
    const ai = useContractDraftAI({
      review: async () => {
        reviewCalls++;
        return 42;
      },
      getSection: async () => polls[Math.min(i++, polls.length - 1)],
      sleep: async () => undefined,
      intervalMs: 1,
      maxPolls: 10
    });
    const result = await ai.resumeSection(9, 1, "review_status");
    expect(result).not.toBeNull();
    expect(ai.stateOf(1).phase).toBe("done");
    expect(reviewCalls).toBe(0); // 恢复不重新入队
  });

  it("恢复：字段停留在 error 时 phase=error", async () => {
    const ai = useContractDraftAI({
      getSection: async () => sectionWith({ ai_status: "error" }),
      sleep: async () => undefined,
      intervalMs: 1,
      maxPolls: 5
    });
    const result = await ai.resumeSection(9, 1, "ai_status");
    expect(result).toBeNull();
    expect(ai.stateOf(1).phase).toBe("error");
  });
});
