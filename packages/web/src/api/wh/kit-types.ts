/** 配套清单（阶段 2）的类型，字段与后端 services/warehouse/kit-*.ts、project-ledger.ts 的返回一致。 */
import type { DeviceRow, MaterialKind } from "./types";

export type KitLineKind = "device" | "material" | "text";
export type KitLineSource =
  | "warehouse"
  | "site_purchase"
  | "rental"
  | "on_site";
export type ProjectKitStatus = "draft" | "submitted" | "confirmed" | "closed";

export interface KitTemplateRow {
  id: number;
  name: string;
  machine_type: string | null;
  remark: string | null;
  status: "active" | "disabled";
  version: number;
  created_by_userid: string;
  created_at: string;
  updated_at: string;
  line_count: number;
}

/** 模板行：读回来时带 id、sort_order、类别名；保存时只需要输入字段。 */
export interface TemplateLineInput {
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
  category_name: string | null;
  spec_choices: { id: number; spec: string }[];
}
export interface ProjectKitDetail extends ProjectKitRow {
  lines: ProjectKitLine[];
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
