import type { Env } from "../types/env";

/**
 * 高危写匹配表：mcp_agent 令牌命中这些端点时不直接执行，而是 park 成待确认动作，
 * 推微信卡片给授权人本人，确认后由服务端重放执行。
 *
 * 首批仅审批 approve/reject（P2a 窄验证闭环）。付款/报销/合同金额变更留 P3。
 * 新增条目必须同步补单测，并确认该端点的业务语义适合「人在环延迟执行」。
 */
export interface HighRiskRule {
  readonly method: "POST";
  /** 归一化后（剥离 /api/v1 与 query）的路径正则，必须锚定首尾。 */
  readonly pattern: RegExp;
  /** 审计与卡片文案用的动作类型。 */
  readonly actionKind: string;
  /** 展示给员工的风险说明。 */
  readonly riskReason: string;
}

const HIGH_RISK_RULES: readonly HighRiskRule[] = [
  {
    method: "POST",
    pattern: /^\/approval\/\d+\/approve$/,
    actionKind: "approval.approve",
    riskReason: "智能体请求批准审批单"
  },
  {
    method: "POST",
    pattern: /^\/approval\/\d+\/reject$/,
    actionKind: "approval.reject",
    riskReason: "智能体请求拒绝审批单"
  }
];

const stripApiPrefix = (path: string): string => path.replace(/^\/api\/v1(?=\/|$)/, "");
const pathnameOnly = (path: string): string => path.replace(/[?#].*$/, "");

/** 命中返回规则，否则 null。 */
export const matchHighRisk = (method: string, path: string): HighRiskRule | null => {
  const upper = method.toUpperCase();
  const normalized = stripApiPrefix(pathnameOnly(path));
  return (
    HIGH_RISK_RULES.find(
      (rule) => rule.method === upper && rule.pattern.test(normalized)
    ) ?? null
  );
};

const HIGH_RISK_KV_KEY = "agent:highrisk:config";

/**
 * 高危写路径总开关（部署了也能先不放量）。
 * 缺省：仅本地开启，生产关闭——与 passkey feature flag 同款保守口径。
 */
export const isHighRiskEnabled = async (env: Env): Promise<boolean> => {
  const raw = await env.KV.get(HIGH_RISK_KV_KEY);
  if (!raw) {
    return env.APP_ENV === "local";
  }
  try {
    const parsed = JSON.parse(raw) as Partial<{ enabled: boolean }>;
    return parsed.enabled === true;
  } catch (err) {
    console.error("agent highrisk flag parse failed", err);
    return false;
  }
};
