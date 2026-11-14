/** 配套清单（阶段 2）的类型，字段与后端 services/warehouse/kit-*.ts、project-ledger.ts 的返回一致。 */
import type { DeviceRow, MaterialKind } from "./types";

export type KitLineKind = "device" | "material" | "text";
export type KitLineSource =
  | "warehouse"
  | "site_purchase"
  | "rental"
  | "on_site";
export type ProjectKitStatus = "draft" | "submitted" | "confirmed" | "closed";

/** 模板行的数量怎么算：固定、按总长、按最长一段、按段。 */
export type KitQtyBasis =
  | "fixed"
  | "per_total_metre"
  | "per_longest_metre"
  | "per_section";
/** 生成时要特殊处理的行：主机（机头）、发电、住宿。 */
export type KitLineRole = "main_machine" | "power" | "lodging";

/** 模板行上的计算规则。 */
export interface KitLineRule {
  qty_basis: KitQtyBasis;
  /** 每米、每段多少；固定时为空 */
  qty_factor: number | null;
  /** 算完再加的固定余量 */
  qty_extra: number | null;
  /** 加完再向上取到它的倍数；固定时为空 */
  qty_round_to: number | null;
  /** 每套设备各要一份：结果再乘套数 */
  qty_per_set: boolean;
  spec_by_diameter: boolean;
  role: KitLineRole | null;
}

export interface KitTemplateRow {
  id: number;
  name: string;
  machine_type: string | null;
  /** 模板对应的管径（毫米） */
  diameter_mm: number | null;
  remark: string | null;
  status: "active" | "disabled";
  version: number;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
  line_count: number;
}

/** 模板行：读回来时带 id、sort_order、类别名；保存时只需要输入字段。 */
export interface TemplateLineInput extends KitLineRule {
  section: string;
  line_kind: KitLineKind;
  device_category_id: number | null;
  name_text: string;
  spec_text: string | null;
  unit: string | null;
  default_qty: number | null;
  note: string | null;
}
export interface KitTemplateLine extends TemplateLineInput {
  id: number;
  sort_order: number;
  device_category_name: string | null;
}
export interface KitTemplateDetail extends Omit<KitTemplateRow, "line_count"> {
  lines: KitTemplateLine[];
}

export interface ProjectKitRow {
  id: number;
  kit_no: string;
  project_id: number;
  project_name: string;
  project_manager_userid: string | null;
  title: string;
  template_id: number | null;
  template_name: string | null;
  copied_from_kit_id: number | null;
  status: ProjectKitStatus;
  remark: string | null;
  created_by_userid: string;
  submitted_by_userid: string | null;
  submitted_at: string | null;
  confirmed_by_userid: string | null;
  confirmed_at: string | null;
  closed_by_userid: string | null;
  closed_at: string | null;
  close_reason: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  line_count: number;
  /** 是不是按项目参数生成的 */
  has_plan: boolean;
}

export interface KitLineInput {
  section: string;
  line_kind: KitLineKind;
  device_category_id: number | null;
  material_id: number | null;
  name_text: string;
  spec_text: string | null;
  unit: string | null;
  planned_qty: number;
  source: KitLineSource;
  note: string | null;
}
export interface ProjectKitLine extends KitLineInput {
  id: number;
  sort_order: number;
  material_code: string | null;
  material_name: string | null;
  material_spec: string | null;
  material_unit: string | null;
  material_status: string | null;
  material_kind: MaterialKind | null;
  category_name: string | null;
  spec_choices: { id: number; spec: string }[];
}
/** 清单详情里的行：按参数生成的清单带出每行的算式和生成时的数量，别的清单这两项是空的。 */
export interface ProjectKitDetailLine extends ProjectKitLine {
  calc_text: string | null;
  generated_qty: number | null;
}
export interface ProjectKitDetail extends ProjectKitRow {
  /** 生成时确认过的参数、来源和所用的模板；不是按参数生成的清单是 null */
  plan: KitPlanView | null;
  lines: ProjectKitDetailLine[];
}

// ─── 按项目参数生成 ──────────
export type KitClientSupply = "power" | "lodging";
export interface KitPlanParams {
  machine_type: string | null;
  pipe_diameter_mm: number | null;
  total_length_m: number | null;
  /** 最长的一段：排泥管、电缆这类沿一段铺的东西按它算 */
  longest_drive_m: number | null;
  section_count: number | null;
  set_count: number;
  soil: string | null;
  client_supplies: KitClientSupply[];
}
export type KitPlanSourceFrom = "section" | "project" | "ai" | "manual";
export type KitPlanSources = Partial<
  Record<keyof KitPlanParams, { from: KitPlanSourceFrom; quote?: string }>
>;
/** 从工作段和项目档案取到的参数。 */
export interface KitPlanSource {
  params: Partial<KitPlanParams>;
  sources: KitPlanSources;
  has_text: boolean;
}
export interface KitPlanLine {
  section: string;
  sort_order: number;
  line_kind: KitLineKind;
  device_category_id: number | null;
  material_id: number | null;
  name_text: string;
  spec_text: string | null;
  unit: string | null;
  qty: number;
  source: KitLineSource;
  note: string | null;
  calc_text: string | null;
  needs_spec: boolean;
  material_label: string | null;
}
export interface KitPlanDevice {
  name_text: string;
  qty: number;
  candidates: {
    device_code: string;
    name: string;
    diameter_mm: number | null;
  }[];
}
export interface KitPlanTemplateRef {
  id: number;
  version: number;
  name: string;
  diameter_mm: number | null;
}
export interface KitPlanPreview {
  template: KitPlanTemplateRef;
  lines: KitPlanLine[];
  devices: KitPlanDevice[];
  warnings: string[];
}
export interface KitPlanView {
  v: 1;
  params: KitPlanParams;
  sources: KitPlanSources;
  template: KitPlanTemplateRef;
}

export interface KitFulfilmentLine extends ProjectKitLine {
  shipped: number;
  pending: number;
  /** 物资是在库数，设备是这个类别现在可用的台数，备忘行为 null。 */
  in_stock: number | null;
}

export interface LedgerMaterialRow {
  material_id: number;
  material_code: string;
  name: string;
  spec: string;
  unit: string;
  category: string;
  kind: MaterialKind;
  planned: number;
  shipped: number;
  transferred_out: number;
  returned: number;
  lost: number;
  on_site: number | null;
  first_out_at: string | null;
  last_back_at: string | null;
  unit_price: number | null;
  loss_amount: number | null;
}
export interface LedgerDeviceRow {
  device_category_id: number;
  category_name: string;
  planned: number;
  shipped: number;
  on_site: number;
}
export interface ProjectLedger {
  project_id: number;
  project_name: string;
  settled: boolean;
  devices_on_site: number;
  turnover_kinds_on_site: number;
  materials: LedgerMaterialRow[];
  device_categories: LedgerDeviceRow[];
  devices: DeviceRow[];
  kits: ProjectKitRow[];
}
