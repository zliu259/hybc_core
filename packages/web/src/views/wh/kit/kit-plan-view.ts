/** 按项目参数生成清单：页面用的纯函数（参数检查、选模板、规则的文字、标签）。 */
import type {
  KitClientSupply,
  KitLineRole,
  KitLineRule,
  KitPlanParams,
  KitPlanSourceFrom,
  KitQtyBasis,
  KitTemplateRow
} from "@/api/wh/kit-types";

export const BASIS_LABELS: Record<KitQtyBasis, string> = {
  fixed: "固定",
  per_total_metre: "按总长",
  per_longest_metre: "按最长一段",
  per_section: "按段"
};

export const ROLE_LABELS: Record<KitLineRole, string> = {
  main_machine: "主机",
  power: "发电",
  lodging: "住宿"
};

/** 参数来源的小字；手填的不标。 */
export const SOURCE_FROM_LABELS: Record<KitPlanSourceFrom, string> = {
  section: "工作段",
  project: "项目档案",
  ai: "AI 读自简报",
  manual: ""
};

export const CLIENT_SUPPLY_LABELS: Record<KitClientSupply, string> = {
  power: "发电",
  lodging: "住宿"
};

export const emptyRule = (): KitLineRule => ({
  qty_basis: "fixed",
  qty_factor: null,
  qty_extra: null,
  qty_per_set: false,
  spec_by_diameter: false,
  role: null
});

export const emptyPlanParams = (): KitPlanParams => ({
  machine_type: null,
  pipe_diameter_mm: null,
  total_length_m: null,
  longest_drive_m: null,
  section_count: null,
  set_count: 1,
  soil: null,
  client_supplies: []
});

const MAX_LENGTH_M = 20000;

const badInteger = (value: number | null, min: number, max: number): boolean =>
  value !== null && (!Number.isInteger(value) || value < min || value > max);

const badLength = (value: number | null): boolean =>
  value !== null &&
  (!Number.isFinite(value) || value <= 0 || value > MAX_LENGTH_M);

/** 参数哪里不对。文字和服务端的校验相同。 */
export const planParamProblems = (params: KitPlanParams): string[] => {
  const checks: [boolean, string][] = [
    [(params.machine_type ?? "").trim().length > 20, "机型不能超过20个字"],
    [
      badInteger(params.pipe_diameter_mm, 300, 5000),
      "管径必须是 300 到 5000 之间的整数"
    ],
    [badLength(params.total_length_m), "总长度必须大于 0，不超过 20000"],
    [badLength(params.longest_drive_m), "最长一段必须大于 0，不超过 20000"],
    [
      params.total_length_m !== null &&
        params.longest_drive_m !== null &&
        !badLength(params.total_length_m) &&
        !badLength(params.longest_drive_m) &&
        params.longest_drive_m > params.total_length_m,
      "最长一段不能超过总长度"
    ],
    [badInteger(params.section_count, 1, 200), "段数必须是 1 到 200 的整数"],
    [badInteger(params.set_count, 1, 200), "套数必须是 1 到 200 的整数"],
    [(params.soil ?? "").trim().length > 100, "土质不能超过100个字"]
  ];
  return checks.filter(([bad]) => bad).map(([, message]) => message);
};

/**
 * 预选模板：在用的模板里找机型相同的，管径最接近的那个，一样近时取大的。
 * 没给管径时取同机型里排最前的；没有同机型的不预选。
 */
export const pickTemplateFor = (
  templates: readonly KitTemplateRow[],
  machineType: string | null,
  diameter: number | null
): number | null => {
  const wanted = (machineType ?? "").trim();
  if (!wanted) return null;
  const same = templates.filter(
    template =>
      template.status === "active" &&
      (template.machine_type ?? "").trim() === wanted
  );
  if (same.length === 0) return null;
  const sized = same.filter(template => template.diameter_mm !== null);
  if (diameter === null || sized.length === 0) return same[0].id;
  const distance = (template: KitTemplateRow) =>
    Math.abs(Number(template.diameter_mm) - diameter);
  return sized.reduce((best, template) => {
    if (distance(template) < distance(best)) return template;
    if (
      distance(template) === distance(best) &&
      Number(template.diameter_mm) > Number(best.diameter_mm)
    )
      return template;
    return best;
  }).id;
};

const show = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));

/** 模板行上规则的一句话，例如「按最长一段 ×2 +60 · 每套一份」。没配是空字符串。 */
export const ruleSummary = (rule: KitLineRule): string => {
  const basis =
    rule.qty_basis === "fixed"
      ? ""
      : rule.qty_factor === null
        ? `${BASIS_LABELS[rule.qty_basis]}（没填系数）`
        : `${BASIS_LABELS[rule.qty_basis]} ×${show(rule.qty_factor)}${
            rule.qty_extra ? ` +${show(rule.qty_extra)}` : ""
          }`;
  return [
    basis,
    rule.qty_per_set ? "每套一份" : "",
    rule.spec_by_diameter ? "规格随管径" : "",
    rule.role ? ROLE_LABELS[rule.role] : ""
  ]
    .filter(Boolean)
    .join(" · ");
};

/** 现在的数量和生成时不一样。不是生成的行（生成时的数量是空的）不算改过。 */
export const lineChanged = (line: {
  planned_qty: number;
  generated_qty: number | null;
}): boolean =>
  line.generated_qty !== null &&
  Number(line.planned_qty) !== Number(line.generated_qty);
