// packages/api/src/services/contract-draft-finalize.ts
// 定稿固化：服务端关键字表构建（与 web 端 keywordValues 同口径）+ 占位符替换。
// 大写金额由本服务经 toAmountChinese 生成，AI 与前端不生成数字。
import { toAmountChinese } from "./amount-cn";
import type { ContractDraft } from "../types/contract-draft";

export interface OurEntityInfo {
  entity_name: string;
  tax_id: string | null;
  legal_person: string | null;
  primary_bank_name: string | null;
  primary_bank_account_no: string | null;
}

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g;

// 仅当该键尚无值时写入：用户显式关键字（含所选开户账户）优先于 entity/counterparty 默认回填
const setIf = (
  target: Record<string, string>,
  key: string,
  value: string | null | undefined
): void => {
  if (typeof value === "string" && value.trim().length > 0 && !(key in target)) {
    target[key] = value.trim();
  }
};

/** 立场映射：inbound=我方乙方（收款），outbound=我方甲方（付款）。 */
export const buildKeywordValues = (
  draft: ContractDraft,
  ourEntity: OurEntityInfo | null
): Record<string, string> => {
  let keywords: Record<string, unknown> = {};
  try {
    keywords = JSON.parse(draft.keywords_json) as Record<string, unknown>;
  } catch {
    keywords = {};
  }
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(keywords)) {
    if (typeof v === "string" && v.trim().length > 0) values[k] = v.trim();
  }

  const our = {
    name: ourEntity?.entity_name ?? "",
    credit: ourEntity?.tax_id ?? "",
    legal: ourEntity?.legal_person ?? "",
    bank: ourEntity?.primary_bank_name ?? "",
    account: ourEntity?.primary_bank_account_no ?? ""
  };
  const cp = {
    name: draft.counterparty_name,
    credit: draft.counterparty_credit_code ?? "",
    legal: draft.counterparty_legal_person ?? "",
    address: draft.counterparty_address ?? "",
    phone: draft.counterparty_phone ?? "",
    bank: draft.counterparty_bank_name ?? "",
    account: draft.counterparty_bank_account ?? ""
  };
  const partyA = draft.direction === "inbound" ? cp : { ...our, address: "", phone: "" };
  const partyB = draft.direction === "inbound" ? { ...our, address: "", phone: "" } : cp;

  setIf(values, "party_a", partyA.name);
  setIf(values, "party_a_credit_code", partyA.credit);
  setIf(values, "party_a_legal_person", partyA.legal);
  setIf(values, "party_a_address", partyA.address);
  setIf(values, "party_a_phone", partyA.phone);
  setIf(values, "party_a_bank_name", partyA.bank);
  setIf(values, "party_a_bank_account", partyA.account);
  setIf(values, "party_b", partyB.name);
  setIf(values, "party_b_credit_code", partyB.credit);
  setIf(values, "party_b_legal_person", partyB.legal);
  setIf(values, "party_b_address", partyB.address);
  setIf(values, "party_b_phone", partyB.phone);
  setIf(values, "party_b_bank_name", partyB.bank);
  setIf(values, "party_b_bank_account", partyB.account);

  const amount = Number(values.amount);
  if (Number.isFinite(amount) && amount > 0) {
    values.amount_cn = toAmountChinese(amount);
  } else {
    delete values.amount_cn;
  }
  return values;
};

export const fillPlaceholders = (text: string, values: Record<string, string>): string =>
  text.replace(PLACEHOLDER_RE, (raw, key: string) => {
    const v = values[key];
    return v && v.length > 0 ? v : raw;
  });

export const collectUnresolvedKeys = (
  texts: string[],
  values: Record<string, string>
): string[] => {
  const unresolved = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      const key = m[1];
      if (!(values[key] && values[key].length > 0)) unresolved.add(key);
    }
  }
  return [...unresolved];
};
