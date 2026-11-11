/** 项目配套页面用的纯函数：状态文案、按钮、提交前检查、模板粘贴导入。 */
import type {
  KitLineInput,
  KitLineKind,
  KitLineSource,
  KitTemplateLine,
  ProjectKitLine,
  ProjectKitRow,
  ProjectKitStatus,
  TemplateLineInput
} from "@/api/wh/kit-types";
import type { ImportRowError, WarehouseCapabilities } from "@/api/wh/types";
import type { ParsedTable } from "../shared/csv";

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

const KIND_BY_LABEL: Record<string, KitLineKind> = {
  设备: "device",
  按台: "device",
  物资: "material",
  周转: "material",
  消耗: "material",
  备忘: "text"
};

const optional = (text: string): string | null =>
  text.trim() === "" ? null : text.trim();

/**
 * 粘贴的模板表格 → 模板行。列名：分节、类型、品名、规格、单位、默认数量、设备类别、备注。
 * 类型认 设备/按台、物资/周转/消耗、备忘；设备类别按名字找。
 */
export const mapTemplateRows = (
  table: ParsedTable,
  categories: readonly { id: number; name: string }[]
): { rows: TemplateLineInput[]; errors: ImportRowError[] } => {
  const missing = ["分节", "类型", "品名"].filter(
    column => !table.headers.includes(column)
  );
  if (missing.length)
    return {
      rows: [],
      errors: [{ row: 0, message: `缺少列：${missing.join("、")}` }]
    };
  const categoryByName = new Map(
    categories.map(category => [category.name, category.id])
  );
  const rows: TemplateLineInput[] = [];
  const errors: ImportRowError[] = [];
  table.rows.forEach((row, index) => {
    const cell = (column: string) => (row[column] ?? "").trim();
    const fail = (message: string) => errors.push({ row: index + 1, message });
    const lineKind = KIND_BY_LABEL[cell("类型")];
    if (!lineKind)
      return fail(`类型只能填 设备、物资 或 备忘：${cell("类型")}`);
    let categoryId: number | null = null;
    if (lineKind === "device") {
      if (!cell("设备类别")) return fail("设备行要填设备类别");
      categoryId = categoryByName.get(cell("设备类别")) ?? null;
      if (categoryId === null)
        return fail(
          `设备类别不存在：${cell("设备类别")}，请先在库房设置里添加`
        );
    }
    const qtyText = cell("默认数量");
    const qty = qtyText === "" ? null : Number(qtyText);
    if (qty !== null && (!Number.isFinite(qty) || qty < 0))
      return fail(`默认数量不是数字：${qtyText}`);
    if (lineKind === "device" && qty !== null && !Number.isInteger(qty))
      return fail("设备数量必须是整数");
    rows.push({
      section: cell("分节"),
      line_kind: lineKind,
      device_category_id: categoryId,
      name_text: cell("品名"),
      spec_text: optional(cell("规格")),
      unit: optional(cell("单位")),
      default_qty: qty,
      note: optional(cell("备注"))
    });
  });
  return { rows, errors };
};

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
  material_label: ""
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
    note: line.note ?? ""
  }));

export const editableFromKit = (
  lines: readonly ProjectKitLine[]
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
      : ""
  }));

const nullable = (text: string): string | null =>
  text.trim() === "" ? null : text.trim();

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
    note: nullable(row.note)
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
