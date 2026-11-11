/** 库房单录入表单的状态、前端校验和请求体。后端还会再校验一遍，这里只为让人当场看到错在哪。 */
import type { KitFulfilmentLine } from "@/api/wh/kit-types";
import type {
  CreateWhDocInput,
  MaterialKind,
  ProjectHoldings
} from "@/api/wh/types";
import { newClientRequestId } from "../shared/ids";

export type DocFormType = "inbound" | "out" | "back" | "transfer";

export interface DocDeviceLine {
  device_id: number;
  device_code: string;
  name: string;
  /** 按清单发货时用来数某类设备已加了几台 */
  category_id?: number;
  usage_meters: string;
  soil_type: string;
}

export interface DocMaterialLine {
  material_id: number;
  name: string;
  spec: string;
  unit: string;
  kind: MaterialKind;
  /** 发货时是在库数，返库和转场时是在场数；返库另加的耗材行没有上限，为 null。 */
  available: number | null;
  returned: string;
  lost: string;
  quantity: string;
}

export interface DocFormState {
  doc_type: DocFormType;
  client_request_id: string;
  project_id: number | null;
  to_project_id: number | null;
  /** 按配套清单发货时的清单（只有发往项目） */
  project_kit_id: number | null;
  counterparty: string;
  handover_name: string;
  remark: string;
  photo_keys: string[];
  devices: DocDeviceLine[];
  materials: DocMaterialLine[];
}

export const newDocForm = (docType: DocFormType): DocFormState => ({
  doc_type: docType,
  client_request_id: newClientRequestId(),
  project_id: null,
  to_project_id: null,
  project_kit_id: null,
  counterparty: "",
  handover_name: "",
  remark: "",
  photo_keys: [],
  devices: [],
  materials: []
});

const QUANTITY = /^\d+(\.\d{1,3})?$/;
const parseAmount = (text: string): number | null => {
  const trimmed = text.trim();
  if (!QUANTITY.test(trimmed)) return null;
  return Number(trimmed);
};
const parseOptional = (text: string): number | null =>
  text.trim() === "" ? 0 : parseAmount(text);

export const validateDocForm = (state: DocFormState): string | null => {
  const type = state.doc_type;
  if (type !== "inbound" && state.project_id === null) return "请选择项目";
  if (type === "transfer") {
    if (state.to_project_id === null) return "请选择目的项目";
    if (state.to_project_id === state.project_id)
      return "来源和目的项目不能相同";
  }
  if (type === "inbound" && state.devices.length > 0)
    return "入库单不能包含设备";
  // 顶进距离只在返库时填；填了就得是能入账的数字，否则提交时会被悄悄丢掉
  const MAX_USAGE_METERS = 100000;
  for (const device of type === "back" ? state.devices : []) {
    if (!device.usage_meters.trim()) continue;
    const meters = parseAmount(device.usage_meters);
    if (meters === null || meters > MAX_USAGE_METERS)
      return `${device.device_code} 的顶进距离不对，只填数字（米）`;
  }

  let materialRows = 0;
  for (const line of state.materials) {
    if (type === "back") {
      const returned = parseOptional(line.returned);
      const lost = parseOptional(line.lost);
      if (returned === null || lost === null) return `${line.name} 的数量不对`;
      if (line.kind === "consumable" && lost > 0)
        return `耗材不需要报损：${line.name}`;
      if (line.available !== null && returned + lost > line.available + 1e-9)
        return `${line.name} 在场只有 ${line.available}`;
      if (returned + lost > 0) materialRows += 1;
      continue;
    }
    const quantity = parseAmount(line.quantity);
    if (quantity === null || quantity <= 0) return `${line.name} 的数量不对`;
    if (line.available !== null && quantity > line.available + 1e-9) {
      return type === "out"
        ? `${line.name} 在库只有 ${line.available}`
        : `${line.name} 在场只有 ${line.available}`;
    }
    materialRows += 1;
  }
  if (state.devices.length + materialRows === 0) return "请至少添加一行";
  return null;
};

export const buildDocPayload = (state: DocFormState): CreateWhDocInput => {
  const payload: CreateWhDocInput = {
    doc_type: state.doc_type,
    client_request_id: state.client_request_id
  };
  if (state.project_id !== null && state.doc_type !== "inbound")
    payload.project_id = state.project_id;
  if (state.doc_type === "transfer" && state.to_project_id !== null)
    payload.to_project_id = state.to_project_id;
  if (state.doc_type === "out" && state.project_kit_id !== null)
    payload.project_kit_id = state.project_kit_id;
  if (state.counterparty.trim())
    payload.counterparty = state.counterparty.trim();
  if (state.handover_name.trim())
    payload.handover_name = state.handover_name.trim();
  if (state.remark.trim()) payload.remark = state.remark.trim();
  if (state.photo_keys.length > 0) payload.photo_keys = state.photo_keys;
  if (state.devices.length > 0) {
    payload.device_lines = state.devices.map(line => {
      const device: NonNullable<CreateWhDocInput["device_lines"]>[number] = {
        device_id: line.device_id
      };
      if (state.doc_type === "back") {
        const meters = parseAmount(line.usage_meters);
        if (meters !== null) device.usage_meters = meters;
        if (line.soil_type.trim()) device.soil_type = line.soil_type.trim();
      }
      return device;
    });
  }
  const lines: NonNullable<CreateWhDocInput["material_lines"]> = [];
  for (const line of state.materials) {
    if (state.doc_type === "back") {
      const returned = parseOptional(line.returned) ?? 0;
      const lost = parseOptional(line.lost) ?? 0;
      if (returned > 0)
        lines.push({
          material_id: line.material_id,
          quantity: returned,
          outcome: "returned"
        });
      if (lost > 0)
        lines.push({
          material_id: line.material_id,
          quantity: lost,
          outcome: "lost"
        });
    } else {
      lines.push({
        material_id: line.material_id,
        quantity: parseAmount(line.quantity) ?? 0
      });
    }
  }
  if (lines.length > 0) payload.material_lines = lines;
  return payload;
};

/** 返库和转场用项目在场清单预填：设备全部带出，周转件带出在场数。返库默认全部退回，有丢失损坏的再改。 */
export const prefillBackForm = (
  state: DocFormState,
  holdings: ProjectHoldings
): DocFormState => ({
  ...state,
  devices: holdings.devices.map(device => ({
    device_id: device.id,
    device_code: device.device_code,
    name: device.name,
    usage_meters: "",
    soil_type: ""
  })),
  materials: holdings.materials.map(item => ({
    material_id: item.material_id,
    name: item.name,
    spec: item.spec,
    unit: item.unit,
    kind: "turnover",
    available: item.holding,
    returned: state.doc_type === "back" ? String(item.holding) : "",
    lost: "",
    quantity: state.doc_type === "transfer" ? String(item.holding) : ""
  }))
});

export interface DeviceNeed {
  category_id: number;
  category_name: string;
  /** 清单上写的规格要求，几行时用顿号连起来 */
  spec_text: string;
  count: number;
  /** 这个类别现在可用的台数 */
  available: number;
}

/**
 * 按清单发货：项目固定为清单的项目；只取"库房发"、待发大于 0 的行。
 * 物资行数量默认待发（同一物资几行合并成一行，后端不许一张单里重复）；
 * 设备行不预填具体设备，只按类别给出还需几台，由库管扫码或挑选。
 */
export const prefillOutFromKit = (
  kit: { id: number; project_id: number },
  fulfilment: readonly KitFulfilmentLine[],
  base: DocFormState = newDocForm("out")
): { form: DocFormState; deviceNeeds: DeviceNeed[] } => {
  const pending = fulfilment.filter(
    line => line.source === "warehouse" && line.pending > 0
  );
  const materials = new Map<number, DocMaterialLine>();
  for (const line of pending) {
    if (line.line_kind !== "material" || !line.material_id) continue;
    const existing = materials.get(line.material_id);
    const quantity =
      Math.round(
        ((existing ? Number(existing.quantity) : 0) + line.pending) * 1000
      ) / 1000;
    materials.set(line.material_id, {
      material_id: line.material_id,
      name: line.material_name ?? line.name_text,
      spec: line.material_spec ?? "",
      unit: line.material_unit ?? line.unit ?? "",
      kind: line.material_kind ?? "turnover",
      available: line.in_stock,
      returned: "",
      lost: "",
      quantity: String(quantity)
    });
  }
  const needs = new Map<number, DeviceNeed>();
  for (const line of pending) {
    if (line.line_kind !== "device" || !line.device_category_id) continue;
    const existing = needs.get(line.device_category_id);
    const specs = [existing?.spec_text, line.spec_text]
      .filter(Boolean)
      .join("、");
    needs.set(line.device_category_id, {
      category_id: line.device_category_id,
      category_name: line.category_name ?? "",
      spec_text: specs,
      count: (existing?.count ?? 0) + line.pending,
      available: line.in_stock ?? 0
    });
  }
  return {
    form: {
      ...base,
      doc_type: "out",
      project_id: kit.project_id,
      project_kit_id: kit.id,
      devices: [],
      materials: [...materials.values()]
    },
    deviceNeeds: [...needs.values()]
  };
};
