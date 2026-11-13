/**
 * 按项目参数生成配套清单：先从项目的工作段、再从项目档案的字段取参数。
 * 取不到的留空，由人填，或者（第二期）由 AI 从简报文字里读。
 */
import type { Env } from "../../types/env";
import { WarehouseError } from "./errors";
import type { PlanParams } from "./kit-plan-calc";

export type PlanParamKey =
  | "machine_type"
  | "pipe_diameter_mm"
  | "total_length_m"
  | "longest_drive_m"
  | "section_count"
  | "soil";

type SourceParams = Partial<Pick<PlanParams, PlanParamKey>>;
type SourceOrigins = Partial<Record<PlanParamKey, { from: "section" | "project" }>>;

export interface PlanSource {
  params: SourceParams;
  /** 每一项是从哪里取到的 */
  sources: SourceOrigins;
  /** 项目有没有可读的文字（简报、历史备注） */
  has_text: boolean;
}

interface ProjectRow {
  machine_type: string | null;
  pipe_spec: string | null;
  geotech_soil: string | null;
  project_briefing: string | null;
  legacy_note: string | null;
}

interface SectionRow {
  section_length: number | null;
  pipe_diameter_mm: number | null;
  soil_type: string | null;
  assigned_machine_type: string | null;
  jacking_method: string | null;
}

const MIN_DIAMETER = 300;
const MAX_DIAMETER = 5000;
const MAX_SECTIONS = 200;
const MAX_LENGTH_M = 20000;
const MACHINE_MAX = 20;
const SOIL_MAX = 100;

const clean = (value: string | null | undefined): string => (value ?? "").trim();

const distinct = (values: readonly string[]): string[] => [...new Set(values.filter(Boolean))];

const round6 = (value: number): number => Math.round(value * 1e6) / 1e6;

const validDiameter = (value: number): boolean =>
  Number.isInteger(value) && value >= MIN_DIAMETER && value <= MAX_DIAMETER;

/** 「D1600」「DN800」「D1550*2」里第一段 3 到 4 位的数字。 */
const diameterFromSpec = (spec: string): number | null => {
  const match = /(?<![0-9])([0-9]{3,4})(?![0-9])/.exec(spec);
  if (!match) return null;
  const value = Number(match[1]);
  return validDiameter(value) ? value : null;
};

const fromSections = (rows: readonly SectionRow[]): SourceParams => {
  if (rows.length === 0) return {};
  const lengths = rows
    .map((row) => Number(row.section_length))
    .filter((length) => Number.isFinite(length) && length > 0);
  const total = round6(lengths.reduce((sum, length) => sum + length, 0));
  const diameters = [
    ...new Set(
      rows
        .filter((row) => row.pipe_diameter_mm !== null)
        .map((row) => Math.round(Number(row.pipe_diameter_mm)))
        .filter(validDiameter)
    )
  ];
  const soils = distinct(rows.map((row) => clean(row.soil_type))).join("、");
  const assigned = distinct(rows.map((row) => clean(row.assigned_machine_type)));
  const machines =
    assigned.length > 0 ? assigned : distinct(rows.map((row) => clean(row.jacking_method)));
  return {
    ...(rows.length <= MAX_SECTIONS ? { section_count: rows.length } : {}),
    ...(lengths.length > 0 && total <= MAX_LENGTH_M
      ? { total_length_m: total, longest_drive_m: Math.max(...lengths) }
      : {}),
    ...(diameters.length === 1 ? { pipe_diameter_mm: diameters[0] } : {}),
    ...(soils ? { soil: soils.slice(0, SOIL_MAX) } : {}),
    ...(machines.length === 1 && machines[0].length <= MACHINE_MAX
      ? { machine_type: machines[0] }
      : {})
  };
};

const fromProject = (project: ProjectRow): SourceParams => {
  const machine = clean(project.machine_type);
  const diameter = diameterFromSpec(clean(project.pipe_spec));
  const soil = clean(project.geotech_soil)
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("、");
  return {
    ...(machine && machine.length <= MACHINE_MAX ? { machine_type: machine } : {}),
    ...(diameter !== null ? { pipe_diameter_mm: diameter } : {}),
    ...(soil ? { soil: soil.slice(0, SOIL_MAX) } : {})
  };
};

const originsOf = (params: SourceParams, from: "section" | "project"): SourceOrigins =>
  Object.fromEntries(Object.keys(params).map((key) => [key, { from }]));

export const loadPlanSource = async (env: Env, projectId: number): Promise<PlanSource> => {
  const project = await env.DB.prepare(
    "SELECT machine_type, pipe_spec, geotech_soil, project_briefing, legacy_note FROM project WHERE id = ?"
  )
    .bind(projectId)
    .first<ProjectRow>();
  if (!project) throw new WarehouseError(404, "项目不存在");
  const sections =
    (
      await env.DB.prepare(
        `SELECT section_length, pipe_diameter_mm, soil_type, assigned_machine_type, jacking_method
           FROM project_section WHERE project_id = ?`
      )
        .bind(projectId)
        .all<SectionRow>()
    ).results ?? [];

  const sectionParams = fromSections(sections);
  const projectParams = fromProject(project);
  return {
    // 工作段取到的优先，项目档案补上工作段没有的
    params: { ...projectParams, ...sectionParams },
    sources: {
      ...originsOf(projectParams, "project"),
      ...originsOf(sectionParams, "section")
    },
    has_text: Boolean(clean(project.project_briefing) || clean(project.legacy_note))
  };
};
