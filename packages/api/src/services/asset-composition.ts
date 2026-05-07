export type TbmComponentRole = "shell" | "core" | "console";

export interface TbmCompositionAssetInput {
  id: number;
  asset_code: string;
  asset_name: string;
  asset_type_id: number;
  asset_type_code: string | null;
  asset_type_name: string | null;
  brand?: string | null;
  model?: string | null;
  properties_json?: string | null;
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
  brand: string | null;
  model: string | null;
  role: TbmComponentRole;
  status: string;
  current_warehouse_id: number | null;
  available: boolean;
  requires_modification: boolean;
  reasons: string[];
}

export interface TbmCompositionTaskDefinition {
  key: "precheck" | "modification" | "confirmation";
  work_order_type: "inspection" | "modification";
  remark: string;
  step_title: string;
  step_type: "check" | "work" | "confirmation";
  required_photo_count: number;
}

const roleRelation: Record<Exclude<TbmComponentRole, "core">, "shell_core" | "core_console"> = {
  shell: "shell_core",
  console: "core_console"
};

const normalizeText = (value?: string | null): string | null => {
  const next = value?.trim();
  return next ? next.toLowerCase() : null;
};

const parseAssetProperties = (value?: string | null): Record<string, unknown> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const readTextProperty = (asset: TbmCompositionAssetInput, keys: string[]): string | null => {
  const properties = parseAssetProperties(asset.properties_json);
  for (const key of keys) {
    const value = properties[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
};

const readNumberProperty = (asset: TbmCompositionAssetInput, keys: string[]): number | null => {
  const properties = parseAssetProperties(asset.properties_json);
  for (const key of keys) {
    const value = properties[key];
    const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const readManufacturer = (asset: TbmCompositionAssetInput): string | null =>
  asset.brand?.trim() ||
  readTextProperty(asset, ["manufacturer", "factory", "vendor", "brand", "厂家", "生产厂家"]);

const readDiameterMm = (asset: TbmCompositionAssetInput): number | null =>
  readNumberProperty(asset, [
    "diameter_mm",
    "pipe_diameter_mm",
    "diameter",
    "pipe_diameter",
    "口径",
    "管径"
  ]);

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

  const candidateModel = normalizeText(payload.candidate.model);
  const coreModel = normalizeText(payload.selectedCore.model);
  if (candidateModel && coreModel && candidateModel !== coreModel) {
    requiresModification = true;
    reasons.push(`型号不一致：${payload.candidate.model} / ${payload.selectedCore.model}`);
  }

  const candidateDiameter = readDiameterMm(payload.candidate);
  const coreDiameter = readDiameterMm(payload.selectedCore);
  if (candidateDiameter && coreDiameter && candidateDiameter !== coreDiameter) {
    requiresModification = true;
    reasons.push(`口径不匹配：${candidateDiameter}mm / ${coreDiameter}mm`);
  }

  const candidateManufacturer = readManufacturer(payload.candidate);
  const coreManufacturer = readManufacturer(payload.selectedCore);
  if (
    candidateManufacturer &&
    coreManufacturer &&
    normalizeText(candidateManufacturer) !== normalizeText(coreManufacturer)
  ) {
    requiresModification = true;
    reasons.push(`厂家不一致：${candidateManufacturer} / ${coreManufacturer}`);
  }

  return {
    id: payload.candidate.id,
    asset_code: payload.candidate.asset_code,
    asset_name: payload.candidate.asset_name,
    asset_type_id: payload.candidate.asset_type_id,
    asset_type_code: payload.candidate.asset_type_code,
    asset_type_name: payload.candidate.asset_type_name,
    brand: payload.candidate.brand ?? null,
    model: payload.candidate.model ?? null,
    role: payload.role,
    status: payload.candidate.status,
    current_warehouse_id: payload.candidate.current_warehouse_id,
    available: reasons.length === 0,
    requires_modification: requiresModification,
    reasons
  };
};

export const buildTbmCompositionTaskDefinitions = (): TbmCompositionTaskDefinition[] => [
  {
    key: "precheck",
    work_order_type: "inspection",
    remark: "顶管机组合前检查：核对壳体、机芯、操作台状态并提交照片与检查简报。",
    step_title: "组合前检查",
    step_type: "check",
    required_photo_count: 3
  },
  {
    key: "modification",
    work_order_type: "modification",
    remark: "顶管机组合改装：按组合方案完成组件搭配、改装确认和照片简报。",
    step_title: "改装实施",
    step_type: "work",
    required_photo_count: 3
  },
  {
    key: "confirmation",
    work_order_type: "inspection",
    remark: "顶管机组合确认：复核壳体、机芯、操作台搭配结果，确认整机号、照片和简报可追溯。",
    step_title: "组合确认",
    step_type: "confirmation",
    required_photo_count: 3
  }
];
