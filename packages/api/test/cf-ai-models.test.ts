// packages/api/test/cf-ai-models.test.ts
// 模型策略历史：M1 为 terra/sonnet 交替+critic 异厂商；owner 07-23 改为固定分工
// （生成=luna / 审查=sonnet-5 / 完整性=双模型），分工断言见 cf-ai-cheap-routing.test.ts。
import { describe, it, expect } from "vitest";
import { CF_AI_TASK_TYPES, isCfAiTaskType } from "../src/services/cf-ai";

describe("cf_ai 任务类型", () => {
  it("任务类型判别", () => {
    expect(isCfAiTaskType("contract_draft_section")).toBe(true);
    expect(isCfAiTaskType("contract_review")).toBe(false);
  });
  it("五类任务全部登记（起草四类 + 合同预审）", () => {
    expect([...CF_AI_TASK_TYPES]).toEqual([
      "contract_draft_section",
      "contract_compliance_review",
      "contract_completeness_check",
      "contract_completeness_audit",
      "contract_precheck_review"
    ]);
  });
});
