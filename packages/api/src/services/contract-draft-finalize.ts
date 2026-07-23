// packages/api/src/services/contract-draft-finalize.ts
// 定稿固化：服务端关键字表构建（与 web 端 keywordValues 同口径）+ 占位符替换。
// 大写金额由本服务经 toAmountChinese 生成，AI 与前端不生成数字。
import { toAmountChinese } from "./amount-cn";
import { TABLE_SENTINEL } from "./contract-draft-table";
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

/** 占位符 → 中文可读标签，用于发给 AI 时把未填占位符换成人话（防 AI 误判为条款缺陷）。 */
const PLACEHOLDER_LABELS: Record<string, string> = {
  party_a: "甲方名称",
  party_b: "乙方名称",
  party_a_credit_code: "甲方统一社会信用代码",
  party_b_credit_code: "乙方统一社会信用代码",
  party_a_legal_person: "甲方法定代表人",
  party_b_legal_person: "乙方法定代表人",
  party_a_address: "甲方地址",
  party_b_address: "乙方地址",
  party_a_bank_name: "甲方开户银行",
  party_b_bank_name: "乙方开户银行",
  party_a_bank_account: "甲方账号",
  party_b_bank_account: "乙方账号",
  party_a_phone: "甲方电话",
  party_b_phone: "乙方电话",
  project_name: "工程/项目名称",
  location: "工程地点",
  pipe_spec: "管材规格",
  length: "顶进长度",
  unit_price: "综合单价",
  amount: "合同总价",
  amount_cn: "合同总价大写",
  tax_rate: "税率",
  invoice_type: "发票类型",
  start_date: "开工日期",
  end_date: "竣工日期",
  sign_date: "签约日期",
  with_operator: "是否含操作人员",
  work_scope: "作业范围",
  goods_name: "货物名称",
  quality_standard: "质量标准",
  delivery_date: "交货日期",
  delivery_place: "交货地点",
  warranty_months: "质保月数",
  worker_count: "劳务人数"
};

/**
 * 发给 AI 前填充占位符：已填的换真实值，未填的换成「（<中文标签>，尚未填写）」而非保留 {{key}}。
 * 这样 AI 看到的是接近成稿的纯文本，不会把占位符当成条款缺陷误报，输出也基于真实值。
 */
export const fillPlaceholdersForAi = (
  text: string,
  values: Record<string, string>
): string =>
  text.replace(PLACEHOLDER_RE, (_raw, key: string) => {
    // 清单表格哨兵：喂 AI 的文本里换成人话提示，避免 AI 把 {{__table__}} 当条款缺陷。
    if (key === TABLE_SENTINEL) return "（详见清单表格）";
    const v = values[key];
    if (v && v.length > 0) return v;
    const label = PLACEHOLDER_LABELS[key] ?? key;
    return `（${label}，尚未填写）`;
  });

export const collectUnresolvedKeys = (
  texts: string[],
  values: Record<string, string>
): string[] => {
  const unresolved = new Set<string>();
  for (const text of texts) {
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      const key = m[1];
      // 清单表格哨兵不是待填关键字：由 docx 渲染真表格，不计入未解析。
      if (key === TABLE_SENTINEL) continue;
      if (!(values[key] && values[key].length > 0)) unresolved.add(key);
    }
  }
  return [...unresolved];
};
