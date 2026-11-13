/** 项目配套页面用的纯函数：状态文案、按钮、提交前检查、表格行和接口行互转。 */
import type {
  KitLineInput,
  KitLineKind,
  KitLineRule,
  KitLineSource,
  KitTemplateLine,
  ProjectKitLine,
  ProjectKitRow,
  ProjectKitStatus,
  TemplateLineInput
} from "@/api/wh/kit-types";
import type { WarehouseCapabilities } from "@/api/wh/types";
import { emptyRule } from "./kit-plan-view";

export const KIT_STATUS_LABELS: Record<ProjectKitStatus, string> = {
  draft: "草稿",
  submitted: "待确认",
  confirmed: "已确认",
  closed: "已关闭"
};

export const KIT_STATUS_TAG: Record<
  ProjectKitStatus,
  "info" | "warning" | "success"
> = {
  draft: "info",
  submitted: "warning",
  confirmed: "success",
  closed: "info"
};

export const KIT_SOURCE_LABELS: Record<KitLineSource, string> = {
  warehouse: "库房发",
  site_purchase: "现场采购",
  rental: "租赁",
  on_site: "现场已有"
};

export const KIT_LINE_KIND_LABELS: Record<KitLineKind, string> = {
  device: "设备",
  material: "物资",
  text: "备忘"
};

export interface KitViewer {
  userid: string;
  roles: readonly string[];
  caps: WarehouseCapabilities | null;
}

export interface KitActions {
  canEdit: boolean;
  canSubmit: boolean;
  canConfirm: boolean;
  canDiscard: boolean;
  canClose: boolean;
  canShip: boolean;
}

/** 和后端 assertCanEditKitFor 同样的规则：库管、经理任何项目；现场负责人只限自己负责的项目。 */
const canEditProject = (
  kit: Pick<ProjectKitRow, "project_manager_userid">,
  viewer: KitViewer
): boolean => {
  const caps = viewer.caps;
  if (!caps) return false;
  if (caps.is_keeper || viewer.roles.includes("manager")) return true;
  return (
    caps.can_create_kit &&
    viewer.roles.includes("site_manager") &&
    kit.project_manager_userid !== null &&
    kit.project_manager_userid === viewer.userid
  );
};

export const kitActions = (
  kit: Pick<ProjectKitRow, "status" | "project_manager_userid">,
  viewer: KitViewer
): KitActions => {
  const editor = canEditProject(kit, viewer);
  const keeper = Boolean(viewer.caps?.is_keeper);
  const open = kit.status === "draft" || kit.status === "submitted";
  return {
    canEdit: open && editor,
    canSubmit: kit.status === "draft" && editor,
    canConfirm: kit.status === "submitted" && keeper,
    canDiscard: open && editor,
    canClose: kit.status === "confirmed" && keeper,
    canShip: kit.status === "confirmed" && keeper
  };
};

export interface KitLineCheck {
  line_kind: KitLineKind;
  material_id: number | null;
  name_text: string;
  planned_qty: number;
}

/** 提交前在表格里标红的行。和后端 assertKitReady 同样的规则，再多查几个空值。 */
export const kitLineProblems = (
  lines: readonly KitLineCheck[]
): { index: number; message: string }[] =>
  lines.flatMap((line, index) => {
    const planned = Number(line.planned_qty);
    if (!line.name_text.trim()) return [{ index, message: "品名不能为空" }];
    if (!Number.isFinite(planned) || planned < 0)
      return [{ index, message: "数量不对" }];
    if (line.line_kind === "device" && !Number.isInteger(planned))
      return [{ index, message: "设备数量必须是整数" }];
    if (line.line_kind === "material" && planned > 0 && !line.material_id)
      return [{ index, message: `${line.name_text} 还没选规格` }];
    return [];
  });

/** 表格里正在编辑的一行；模板和清单共用，qty 在模板里是默认数量，在清单里是计划数。 */
export interface EditableKitLine {
  key: string;
  id: number | null;
  section: string;
  line_kind: KitLineKind;
  device_category_id: number | null;
  material_id: number | null;
  name_text: string;
  spec_text: string;
  unit: string;
  qty: number | null;
  source: KitLineSource;
  note: string;
  /** 同品名的可选规格（清单的物资行） */
  spec_choices: { id: number; spec: string }[];
  /** 已选物资的"品名 规格" */
  material_label: string;
  /** 模板行上的计算规则；清单行用不到，恒为默认值 */
  rule: KitLineRule;
  /** 按参数生成的清单：这一行是怎么算的。只用来显示，保存时不带 */
  calc_text: string | null;
  /** 按参数生成的清单：生成时的数量。只用来显示，保存时不带 */
  generated_qty: number | null;
}

let keySeq = 0;
const nextKey = (): string => {
  keySeq += 1;
  return `row-${keySeq}`;
};

export const newEditableLine = (section = ""): EditableKitLine => ({
  key: nextKey(),
  id: null,
  section,
  line_kind: "material",
  device_category_id: null,
  material_id: null,
  name_text: "",
  spec_text: "",
  unit: "",
  qty: null,
  source: "warehouse",
  note: "",
  spec_choices: [],
  material_label: "",
  rule: emptyRule(),
  calc_text: null,
  generated_qty: null
});

export const editableFromTemplate = (
  lines: readonly KitTemplateLine[]
): EditableKitLine[] =>
  lines.map(line => ({
    ...newEditableLine(line.section),
    id: line.id,
    line_kind: line.line_kind,
    device_category_id: line.device_category_id,
    name_text: line.name_text,
    spec_text: line.spec_text ?? "",
    unit: line.unit ?? "",
    qty: line.default_qty,
    note: line.note ?? "",
    rule: {
      qty_basis: line.qty_basis,
      qty_factor: line.qty_factor,
      qty_extra: line.qty_extra,
      qty_per_set: Boolean(line.qty_per_set),
      spec_by_diameter: Boolean(line.spec_by_diameter),
      role: line.role
    }
  }));

export const editableFromKit = (
  lines: readonly (ProjectKitLine & {
    calc_text?: string | null;
    generated_qty?: number | null;
  })[]
): EditableKitLine[] =>
  lines.map(line => ({
    ...newEditableLine(line.section),
    id: line.id,
    line_kind: line.line_kind,
    device_category_id: line.device_category_id,
    material_id: line.material_id,
    name_text: line.name_text,
    spec_text: line.spec_text ?? "",
    unit: line.unit ?? "",
    qty: Number(line.planned_qty),
    source: line.source,
    note: line.note ?? "",
    spec_choices: line.spec_choices ?? [],
    material_label: line.material_id
      ? [line.material_name ?? line.name_text, line.material_spec]
          .filter(Boolean)
          .join(" ")
      : "",
    calc_text: line.calc_text ?? null,
    generated_qty:
      line.generated_qty === null || line.generated_qty === undefined
        ? null
        : Number(line.generated_qty)
  }));

const nullable = (text: string): string | null =>
  text.trim() === "" ? null : text.trim();

/** 保存时的规则：备忘行不存规则，固定的行不存系数和另加（和服务端一致）。 */
const ruleToSave = (row: EditableKitLine): KitLineRule => {
  if (row.line_kind === "text") return emptyRule();
  const fixed = row.rule.qty_basis === "fixed";
  return {
    ...row.rule,
    qty_factor: fixed ? null : row.rule.qty_factor,
    qty_extra: fixed ? null : row.rule.qty_extra
  };
};

export const toTemplateLines = (
  rows: readonly EditableKitLine[]
): TemplateLineInput[] =>
  rows.map(row => ({
    section: row.section.trim(),
    line_kind: row.line_kind,
    device_category_id:
      row.line_kind === "device" ? row.device_category_id : null,
    name_text: row.name_text.trim(),
    spec_text: nullable(row.spec_text),
    unit: nullable(row.unit),
    default_qty: row.qty,
    note: nullable(row.note),
    ...ruleToSave(row)
  }));

export const toKitLines = (rows: readonly EditableKitLine[]): KitLineInput[] =>
  rows.map(row => ({
    section: row.section.trim(),
    line_kind: row.line_kind,
    device_category_id:
      row.line_kind === "device" ? row.device_category_id : null,
    material_id: row.line_kind === "material" ? row.material_id : null,
    name_text: row.name_text.trim(),
    spec_text: nullable(row.spec_text),
    unit: nullable(row.unit),
    planned_qty: row.qty ?? 0,
    source: row.source,
    note: nullable(row.note)
  }));

/**
 * 表格能改时先保存，保存成功再做下一步（提交、确认）；保存失败就停下。
 * 这样库管在待确认的清单上改了数量再点确认，改动不会被丢掉。
 */
export const saveThen = async <T>(
  editable: boolean,
  save: () => Promise<boolean>,
  next: () => Promise<T>
): Promise<T | undefined> => {
  if (editable && !(await save())) return undefined;
  return next();
};
