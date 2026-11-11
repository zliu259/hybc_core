/**
 * 设备和物资的批量导入。全有或全无：任何一行有错就一行都不导入，并列出所有出错的行。
 * 整个导入是一个批处理；同一个 client_request_id 重放时返回第一次的结果。
 */
import type { Env } from "../../types/env";
import { runAtomicBatch } from "../db-transaction";
import { generateSerials } from "../serial";
import { requireClientRequestId } from "./doc-input";
import { badRequest, WarehouseError } from "./errors";
import { assertInBatch, isGuardFailure, releaseGuards } from "./guard";
import { nextMaterialCode, parseMaterialFields } from "./material";
import { optionalNumber, optionalText, requireQuantity, requireText } from "./validation";

export interface ImportRowError {
  row: number;
  message: string;
}

export interface ImportResult {
  created: number;
  errors: ImportRowError[];
  opening_doc_no: string | null;
}

const MAX_ROWS = 200;
const nowIso = () => new Date().toISOString();

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const readRows = (input: Record<string, unknown>): Record<string, unknown>[] => {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (rows.length === 0) throw badRequest("请至少导入一行");
  if (rows.length > MAX_ROWS) throw badRequest(`一次最多导入 ${MAX_ROWS} 行`);
  return rows.map(asRecord);
};

/** 逐行解析，收集每行第一个错误。 */
const parseRows = <T>(
  rows: Record<string, unknown>[],
  parse: (row: Record<string, unknown>) => T
): { parsed: (T | null)[]; errors: ImportRowError[] } => {
  const errors: ImportRowError[] = [];
  const parsed = rows.map((row, index) => {
    try {
      return parse(row);
    } catch (error) {
      if (error instanceof WarehouseError) {
        errors.push({ row: index + 1, message: error.message });
        return null;
      }
      throw error;
    }
  });
  return { parsed, errors };
};

const inPlaceholders = (count: number): string =>
  Array.from({ length: count }, () => "?").join(", ");

// ─── 设备 ──────────

interface DeviceImportRow {
  device_code: string | null;
  name: string;
  alias: string | null;
  category_name: string;
  machine_type: string | null;
  diameter_mm: number | null;
  manufacturer: string | null;
  model: string | null;
  serial_no: string | null;
  spec: string | null;
  project_name: string | null;
  storage_note: string | null;
  remark: string | null;
}

const parseDeviceRow = (row: Record<string, unknown>): DeviceImportRow => ({
  device_code: optionalText(row.device_code, "编号", 30),
  name: requireText(row.name, "名称", 80),
  alias: optionalText(row.alias, "现场叫法", 30),
  category_name: requireText(row.category_name, "类别", 30),
  machine_type: optionalText(row.machine_type, "机型", 20),
  diameter_mm: optionalNumber(row.diameter_mm, "口径", { min: 100, max: 6000, integer: true }),
  manufacturer: optionalText(row.manufacturer, "厂家", 50),
  model: optionalText(row.model, "型号", 50),
  serial_no: optionalText(row.serial_no, "出厂编号", 50),
  spec: optionalText(row.spec, "规格", 80),
  project_name: optionalText(row.project_name, "所在项目", 80),
  storage_note: optionalText(row.storage_note, "库位", 50),
  remark: optionalText(row.remark, "备注", 300)
});

const countImported = async (env: Env, ref: string): Promise<number> => {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM device_event WHERE ref_type = ?")
    .bind(ref)
    .first<{ n: number }>();
  return Number(row?.n ?? 0);
};

export const importDevices = async (
  env: Env,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<ImportResult> => {
  const crid = requireClientRequestId(input.client_request_id);
  const ref = `import:${crid}`;
  const done = await countImported(env, ref);
  if (done > 0) return { created: done, errors: [], opening_doc_no: null };
  const rows = readRows(input);
  const { parsed, errors } = parseRows(rows, parseDeviceRow);

  const valid = parsed.filter((row): row is DeviceImportRow => row !== null);
  const projectNames = [
    ...new Set(valid.flatMap((row) => (row.project_name ? [row.project_name] : [])))
  ];
  const projects = new Map<string, number>();
  if (projectNames.length > 0) {
    const found = await env.DB.prepare(
      `SELECT id, project_name FROM project WHERE project_name IN (${inPlaceholders(projectNames.length)})`
    )
      .bind(...projectNames)
      .all<{ id: number; project_name: string }>();
    for (const project of found.results ?? [])
      projects.set(project.project_name, Number(project.id));
  }
  const codes = valid.flatMap((row) => (row.device_code ? [row.device_code.toUpperCase()] : []));
  const existing = new Set<string>();
  if (codes.length > 0) {
    const found = await env.DB.prepare(
      `SELECT UPPER(device_code) AS code FROM device WHERE UPPER(device_code) IN (${inPlaceholders(codes.length)})`
    )
      .bind(...codes)
      .all<{ code: string }>();
    for (const row of found.results ?? []) existing.add(row.code);
  }
  const categories = await env.DB.prepare("SELECT name, status FROM device_category").all<{
    name: string;
    status: string;
  }>();
  const categoryStatus = new Map((categories.results ?? []).map((row) => [row.name, row.status]));

  const seen = new Set<string>();
  parsed.forEach((row, index) => {
    if (!row) return;
    const fail = (message: string) => errors.push({ row: index + 1, message });
    if (row.device_code) {
      const key = row.device_code.toUpperCase();
      if (seen.has(key) || existing.has(key)) return fail(`设备编号重复：${row.device_code}`);
      seen.add(key);
    }
    if (row.project_name && !projects.has(row.project_name))
      return fail(`找不到项目：${row.project_name}`);
    if (categoryStatus.get(row.category_name) === "disabled")
      return fail(`设备类别已停用：${row.category_name}`);
  });
  if (errors.length > 0) {
    return { created: 0, errors: errors.sort((a, b) => a.row - b.row), opening_doc_no: null };
  }

  const maxRow = await env.DB.prepare(
    "SELECT MAX(CAST(SUBSTR(device_code, 4) AS INTEGER)) AS n FROM device WHERE device_code GLOB 'SB-[0-9]*'"
  ).first<{ n: number | null }>();
  const fileMax = Math.max(
    0,
    ...valid.map((row) => Number(/^SB-(\d+)$/i.exec(row.device_code ?? "")?.[1] ?? 0))
  );
  let nextNumber = Math.max(Number(maxRow?.n ?? 0), fileMax) + 1;
  const now = nowIso();
  const statements: D1PreparedStatement[] = [
    assertInBatch(
      env.DB,
      "SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM device_event WHERE ref_type = ?)",
      [ref]
    )
  ];
  for (const name of new Set(valid.map((row) => row.category_name))) {
    if (categoryStatus.has(name)) continue;
    statements.push(
      env.DB.prepare(
        "INSERT INTO device_category (name, sort_order, status, created_at, updated_at) VALUES (?, 0, 'active', ?, ?) ON CONFLICT(name) DO NOTHING"
      ).bind(name, now, now)
    );
  }
  for (const row of valid) {
    const code = row.device_code ?? `SB-${String(nextNumber++).padStart(4, "0")}`;
    const projectId = row.project_name ? (projects.get(row.project_name) ?? null) : null;
    statements.push(
      env.DB.prepare(
        `INSERT INTO device
          (device_code, name, alias, category_id, machine_type, diameter_mm, manufacturer, model, serial_no, spec,
           location, current_project_id, storage_note, remark, created_by_userid, created_at, updated_at)
         VALUES (?, ?, ?, (SELECT id FROM device_category WHERE name = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        code,
        row.name,
        row.alias,
        row.category_name,
        row.machine_type,
        row.diameter_mm,
        row.manufacturer,
        row.model,
        row.serial_no,
        row.spec,
        projectId === null ? "warehouse" : "project",
        projectId,
        row.storage_note,
        row.remark,
        operatorUserid,
        now,
        now
      ),
      env.DB.prepare(
        `INSERT INTO device_event (device_id, event_type, ref_type, summary, operator_userid, occurred_at, created_at)
         VALUES ((SELECT id FROM device WHERE device_code = ?), 'created', ?, '导入建档', ?, ?, ?)`
      ).bind(code, ref, operatorUserid, now, now)
    );
  }
  statements.push(releaseGuards(env.DB));
  try {
    await runAtomicBatch(env.DB, statements);
  } catch (error) {
    if (isGuardFailure(error))
      return { created: await countImported(env, ref), errors: [], opening_doc_no: null };
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed: device.device_code")
    ) {
      throw new WarehouseError(409, "设备编号已存在，请刷新后重试");
    }
    throw error;
  }
  return { created: valid.length, errors: [], opening_doc_no: null };
};

// ─── 物资 ──────────

const parseMaterialRow = (row: Record<string, unknown>) => {
  const columns = parseMaterialFields(
    {
      name: row.name,
      spec: row.spec,
      unit: row.unit,
      category: row.category,
      kind: row.kind,
      unit_price: row.unit_price,
      min_stock: row.min_stock,
      storage_note: row.storage_note,
      remark: row.remark
    },
    "create"
  );
  const blank =
    row.opening_quantity === undefined ||
    row.opening_quantity === null ||
    String(row.opening_quantity).trim() === "";
  return { columns, opening: blank ? null : requireQuantity(row.opening_quantity, "期初数量") };
};

const nameSpecKey = (name: unknown, spec: unknown): string =>
  `${String(name)}\u0000${String(spec ?? "")}`;

export const importMaterials = async (
  env: Env,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<ImportResult> => {
  const crid = requireClientRequestId(input.client_request_id);
  const replay = await env.DB.prepare("SELECT doc_no FROM wh_doc WHERE client_request_id = ?")
    .bind(crid)
    .first<{ doc_no: string }>();
  const rows = readRows(input);
  if (replay) return { created: rows.length, errors: [], opening_doc_no: replay.doc_no };
  const { parsed, errors } = parseRows(rows, parseMaterialRow);

  const names = [...new Set(parsed.flatMap((row) => (row ? [String(row.columns.name)] : [])))];
  const existing = new Set<string>();
  if (names.length > 0) {
    const found = await env.DB.prepare(
      `SELECT name, spec FROM material WHERE name IN (${inPlaceholders(names.length)})`
    )
      .bind(...names)
      .all<{ name: string; spec: string }>();
    for (const row of found.results ?? []) existing.add(nameSpecKey(row.name, row.spec));
  }
  const seen = new Set<string>();
  parsed.forEach((row, index) => {
    if (!row) return;
    const key = nameSpecKey(row.columns.name, row.columns.spec);
    if (seen.has(key) || existing.has(key)) {
      const label = row.columns.spec
        ? `${row.columns.name} ${row.columns.spec}`
        : String(row.columns.name);
      errors.push({ row: index + 1, message: `品名和规格重复：${label}` });
    }
    seen.add(key);
  });
  if (errors.length > 0) {
    return { created: 0, errors: errors.sort((a, b) => a.row - b.row), opening_doc_no: null };
  }

  const valid = parsed.filter((row): row is ReturnType<typeof parseMaterialRow> => row !== null);
  const firstCode = Number((await nextMaterialCode(env)).slice(3));
  const [docNo] = await generateSerials(env.DB, "KFD", "wh_doc", "doc_no", 1);
  const now = nowIso();
  const openings = valid
    .map((row, index) => ({
      code: `WZ-${String(firstCode + index).padStart(4, "0")}`,
      quantity: row.opening
    }))
    .filter((row): row is { code: string; quantity: number } => row.quantity !== null);

  const statements: D1PreparedStatement[] = valid.map((row, index) => {
    const values = {
      ...row.columns,
      material_code: `WZ-${String(firstCode + index).padStart(4, "0")}`,
      quantity: 0,
      status: "active",
      created_at: now,
      updated_at: now
    };
    const keys = Object.keys(values) as (keyof typeof values)[];
    return env.DB.prepare(
      `INSERT INTO material (${keys.join(", ")}) VALUES (${inPlaceholders(keys.length)})`
    ).bind(...keys.map((key) => values[key] ?? null));
  });
  if (openings.length > 0) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO wh_doc (doc_no, doc_type, remark, operator_userid, occurred_at, client_request_id, created_at)
         VALUES (?, 'opening', '导入期初数量', ?, ?, ?, ?)`
      ).bind(docNo, operatorUserid, now, crid, now)
    );
    for (const opening of openings) {
      statements.push(
        env.DB.prepare(
          "UPDATE material SET quantity = ROUND(quantity + ?, 3), updated_at = ? WHERE material_code = ?"
        ).bind(opening.quantity, now, opening.code),
        env.DB.prepare(
          `INSERT INTO wh_doc_line (doc_id, material_id, quantity, outcome, stock_delta, balance_after, project_delta, created_at)
           VALUES ((SELECT id FROM wh_doc WHERE client_request_id = ?), (SELECT id FROM material WHERE material_code = ?), ?, 'normal', ?,
                   (SELECT quantity FROM material WHERE material_code = ?), 0, ?)`
        ).bind(crid, opening.code, opening.quantity, opening.quantity, opening.code, now)
      );
    }
  }
  try {
    await runAtomicBatch(env.DB, statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE constraint failed: wh_doc.client_request_id")) {
      return { created: valid.length, errors: [], opening_doc_no: docNo };
    }
    if (message.includes("UNIQUE constraint failed: material")) {
      throw new WarehouseError(409, "物资已被别人先导入或编号冲突，请刷新后重试");
    }
    throw error;
  }
  return { created: valid.length, errors: [], opening_doc_no: openings.length > 0 ? docNo : null };
};
