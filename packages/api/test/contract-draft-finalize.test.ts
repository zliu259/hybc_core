// packages/api/test/contract-draft-finalize.test.ts
import { describe, it, expect } from "vitest";
import {
  buildKeywordValues,
  fillPlaceholders,
  collectUnresolvedKeys
} from "../src/services/contract-draft-finalize";
import type { ContractDraft } from "../src/types/contract-draft";

const draftWith = (over: Partial<ContractDraft>): ContractDraft => ({
  id: 1,
  title: "t",
  direction: "inbound",
  family: "pipe_jacking",
  project_id: 1,
  entity_id: 1,
  counterparty_name: "对方公司",
  counterparty_credit_code: "91110000TEST",
  counterparty_legal_person: "张三",
  counterparty_address: null,
  counterparty_contact: null,
  counterparty_phone: null,
  counterparty_bank_name: null,
  counterparty_bank_account: null,
  keywords_json: JSON.stringify({ amount: "246400", sign_date: "2026-07-22" }),
  status: "drafting",
  completeness_status: null,
  completeness_task_id: null,
  completeness_result_json: null,
  ignored_hints_json: "[]",
  converted_contract_id: null,
  created_by_userid: "u1",
  created_at: "",
  updated_at: "",
  ...over
});

describe("buildKeywordValues", () => {
  it("inbound：对方=甲方、我方主体=乙方，amount_cn 自动生成", () => {
    const values = buildKeywordValues(draftWith({}), {
      entity_name: "我方公司",
      tax_id: "91110000OUR",
      legal_person: "李四",
      primary_bank_name: "X银行",
      primary_bank_account_no: "123"
    });
    expect(values.party_a).toBe("对方公司");
    expect(values.party_b).toBe("我方公司");
    expect(values.party_a_credit_code).toBe("91110000TEST");
    expect(values.party_b_credit_code).toBe("91110000OUR");
    expect(values.amount).toBe("246400");
    // 期望值以 services/amount-cn.ts 实现为准（该实现对节内末尾零补"零"）
    expect(values.amount_cn).toBe("贰拾肆万陆仟肆佰零元整");
  });
  it("outbound：我方主体=甲方、对方=乙方", () => {
    const values = buildKeywordValues(draftWith({ direction: "outbound" }), {
      entity_name: "我方公司",
      tax_id: null,
      legal_person: null,
      primary_bank_name: null,
      primary_bank_account_no: null
    });
    expect(values.party_a).toBe("我方公司");
    expect(values.party_b).toBe("对方公司");
  });
  it("amount 非数字时不生成 amount_cn", () => {
    const values = buildKeywordValues(draftWith({ keywords_json: '{"amount":"面议"}' }), null);
    expect(values.amount_cn).toBeUndefined();
  });
});

describe("fillPlaceholders / collectUnresolvedKeys", () => {
  it("已知键替换、未知键原样保留", () => {
    expect(fillPlaceholders("甲方{{party_a}}与{{unknown}}", { party_a: "A公司" })).toBe(
      "甲方A公司与{{unknown}}"
    );
  });
  it("收集未解析键（去重）", () => {
    expect(collectUnresolvedKeys(["{{a}}和{{b}}", "{{b}}之外"], { a: "x" })).toEqual(["b"]);
  });
});
