export type TbmComponentRole = "shell" | "core" | "console";

export interface TbmCompositionAssetInput {
  id: number;
  asset_code: string;
  asset_name: string;
  asset_type_id: number;
  asset_type_code: string | null;
  asset_type_name: string | null;
  status: string;
  current_warehouse_id: number | null;
}

export interface TbmCompatibilityRuleInput {
  left_asset_type_id: number;
  right_asset_type_id: number;
  relation_type: "shell_core" | "core_console";
}

export interface TbmCompositionCandidate {
  id: number;
  asset_code: string;
  asset_name: string;
  asset_type_id: number;
  asset_type_code: string | null;
  asset_type_name: string | null;
  role: TbmComponentRole;
  status: string;
  current_warehouse_id: number | null;
  available: boolean;
  requires_modification: boolean;
  reasons: string[];
}

const roleRelation: Record<Exclude<TbmComponentRole, "core">, "shell_core" | "core_console"> = {
  shell: "shell_core",
  console: "core_console"
};

export const hasCompatibilityRule = (
  rules: TbmCompatibilityRuleInput[],
  leftAssetTypeId: number,
  rightAssetTypeId: number,
  relationType: "shell_core" | "core_console"
): boolean => {
  return rules.some(
    (rule) =>
      rule.relation_type === relationType &&
      ((rule.left_asset_type_id === leftAssetTypeId &&
        rule.right_asset_type_id === rightAssetTypeId) ||
        (rule.left_asset_type_id === rightAssetTypeId &&
          rule.right_asset_type_id === leftAssetTypeId))
  );
};

export const inferTbmComponentRole = (
  asset: Pick<TbmCompositionAssetInput, "asset_type_code" | "asset_type_name" | "asset_name">
): TbmComponentRole | "generic" => {
  const text =
    `${asset.asset_type_code ?? ""} ${asset.asset_type_name ?? ""} ${asset.asset_name}`.toLowerCase();
  if (text.includes("机芯") || text.includes("core")) return "core";
  if (text.includes("操作台") || text.includes("console")) return "console";
  if (text.includes("壳") || text.includes("shell")) return "shell";
  return "generic";
};

export const buildTbmCompositionCandidate = (payload: {
  candidate: TbmCompositionAssetInput;
  selectedCore: TbmCompositionAssetInput;
  role: TbmComponentRole;
  compatibilityRules: TbmCompatibilityRuleInput[];
}): TbmCompositionCandidate => {
  const reasons: string[] = [];
  let requiresModification = false;

  if (payload.candidate.status !== "idle") {
    reasons.push(`设备状态为 ${payload.candidate.status}`);
  }
  if (
    payload.selectedCore.current_warehouse_id &&
    payload.candidate.current_warehouse_id !== payload.selectedCore.current_warehouse_id
  ) {
    reasons.push("不在同一库房");
  }
  if (payload.role !== "core") {
    const relationType = roleRelation[payload.role];
    const compatible = hasCompatibilityRule(
      payload.compatibilityRules,
      payload.candidate.asset_type_id,
      payload.selectedCore.asset_type_id,
      relationType
    );
    if (!compatible) {
      requiresModification = true;
      reasons.push(payload.role === "shell" ? "缺少壳体-机芯兼容规则" : "缺少机芯-操作台兼容规则");
    }
  }

  return {
    id: payload.candidate.id,
    asset_code: payload.candidate.asset_code,
    asset_name: payload.candidate.asset_name,
    asset_type_id: payload.candidate.asset_type_id,
    asset_type_code: payload.candidate.asset_type_code,
    asset_type_name: payload.candidate.asset_type_name,
    role: payload.role,
    status: payload.candidate.status,
    current_warehouse_id: payload.candidate.current_warehouse_id,
    available: reasons.length === 0,
    requires_modification: requiresModification,
    reasons
  };
};
