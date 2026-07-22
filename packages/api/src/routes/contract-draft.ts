// packages/api/src/routes/contract-draft.ts
// AI 合同起草草稿域：草稿 CRUD / 节管理 / 逐节生成 / 合规审查 / 完整性提示。
// 人在环：AI 只写草稿节，正式合同转化在 M2；mutation 一律拒绝 mcp_agent 令牌。
import { Hono } from "hono";
import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";
import { createTask } from "../services/ai-slot";
import { writeAuditLog } from "../services/audit-log";
import {
  CF_AI_CHEAP_MODEL,
  executeCfAiTask,
  pickCriticModel,
  pickDraftModel,
  pickSectionModel
} from "../services/cf-ai";
import {
  buildKeywordValues,
  collectUnresolvedKeys,
  fillPlaceholders
} from "../services/contract-draft-finalize";
import { checkClauseText, checkDraftDates } from "../services/contract-draft-rules";
import { generateSerial } from "../services/serial";
import type {
  ContractClauseTemplate,
  ContractDraft,
  ContractDraftSection,
  ContractFamily,
  DraftDirection
} from "../types/contract-draft";
import { contractFamilies, draftDirections } from "../types/contract-draft";

const ROLES = ["super_admin", "manager", "finance"] as const;
const MAX_INSTRUCTION = 500;
const MAX_TITLE = 120;

const nowIso = () => new Date().toISOString();

export const contractDraftRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

contractDraftRoutes.use("*", authMiddleware);
contractDraftRoutes.use("*", requireRoles([...ROLES]));

// 起草是人本人业务：泄漏的 agent 令牌不得代为起草/生成（人在环约束）。
contractDraftRoutes.use("*", async (c, next) => {
  const auth = c.get("auth");
  if (c.req.method !== "GET" && auth.auth_method === "mcp_agent") {
    return c.json({ success: false, error: { message: "该操作不对 agent 令牌开放" } }, 403);
  }
  await next();
});

const isDirection = (value: unknown): value is DraftDirection =>
  typeof value === "string" && (draftDirections as readonly string[]).includes(value);

const isFamily = (value: unknown): value is ContractFamily =>
  typeof value === "string" && (contractFamilies as readonly string[]).includes(value);

/** 各族默认草稿标题（direction 语义与条款库 seed 注释一致）。 */
const DEFAULT_TITLES: Record<ContractFamily, Record<DraftDirection, string>> = {
  pipe_jacking: { inbound: "顶管施工协议（对甲方）", outbound: "顶管施工协议（对分包商）" },
  equipment_lease: {
    inbound: "设备租赁合同（对甲方出租）",
    outbound: "设备租赁合同（对分包商/供应商承租）"
  },
  labor_service: {
    inbound: "劳务分包合同（我方承接劳务）",
    outbound: "劳务分包合同（发包给劳务队）"
  },
  materials_sale: { inbound: "材料购销合同（我方销售）", outbound: "材料购销合同（对外采购）" }
};

const canAccess = (draft: ContractDraft, auth: { sub: string; roles: string[] }): boolean =>
  draft.created_by_userid === auth.sub || auth.roles.includes("super_admin");

const loadDraft = async (env: Env, id: number): Promise<ContractDraft | null> => {
  if (!Number.isInteger(id) || id <= 0) return null;
  return env.DB.prepare("SELECT * FROM contract_draft WHERE id = ? AND status != 'deleted'")
    .bind(id)
    .first<ContractDraft>();
};

const loadSection = async (
  env: Env,
  draftId: number,
  sectionId: number
): Promise<ContractDraftSection | null> => {
  if (!Number.isInteger(sectionId) || sectionId <= 0) return null;
  return env.DB.prepare(
    "SELECT * FROM contract_draft_section WHERE id = ? AND draft_id = ? AND status != 'deleted'"
  )
    .bind(sectionId, draftId)
    .first<ContractDraftSection>();
};

const listSections = async (env: Env, draftId: number): Promise<ContractDraftSection[]> => {
  const rows = await env.DB.prepare(
    "SELECT * FROM contract_draft_section WHERE draft_id = ? AND status != 'deleted' ORDER BY sort_order ASC, id ASC"
  )
    .bind(draftId)
    .all<ContractDraftSection>();
  return rows.results ?? [];
};

const parseKeywords = (draft: ContractDraft): Record<string, unknown> => {
  try {
    return JSON.parse(draft.keywords_json) as Record<string, unknown>;
  } catch {
    return {};
  }
};

// ── 条款库目录（供"添加节"选择器与完整性检查候选集） ──
contractDraftRoutes.get("/templates", async (c) => {
  const direction = c.req.query("direction");
  if (!isDirection(direction)) {
    return c.json(
      { success: false, error: { message: "direction 必须为 inbound 或 outbound" } },
      400
    );
  }
  const family = c.req.query("family") ?? "pipe_jacking";
  if (!isFamily(family)) {
    return c.json(
      { success: false, error: { message: `family 必须为 ${contractFamilies.join("/")} 之一` } },
      400
    );
  }
  const rows = await c.env.DB.prepare(
    `SELECT * FROM contract_clause_template
      WHERE family = ? AND (direction = ? OR direction = 'both') AND status = 'active'
      ORDER BY sort_order ASC, variant_key ASC, id ASC`
  )
    .bind(family, direction)
    .all<ContractClauseTemplate>();
  return c.json({ success: true, data: rows.results ?? [] });
});

// ── 草稿 CRUD ──
contractDraftRoutes.post("/", async (c) => {
  const auth = c.get("auth");
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);
  if (!isDirection(body.direction)) {
    return c.json(
      { success: false, error: { message: "direction 必须为 inbound 或 outbound" } },
      400
    );
  }
  const family = body.family ?? "pipe_jacking";
  if (!isFamily(family)) {
    return c.json(
      { success: false, error: { message: `family 必须为 ${contractFamilies.join("/")} 之一` } },
      400
    );
  }
  const defaultTitle = DEFAULT_TITLES[family][body.direction];
  const title =
    typeof body.title === "string" && body.title.trim().length > 0
      ? body.title.trim().slice(0, MAX_TITLE)
      : defaultTitle;
  const now = nowIso();
  const insert = await c.env.DB.prepare(
    `INSERT INTO contract_draft
       (title, direction, family, project_id, entity_id, counterparty_name, keywords_json,
        status, created_by_userid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '{}', 'drafting', ?, ?, ?)`
  )
    .bind(
      title,
      body.direction,
      family,
      typeof body.project_id === "number" ? body.project_id : null,
      typeof body.entity_id === "number" ? body.entity_id : null,
      typeof body.counterparty_name === "string" ? body.counterparty_name.trim() : "",
      auth.sub,
      now,
      now
    )
    .run();
  const draftId = insert.meta.last_row_id;

  // 预载默认节集合（core + recommended；optional 由用户从目录追加）
  // 仅取 default 变体：0066 起同一 section_key 存在 core 级非默认变体，不过滤会预载重复节。
  const templates = await c.env.DB.prepare(
    `SELECT * FROM contract_clause_template
      WHERE family = ? AND (direction = ? OR direction = 'both') AND status = 'active'
        AND required_level IN ('core', 'recommended') AND variant_key = 'default'
      ORDER BY sort_order ASC, id ASC`
  )
    .bind(family, body.direction)
    .all<ContractClauseTemplate>();
  const stmts = (templates.results ?? []).map((t) =>
    c.env.DB.prepare(
      `INSERT INTO contract_draft_section
         (draft_id, section_key, title, source, content, sort_order, status, created_at, updated_at)
       VALUES (?, ?, ?, 'default_template', ?, ?, 'active', ?, ?)`
    ).bind(draftId, t.section_key, t.title, t.body_template, t.sort_order, now, now)
  );
  if (stmts.length) await c.env.DB.batch(stmts);

  const draft = await loadDraft(c.env, draftId);
  return c.json({ success: true, data: { draft, sections: await listSections(c.env, draftId) } });
});

contractDraftRoutes.get("/", async (c) => {
  const auth = c.get("auth");
  const rows = auth.roles.includes("super_admin")
    ? await c.env.DB.prepare(
        "SELECT * FROM contract_draft WHERE status != 'deleted' ORDER BY updated_at DESC LIMIT 100"
      ).all<ContractDraft>()
    : await c.env.DB.prepare(
        "SELECT * FROM contract_draft WHERE status != 'deleted' AND created_by_userid = ? ORDER BY updated_at DESC LIMIT 100"
      )
        .bind(auth.sub)
        .all<ContractDraft>();
  return c.json({ success: true, data: rows.results ?? [] });
});

contractDraftRoutes.get("/:id", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  return c.json({ success: true, data: { draft, sections: await listSections(c.env, draft.id) } });
});

contractDraftRoutes.put("/:id", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  if (draft.status !== "drafting") {
    return c.json({ success: false, error: { message: "当前状态不可编辑" } }, 400);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  const keywords =
    body.keywords && typeof body.keywords === "object" && !Array.isArray(body.keywords)
      ? (body.keywords as Record<string, unknown>)
      : parseKeywords(draft);

  // 工期倒挂等关键字级校验只提示不拦截（结果随响应返回，前端标红）
  const keywordFindings = checkDraftDates(
    typeof keywords.start_date === "string" ? keywords.start_date : undefined,
    typeof keywords.end_date === "string" ? keywords.end_date : undefined
  );

  await c.env.DB.prepare(
    `UPDATE contract_draft SET
       title = ?, project_id = ?, entity_id = ?, counterparty_name = ?,
       counterparty_credit_code = ?, counterparty_legal_person = ?, counterparty_address = ?,
       counterparty_contact = ?, counterparty_phone = ?, counterparty_bank_name = ?,
       counterparty_bank_account = ?, keywords_json = ?, updated_at = ?
     WHERE id = ? AND status = 'drafting'`
  )
    .bind(
      str(body.title)?.slice(0, MAX_TITLE) ?? draft.title,
      typeof body.project_id === "number" ? body.project_id : draft.project_id,
      typeof body.entity_id === "number" ? body.entity_id : draft.entity_id,
      str(body.counterparty_name) ?? draft.counterparty_name,
      str(body.counterparty_credit_code),
      str(body.counterparty_legal_person),
      str(body.counterparty_address),
      str(body.counterparty_contact),
      str(body.counterparty_phone),
      str(body.counterparty_bank_name),
      str(body.counterparty_bank_account),
      JSON.stringify(keywords),
      nowIso(),
      draft.id
    )
    .run();
  const updated = await loadDraft(c.env, draft.id);
  return c.json({ success: true, data: { draft: updated, keyword_findings: keywordFindings } });
});

contractDraftRoutes.delete("/:id", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  await c.env.DB.prepare(
    "UPDATE contract_draft SET status = 'deleted', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), draft.id)
    .run();
  return c.json({ success: true, data: { id: draft.id } });
});

// ── 节管理 ──
contractDraftRoutes.post("/:id/sections", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);
  const now = nowIso();
  const maxSort = await c.env.DB.prepare(
    "SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM contract_draft_section WHERE draft_id = ? AND status != 'deleted'"
  )
    .bind(draft.id)
    .first<{ max_sort: number }>();
  const nextSort = (maxSort?.max_sort ?? 0) + 10;

  if (typeof body.section_key === "string" && body.section_key.length > 0) {
    const variantKey =
      typeof body.variant_key === "string" && body.variant_key.trim().length > 0
        ? body.variant_key.trim()
        : "default";
    const tpl = await c.env.DB.prepare(
      `SELECT * FROM contract_clause_template
        WHERE family = ? AND section_key = ? AND (direction = ? OR direction = 'both')
          AND variant_key = ? AND status = 'active'
        ORDER BY CASE direction WHEN 'both' THEN 1 ELSE 0 END ASC LIMIT 1`
    )
      .bind(draft.family, body.section_key, draft.direction, variantKey)
      .first<ContractClauseTemplate>();
    if (!tpl) return c.json({ success: false, error: { message: "条款库中无该节" } }, 404);
    const dup = await c.env.DB.prepare(
      "SELECT id FROM contract_draft_section WHERE draft_id = ? AND section_key = ? AND status != 'deleted'"
    )
      .bind(draft.id, tpl.section_key)
      .first<{ id: number }>();
    if (dup) return c.json({ success: false, error: { message: "该节已存在" } }, 400);
    const ins = await c.env.DB.prepare(
      `INSERT INTO contract_draft_section
         (draft_id, section_key, title, variant_key, source, content, sort_order, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'default_template', ?, ?, 'active', ?, ?)`
    )
      .bind(
        draft.id,
        tpl.section_key,
        tpl.title,
        tpl.variant_key,
        tpl.body_template,
        nextSort,
        now,
        now
      )
      .run();
    const section = await loadSection(c.env, draft.id, ins.meta.last_row_id);
    return c.json({ success: true, data: section });
  }

  const customTitle = typeof body.title === "string" ? body.title.trim().slice(0, MAX_TITLE) : "";
  if (!customTitle) {
    return c.json({ success: false, error: { message: "需提供 section_key 或自定义节标题" } }, 400);
  }
  const ins = await c.env.DB.prepare(
    `INSERT INTO contract_draft_section
       (draft_id, section_key, title, source, content, sort_order, status, created_at, updated_at)
     VALUES (?, ?, ?, 'manual', '', ?, 'active', ?, ?)`
  )
    .bind(draft.id, `custom_${Date.now()}`, customTitle, nextSort, now, now)
    .run();
  const section = await loadSection(c.env, draft.id, ins.meta.last_row_id);
  return c.json({ success: true, data: section });
});

contractDraftRoutes.get("/:id/sections/:sectionId", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const section = await loadSection(c.env, draft.id, Number(c.req.param("sectionId")));
  if (!section) return c.json({ success: false, error: { message: "节不存在" } }, 404);
  return c.json({ success: true, data: section });
});

contractDraftRoutes.put("/:id/sections/:sectionId", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const section = await loadSection(c.env, draft.id, Number(c.req.param("sectionId")));
  if (!section) return c.json({ success: false, error: { message: "节不存在" } }, 404);
  if (section.ai_status === "generating") {
    return c.json({ success: false, error: { message: "该节正在生成中，稍后再编辑" } }, 400);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);

  const nextContent = typeof body.content === "string" ? body.content : section.content;
  const contentChanged = nextContent !== section.content;
  // 人工改稿即重跑规则层（AI 标注保留需重新生成才更新）
  const annotations = contentChanged ? checkClauseText(nextContent) : null;

  await c.env.DB.prepare(
    `UPDATE contract_draft_section SET
       title = ?, content = ?, instruction = ?, sort_order = ?,
       source = ?, risk_annotations_json = COALESCE(?, risk_annotations_json), updated_at = ?
     WHERE id = ?`
  )
    .bind(
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, MAX_TITLE)
        : section.title,
      nextContent,
      typeof body.instruction === "string"
        ? body.instruction.slice(0, MAX_INSTRUCTION)
        : section.instruction,
      typeof body.sort_order === "number" ? body.sort_order : section.sort_order,
      contentChanged ? "manual" : section.source,
      annotations ? JSON.stringify(annotations) : null,
      nowIso(),
      section.id
    )
    .run();
  return c.json({ success: true, data: await loadSection(c.env, draft.id, section.id) });
});

// 换模版变体：以所选变体骨架整体覆盖该节（覆盖前快照留档，可追溯）
contractDraftRoutes.put("/:id/sections/:sectionId/apply-variant", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const section = await loadSection(c.env, draft.id, Number(c.req.param("sectionId")));
  if (!section) return c.json({ success: false, error: { message: "节不存在" } }, 404);
  if (section.ai_status === "generating") {
    return c.json({ success: false, error: { message: "该节正在生成中，稍后再换模版" } }, 400);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const variantKey =
    body && typeof body.variant_key === "string" && body.variant_key.trim().length > 0
      ? body.variant_key.trim()
      : "";
  if (!variantKey) return c.json({ success: false, error: { message: "缺少 variant_key" } }, 400);

  const tpl = await c.env.DB.prepare(
    `SELECT * FROM contract_clause_template
      WHERE family = ? AND section_key = ? AND (direction = ? OR direction = 'both')
        AND variant_key = ? AND status = 'active'
      ORDER BY CASE direction WHEN 'both' THEN 1 ELSE 0 END ASC LIMIT 1`
  )
    .bind(draft.family, section.section_key, draft.direction, variantKey)
    .first<ContractClauseTemplate>();
  if (!tpl) return c.json({ success: false, error: { message: "条款库中无该变体" } }, 404);

  // 覆盖前留档：已有非模板正文时快照全稿（与 regenerate 快照同款）
  if (section.content.trim().length > 0 && section.source !== "default_template") {
    const allSections = await listSections(c.env, draft.id);
    await c.env.DB.prepare(
      `INSERT INTO contract_draft_revision (draft_id, snapshot_json, trigger_action, created_by_userid, created_at)
       VALUES (?, ?, 'regenerate', ?, ?)`
    )
      .bind(draft.id, JSON.stringify({ draft, sections: allSections }), auth.sub, nowIso())
      .run();
  }

  await c.env.DB.prepare(
    `UPDATE contract_draft_section SET
       content = ?, title = ?, source = 'default_template', variant_key = ?,
       risk_annotations_json = NULL, updated_at = ?
     WHERE id = ?`
  )
    .bind(tpl.body_template, tpl.title, tpl.variant_key, nowIso(), section.id)
    .run();
  return c.json({ success: true, data: await loadSection(c.env, draft.id, section.id) });
});

contractDraftRoutes.delete("/:id/sections/:sectionId", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const section = await loadSection(c.env, draft.id, Number(c.req.param("sectionId")));
  if (!section) return c.json({ success: false, error: { message: "节不存在" } }, 404);
  await c.env.DB.prepare(
    "UPDATE contract_draft_section SET status = 'deleted', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), section.id)
    .run();
  return c.json({ success: true, data: { id: section.id } });
});

// ── AI 生成 ──
contractDraftRoutes.post("/:id/sections/:sectionId/generate", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const section = await loadSection(c.env, draft.id, Number(c.req.param("sectionId")));
  if (!section) return c.json({ success: false, error: { message: "节不存在" } }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
  if (instruction.length > MAX_INSTRUCTION) {
    return c.json(
      { success: false, error: { message: `个性化指令不得超过 ${MAX_INSTRUCTION} 字` } },
      400
    );
  }

  // 闸门前置：抢占节状态，防重复生成（D1 无事务）
  const claim = await c.env.DB.prepare(
    `UPDATE contract_draft_section SET ai_status = 'generating', instruction = ?, updated_at = ?
      WHERE id = ? AND (ai_status IS NULL OR ai_status != 'generating')`
  )
    .bind(instruction || null, nowIso(), section.id)
    .run();
  if (!claim.meta.changes) {
    return c.json({ success: false, error: { message: "该节已在生成中" } }, 409);
  }

  // 重生成前留档：已有非模板正文时快照全稿，防"regenerate 静默覆盖"
  if (section.content.trim().length > 0 && section.source !== "default_template") {
    const allSections = await listSections(c.env, draft.id);
    await c.env.DB.prepare(
      `INSERT INTO contract_draft_revision (draft_id, snapshot_json, trigger_action, created_by_userid, created_at)
       VALUES (?, ?, 'regenerate', ?, ?)`
    )
      .bind(draft.id, JSON.stringify({ draft, sections: allSections }), auth.sub, nowIso())
      .run();
  }

  // 按当前变体取骨架：保证 regenerate 沿用该节已选模版
  const tpl = await c.env.DB.prepare(
    `SELECT * FROM contract_clause_template
      WHERE family = ? AND section_key = ? AND (direction = ? OR direction = 'both')
        AND variant_key = ? AND status = 'active'
      ORDER BY CASE direction WHEN 'both' THEN 1 ELSE 0 END ASC LIMIT 1`
  )
    .bind(draft.family, section.section_key, draft.direction, section.variant_key)
    .first<ContractClauseTemplate>();

  const sectionIndex = Math.trunc(section.sort_order / 10);
  const task = await createTask(c.env, {
    task_type: "contract_draft_section",
    biz_type: "contract_draft",
    biz_id: draft.id,
    payload: {
      draft_id: draft.id,
      section_id: section.id,
      direction: draft.direction,
      section_key: section.section_key,
      section_title: section.title,
      body_template: tpl?.body_template ?? section.content,
      current_content: section.content,
      style_ref: tpl?.style_ref ?? "",
      keywords_json: draft.keywords_json,
      instruction,
      section_sort: sectionIndex,
      // 成本分级：已有非模板正文且带指令的修改类走 Workers AI 免费层
      model: pickSectionModel({
        hasContent: section.content.trim().length > 0 && section.source !== "default_template",
        hasInstruction: instruction.length > 0,
        sectionSort: sectionIndex
      })
    },
    priority: 6,
    timeout_seconds: 300
  });
  await c.env.DB.prepare("UPDATE contract_draft_section SET ai_task_id = ? WHERE id = ?")
    .bind(task.id, section.id)
    .run();
  // 即时执行（本地无 Queue 也能跑通）；Queue 事件与 cron 为后备，原子抢占保证幂等。
  c.executionCtx.waitUntil(
    executeCfAiTask(c.env, task.id).catch((err) =>
      console.error("cf_ai execute failed", task.id, err)
    )
  );
  return c.json({ success: true, data: { task_id: task.id, section_id: section.id } });
});

contractDraftRoutes.post("/:id/sections/:sectionId/review", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const section = await loadSection(c.env, draft.id, Number(c.req.param("sectionId")));
  if (!section) return c.json({ success: false, error: { message: "节不存在" } }, 404);
  if (!section.content.trim()) {
    return c.json({ success: false, error: { message: "该节尚无正文可审查" } }, 400);
  }
  const claim = await c.env.DB.prepare(
    `UPDATE contract_draft_section SET review_status = 'generating', updated_at = ?
      WHERE id = ? AND (review_status IS NULL OR review_status != 'generating')`
  )
    .bind(nowIso(), section.id)
    .run();
  if (!claim.meta.changes) {
    return c.json({ success: false, error: { message: "该节已在审查中" } }, 409);
  }
  // critic 与起草异厂商：起草模型由节序决定，审查取另一个
  const draftModel = pickDraftModel(Math.trunc(section.sort_order / 10));
  const task = await createTask(c.env, {
    task_type: "contract_compliance_review",
    biz_type: "contract_draft",
    biz_id: draft.id,
    payload: {
      draft_id: draft.id,
      section_id: section.id,
      direction: draft.direction,
      section_title: section.title,
      content: section.content,
      model: pickCriticModel(draftModel)
    },
    priority: 6,
    timeout_seconds: 300
  });
  await c.env.DB.prepare("UPDATE contract_draft_section SET review_task_id = ? WHERE id = ?")
    .bind(task.id, section.id)
    .run();
  c.executionCtx.waitUntil(
    executeCfAiTask(c.env, task.id).catch((err) =>
      console.error("cf_ai review failed", task.id, err)
    )
  );
  return c.json({ success: true, data: { task_id: task.id, section_id: section.id } });
});

// ── 完整性遗漏提示 ──
contractDraftRoutes.post("/:id/completeness-check", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const claim = await c.env.DB.prepare(
    `UPDATE contract_draft SET completeness_status = 'generating', updated_at = ?
      WHERE id = ? AND (completeness_status IS NULL OR completeness_status != 'generating')`
  )
    .bind(nowIso(), draft.id)
    .run();
  if (!claim.meta.changes) {
    return c.json({ success: false, error: { message: "完整性检查进行中" } }, 409);
  }
  const sections = await listSections(c.env, draft.id);
  // 候选集按 section_key 去变体（default 变体每 key 恒存在），避免同一节多变体重复提示
  const catalog = await c.env.DB.prepare(
    `SELECT section_key, title, required_level FROM contract_clause_template
      WHERE family = ? AND (direction = ? OR direction = 'both') AND status = 'active'
        AND variant_key = 'default'
      ORDER BY sort_order ASC`
  )
    .bind(draft.family, draft.direction)
    .all<{ section_key: string; title: string; required_level: string }>();
  const task = await createTask(c.env, {
    task_type: "contract_completeness_check",
    biz_type: "contract_draft",
    biz_id: draft.id,
    payload: {
      draft_id: draft.id,
      direction: draft.direction,
      catalog_json: JSON.stringify(catalog.results ?? []),
      present_sections_json: JSON.stringify(
        sections.map((s) => ({ section_key: s.section_key, title: s.title }))
      ),
      keywords_json: draft.keywords_json,
      // 完整性提示属轻量辅助判断，固定走 Workers AI 免费层
      model: CF_AI_CHEAP_MODEL
    },
    priority: 6,
    timeout_seconds: 180
  });
  await c.env.DB.prepare("UPDATE contract_draft SET completeness_task_id = ? WHERE id = ?")
    .bind(task.id, draft.id)
    .run();
  c.executionCtx.waitUntil(
    executeCfAiTask(c.env, task.id).catch((err) =>
      console.error("cf_ai completeness failed", task.id, err)
    )
  );
  return c.json({ success: true, data: { task_id: task.id } });
});

contractDraftRoutes.post("/:id/completeness-ignore", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as { section_key?: unknown } | null;
  const key = typeof body?.section_key === "string" ? body.section_key : "";
  if (!key) return c.json({ success: false, error: { message: "缺少 section_key" } }, 400);
  let ignored: string[] = [];
  try {
    const parsed = JSON.parse(draft.ignored_hints_json) as unknown;
    ignored = Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    ignored = [];
  }
  if (!ignored.includes(key)) ignored.push(key);
  await c.env.DB.prepare(
    "UPDATE contract_draft SET ignored_hints_json = ?, updated_at = ? WHERE id = ?"
  )
    .bind(JSON.stringify(ignored), nowIso(), draft.id)
    .run();
  return c.json({ success: true, data: { ignored } });
});

// ── 定稿与转正式合同 ──
contractDraftRoutes.post("/:id/finalize", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  if (!draft.entity_id || !draft.project_id || !draft.counterparty_name.trim()) {
    return c.json(
      { success: false, error: { message: "定稿前需补全：我方主体、关联项目、对方单位" } },
      400
    );
  }
  const sections = await listSections(c.env, draft.id);
  if (!sections.length || sections.every((s) => !s.content.trim())) {
    return c.json({ success: false, error: { message: "草稿尚无条款正文" } }, 400);
  }
  const generating = sections.some(
    (s) => s.ai_status === "generating" || s.review_status === "generating"
  );
  if (generating) {
    return c.json({ success: false, error: { message: "仍有节在生成/审查中，请稍候" } }, 400);
  }

  const entity = draft.entity_id
    ? await c.env.DB.prepare(
        "SELECT entity_name, tax_id, legal_person, primary_bank_name, primary_bank_account_no FROM entity WHERE id = ?"
      )
        .bind(draft.entity_id)
        .first<{
          entity_name: string;
          tax_id: string | null;
          legal_person: string | null;
          primary_bank_name: string | null;
          primary_bank_account_no: string | null;
        }>()
    : null;
  const values = buildKeywordValues(draft, entity);
  const fixedSections = sections.map((s) => ({
    id: s.id,
    section_key: s.section_key,
    title: s.title,
    content: fillPlaceholders(s.content, values)
  }));
  const unresolved = collectUnresolvedKeys(
    sections.map((s) => s.content),
    values
  );

  const now = nowIso();
  if (draft.status === "drafting") {
    const claim = await c.env.DB.prepare(
      "UPDATE contract_draft SET status = 'finalized', updated_at = ? WHERE id = ? AND status = 'drafting'"
    )
      .bind(now, draft.id)
      .run();
    if (!claim.meta.changes) {
      return c.json({ success: false, error: { message: "当前状态不可定稿" } }, 409);
    }
    await c.env.DB.prepare(
      `INSERT INTO contract_draft_revision (draft_id, snapshot_json, trigger_action, created_by_userid, created_at)
       VALUES (?, ?, 'finalize', ?, ?)`
    )
      .bind(draft.id, JSON.stringify({ draft, sections: fixedSections, values }), auth.sub, now)
      .run();
  } else if (draft.status !== "finalized") {
    return c.json({ success: false, error: { message: "当前状态不可定稿" } }, 409);
  }
  // 已 finalized：幂等重算返回（convert 失败/刷新后的重试出口），不重复写快照
  return c.json({
    success: true,
    data: { draft_id: draft.id, fixed_sections: fixedSections, unresolved_keys: unresolved }
  });
});

contractDraftRoutes.post("/:id/convert", async (c) => {
  const auth = c.get("auth");
  const draft = await loadDraft(c.env, Number(c.req.param("id")));
  if (!draft || !canAccess(draft, auth)) {
    return c.json({ success: false, error: { message: "草稿不存在" } }, 404);
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ success: false, error: { message: "请求体不是合法 JSON" } }, 400);
  const contractType =
    typeof body.contract_type === "string" ? body.contract_type.trim().slice(0, 20) : "";
  const fileKey = typeof body.file_key === "string" ? body.file_key : "";
  const fileName = typeof body.file_name === "string" ? body.file_name : "合同草稿.docx";
  const fileSize = typeof body.file_size === "number" ? body.file_size : 0;
  if (!contractType) return c.json({ success: false, error: { message: "缺少合同类型" } }, 400);
  if (!fileKey.startsWith("contract-draft/")) {
    return c.json({ success: false, error: { message: "缺少定稿文档（需先上传 docx）" } }, 400);
  }
  let keywords: Record<string, unknown> = {};
  try {
    keywords = JSON.parse(draft.keywords_json) as Record<string, unknown>;
  } catch {
    keywords = {};
  }
  const totalAmount =
    typeof body.total_amount === "number" ? body.total_amount : Number(keywords.amount);
  if (!Number.isFinite(totalAmount) || totalAmount < 0) {
    return c.json(
      { success: false, error: { message: "合同金额无效：请在关键字 amount 填写数字金额" } },
      400
    );
  }
  const contractDate =
    typeof body.contract_date === "string" && body.contract_date.trim()
      ? body.contract_date.trim()
      : typeof keywords.sign_date === "string" && keywords.sign_date
        ? keywords.sign_date
        : nowIso().slice(0, 10);

  const now = nowIso();
  const claim = await c.env.DB.prepare(
    "UPDATE contract_draft SET status = 'converted', updated_at = ? WHERE id = ? AND status = 'finalized'"
  )
    .bind(now, draft.id)
    .run();
  if (!claim.meta.changes) {
    return c.json({ success: false, error: { message: "仅定稿状态的草稿可转正式合同" } }, 409);
  }

  try {
    const contractNo = await generateSerial(c.env.DB, "CT", "contract", "contract_no");
    const attachments = [{ file_key: fileKey, file_name: fileName, file_size: fileSize }];
    const insert = await c.env.DB.prepare(
      `INSERT INTO contract
         (contract_no, direction, project_id, entity_id, counterparty, contract_type,
          handler_userid, contract_date, total_amount, status, ai_review_status,
          attachments_json, remark, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'pending', ?, ?, ?, ?)`
    )
      .bind(
        contractNo,
        draft.direction,
        draft.project_id,
        draft.entity_id,
        draft.counterparty_name,
        contractType,
        auth.sub,
        contractDate,
        totalAmount,
        JSON.stringify(attachments),
        `AI起草草稿#${draft.id}转化`,
        now,
        now
      )
      .run();
    const contractId = insert.meta.last_row_id;

    await createTask(c.env, {
      task_type: "contract_review",
      biz_type: "contract",
      biz_id: contractId,
      priority: 3,
      timeout_seconds: 600,
      payload: {
        contract_id: contractId,
        contract_no: contractNo,
        counterparty: draft.counterparty_name,
        contract_type: contractType,
        total_amount: totalAmount,
        attachments
      }
    });
    await c.env.DB.prepare(
      "UPDATE contract_draft SET converted_contract_id = ?, updated_at = ? WHERE id = ?"
    )
      .bind(contractId, nowIso(), draft.id)
      .run();
    await writeAuditLog(c.env.DB, {
      actorUserId: auth.sub,
      actorRoles: auth.roles,
      action: "contract_draft.convert",
      targetType: "contract_draft",
      targetId: draft.id,
      detail: {
        contract_id: contractId,
        contract_no: contractNo,
        contract_type: contractType,
        total_amount: totalAmount
      }
    });
    return c.json({ success: true, data: { contract_id: contractId, contract_no: contractNo } });
  } catch (err) {
    // 补偿：合同创建失败则回退草稿状态（D1 无事务）
    await c.env.DB.prepare(
      "UPDATE contract_draft SET status = 'finalized', updated_at = ? WHERE id = ? AND status = 'converted' AND converted_contract_id IS NULL"
    )
      .bind(nowIso(), draft.id)
      .run();
    return c.json(
      {
        success: false,
        error: { message: err instanceof Error ? err.message : "转化失败，请重试" }
      },
      500
    );
  }
});
