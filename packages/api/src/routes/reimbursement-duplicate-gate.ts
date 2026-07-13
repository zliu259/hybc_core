// 复核通过时的重复风险门控：
// 常规路径要求申请人在提交时"坚持提交"（duplicate_override_requested=1）；
// 办公室财务/超级管理员可凭必填理由直接放行（写审计日志），其余角色一律拦截。

export interface DuplicateGateInput {
  duplicateCount: number;
  overrideRequested: boolean;
  actorRoles: readonly string[];
  overrideReason?: unknown;
}

export type DuplicateGateResult =
  | { outcome: "pass" }
  | { outcome: "override"; reason: string }
  | { outcome: "blocked"; canOverride: boolean };

const DUPLICATE_OVERRIDE_ROLES = ["finance", "super_admin"] as const;

export const canOverrideDuplicateGate = (roles: readonly string[]): boolean =>
  DUPLICATE_OVERRIDE_ROLES.some(role => roles.includes(role));

export function evaluateDuplicatePrecheckGate(
  input: DuplicateGateInput
): DuplicateGateResult {
  if (input.duplicateCount <= 0 || input.overrideRequested) {
    return { outcome: "pass" };
  }

  const canOverride = canOverrideDuplicateGate(input.actorRoles);
  const reason =
    typeof input.overrideReason === "string" ? input.overrideReason.trim() : "";

  if (canOverride && reason) {
    return { outcome: "override", reason };
  }

  return { outcome: "blocked", canOverride };
}
