import { Hono } from "hono";

import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";
import type {
  ApprovalTemplate,
  ApprovalThreshold,
  CreateTemplateRequest,
  ThresholdRule
} from "../types/approval";
import type {
  AiProviderConfig,
  AiRoutingRule,
  AiPromptTemplate,
  ProviderConfigRequest,
  RoutingRuleRequest,
  PromptTemplateRequest
} from "../types/ai";
import { validateTemplate } from "../services/approval/template-parser";

const nowIso = () => new Date().toISOString();

export const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

adminRoutes.use("*", authMiddleware);

// ─── Approval Template CRUD ──────────

// GET /approval-config — List templates
adminRoutes.get(
  "/approval-config",
  requireRoles(["super_admin"]),
  async (c) => {
    const bizType = c.req.query("biz_type");

    let sql = "SELECT * FROM approval_template WHERE status != 'deleted'";
    const params: string[] = [];

    if (bizType) {
      sql += " AND biz_type = ?";
      params.push(bizType);
    }
    sql += " ORDER BY id DESC";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<ApprovalTemplate>();

    return c.json({ success: true, data: rows.results ?? [] });
  }
);

// POST /approval-config — Create template
adminRoutes.post(
  "/approval-config",
  requireRoles(["super_admin"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json()) as CreateTemplateRequest;

    // Validate config_json
    const { valid, errors } = validateTemplate(body.config_json);
    if (!valid) {
      return c.json(
        {
          success: false,
          error: { message: "Invalid template config", details: errors }
        },
        400
      );
    }

    const now = nowIso();
    const result = await c.env.DB.prepare(
      `INSERT INTO approval_template
        (template_code, template_name, biz_type, config_json, status,
         created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
    )
      .bind(
        body.template_code,
        body.template_name,
        body.biz_type,
        body.config_json,
        auth.sub,
        now,
        now
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

// PUT /approval-config/:id — Update template
adminRoutes.put(
  "/approval-config/:id",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as Partial<CreateTemplateRequest> & {
      status?: string;
    };

    // Validate config_json if provided
    if (body.config_json) {
      const { valid, errors } = validateTemplate(body.config_json);
      if (!valid) {
        return c.json(
          {
            success: false,
            error: { message: "Invalid template config", details: errors }
          },
          400
        );
      }
    }

    await c.env.DB.prepare(
      `UPDATE approval_template SET
        template_name = COALESCE(?, template_name),
        biz_type = COALESCE(?, biz_type),
        config_json = COALESCE(?, config_json),
        status = COALESCE(?, status),
        updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.template_name ?? null,
        body.biz_type ?? null,
        body.config_json ?? null,
        body.status ?? null,
        nowIso(),
        id
      )
      .run();

    return c.json({ success: true });
  }
);

// DELETE /approval-config/:id — Soft delete template
adminRoutes.delete(
  "/approval-config/:id",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare(
      "UPDATE approval_template SET status = 'disabled', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    return c.json({ success: true });
  }
);

// ─── Threshold CRUD ──────────

// GET /threshold — List thresholds
adminRoutes.get(
  "/threshold",
  requireRoles(["super_admin"]),
  async (c) => {
    const templateId = c.req.query("template_id");

    let sql = "SELECT * FROM approval_threshold WHERE status != 'deleted'";
    const params: (string | number)[] = [];

    if (templateId) {
      sql += " AND template_id = ?";
      params.push(Number(templateId));
    }
    sql += " ORDER BY priority ASC";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<ApprovalThreshold>();

    return c.json({ success: true, data: rows.results ?? [] });
  }
);

// POST /threshold — Create threshold
adminRoutes.post(
  "/threshold",
  requireRoles(["super_admin"]),
  async (c) => {
    const body = (await c.req.json()) as ThresholdRule;
    const now = nowIso();

    const result = await c.env.DB.prepare(
      `INSERT INTO approval_threshold
        (template_id, condition_field, operator, threshold_value,
         threshold_value_upper, target_branch, priority, status,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
      .bind(
        body.template_id,
        body.condition_field,
        body.operator,
        body.threshold_value,
        body.threshold_value_upper ?? null,
        body.target_branch,
        body.priority,
        now,
        now
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

// PUT /threshold/:id — Update threshold
adminRoutes.put(
  "/threshold/:id",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as Partial<ThresholdRule> & {
      status?: string;
    };

    await c.env.DB.prepare(
      `UPDATE approval_threshold SET
        condition_field = COALESCE(?, condition_field),
        operator = COALESCE(?, operator),
        threshold_value = COALESCE(?, threshold_value),
        threshold_value_upper = ?,
        target_branch = COALESCE(?, target_branch),
        priority = COALESCE(?, priority),
        status = COALESCE(?, status),
        updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.condition_field ?? null,
        body.operator ?? null,
        body.threshold_value ?? null,
        body.threshold_value_upper ?? null,
        body.target_branch ?? null,
        body.priority ?? null,
        body.status ?? null,
        nowIso(),
        id
      )
      .run();

    return c.json({ success: true });
  }
);

// DELETE /threshold/:id — Soft delete threshold
adminRoutes.delete(
  "/threshold/:id",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare(
      "UPDATE approval_threshold SET status = 'disabled', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    return c.json({ success: true });
  }
);

// ─── AI Provider Config CRUD ──────────

// GET /ai-provider — List providers
adminRoutes.get(
  "/ai-provider",
  requireRoles(["super_admin"]),
  async (c) => {
    const rows = await c.env.DB.prepare(
      "SELECT * FROM ai_provider_config WHERE status != 'deleted' ORDER BY priority ASC"
    ).all<AiProviderConfig>();

    return c.json({ success: true, data: rows.results ?? [] });
  }
);

// POST /ai-provider — Create provider
adminRoutes.post(
  "/ai-provider",
  requireRoles(["super_admin"]),
  async (c) => {
    const body = (await c.req.json()) as ProviderConfigRequest;
    const now = nowIso();

    const result = await c.env.DB.prepare(
      `INSERT INTO ai_provider_config
        (provider_key, provider_name, api_endpoint, model_id,
         config_json, priority, max_concurrent, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
      .bind(
        body.provider_key,
        body.provider_name,
        body.api_endpoint ?? null,
        body.model_id ?? null,
        body.config_json ?? null,
        body.priority ?? 0,
        body.max_concurrent ?? 1,
        now,
        now
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

// PUT /ai-provider/:id — Update provider
adminRoutes.put(
  "/ai-provider/:id",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as Partial<ProviderConfigRequest> & {
      status?: string;
    };

    await c.env.DB.prepare(
      `UPDATE ai_provider_config SET
        provider_name = COALESCE(?, provider_name),
        api_endpoint = COALESCE(?, api_endpoint),
        model_id = COALESCE(?, model_id),
        config_json = COALESCE(?, config_json),
        priority = COALESCE(?, priority),
        max_concurrent = COALESCE(?, max_concurrent),
        status = COALESCE(?, status),
        updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.provider_name ?? null,
        body.api_endpoint ?? null,
        body.model_id ?? null,
        body.config_json ?? null,
        body.priority ?? null,
        body.max_concurrent ?? null,
        body.status ?? null,
        nowIso(),
        id
      )
      .run();

    return c.json({ success: true });
  }
);

// DELETE /ai-provider/:id — Soft delete provider
adminRoutes.delete(
  "/ai-provider/:id",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare(
      "UPDATE ai_provider_config SET status = 'disabled', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    return c.json({ success: true });
  }
);

// ─── AI Routing Rule CRUD ──────────

// GET /ai-routing — List routing rules
adminRoutes.get(
  "/ai-routing",
  requireRoles(["super_admin"]),
  async (c) => {
    const bizType = c.req.query("biz_type");
    const taskType = c.req.query("task_type");

    let sql = "SELECT * FROM ai_routing_rule WHERE status != 'deleted'";
    const params: string[] = [];

    if (bizType) {
      sql += " AND biz_type = ?";
      params.push(bizType);
    }
    if (taskType) {
      sql += " AND task_type = ?";
      params.push(taskType);
    }
    sql += " ORDER BY priority ASC";

    const rows = await c.env.DB.prepare(sql)
      .bind(...params)
      .all<AiRoutingRule>();

    return c.json({ success: true, data: rows.results ?? [] });
  }
);

// POST /ai-routing — Create routing rule
adminRoutes.post(
  "/ai-routing",
  requireRoles(["super_admin"]),
  async (c) => {
    const body = (await c.req.json()) as RoutingRuleRequest;
    const now = nowIso();

    const result = await c.env.DB.prepare(
      `INSERT INTO ai_routing_rule
        (rule_name, biz_type, task_type, condition_json,
         provider_id, prompt_template_id, priority, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
      .bind(
        body.rule_name,
        body.biz_type,
        body.task_type,
        body.condition_json ?? null,
        body.provider_id,
        body.prompt_template_id ?? null,
        body.priority ?? 0,
        now,
        now
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

// PUT /ai-routing/:id — Update routing rule
adminRoutes.put(
  "/ai-routing/:id",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as Partial<RoutingRuleRequest> & {
      status?: string;
    };

    await c.env.DB.prepare(
      `UPDATE ai_routing_rule SET
        rule_name = COALESCE(?, rule_name),
        biz_type = COALESCE(?, biz_type),
        task_type = COALESCE(?, task_type),
        condition_json = COALESCE(?, condition_json),
        provider_id = COALESCE(?, provider_id),
        prompt_template_id = ?,
        priority = COALESCE(?, priority),
        status = COALESCE(?, status),
        updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.rule_name ?? null,
        body.biz_type ?? null,
        body.task_type ?? null,
        body.condition_json ?? null,
        body.provider_id ?? null,
        body.prompt_template_id ?? null,
        body.priority ?? null,
        body.status ?? null,
        nowIso(),
        id
      )
      .run();

    return c.json({ success: true });
  }
);

// DELETE /ai-routing/:id — Soft delete routing rule
adminRoutes.delete(
  "/ai-routing/:id",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare(
      "UPDATE ai_routing_rule SET status = 'disabled', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    return c.json({ success: true });
  }
);

// ─── AI Prompt Template CRUD ──────────

// GET /ai-prompt — List prompt templates
adminRoutes.get(
  "/ai-prompt",
  requireRoles(["super_admin"]),
  async (c) => {
    const rows = await c.env.DB.prepare(
      "SELECT * FROM ai_prompt_template WHERE status != 'deleted' ORDER BY template_key ASC"
    ).all<AiPromptTemplate>();

    return c.json({ success: true, data: rows.results ?? [] });
  }
);

// POST /ai-prompt — Create prompt template
adminRoutes.post(
  "/ai-prompt",
  requireRoles(["super_admin"]),
  async (c) => {
    const body = (await c.req.json()) as PromptTemplateRequest;
    const now = nowIso();

    const result = await c.env.DB.prepare(
      `INSERT INTO ai_prompt_template
        (template_key, template_name, system_prompt, user_prompt_template,
         variables_schema, version, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)`
    )
      .bind(
        body.template_key,
        body.template_name,
        body.system_prompt,
        body.user_prompt_template,
        body.variables_schema ?? null,
        now,
        now
      )
      .run();

    return c.json({ success: true, data: { id: result.meta.last_row_id } }, 201);
  }
);

// PUT /ai-prompt/:id — Update prompt template (increments version)
adminRoutes.put(
  "/ai-prompt/:id",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json()) as Partial<PromptTemplateRequest> & {
      status?: string;
    };

    await c.env.DB.prepare(
      `UPDATE ai_prompt_template SET
        template_name = COALESCE(?, template_name),
        system_prompt = COALESCE(?, system_prompt),
        user_prompt_template = COALESCE(?, user_prompt_template),
        variables_schema = COALESCE(?, variables_schema),
        version = version + 1,
        status = COALESCE(?, status),
        updated_at = ?
       WHERE id = ?`
    )
      .bind(
        body.template_name ?? null,
        body.system_prompt ?? null,
        body.user_prompt_template ?? null,
        body.variables_schema ?? null,
        body.status ?? null,
        nowIso(),
        id
      )
      .run();

    return c.json({ success: true });
  }
);

// DELETE /ai-prompt/:id — Soft delete prompt template
adminRoutes.delete(
  "/ai-prompt/:id",
  requireRoles(["super_admin"]),
  async (c) => {
    const id = Number(c.req.param("id"));
    await c.env.DB.prepare(
      "UPDATE ai_prompt_template SET status = 'disabled', updated_at = ? WHERE id = ?"
    )
      .bind(nowIso(), id)
      .run();

    return c.json({ success: true });
  }
);
