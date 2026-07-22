// packages/api/src/services/contract-draft-rules.ts
// 合同草稿合规规则层：确定性校验（黑名单/日期/输出解析），与 LLM 合规审查互补。
import type { RiskAnnotation } from "../types/contract-draft";

interface RulePattern {
  re: RegExp;
  level: "red" | "yellow";
  reason: string;
  legal_basis: string;
}

const RULE_PATTERNS: RulePattern[] = [
  {
    re: /《中华人民共和国合同法》|《合同法》|《中华人民共和国经济合同法》/,
    level: "red",
    reason: "引用了已废止的法律，应改为《中华人民共和国民法典》",
    legal_basis: "《民法典》2021年1月1日施行，合同法同日废止"
  },
  {
    re: /(收到|待)(业主|建设单位|上游|第三方|总包)[^。；]{0,12}(付款|款项|工程款)[^。；]{0,8}(后|再|方)[^。；]{0,12}(支付|付款|拨付)/,
    level: "red",
    reason: "背靠背付款条款：以第三方付款作为付款前提，对中小企业无效",
    legal_basis: "最高人民法院2024年批复（法释〔2024〕11号）"
  },
  { re: /\d{17}[0-9Xx]/, level: "red", reason: "正文含身份证号明文，个人信息不得写入合同模板正文", legal_basis: "《个人信息保护法》" },
  {
    re: /免除[^。；]{0,16}人身(损害|伤害)[^。；]{0,8}责任|不承担[^。；]{0,12}人身(损害|伤害)/,
    level: "red",
    reason: "免除人身损害责任的免责条款无效",
    legal_basis: "《民法典》第506条"
  },
  {
    re: /(故意|重大过失)[^。；]{0,16}(免责|不承担责任|免除责任)/,
    level: "red",
    reason: "免除故意或重大过失责任的免责条款无效",
    legal_basis: "《民法典》第506条"
  },
  {
    re: /(允许|可以|有权)[^。；]{0,8}(转包|再分包)/,
    level: "red",
    reason: "转包/违法再分包安排违法且合同存在无效风险",
    legal_basis: "《建筑法》第28-29条"
  },
  {
    re: /每日[按]?千分之[一二三四五六七八九十\d]/,
    level: "yellow",
    reason: "逾期违约金费率畸高（年化超36%），存在被法院调减风险",
    legal_basis: "《民法典》第585条"
  }
];

const WARRANTY_RE = /(质量保证金|质保金)[^。；]{0,20}?([0-9]+(?:\.[0-9]+)?)\s*%/g;

const firstMatchText = (text: string, re: RegExp): string => {
  const m = text.match(re);
  return m ? m[0] : "";
};

/** 对单节正文跑全部确定性规则，返回风险标注（source='rule'）。 */
export const checkClauseText = (text: string): RiskAnnotation[] => {
  const findings: RiskAnnotation[] = [];
  for (const p of RULE_PATTERNS) {
    if (p.re.test(text)) {
      findings.push({
        text: firstMatchText(text, p.re),
        level: p.level,
        reason: p.reason,
        legal_basis: p.legal_basis,
        source: "rule"
      });
    }
  }
  for (const m of text.matchAll(WARRANTY_RE)) {
    const ratio = Number(m[2]);
    if (Number.isFinite(ratio) && ratio > 3) {
      findings.push({
        text: m[0],
        level: "red",
        reason: "质量保证金超过结算总额3%上限，超出部分不受支持",
        legal_basis: "《建设工程质量保证金管理办法》",
        source: "rule"
      });
    }
  }
  return findings;
};

/** 工期逻辑：竣工不得早于开工。 */
export const checkDraftDates = (
  startDate: string | undefined,
  endDate: string | undefined
): RiskAnnotation[] => {
  if (!startDate || !endDate) return [];
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end >= start) return [];
  return [
    {
      text: `${startDate} → ${endDate}`,
      level: "red",
      reason: "竣工日期早于开工日期，工期倒挂",
      legal_basis: "",
      source: "rule"
    }
  ];
};

export interface ContractSectionOutput {
  content: string;
  risk_spans: RiskAnnotation[];
}

const stripCodeFence = (raw: string): string => {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1] : trimmed;
};

/** 容错解析单节生成输出：JSON 优先，失败降级为纯文本正文。 */
export const parseContractSectionOutput = (rawOutput: string): ContractSectionOutput => {
  const raw = stripCodeFence(rawOutput);
  try {
    const parsed = JSON.parse(raw) as { content?: unknown; risk_spans?: unknown };
    const content = typeof parsed.content === "string" ? parsed.content : raw;
    const spansRaw = Array.isArray(parsed.risk_spans) ? parsed.risk_spans : [];
    const risk_spans: RiskAnnotation[] = spansRaw
      .filter(
        (s): s is { text: string; level: string; reason: string; legal_basis?: string } =>
          !!s &&
          typeof s === "object" &&
          typeof (s as { text?: unknown }).text === "string" &&
          typeof (s as { reason?: unknown }).reason === "string"
      )
      .map(s => ({
        text: s.text,
        level: s.level === "red" ? "red" : "yellow",
        reason: s.reason,
        legal_basis: typeof s.legal_basis === "string" ? s.legal_basis : "",
        source: "ai" as const
      }));
    return { content, risk_spans };
  } catch {
    return { content: rawOutput, risk_spans: [] };
  }
};
