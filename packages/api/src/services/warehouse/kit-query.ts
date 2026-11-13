/**
 * 项目配套清单的读：列表、详情（行带物资和类别的名字，物资行带同品名的可选规格）。
 */
import type { Env } from "../../types/env";
import type { MaterialKind, ProjectKit, ProjectKitLine, ProjectKitStatus } from "../../types/wh";
import type { Paged } from "./device";
import { matchGenerated, readPlanRecord, type KitPlanView } from "./kit-plan-match";
import { queryIn } from "./query-in";
import { requireEnum, requireId } from "./validation";

/** 列表和详情头：不带生成参数那一大段，只说有没有。 */
export interface ProjectKitRow extends Omit<ProjectKit, "plan_json"> {
  /** 是不是按项目参数生成的 */
  has_plan: boolean;
  project_name: string;
  /** 前端判断现场负责人能不能改这份清单。 */
  project_manager_userid: string | null;
  template_name: string | null;
  line_count: number;
}

export interface ProjectKitLineView extends ProjectKitLine {
  material_code: string | null;
  material_name: string | null;
  material_spec: string | null;
  material_unit: string | null;
  material_status: string | null;
  material_kind: MaterialKind | null;
  category_name: string | null;
  /** 同品名的在用物资，物资行"待选规格"时给前端下拉用。 */
  spec_choices: { id: number; spec: string }[];
}

export const KIT_STATUSES: readonly ProjectKitStatus[] = [
  "draft",
  "submitted",
  "confirmed",
  "closed"
];

const SELECT_KIT = `SELECT k.*, p.project_name, p.manager_userid AS project_manager_userid,
         t.name AS template_name,
         (SELECT COUNT(*) FROM project_kit_line l WHERE l.kit_id = k.id) AS line_count
    FROM project_kit k
    JOIN project p ON p.id = k.project_id
    LEFT JOIN kit_template t ON t.id = k.template_id`;

type StoredKitRow = Omit<ProjectKitRow, "has_plan"> & { plan_json: string | null };

const toRow = ({ plan_json: planJson, ...row }: StoredKitRow): ProjectKitRow => ({
  ...row,
  line_count: Number(row.line_count),
  has_plan: planJson !== null
});

/** 清单的行，带上生成时的数量和算式（不是按参数生成的清单这两项是空的）。 */
export type ProjectKitLineWithPlan = ProjectKitLineView & {
  calc_text: string | null;
  generated_qty: number | null;
};

const positiveInt = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
};

export const listProjectKits = async (
  env: Env,
  query: Record<string, string | undefined>
): Promise<Paged<ProjectKitRow>> => {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query.project_id) {
    where.push("k.project_id = ?");
    params.push(requireId(query.project_id, "项目"));
  }
  if (query.status) {
    where.push("k.status = ?");
    params.push(requireEnum(query.status, "清单状态", KIT_STATUSES));
  }
  const keyword = query.keyword?.trim();
  if (keyword) {
    where.push("(k.kit_no LIKE ? OR k.title LIKE ? OR p.project_name LIKE ?)");
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }
  const whereSql = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  const page = positiveInt(query.page, 1, 100000);
  const pageSize = positiveInt(query.pageSize, 20, 200);
  const [rows, count] = await Promise.all([
    env.DB.prepare(
      `${SELECT_KIT}${whereSql} ORDER BY k.updated_at DESC, k.id DESC LIMIT ? OFFSET ?`
    )
      .bind(...params, pageSize, (page - 1) * pageSize)
      .all<StoredKitRow>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS n FROM project_kit k JOIN project p ON p.id = k.project_id${whereSql}`
    )
      .bind(...params)
      .first<{ n: number }>()
  ]);
  return {
    items: (rows.results ?? []).map(toRow),
    total: Number(count?.n ?? 0),
    page,
    pageSize
  };
};

const loadStoredRow = (env: Env, id: number): Promise<StoredKitRow | null> =>
  env.DB.prepare(`${SELECT_KIT} WHERE k.id = ?`).bind(id).first<StoredKitRow>();

export const getProjectKitHeader = async (env: Env, id: number): Promise<ProjectKitRow | null> => {
  const row = await loadStoredRow(env, id);
  return row ? toRow(row) : null;
};

/** 同品名在用物资的规格，按品名分组。 */
export const loadSpecChoices = async (
  env: Env,
  names: readonly string[]
): Promise<Map<string, { id: number; spec: string }[]>> => {
  const rows = await queryIn<{ id: number; name: string; spec: string }>(
    env.DB,
    (inList) =>
      `SELECT id, name, spec FROM material WHERE status = 'active' AND name IN (${inList}) ORDER BY spec ASC, id ASC`,
    [...new Set(names)]
  );
  const byName = new Map<string, { id: number; spec: string }[]>();
  for (const row of rows) {
    byName.set(row.name, [
      ...(byName.get(row.name) ?? []),
      { id: Number(row.id), spec: row.spec ?? "" }
    ]);
  }
  return byName;
};

export const loadKitLines = async (env: Env, kitId: number): Promise<ProjectKitLineView[]> => {
  const rows =
    (
      await env.DB.prepare(
        `SELECT l.*, m.material_code, m.name AS material_name, m.spec AS material_spec,
                m.unit AS material_unit, m.status AS material_status, m.kind AS material_kind,
                c.name AS category_name
           FROM project_kit_line l
           LEFT JOIN material m ON m.id = l.material_id
           LEFT JOIN device_category c ON c.id = l.device_category_id
          WHERE l.kit_id = ?
          ORDER BY l.sort_order ASC, l.id ASC`
      )
        .bind(kitId)
        .all<Omit<ProjectKitLineView, "spec_choices">>()
    ).results ?? [];
  const choices = await loadSpecChoices(
    env,
    rows.filter((row) => row.line_kind === "material").map((row) => row.name_text)
  );
  return rows.map((row) => ({
    ...row,
    spec_choices: row.line_kind === "material" ? (choices.get(row.name_text) ?? []) : []
  }));
};

export const getProjectKit = async (
  env: Env,
  id: number
): Promise<
  (ProjectKitRow & { plan: KitPlanView | null; lines: ProjectKitLineWithPlan[] }) | null
> => {
  const stored = await loadStoredRow(env, id);
  if (!stored) return null;
  const record = readPlanRecord(stored.plan_json);
  const lines = matchGenerated(await loadKitLines(env, id), record?.generated ?? []);
  const plan: KitPlanView | null = record
    ? { v: record.v, params: record.params, sources: record.sources, template: record.template }
    : null;
  return { ...toRow(stored), plan, lines };
};
