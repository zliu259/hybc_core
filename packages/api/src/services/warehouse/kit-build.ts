/**
 * 新清单的初始行：从模板生成，或者照抄另一份清单。
 */
import type { Env } from "../../types/env";
import type { KitTemplate, KitTemplateLine, ProjectKitLine } from "../../types/wh";
import { badRequest } from "./errors";
import { loadSpecChoices } from "./kit-query";
import type { ParsedKitLine } from "./kit-lines";

/**
 * 模板行只写品名，规格随管径变：模板写了规格且有同规格的物资就选它；
 * 同品名只有一种规格也选它；否则留空，让用户在清单里选。
 */
export const pickMaterial = (
  specText: string | null,
  candidates: readonly { id: number; spec: string }[]
): number | null => {
  const wanted = specText?.trim();
  if (wanted) {
    const exact = candidates.find((candidate) => candidate.spec.trim() === wanted);
    if (exact) return exact.id;
  }
  return candidates.length === 1 ? candidates[0].id : null;
};

export const linesFromTemplate = async (env: Env, templateId: number): Promise<ParsedKitLine[]> => {
  const template = await env.DB.prepare("SELECT status FROM kit_template WHERE id = ?")
    .bind(templateId)
    .first<Pick<KitTemplate, "status">>();
  if (!template) throw badRequest("模板不存在");
  if (template.status !== "active") throw badRequest("模板已停用");
  const rows =
    (
      await env.DB.prepare(
        "SELECT * FROM kit_template_line WHERE template_id = ? ORDER BY sort_order ASC, id ASC"
      )
        .bind(templateId)
        .all<KitTemplateLine>()
    ).results ?? [];
  const choices = await loadSpecChoices(
    env,
    rows.filter((row) => row.line_kind === "material").map((row) => row.name_text)
  );
  return rows.map((row, index) => ({
    section: row.section,
    sort_order: index,
    line_kind: row.line_kind,
    device_category_id: row.device_category_id,
    material_id:
      row.line_kind === "material"
        ? pickMaterial(row.spec_text, choices.get(row.name_text) ?? [])
        : null,
    name_text: row.name_text,
    spec_text: row.spec_text,
    unit: row.unit,
    qty: row.default_qty ?? 0,
    source: "warehouse",
    note: row.note
  }));
};

/** 照抄另一份清单（可以是别的项目的）。已停用的物资不带过来，变成待选规格。 */
export const linesFromKit = async (env: Env, kitId: number): Promise<ParsedKitLine[]> => {
  const kit = await env.DB.prepare("SELECT id FROM project_kit WHERE id = ?").bind(kitId).first();
  if (!kit) throw badRequest("要复制的清单不存在");
  const rows =
    (
      await env.DB.prepare(
        `SELECT l.*, m.status AS material_status
           FROM project_kit_line l LEFT JOIN material m ON m.id = l.material_id
          WHERE l.kit_id = ? ORDER BY l.sort_order ASC, l.id ASC`
      )
        .bind(kitId)
        .all<ProjectKitLine & { material_status: string | null }>()
    ).results ?? [];
  return rows.map((row, index) => ({
    section: row.section,
    sort_order: index,
    line_kind: row.line_kind,
    device_category_id: row.device_category_id,
    material_id: row.material_status === "active" ? row.material_id : null,
    name_text: row.name_text,
    spec_text: row.spec_text,
    unit: row.unit,
    qty: Number(row.planned_qty),
    source: row.source,
    note: row.note
  }));
};
