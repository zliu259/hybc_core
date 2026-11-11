/** 库房单请求体的通用校验。类型相关的规则在各自的 plan 里。 */
import type { Env } from "../../types/env";
import type { Material, WhDocType } from "../../types/wh";
import { badRequest } from "./errors";
import {
  optionalNumber,
  optionalText,
  requireEnum,
  requireId,
  requireQuantity
} from "./validation";
import { queryIn } from "./query-in";

export const DOC_TYPES: readonly WhDocType[] = [
  "opening",
  "inbound",
  "out",
  "back",
  "transfer",
  "adjust",
  "scrap",
  "unscrap"
];
const MAX_LINES = 200;
const MAX_PHOTOS = 9;

export interface DeviceLineInput {
  device_id: number;
  usage_meters: number | null;
  soil_type: string | null;
  note: string | null;
}

export interface MaterialLineInput {
  material_id: number;
  quantity: number;
  outcome: "returned" | "lost" | null;
  note: string | null;
}

export interface ParsedDoc {
  doc_type: WhDocType;
  client_request_id: string;
  project_id: number | null;
  to_project_id: number | null;
  counterparty: string | null;
  handover_name: string | null;
  remark: string | null;
  photo_keys_json: string | null;
  occurred_at: string;
  device_lines: DeviceLineInput[];
  material_lines: MaterialLineInput[];
}

export const requireClientRequestId = (value: unknown): string => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < 8 || text.length > 64)
    throw badRequest("client_request_id 格式不对，请刷新页面后重试");
  return text;
};

export const parsePhotoKeys = (value: unknown, prefix: string, label: string): string | null => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_PHOTOS)
    throw badRequest(`${label}最多 ${MAX_PHOTOS} 张`);
  const keys = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (keys.some((key) => !key.startsWith(prefix) || key.length > 300))
    throw badRequest(`${label}不对，请重新上传`);
  return keys.length ? JSON.stringify(keys) : null;
};

const parseOccurredAt = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return new Date().toISOString();
  const date = typeof value === "string" ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) throw badRequest("发生时间格式不对");
  return date.toISOString();
};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const parseDocInput = (input: Record<string, unknown>, docType: WhDocType): ParsedDoc => {
  const clientRequestId = requireClientRequestId(input.client_request_id);
  const deviceLines = asArray(input.device_lines).map((raw) => {
    const line = asRecord(raw);
    return {
      device_id: requireId(line.device_id, "设备"),
      usage_meters: optionalNumber(line.usage_meters, "顶进距离", { min: 0, max: 100000 }),
      soil_type: optionalText(line.soil_type, "土质", 50),
      note: optionalText(line.note, "备注", 100)
    };
  });
  const materialLines = asArray(input.material_lines).map((raw) => {
    const line = asRecord(raw);
    return {
      material_id: requireId(line.material_id, "物资"),
      quantity: requireQuantity(line.quantity, "数量"),
      outcome:
        line.outcome === undefined || line.outcome === null
          ? null
          : requireEnum(line.outcome, "退回或报损", ["returned", "lost"] as const),
      note: optionalText(line.note, "备注", 100)
    };
  });
  const total = deviceLines.length + materialLines.length;
  if (total === 0) throw badRequest("请至少添加一行");
  if (total > MAX_LINES) throw badRequest(`一张单最多 ${MAX_LINES} 行`);
  const deviceIds = new Set(deviceLines.map((line) => line.device_id));
  if (deviceIds.size !== deviceLines.length) throw badRequest("同一设备在一张单里只能出现一次");
  const materialKeys = new Set(
    materialLines.map((line) => `${line.material_id}:${line.outcome ?? ""}`)
  );
  if (materialKeys.size !== materialLines.length)
    throw badRequest("同一物资在一张单里只能出现一次");

  return {
    doc_type: docType,
    client_request_id: clientRequestId,
    project_id: null,
    to_project_id: null,
    counterparty: optionalText(input.counterparty, "供应商", 80),
    handover_name: optionalText(input.handover_name, "领料人", 30),
    remark: optionalText(input.remark, "备注", 300),
    photo_keys_json: parsePhotoKeys(input.photo_keys, "wh-doc/", "单据照片"),
    occurred_at: parseOccurredAt(input.occurred_at),
    device_lines: deviceLines,
    material_lines: materialLines
  };
};

export const materialLabel = (material: Pick<Material, "name" | "spec">): string =>
  material.spec ? `${material.name} ${material.spec}` : material.name;

/** 取单据里用到的物资；不存在或已停用直接 400。 */
export const loadActiveMaterials = async (
  env: Env,
  lines: readonly MaterialLineInput[]
): Promise<Map<number, Material>> => {
  const ids = [...new Set(lines.map((line) => line.material_id))];
  if (ids.length === 0) return new Map();
  const rows = await queryIn<Material>(
    env.DB,
    (inList) => `SELECT * FROM material WHERE id IN (${inList})`,
    ids
  );
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  for (const id of ids) {
    const material = byId.get(id);
    if (!material) throw badRequest("物资不存在");
    if (material.status !== "active") throw badRequest(`物资已停用：${materialLabel(material)}`);
  }
  return byId;
};

export const requireProjectId = async (
  env: Env,
  value: unknown,
  label = "项目"
): Promise<number> => {
  const id = requireId(value, label);
  const row = await env.DB.prepare("SELECT id FROM project WHERE id = ?").bind(id).first();
  if (!row) throw badRequest(`${label}不存在`);
  return id;
};
