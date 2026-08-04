import { describe, expect, it, vi } from "vitest";

import { applyContractPrecheckExtract } from "./contract-precheck";
import type { Env } from "../types/env";

/** 极简 D1 桩：记录每条 SQL 与绑定参数，供断言链式推进的写入顺序 */
const fakeEnv = () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              async run() {
                calls.push({ sql: sql.replace(/\s+/g, " ").trim(), args });
                return { meta: { changes: 1 } };
              }
            };
          }
        };
      }
    }
  } as unknown as Env;
  return { env, calls };
};

const extractTask = (payloadOverrides: Record<string, unknown> = {}) => ({
  id: 101,
  biz_id: 7,
  payload_json: JSON.stringify({
    precheck_id: 7,
    round: 1,
    title: "设备租赁合同",
    counterparty: "某某公司",
    direction: "inbound",
    direction_label: "inbound（我方乙方）",
    our_entities: "恒越百川建设集团有限公司",
    model: "anthropic/claude-sonnet-5",
    file_key: "contract-precheck/a.docx",
    file_name: "a.docx",
    ...payloadOverrides
  })
});

const LONG_TEXT = `甲乙双方经协商一致，依据《中华人民共和国民法典》订立本设备租赁合同。${"条款内容。".repeat(20)}`;

describe("applyContractPrecheckExtract — 提取完成后的链式推进", () => {
  it("提取成功：文本落库 → 派生审计任务 → 指针改指新任务", async () => {
    const { env, calls } = fakeEnv();
    const createReviewTask = vi.fn().mockResolvedValue({ id: 202 });

    await applyContractPrecheckExtract(
      env,
      extractTask(),
      JSON.stringify({ text: LONG_TEXT, chars: LONG_TEXT.length }),
      createReviewTask
    );

    // 文本落库
    const textWrite = calls.find(c => c.sql.includes("SET contract_text = ?"));
    expect(textWrite).toBeDefined();
    expect(String(textWrite?.args[0])).toContain("设备租赁合同");

    // 审计任务带齐提示词变量（含实时实体名单），且携带提取到的正文
    expect(createReviewTask).toHaveBeenCalledTimes(1);
    const payload = createReviewTask.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.our_entities).toBe("恒越百川建设集团有限公司");
    expect(payload.model).toBe("anthropic/claude-sonnet-5");
    expect(String(payload.contract_text)).toContain("民法典");

    // 指针改指审计任务（轮询/超时回收跟随活任务）
    const pointerWrite = calls.find(c => c.sql.includes("SET review_task_id = ?"));
    expect(pointerWrite?.args).toEqual([202, expect.any(String), 7, 101]);
    const roundWrite = calls.find(c => c.sql.includes("contract_precheck_round SET task_id = ?"));
    expect(roundWrite?.args[0]).toBe(202);
  });

  it("扫描件（提取为空）：落 review_failed 并写明原因，不派审计任务", async () => {
    const { env, calls } = fakeEnv();
    const createReviewTask = vi.fn();

    await applyContractPrecheckExtract(
      env,
      extractTask(),
      JSON.stringify({ text: "", chars: 0, error: "未能从文件中提取到文字（可能是扫描件或加密文件）" }),
      createReviewTask
    );

    expect(createReviewTask).not.toHaveBeenCalled();
    const failWrite = calls.find(c => c.sql.includes("status = 'review_failed'"));
    expect(failWrite).toBeDefined();
    const result = JSON.parse(String(failWrite?.args[0])) as Record<string, unknown>;
    expect(result.has_blocking).toBe(true);
    expect(String(result.summary)).toContain("扫描件");
    expect(String(result.summary)).toContain("重新预审");
  });

  it("提取文本过短同样判失败（防半截文本进审计）", async () => {
    const { env, calls } = fakeEnv();
    const createReviewTask = vi.fn();
    await applyContractPrecheckExtract(
      env,
      extractTask(),
      JSON.stringify({ text: "太短", chars: 2 }),
      createReviewTask
    );
    expect(createReviewTask).not.toHaveBeenCalled();
    expect(calls.some(c => c.sql.includes("status = 'review_failed'"))).toBe(true);
  });

  it("裸文本输出（非 JSON）也能接受", async () => {
    const { env } = fakeEnv();
    const createReviewTask = vi.fn().mockResolvedValue({ id: 303 });
    await applyContractPrecheckExtract(env, extractTask(), LONG_TEXT, createReviewTask);
    expect(createReviewTask).toHaveBeenCalledTimes(1);
  });
});
