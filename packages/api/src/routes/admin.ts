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
import { taskTypes } from "../types/ai";
import { validateTemplate } from "../services/approval/template-parser";
import { createTask } from "../services/ai-slot";
import {
  listRunnerRuntimeConfig,
  upsertRunnerRuntimeConfig,
  refreshRunnerRuntimeKvFromDb
} from "../services/runner-runtime";

const nowIso = () => new Date().toISOString();

const defaultApprovalTemplates: Array<{
  template_code: string;
  template_name: string;
  biz_type: string;
  config_json: string;
}> = [
  {
    template_code: "TPL-OUTBOUND-CONTRACT",
    template_name: "对外付款合同审批模板",
    biz_type: "outbound_contract",
    config_json:
      '{"version":1,"start_key":"submit_lead","nodes":[{"key":"submit_lead","type":"sequential","name":"经办负责人审批","assignee_userids":["manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务复核","assignee_userids":["finance_manager"],"next_key":"legal_review"},{"key":"legal_review","type":"sequential","name":"法务审查","assignee_userids":["legal_manager"],"next_key":"gm_approve"},{"key":"gm_approve","type":"or_sign","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"notify_cc"},{"key":"notify_cc","type":"cc","name":"抄送归档","assignee_userids":["finance_manager"],"next_key":null}]}'
  },
  {
    template_code: "TPL-PAYMENT-REQUEST",
    template_name: "付款申请审批模板",
    biz_type: "payment_request",
    config_json:
      '{"version":1,"start_key":"dept_approve","nodes":[{"key":"dept_approve","type":"sequential","name":"部门负责人审批","assignee_userids":["site_manager"],"next_key":"ai_gate_risk"},{"key":"ai_gate_risk","type":"ai_gate","name":"AI风险关卡","ai_slot_id":"payment_risk_assessment","next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务审批","assignee_userids":["finance_manager"],"conditions":[{"field":"amount","operator":"gt","value":500000,"next_key":"gm_approve"}],"default_next_key":"cashier_execute"},{"key":"gm_approve","type":"sequential","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"cashier_execute"},{"key":"cashier_execute","type":"auto","name":"出纳执行","auto_action":"approve","next_key":"notify_cc"},{"key":"notify_cc","type":"cc","name":"抄送归档","assignee_userids":["site_manager"],"next_key":null}]}'
  },
  {
    template_code: "TPL-REIMBURSEMENT-BATCH",
    template_name: "报销批次集中审批模板",
    biz_type: "reimbursement_batch",
    config_json:
      '{"version":1,"start_key":"dept_review","nodes":[{"key":"dept_review","type":"sequential","name":"部门负责人审批","assignee_userids":["site_manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务复核","assignee_userids":["finance_manager"],"conditions":[{"field":"amount","operator":"gt","value":20000,"next_key":"gm_review"}],"default_next_key":"archive_cc"},{"key":"gm_review","type":"sequential","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"archive_cc"},{"key":"archive_cc","type":"cc","name":"抄送归档","assignee_userids":["manager"],"next_key":null}]}'
  },
  {
    template_code: "TPL-INBOUND-CONTRACT",
    template_name: "收款合同审批模板",
    biz_type: "inbound_contract",
    config_json:
      '{"version":1,"start_key":"dept_review","nodes":[{"key":"dept_review","type":"sequential","name":"部门负责人审批","assignee_userids":["site_manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务复核","assignee_userids":["finance_manager"],"conditions":[{"field":"amount","operator":"gt","value":500000,"next_key":"gm_approve"}],"default_next_key":"archive_cc"},{"key":"gm_approve","type":"sequential","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"archive_cc"},{"key":"archive_cc","type":"cc","name":"抄送归档","assignee_userids":["manager"],"next_key":null}]}'
  },
  {
    template_code: "TPL-STOCK-ORDER",
    template_name: "出入库单审批模板",
    biz_type: "stock_order",
    config_json:
      '{"version":1,"start_key":"warehouse_review","nodes":[{"key":"warehouse_review","type":"sequential","name":"仓库负责人审核","assignee_userids":["site_manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务复核","assignee_userids":["finance_manager"],"next_key":"archive_cc"},{"key":"archive_cc","type":"cc","name":"抄送归档","assignee_userids":["manager"],"next_key":null}]}'
  },
  {
    template_code: "TPL-CONTRACT-AMOUNT-CHANGE",
    template_name: "合同金额变更审批模板",
    biz_type: "contract_amount_change",
    config_json:
      '{"version":1,"start_key":"dept_approve","nodes":[{"key":"dept_approve","type":"sequential","name":"部门负责人审批","assignee_userids":["manager"],"next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务审批","assignee_userids":["finance_manager"],"conditions":[{"field":"amount","operator":"gt","value":500000,"next_key":"gm_approve"}],"default_next_key":"notify_cc"},{"key":"gm_approve","type":"sequential","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"notify_cc"},{"key":"notify_cc","type":"cc","name":"抄送归档","assignee_userids":["site_manager"],"next_key":null}]}'
  }
];

const defaultThresholdSeeds: Array<{
  template_code: string;
  condition_field: string;
  operator: string;
  threshold_value: number;
  threshold_value_upper: number | null;
  target_branch: string;
  priority: number;
}> = [
  {
    template_code: "TPL-PAYMENT-REQUEST",
    condition_field: "amount",
    operator: "lte",
    threshold_value: 100000,
    threshold_value_upper: null,
    target_branch: "default",
    priority: 1
  },
  {
    template_code: "TPL-PAYMENT-REQUEST",
    condition_field: "amount",
    operator: "between",
    threshold_value: 100000,
    threshold_value_upper: 500000,
    target_branch: "mid_amount",
    priority: 2
  },
  {
    template_code: "TPL-PAYMENT-REQUEST",
    condition_field: "amount",
    operator: "gt",
    threshold_value: 500000,
    threshold_value_upper: null,
    target_branch: "high_amount",
    priority: 3
  }
];

const defaultAiPromptTemplates: Array<{
  template_key: string;
  template_name: string;
  system_prompt: string;
  user_prompt_template: string;
}> = [
  {
    template_key: "prompt-payment-risk-v1",
    template_name: "付款风险评估默认提示词",
    system_prompt:
      "你是企业财务风控助手。请基于输入输出结构化JSON，字段包含overall_risk、score、summary、recommendations。",
    user_prompt_template:
      "请评估以下付款申请风险，优先关注金额异常、重复支付与账户一致性：{{payload_json}}"
  },
  {
    template_key: "prompt-contract-review-v1",
    template_name: "合同审查默认提示词",
    system_prompt:
      "你是企业合同审查助手。请输出结构化JSON，字段包含overall_risk、score、summary、clause_analysis、recommendations。",
    user_prompt_template: "请审查以下合同数据并输出风险结论：{{payload_json}}"
  },
  {
    template_key: "prompt-reimbursement-anomaly-v1",
    template_name: "报销异常检测默认提示词",
    system_prompt:
      "你是企业报销审计助手。请输出结构化JSON，字段包含risk_level、summary、anomalies、recommendation。",
    user_prompt_template:
      "请检测以下报销数据的异常与重复风险：{{payload_json}}"
  },
  {
    template_key: "prompt-approval-ai-gate-v1",
    template_name: "审批AI关卡默认提示词",
    system_prompt:
      "你是审批AI关卡助手。必须返回JSON，字段包含outcome(approve/reject)与comment。",
    user_prompt_template: "请对以下审批上下文给出关卡决策：{{payload_json}}"
  },
  {
    template_key: "prompt-log-summary-v1",
    template_name: "施工日志汇总默认提示词",
    system_prompt:
      "你是项目日志汇总助手。输出JSON，字段包含summary、highlights、progress_alert。",
    user_prompt_template: "请汇总以下施工日志输入：{{payload_json}}"
  }
];

const defaultAiRoutingRules: Array<{
  rule_name: string;
  biz_type: string;
  task_type: string;
  prompt_key: string;
  priority: number;
}> = [
  {
    rule_name: "OPENAI_PAYMENT_RISK_DEFAULT",
    biz_type: "payment_request",
    task_type: "payment_risk_assessment",
    prompt_key: "prompt-payment-risk-v1",
    priority: 1
  },
  {
    rule_name: "OPENAI_CONTRACT_REVIEW_DEFAULT",
    biz_type: "contract",
    task_type: "contract_review",
    prompt_key: "prompt-contract-review-v1",
    priority: 1
  },
  {
    rule_name: "OPENAI_REIMBURSEMENT_ANOMALY_DEFAULT",
    biz_type: "reimbursement_envelope",
    task_type: "reimbursement_anomaly",
    prompt_key: "prompt-reimbursement-anomaly-v1",
    priority: 1
  },
  {
    rule_name: "OPENAI_APPROVAL_GATE_DEFAULT",
    biz_type: "payment_request",
    task_type: "approval_ai_gate",
    prompt_key: "prompt-approval-ai-gate-v1",
    priority: 1
  },
  {
    rule_name: "OPENAI_LOG_SUMMARY_DEFAULT",
    biz_type: "construction_log",
    task_type: "log_summary",
    prompt_key: "prompt-log-summary-v1",
    priority: 1
  }
];

const seedDefaultApprovalConfig = async (db: Env["DB"], now: string) => {
  for (const item of defaultApprovalTemplates) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO approval_template
          (template_code, template_name, biz_type, config_json, status,
           created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'active', 'system', ?, ?)`
      )
      .bind(
        item.template_code,
        item.template_name,
        item.biz_type,
        item.config_json,
        now,
        now
      )
      .run();
  }

  for (const item of defaultThresholdSeeds) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO approval_threshold
          (template_id, condition_field, operator, threshold_value, threshold_value_upper,
           target_branch, priority, status, created_at, updated_at)
         SELECT id, ?, ?, ?, ?, ?, ?, 'active', ?, ?
           FROM approval_template
          WHERE template_code = ?`
      )
      .bind(
        item.condition_field,
        item.operator,
        item.threshold_value,
        item.threshold_value_upper,
        item.target_branch,
        item.priority,
        now,
        now,
        item.template_code
      )
      .run();
  }
};

const seedDefaultAiConfig = async (
  db: Env["DB"],
  now: string,
  options: { openaiModel: string; openaiEndpoint: string }
) => {
  const openaiConfigJson = JSON.stringify({
    api_key_env: "OPENAI_API_KEY",
    service_tier: "auto",
    timeout_ms: 30000,
    max_retries: 2
  });

  await db
    .prepare(
      `INSERT OR IGNORE INTO ai_provider_config
        (provider_key, provider_name, api_endpoint, model_id, config_json,
         priority, max_concurrent, status, created_at, updated_at)
       VALUES ('openai', 'OpenAI ChatGPT', ?, ?, ?, 1, 10, 'active', ?, ?)`
    )
    .bind(options.openaiEndpoint, options.openaiModel, openaiConfigJson, now, now)
    .run();

  await db
    .prepare(
      `UPDATE ai_provider_config
          SET provider_name = 'OpenAI ChatGPT',
              api_endpoint = ?,
              model_id = ?,
              config_json = ?,
              priority = 1,
              max_concurrent = 10,
              status = 'active',
              updated_at = ?
        WHERE provider_key = 'openai'`
    )
    .bind(options.openaiEndpoint, options.openaiModel, openaiConfigJson, now)
    .run();

  await db
    .prepare(
      `INSERT OR IGNORE INTO ai_provider_config
        (provider_key, provider_name, api_endpoint, model_id, config_json,
         priority, max_concurrent, status, created_at, updated_at)
       VALUES ('local', 'Local Rules', 'local://rules', 'local-rules', ?, 90, 200, 'active', ?, ?)`
    )
    .bind(JSON.stringify({ mode: "rule_based" }), now, now)
    .run();

  const runnerRuntimeDefaults: Array<{
    config_key: string;
    config_value: string;
    is_secret: 0 | 1;
  }> = [
    { config_key: "OPENAI_MODEL", config_value: options.openaiModel, is_secret: 0 },
    { config_key: "OPENAI_MODEL_CONTRACT_REVIEW_TEXT", config_value: "gpt-5.2", is_secret: 0 },
    { config_key: "OPENAI_MODEL_CONTRACT_REVIEW_VISION", config_value: "gpt-4o", is_secret: 0 },
    { config_key: "OPENAI_MODEL_REASONING", config_value: "gpt-5.1", is_secret: 0 },
    { config_key: "OPENAI_MODEL_FAST", config_value: "gpt-5-mini", is_secret: 0 },
    { config_key: "OPENAI_MODEL_EFFICIENT", config_value: "gpt-5-nano", is_secret: 0 },
    { config_key: "OPENAI_MODEL_CHAT", config_value: "gpt-5.2-chat-latest", is_secret: 0 },
    { config_key: "OPENAI_MODEL_CHAT_COMPAT", config_value: "gpt-5.1-chat-latest", is_secret: 0 },
    { config_key: "OPENAI_MODEL_SEARCH", config_value: "gpt-5-search-api", is_secret: 0 },
    { config_key: "OPENAI_MODEL_TRANSCRIBE", config_value: "gpt-4o-transcribe", is_secret: 0 },
    { config_key: "OPENAI_MODEL_VISION_FALLBACK", config_value: "gpt-4o", is_secret: 0 },
    { config_key: "OPENAI_API_KEY", config_value: "", is_secret: 1 },
    { config_key: "OPENAI_BASE_URL", config_value: options.openaiEndpoint, is_secret: 0 }
  ];

  for (const item of runnerRuntimeDefaults) {
    await db
      .prepare(
        `INSERT INTO runner_runtime_config
          (config_key, config_value, is_secret, updated_by, created_at, updated_at)
         VALUES (?, ?, ?, 'system', ?, ?)
         ON CONFLICT(config_key) DO UPDATE SET
           config_value = excluded.config_value,
           is_secret = excluded.is_secret,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`
      )
      .bind(item.config_key, item.config_value, item.is_secret, now, now)
      .run();
  }

  for (const prompt of defaultAiPromptTemplates) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO ai_prompt_template
          (template_key, template_name, system_prompt, user_prompt_template,
           variables_schema, version, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?)`
      )
      .bind(
        prompt.template_key,
        prompt.template_name,
        prompt.system_prompt,
        prompt.user_prompt_template,
        JSON.stringify({ payload_json: "string" }),
        now,
        now
      )
      .run();

    await db
      .prepare(
        `UPDATE ai_prompt_template
            SET template_name = ?,
                system_prompt = ?,
                user_prompt_template = ?,
                status = 'active',
                updated_at = ?
          WHERE template_key = ?`
      )
      .bind(
        prompt.template_name,
        prompt.system_prompt,
        prompt.user_prompt_template,
        now,
        prompt.template_key
      )
      .run();
  }

  const providersRows = await db
    .prepare(
      "SELECT id, provider_key FROM ai_provider_config WHERE provider_key IN ('openai', 'local')"
    )
    .all<{ id: number; provider_key: string }>();
  const providerIdMap = new Map(
    (providersRows.results ?? []).map((item) => [item.provider_key, item.id])
  );

  const promptRows = await db
    .prepare(
      "SELECT id, template_key FROM ai_prompt_template WHERE status = 'active'"
    )
    .all<{ id: number; template_key: string }>();
  const promptIdMap = new Map(
    (promptRows.results ?? []).map((item) => [item.template_key, item.id])
  );

  const openaiProviderId = providerIdMap.get("openai");
  if (!openaiProviderId) {
    return;
  }

  for (const rule of defaultAiRoutingRules) {
    const promptTemplateId = promptIdMap.get(rule.prompt_key) ?? null;
    const existing = await db
      .prepare("SELECT id FROM ai_routing_rule WHERE rule_name = ? LIMIT 1")
      .bind(rule.rule_name)
      .first<{ id: number }>();

    if (existing?.id) {
      await db
        .prepare(
          `UPDATE ai_routing_rule
              SET biz_type = ?,
                  task_type = ?,
                  provider_id = ?,
                  prompt_template_id = ?,
                  priority = ?,
                  status = 'active',
                  updated_at = ?
            WHERE id = ?`
        )
        .bind(
          rule.biz_type,
          rule.task_type,
          openaiProviderId,
          promptTemplateId,
          rule.priority,
          now,
          existing.id
        )
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO ai_routing_rule
            (rule_name, biz_type, task_type, condition_json, provider_id, prompt_template_id,
             priority, status, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, 'active', ?, ?)`
        )
        .bind(
          rule.rule_name,
          rule.biz_type,
          rule.task_type,
          openaiProviderId,
          promptTemplateId,
          rule.priority,
          now,
          now
        )
        .run();
    }
  }
};

export const adminRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

const runnerConfigKeyPattern = /^[A-Z0-9_]{2,64}$/;

adminRoutes.use("*", authMiddleware);

adminRoutes.get(
  "/runner-runtime-config",
  requireRoles(["super_admin"]),
  async (c) => {
    const rows = await listRunnerRuntimeConfig(c.env);
    return c.json({ success: true, data: rows });
  }
);

adminRoutes.post(
  "/runner-runtime-config",
  requireRoles(["super_admin"]),
  async (c) => {
    const auth = c.get("auth");
    const body = (await c.req.json().catch(() => ({}))) as {
      items?: Array<{
        config_key?: string;
        config_value?: string;
        is_secret?: boolean | number;
      }>;
    };

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return c.json(
        {
          success: false,
          error: { message: "items is required" }
        },
        400
      );
    }

    const normalized: Array<{
      config_key: string;
      config_value: string;
      is_secret: 0 | 1;
    }> = [];

    for (const item of body.items) {
      const key = typeof item.config_key === "string" ? item.config_key.trim() : "";
      const value = typeof item.config_value === "string" ? item.config_value : "";
      const isSecret = item.is_secret ? 1 : 0;

      if (!runnerConfigKeyPattern.test(key)) {
        return c.json(
          {
            success: false,
            error: { message: `invalid config_key: ${key}` }
          },
          400
        );
      }

      normalized.push({
        config_key: key,
        config_value: value,
        is_secret: isSecret
      });
    }

    const rows = await upsertRunnerRuntimeConfig(c.env, normalized, auth.sub);

    return c.json({ success: true, data: rows });
  }
);

adminRoutes.post(
  "/ai-runtime/test-task",
  requireRoles(["super_admin"]),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      task_type?: string;
      biz_type?: string;
      biz_id?: number;
      payload?: Record<string, unknown>;
      priority?: number;
    };

    const requestedTaskType =
      typeof body.task_type === "string" && body.task_type.trim()
        ? body.task_type.trim()
        : "contract_review";

    if (!taskTypes.includes(requestedTaskType as (typeof taskTypes)[number])) {
      return c.json(
        {
          success: false,
          error: { message: `Unsupported task_type: ${requestedTaskType}` }
        },
        400
      );
    }

    const taskType = requestedTaskType as (typeof taskTypes)[number];
    const bizType =
      typeof body.biz_type === "string" && body.biz_type.trim()
        ? body.biz_type.trim()
        : "ai_runtime_test";
    const bizId =
      typeof body.biz_id === "number" && Number.isFinite(body.biz_id)
        ? body.biz_id
        : Number(new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12));

    const defaultPayloadByTask: Record<(typeof taskTypes)[number], Record<string, unknown>> = {
      contract_review: {
        contract_id: bizId,
        contract_name: "AI Runtime Test Contract",
        total_amount: 128000,
        payment_terms: "30%预付款，70%验收后支付"
      },
      risk_assessment: {
        amount: 128000,
        payee_name: "测试收款方",
        scenario: "runtime_test"
      },
      payment_risk_assessment: {
        amount: 128000,
        payee_name: "测试收款方",
        scenario: "runtime_test"
      },
      reimbursement_check: {
        total_amount: 3680,
        items: [{ amount: 1200, category: "交通" }, { amount: 2480, category: "材料" }]
      },
      reimbursement_anomaly: {
        amount: 3680,
        duplicate_count: 0
      },
      log_smart_fill: {
        previous_log: { weather: "晴", cumulative_pipe_count: 48 },
        completed_pipe_count: 6
      },
      log_analysis: {
        content: "今日推进作业正常，设备状态良好。"
      },
      log_summary: {
        report_type: "daily",
        date_from: new Date().toISOString().slice(0, 10),
        date_to: new Date().toISOString().slice(0, 10)
      },
      equipment_recommend: {
        project_type: "municipal",
        budget: 560000
      },
      consumable_estimation: {
        items: [{ asset_type_id: 1, planned_qty: 120 }]
      },
      inventory_alert_analysis: {
        quantity: 12,
        min_stock: 30
      },
      consumption_anomaly: {
        quantity: 66
      },
      ocr_extract: {
        file_url: "test://sample-receipt"
      },
      file_generate: {
        envelope_uuid: crypto.randomUUID(),
        envelope_no: `TEST-${Date.now()}`,
        project_id: "TEST-PROJ",
        applicant_userid: "super_admin",
        created_at: new Date().toISOString(),
        submitted_at: new Date().toISOString(),
        received_at: new Date().toISOString()
      },
      voice_stt: {
        scene: "finance",
        file_key: "test://voice"
      },
      approval_ai_gate: {
        approval_id: bizId,
        context: "runtime_test"
      }
    };

    const mergedPayload = {
      ...defaultPayloadByTask[taskType],
      ...(body.payload ?? {})
    };

    const task = await createTask(c.env, {
      task_type: taskType,
      biz_type: bizType,
      biz_id: bizId,
      payload: mergedPayload,
      priority:
        typeof body.priority === "number" && Number.isFinite(body.priority)
          ? body.priority
          : 9
    });

    return c.json({
      success: true,
      data: {
        task_id: task.id,
        task_code: task.task_code,
        task_type: task.task_type,
        biz_type: task.biz_type,
        biz_id: task.biz_id,
        status: task.status,
        created_at: task.created_at
      }
    });
  }
);

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

adminRoutes.post(
  "/approval-config/bootstrap-initial",
  requireRoles(["super_admin"]),
  async (c) => {
    const now = nowIso();
    await seedDefaultApprovalConfig(c.env.DB, now);

    const templateCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM approval_template WHERE status = 'active'"
    ).first<{ total: number }>();

    const thresholdCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM approval_threshold WHERE status = 'active'"
    ).first<{ total: number }>();

    return c.json({
      success: true,
      data: {
        templates_active: templateCount?.total ?? 0,
        thresholds_active: thresholdCount?.total ?? 0
      }
    });
  }
);

adminRoutes.post(
  "/bootstrap/near-production-openai",
  requireRoles(["super_admin"]),
  async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      openai_model?: string;
      openai_endpoint?: string;
    };
    const now = nowIso();
    const openaiModel =
      typeof body.openai_model === "string" && body.openai_model.trim()
        ? body.openai_model.trim()
        : "gpt-5.2";
    const openaiEndpoint =
      typeof body.openai_endpoint === "string" && body.openai_endpoint.trim()
        ? body.openai_endpoint.trim()
        : "https://api.openai.com/v1";

    await seedDefaultApprovalConfig(c.env.DB, now);
    await seedDefaultAiConfig(c.env.DB, now, {
      openaiModel,
      openaiEndpoint
    });
    await refreshRunnerRuntimeKvFromDb(c.env);

    const templates = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM approval_template WHERE status = 'active'"
    ).first<{ total: number }>();
    const thresholds = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM approval_threshold WHERE status = 'active'"
    ).first<{ total: number }>();
    const providers = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM ai_provider_config WHERE status = 'active'"
    ).first<{ total: number }>();
    const routingRules = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM ai_routing_rule WHERE status = 'active'"
    ).first<{ total: number }>();
    const prompts = await c.env.DB.prepare(
      "SELECT COUNT(*) as total FROM ai_prompt_template WHERE status = 'active'"
    ).first<{ total: number }>();

    return c.json({
      success: true,
      data: {
        openai_model: openaiModel,
        openai_endpoint: openaiEndpoint,
        templates_active: templates?.total ?? 0,
        thresholds_active: thresholds?.total ?? 0,
        ai_providers_active: providers?.total ?? 0,
        ai_routing_rules_active: routingRules?.total ?? 0,
        ai_prompts_active: prompts?.total ?? 0
      }
    });
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

adminRoutes.get("/thresholds", async (c) => {
  const bizType = c.req.query("biz_type");

  let sql = `SELECT at2.* FROM approval_threshold at2
    JOIN approval_template atp ON atp.id = at2.template_id
    WHERE at2.status = 'active' AND atp.status = 'active'`;
  const params: string[] = [];

  if (bizType) {
    sql += " AND atp.biz_type = ?";
    params.push(bizType);
  }

  sql += " ORDER BY at2.priority ASC, at2.id ASC";

  const rows = await c.env.DB.prepare(sql)
    .bind(...params)
    .all<ApprovalThreshold>();

  return c.json({ success: true, data: rows.results ?? [] });
});

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
