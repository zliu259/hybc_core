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
import { createAiGateHandler, createTask } from "../services/ai-slot";
import { advanceWorkflow } from "../services/approval/engine";
import {
  resolveApplicantDisplayName,
  resolveApprovalPushMeta,
  sendApprovalTodoTemplateCard
} from "../services/wecom-approval-push";
import {
  listRunnerRuntimeConfig,
  upsertRunnerRuntimeConfig,
  refreshRunnerRuntimeKvFromDb
} from "../services/runner-runtime";
import { listAllGrants, revokeGrant, getGrantById } from "../services/agent-grant";

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
      '{"version":1,"start_key":"dept_approve","nodes":[{"key":"dept_approve","type":"sequential","name":"部门负责人审批","assignee_userids":["site_manager"],"next_key":"ai_gate_risk"},{"key":"ai_gate_risk","type":"ai_gate","name":"AI风险关卡","ai_slot_id":"payment_request","next_key":"finance_review"},{"key":"finance_review","type":"sequential","name":"财务审批","assignee_userids":["finance_manager"],"conditions":[{"field":"amount","operator":"gt","value":500000,"next_key":"gm_approve"}],"default_next_key":"cashier_execute"},{"key":"gm_approve","type":"sequential","name":"总经理审批","assignee_userids":["general_manager"],"next_key":"cashier_execute"},{"key":"cashier_execute","type":"auto","name":"出纳执行","auto_action":"approve","next_key":"notify_cc"},{"key":"notify_cc","type":"cc","name":"抄送归档","assignee_userids":["site_manager"],"next_key":null}]}'
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
    template_code: "TPL-INVOICE-REQUEST",
    template_name: "开票申请审批模板",
    biz_type: "invoice_request",
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
    threshold_value: 10000,
    threshold_value_upper: null,
    target_branch: "default",
    priority: 1
  },
  {
    template_code: "TPL-PAYMENT-REQUEST",
    condition_field: "amount",
    operator: "between",
    threshold_value: 10000,
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
      "你是企业财务风控助手。你必须仅输出JSON对象，不要使用markdown代码块。字段固定为overall_risk、score、summary、recommendations、checks。",
    user_prompt_template:
      "请评估付款风险。任务类型={{task_type}}，业务类型={{biz_type}}，业务ID={{biz_id}}。输入JSON={{payload_json}}。重点检查：金额合理性、收款方一致性、历史重复支付、合同余额约束。若关键信息缺失，明确列出缺失字段并给出可执行补充建议。"
  },
  {
    template_key: "prompt-contract-review-v1",
    template_name: "合同审查默认提示词",
    system_prompt:
      "你是企业合同审查助手。你必须仅输出JSON对象，不要使用markdown代码块。字段固定为overall_risk、score、summary、clause_analysis、recommendations。",
    user_prompt_template:
      "请审查合同。任务类型={{task_type}}，业务ID={{biz_id}}。合同编号={{contract_no}}，合同名称={{contract_name}}，相对方={{counterparty}}，金额={{total_amount}}。输入JSON={{payload_json}}。重点关注：付款条款、违约责任、验收条件、争议解决、金额与节点匹配。"
  },
  {
    template_key: "prompt-reimbursement-anomaly-v1",
    template_name: "报销异常检测默认提示词",
    system_prompt:
      "你是企业报销审计助手。你必须仅输出JSON对象，不要使用markdown代码块。字段固定为risk_level、summary、anomalies、recommendation。",
    user_prompt_template:
      "请检测报销异常。任务类型={{task_type}}，业务ID={{biz_id}}。报销单ID={{envelope_id}}，总金额={{total_amount}}，明细={{items}}。输入JSON={{payload_json}}。重点检查：重复票据（含附件重复）、金额异常、报销合理性、附件分类是否正确、时间冲突、供应商异常。"
  },
  {
    template_key: "prompt-approval-ai-gate-v1",
    template_name: "审批AI关卡默认提示词",
    system_prompt:
      "你是审批AI关卡助手。你必须仅输出JSON对象，不要使用markdown代码块。字段固定为outcome(approve/reject)和comment。comment必须同时包含‘审查摘要’与‘结论依据’两部分。若业务类型为reimbursement_batch，本关卡目标是汇总单项AI审查结论并判断报销内容合理性；不是重新做票据真实性核验。",
    user_prompt_template:
      '请对审批关卡做决策。任务类型={{task_type}}，业务类型={{biz_type}}，业务ID={{biz_id}}。节点={{node_key}}，审批实例={{instance_id}}，上下文={{context}}。输入JSON={{payload_json}}。\n输出要求：\n1) 仅返回JSON：{"outcome":"approve|reject","comment":"..."}\n2) comment必须使用以下结构："审查摘要：<提炼关键事实与单项AI结论；若biz_type为reimbursement_batch，优先汇总reimbursement_item_reviews中的结论与风险>；结论依据：<结合业务内容、金额、单项结论与抽查附件的一致性，说明通过/拒绝理由>"\n3) 当biz_type为reimbursement_batch时，不因‘缺少可读附件正文’单独判拒；应以单项AI结论、票据识别结果和业务合理性为主要依据。若发现高风险异常、金额不一致或关键结论冲突，再reject并明确需人工补核项。\n4) 对非reimbursement_batch业务，仍可结合附件证据做一致性判断。'
  },
  {
    template_key: "prompt-log-summary-v1",
    template_name: "施工日志汇总默认提示词",
    system_prompt:
      "你是项目日志汇总助手。你必须仅输出JSON对象，不要使用markdown代码块。字段固定为summary、highlights、progress_alert。",
    user_prompt_template:
      "请生成日志汇总。任务类型={{task_type}}，业务ID={{biz_id}}，汇总类型={{report_type}}，日期范围={{date_from}}到{{date_to}}，项目={{project_id}}。输入JSON={{payload_json}}。输出简洁摘要、关键进展和风险预警。"
  },
  {
    template_key: "prompt-external-log-audit-v1",
    template_name: "外包日志AI审计默认提示词",
    system_prompt:
      "你是施工项目日志审计助手。你必须仅输出JSON对象，不要使用markdown代码块。字段固定为decision、risk_level、score、summary、issues。decision只能是auto_approve或needs_manual_review；risk_level只能是low、medium、high；score为0-100整数；issues为数组，每项包含severity和message。",
    user_prompt_template:
      "请审计外包人员提交的标段施工日志和项目日志。任务类型={{task_type}}，业务ID={{biz_id}}。输入JSON={{payload_json}}。重点检查：1) 标段施工日志与历史施工日志的连续性，累计下管数量不能倒退，进尺和下管数量应合理；2) 同项目同标段同日期同班次是否重复；3) 施工日志与项目日志在停工、风险、天气、土质、问题描述上是否矛盾；4) 必填字段是否完整；5) 日期是否符合项目施工周期；6) 文本是否明显无意义或模板化。只有无硬性错误且风险低时输出auto_approve，否则输出needs_manual_review并列明问题。"
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
    biz_type: "approval_ai_gate",
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
  },
  {
    rule_name: "OPENAI_EXTERNAL_LOG_AUDIT_DEFAULT",
    biz_type: "external_log_submission",
    task_type: "external_log_audit",
    prompt_key: "prompt-external-log-audit-v1",
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
      .bind(item.template_code, item.template_name, item.biz_type, item.config_json, now, now)
      .run();

    await db
      .prepare(
        `UPDATE approval_template
            SET template_name = ?,
                biz_type = ?,
                config_json = ?,
                status = 'active',
                updated_at = ?
          WHERE template_code = ?`
      )
      .bind(item.template_name, item.biz_type, item.config_json, now, item.template_code)
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
    { config_key: "OPENAI_MODEL_CONTRACT_REVIEW_TEXT", config_value: "gpt-5.5", is_secret: 0 },
    { config_key: "OPENAI_MODEL_CONTRACT_REVIEW_VISION", config_value: "gpt-4o", is_secret: 0 },
    { config_key: "OPENAI_MODEL_REASONING", config_value: "gpt-5.1", is_secret: 0 },
    { config_key: "OPENAI_MODEL_FAST", config_value: "gpt-5-mini", is_secret: 0 },
    { config_key: "OPENAI_MODEL_EFFICIENT", config_value: "gpt-5-nano", is_secret: 0 },
    { config_key: "OPENAI_MODEL_CHAT", config_value: "gpt-5.5", is_secret: 0 },
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
    .prepare("SELECT id, template_key FROM ai_prompt_template WHERE status = 'active'")
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

type WeComPushMonitorEventRow = {
  id: number;
  event_type: string;
  event_source: string;
  event_payload: string;
  created_at: string;
};

type WeComPushMonitorTotals = {
  sent_count: number;
  failed_count: number;
  isolation_guard_count: number;
  summary_count: number;
};

const runnerConfigKeyPattern = /^[A-Z0-9_]{2,64}$/;

export const adminRevokeAgentGrant = async (
  db: D1Database,
  grantId: string,
  revokedBy: string
): Promise<void> => {
  await revokeGrant(db, grantId, revokedBy);
};

adminRoutes.use("*", authMiddleware);

adminRoutes.get("/agent/grants", requireRoles(["super_admin"]), async (c) => {
  const grants = await listAllGrants(c.env.DB);
  return c.json({ success: true, data: grants });
});

adminRoutes.post("/agent/grants/:id/revoke", requireRoles(["super_admin"]), async (c) => {
  const id = c.req.param("id");
  const grant = await getGrantById(c.env.DB, id);
  if (!grant) return c.json({ success: false, error: { message: "Grant not found" } }, 404);
  await adminRevokeAgentGrant(c.env.DB, id, c.get("auth").sub);
  return c.json({ success: true, data: { revoked: true } });
});

adminRoutes.get("/wecom-push/monitor", requireRoles(["super_admin"]), async (c) => {
  const hoursRaw = Number(c.req.query("hours") ?? "24");
  const limitRaw = Number(c.req.query("limit") ?? "100");
  const hours = Number.isFinite(hoursRaw) ? Math.max(1, Math.min(168, Math.floor(hoursRaw))) : 24;
  const limit = Number.isFinite(limitRaw) ? Math.max(20, Math.min(500, Math.floor(limitRaw))) : 100;

  const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const totalsRow = await c.env.DB.prepare(
    `SELECT
         SUM(CASE WHEN event_type = 'wecom_template_card_sent' THEN 1 ELSE 0 END) AS sent_count,
         SUM(CASE WHEN event_type = 'wecom_template_card_failed' THEN 1 ELSE 0 END) AS failed_count,
         SUM(CASE WHEN event_type = 'wecom_template_card_isolation_guard' THEN 1 ELSE 0 END) AS isolation_guard_count,
         SUM(CASE WHEN event_type = 'wecom_template_card_summary' THEN 1 ELSE 0 END) AS summary_count
       FROM event_log
       WHERE event_type LIKE 'wecom_template_card_%'
         AND created_at >= ?`
  )
    .bind(sinceIso)
    .first<WeComPushMonitorTotals>();

  const rows = await c.env.DB.prepare(
    `SELECT id, event_type, event_source, event_payload, created_at
       FROM event_log
       WHERE event_type LIKE 'wecom_template_card_%'
         AND created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`
  )
    .bind(sinceIso, limit)
    .all<WeComPushMonitorEventRow>();

  const recent = (rows.results ?? []).map((item) => {
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(item.event_payload) as Record<string, unknown>;
    } catch {
      payload = { raw: item.event_payload };
    }

    return {
      id: item.id,
      event_type: item.event_type,
      event_source: item.event_source,
      created_at: item.created_at,
      payload
    };
  });

  const errorCounter = new Map<string, number>();
  recent.forEach((item) => {
    const payload = item.payload ?? {};
    const singleError = typeof payload.error === "string" ? payload.error.trim() : "";
    if (singleError) {
      errorCounter.set(singleError, (errorCounter.get(singleError) ?? 0) + 1);
    }

    const errors = Array.isArray(payload.errors)
      ? payload.errors.filter((entry): entry is string => typeof entry === "string")
      : [];
    errors.forEach((entry) => {
      const message = entry.trim();
      if (!message) return;
      errorCounter.set(message, (errorCounter.get(message) ?? 0) + 1);
    });
  });

  const top_errors = [...errorCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([message, count]) => ({ message, count }));

  const sentCount = totalsRow?.sent_count ?? 0;
  const failedCount = totalsRow?.failed_count ?? 0;
  const successRateBase = sentCount + failedCount;
  const successRate = successRateBase > 0 ? Number((sentCount / successRateBase).toFixed(4)) : 0;

  return c.json({
    success: true,
    data: {
      window_hours: hours,
      since: sinceIso,
      totals: {
        sent_count: sentCount,
        failed_count: failedCount,
        isolation_guard_count: totalsRow?.isolation_guard_count ?? 0,
        summary_count: totalsRow?.summary_count ?? 0,
        success_rate: successRate
      },
      top_errors,
      recent
    }
  });
});

adminRoutes.post("/wecom-push/force-current-nodes", requireRoles(["super_admin"]), async (c) => {
  const auth = c.get("auth");
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT
         ai.id AS instance_id,
         ai.instance_no,
         ai.biz_type,
         ai.biz_id,
         ai.biz_summary,
         ai.initiator_userid,
         COALESCE(ani.node_name, ai.current_node_key, '当前节点') AS current_node_name,
         at2.assignee_userid
       FROM approval_instance ai
       JOIN approval_task at2
         ON at2.instance_id = ai.id
        AND at2.status = 'pending'
        AND at2.assignee_userid IS NOT NULL
        AND at2.assignee_userid != ''
       LEFT JOIN approval_node_instance ani
         ON ani.instance_id = ai.id
        AND ani.node_key = ai.current_node_key
        AND ani.round = ai.current_round
       WHERE ai.status = 'in_progress'
       ORDER BY ai.id DESC`
  ).all<{
    instance_id: number;
    instance_no: string;
    biz_type: string;
    biz_id: number;
    biz_summary: string;
    initiator_userid: string;
    current_node_name: string;
    assignee_userid: string;
  }>();

  const items = rows.results ?? [];
  let successCount = 0;
  let failureCount = 0;
  const errors: string[] = [];
  const applicantNameCache = new Map<string, string>();
  const pushMetaCache = new Map<number, { requestTitle: string; amountText: string | null }>();
  const instanceSet = new Set<number>();

  for (const item of items) {
    instanceSet.add(item.instance_id);
    try {
      let applicantName = applicantNameCache.get(item.initiator_userid);
      if (!applicantName) {
        applicantName = await resolveApplicantDisplayName(c.env, item.initiator_userid);
        applicantNameCache.set(item.initiator_userid, applicantName);
      }

      let pushMeta = pushMetaCache.get(item.instance_id);
      if (!pushMeta) {
        pushMeta = await resolveApprovalPushMeta(
          c.env,
          item.biz_type,
          item.biz_id,
          item.biz_summary
        );
        pushMetaCache.set(item.instance_id, pushMeta);
      }

      const result = await sendApprovalTodoTemplateCard(
        c.env,
        {
          instanceId: item.instance_id,
          instanceNo: item.instance_no,
          bizType: item.biz_type,
          bizId: item.biz_id,
          bizSummary: item.biz_summary,
          currentNodeName: item.current_node_name,
          assigneeUserId: item.assignee_userid,
          applicantName,
          requestTitle: pushMeta.requestTitle,
          amountText: pushMeta.amountText ?? undefined
        },
        {
          disableDuplicateCheck: true
        }
      );

      successCount += 1;
      await c.env.DB.prepare(
        "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
      )
        .bind(
          "wecom_template_card_sent",
          "admin-force-current-nodes",
          JSON.stringify({
            instance_id: item.instance_id,
            assignee_userid: item.assignee_userid,
            msgid: result.msgid,
            invaliduser: result.invaliduser,
            unlicenseduser: result.unlicenseduser,
            force_scan: true,
            operated_by: auth.sub
          }),
          nowIso()
        )
        .run();
    } catch (error) {
      failureCount += 1;
      const message = error instanceof Error ? error.message : "send failed";
      errors.push(`${item.instance_id}/${item.assignee_userid}: ${message}`);
      await c.env.DB.prepare(
        "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
      )
        .bind(
          "wecom_template_card_failed",
          "admin-force-current-nodes",
          JSON.stringify({
            instance_id: item.instance_id,
            assignee_userid: item.assignee_userid,
            error: message,
            force_scan: true,
            operated_by: auth.sub
          }),
          nowIso()
        )
        .run();
    }
  }

  await c.env.DB.prepare(
    "INSERT INTO event_log (event_type, event_source, event_payload, created_at) VALUES (?, ?, ?, ?)"
  )
    .bind(
      "wecom_template_card_summary",
      "admin-force-current-nodes",
      JSON.stringify({
        force_scan: true,
        operated_by: auth.sub,
        scanned_instances: instanceSet.size,
        scanned_recipients: items.length,
        success_count: successCount,
        failure_count: failureCount,
        errors: errors.slice(0, 100)
      }),
      nowIso()
    )
    .run();

  return c.json({
    success: true,
    data: {
      scanned_instances: instanceSet.size,
      scanned_recipients: items.length,
      success_count: successCount,
      failure_count: failureCount,
      errors: errors.slice(0, 20)
    }
  });
});

adminRoutes.get("/runner-runtime-config", requireRoles(["super_admin"]), async (c) => {
  const rows = await listRunnerRuntimeConfig(c.env);
  return c.json({ success: true, data: rows });
});

adminRoutes.post("/runner-runtime-config", requireRoles(["super_admin"]), async (c) => {
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
});

adminRoutes.post("/runner-nodes/:nodeId/activate", requireRoles(["super_admin"]), async (c) => {
  const nodeId = c.req.param("nodeId");
  const now = nowIso();

  const target = await c.env.DB.prepare("SELECT id FROM compute_node WHERE node_id = ?")
    .bind(nodeId)
    .first<{ id: number }>();

  if (!target) {
    return c.json(
      {
        success: false,
        error: { message: "Runner节点不存在" }
      },
      404
    );
  }

  await c.env.DB.prepare(
    `UPDATE compute_node
       SET status = 'online',
           last_heartbeat_at = ?,
           updated_at = ?
       WHERE id = ?`
  )
    .bind(now, now, target.id)
    .run();

  return c.json({ success: true });
});

adminRoutes.post("/ai-runtime/test-task", requireRoles(["super_admin"]), async (c) => {
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
      : Number(
          new Date()
            .toISOString()
            .replace(/[-:TZ.]/g, "")
            .slice(0, 12)
        );

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
      items: [
        { amount: 1200, category: "交通" },
        { amount: 2480, category: "材料" }
      ]
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
    external_log_audit: {
      submission_id: bizId,
      project: { id: 1, project_name: "测试项目", status: "active" },
      section: { id: 1, section_code: "S1", section_name: "测试标段" },
      log_date: new Date().toISOString().slice(0, 10),
      shift: "day",
      operator_log: {
        completed_pipe_count: 6,
        cumulative_pipe_count: 54,
        footage_m: 9.5,
        issue_summary: "设备运行正常"
      },
      project_log: {
        detail_html: "今日完成白班顶进作业，现场协调正常。",
        risk_note: ""
      },
      context: {
        previous_operator_logs: [{ cumulative_pipe_count: 48, footage_m: 8.8 }],
        previous_project_logs: []
      }
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
    },
    warehouse_task_dispatch_recommendation: {
      no_auto_dispatch: true,
      tasks: [{ id: bizId, work_order_no: "WO-TEST", priority: "urgent" }],
      workload_summary: []
    },
    tbm_composition_recommendation: {
      no_auto_apply: true,
      core_asset_id: bizId,
      candidates: []
    },
    warehouse_manual_draft: {
      manual_id: bizId,
      manual_title: "库房手册 AI 草稿测试",
      historical_tasks: [{ work_order_no: "WO-TEST", result_summary: "检查正常" }]
    },
    warehouse_task_summary: {
      human_edit_required: true,
      task: {
        id: bizId,
        work_order_no: "WO-TEST",
        work_order_type: "inspection",
        result_summary: "检查正常"
      },
      evidence: []
    },
    bidding_dedup_rewrite: {
      paragraphs: [{ id: "test#0", text: "测试段落内容。" }]
    },
    contract_draft_section: {
      draft_id: bizId,
      section_key: "test_section",
      title: "测试条款",
      instruction: "生成一段测试条款内容",
      direction: "outbound"
    },
    contract_compliance_review: {
      draft_id: bizId,
      section_key: "test_section",
      content: "测试条款内容，用于合规审查。"
    },
    contract_completeness_check: {
      draft_id: bizId,
      direction: "outbound",
      section_keys: ["test_section"]
    },
    contract_completeness_audit: {
      draft_id: bizId,
      direction: "outbound",
      initial_result_json: "{}"
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
      typeof body.priority === "number" && Number.isFinite(body.priority) ? body.priority : 9
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
});

// ─── Approval Template CRUD ──────────

// GET /approval-config — List templates
adminRoutes.get("/approval-config", requireRoles(["super_admin"]), async (c) => {
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
});

adminRoutes.post("/approval-config/bootstrap-initial", requireRoles(["super_admin"]), async (c) => {
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
});

adminRoutes.post("/bootstrap/near-production-openai", requireRoles(["super_admin"]), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    openai_model?: string;
    openai_endpoint?: string;
  };
  const now = nowIso();
  const openaiModel =
    typeof body.openai_model === "string" && body.openai_model.trim()
      ? body.openai_model.trim()
      : "gpt-5.5";
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
});

// POST /approval-config — Create template
adminRoutes.post("/approval-config", requireRoles(["super_admin"]), async (c) => {
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
});

// PUT /approval-config/:id — Update template
adminRoutes.put("/approval-config/:id", requireRoles(["super_admin"]), async (c) => {
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
});

// DELETE /approval-config/:id — Soft delete template
adminRoutes.delete("/approval-config/:id", requireRoles(["super_admin"]), async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(
    "UPDATE approval_template SET status = 'disabled', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), id)
    .run();

  return c.json({ success: true });
});

// ─── Threshold CRUD ──────────

// GET /threshold — List thresholds
adminRoutes.get("/threshold", requireRoles(["super_admin"]), async (c) => {
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
});

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
adminRoutes.post("/threshold", requireRoles(["super_admin"]), async (c) => {
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
});

// PUT /threshold/:id — Update threshold
adminRoutes.put("/threshold/:id", requireRoles(["super_admin"]), async (c) => {
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
});

// DELETE /threshold/:id — Soft delete threshold
adminRoutes.delete("/threshold/:id", requireRoles(["super_admin"]), async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(
    "UPDATE approval_threshold SET status = 'disabled', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), id)
    .run();

  return c.json({ success: true });
});

// ─── AI Provider Config CRUD ──────────

// GET /ai-provider — List providers
adminRoutes.get("/ai-provider", requireRoles(["super_admin"]), async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM ai_provider_config WHERE status != 'deleted' ORDER BY priority ASC"
  ).all<AiProviderConfig>();

  return c.json({ success: true, data: rows.results ?? [] });
});

// POST /ai-provider — Create provider
adminRoutes.post("/ai-provider", requireRoles(["super_admin"]), async (c) => {
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
});

// PUT /ai-provider/:id — Update provider
adminRoutes.put("/ai-provider/:id", requireRoles(["super_admin"]), async (c) => {
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
});

// DELETE /ai-provider/:id — Soft delete provider
adminRoutes.delete("/ai-provider/:id", requireRoles(["super_admin"]), async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(
    "UPDATE ai_provider_config SET status = 'disabled', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), id)
    .run();

  return c.json({ success: true });
});

// ─── AI Routing Rule CRUD ──────────

// GET /ai-routing — List routing rules
adminRoutes.get("/ai-routing", requireRoles(["super_admin"]), async (c) => {
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
});

adminRoutes.get("/ai-slot-options", requireRoles(["super_admin"]), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT
         ar.rule_name,
         ar.biz_type,
         ar.task_type,
         ap.provider_name,
         pt.template_name
       FROM ai_routing_rule ar
       LEFT JOIN ai_provider_config ap ON ap.id = ar.provider_id
       LEFT JOIN ai_prompt_template pt ON pt.id = ar.prompt_template_id
       WHERE ar.status = 'active'
         AND ar.task_type = 'approval_ai_gate'
       ORDER BY ar.priority ASC, ar.id ASC`
  ).all<{
    rule_name: string;
    biz_type: string;
    task_type: string;
    provider_name: string | null;
    template_name: string | null;
  }>();

  const options = new Map<
    string,
    { slot_id: string; label: string; rule_name: string; task_type: string; source: string }
  >();

  for (const row of rows.results ?? []) {
    const slotId = row.biz_type || "approval_ai_gate";
    const providerPart = row.provider_name ? ` / ${row.provider_name}` : "";
    const promptPart = row.template_name ? ` / ${row.template_name}` : "";
    options.set(slotId, {
      slot_id: slotId,
      label: `${slotId} (${row.rule_name}${providerPart}${promptPart})`,
      rule_name: row.rule_name,
      task_type: row.task_type,
      source: "routing"
    });
  }

  if (!options.has("approval_ai_gate")) {
    options.set("approval_ai_gate", {
      slot_id: "approval_ai_gate",
      label: "approval_ai_gate (default)",
      rule_name: "",
      task_type: "approval_ai_gate",
      source: "builtin"
    });
  }

  return c.json({ success: true, data: Array.from(options.values()) });
});

adminRoutes.get("/approval-ai-gate/tasks", requireRoles(["super_admin"]), async (c) => {
  const status = c.req.query("status");
  const keyword = c.req.query("keyword");
  const page = Number(c.req.query("page") ?? "1");
  const pageSize = Number(c.req.query("pageSize") ?? "20");
  const offset = (page - 1) * pageSize;

  let whereSql = " WHERE tq.task_type = 'approval_ai_gate'";
  const params: Array<string | number> = [];

  if (status) {
    whereSql += " AND tq.status = ?";
    params.push(status);
  }
  if (keyword) {
    whereSql +=
      " AND (ai.instance_no LIKE ? OR ai.biz_summary LIKE ? OR ai.initiator_userid LIKE ? OR json_extract(tq.payload_json, '$.node_key') LIKE ?)";
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
  }

  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) as total
       FROM task_queue tq
       LEFT JOIN approval_instance ai ON ai.id = tq.biz_id${whereSql}`
  )
    .bind(...params)
    .first<{ total: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT
         tq.id as task_id,
         tq.status as task_status,
         tq.biz_type as task_biz_type,
         tq.error_message,
         tq.created_at as task_created_at,
         tq.completed_at as task_completed_at,
         tq.payload_json,
         ai.id as instance_id,
         ai.instance_no,
         ai.status as instance_status,
         ai.biz_type,
         ai.biz_summary,
         ai.initiator_userid,
         ai.current_round,
         ai.current_node_key,
         ani.status as node_status
       FROM task_queue tq
       LEFT JOIN approval_instance ai ON ai.id = tq.biz_id
       LEFT JOIN approval_node_instance ani
         ON ani.instance_id = ai.id
         AND ani.node_type = 'ai_gate'
         AND ani.round = ai.current_round
         AND ani.node_key = json_extract(tq.payload_json, '$.node_key')
       ${whereSql}
       ORDER BY tq.created_at DESC
       LIMIT ? OFFSET ?`
  )
    .bind(...params, pageSize, offset)
    .all<{
      task_id: number;
      task_status: string;
      task_biz_type: string;
      error_message: string | null;
      task_created_at: string;
      task_completed_at: string | null;
      payload_json: string | null;
      instance_id: number | null;
      instance_no: string | null;
      instance_status: string | null;
      biz_type: string | null;
      biz_summary: string | null;
      initiator_userid: string | null;
      current_round: number | null;
      current_node_key: string | null;
      node_status: string | null;
    }>();

  const data = (rows.results ?? []).map((row) => {
    let nodeKey: string | null = null;
    let aiSlotId: string | null = null;
    if (row.payload_json) {
      try {
        const payload = JSON.parse(row.payload_json) as {
          node_key?: unknown;
          ai_slot_id?: unknown;
        };
        nodeKey = typeof payload.node_key === "string" ? payload.node_key : null;
        aiSlotId = typeof payload.ai_slot_id === "string" ? payload.ai_slot_id : null;
      } catch {
        nodeKey = null;
        aiSlotId = null;
      }
    }

    return {
      task_id: row.task_id,
      task_status: row.task_status,
      task_biz_type: row.task_biz_type,
      error_message: row.error_message,
      task_created_at: row.task_created_at,
      task_completed_at: row.task_completed_at,
      node_key: nodeKey,
      ai_slot_id: aiSlotId,
      node_status: row.node_status,
      instance: row.instance_id
        ? {
            id: row.instance_id,
            instance_no: row.instance_no,
            status: row.instance_status,
            biz_type: row.biz_type,
            biz_summary: row.biz_summary,
            initiator_userid: row.initiator_userid,
            current_round: row.current_round,
            current_node_key: row.current_node_key
          }
        : null
    };
  });

  return c.json({
    success: true,
    data,
    pagination: {
      page,
      pageSize,
      total: count?.total ?? 0
    }
  });
});

adminRoutes.post(
  "/approval-ai-gate/tasks/:taskId/handle",
  requireRoles(["super_admin"]),
  async (c) => {
    const taskId = Number(c.req.param("taskId"));
    const body = (await c.req.json().catch(() => ({}))) as {
      action?: "approve" | "reject" | "comment";
      comment?: string;
    };
    const action = body.action;
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (action !== "approve" && action !== "reject" && action !== "comment") {
      return c.json(
        {
          success: false,
          error: { message: "action must be one of: approve/reject/comment" }
        },
        400
      );
    }

    const task = await c.env.DB.prepare(
      "SELECT * FROM task_queue WHERE id = ? AND task_type = 'approval_ai_gate'"
    )
      .bind(taskId)
      .first<{
        id: number;
        status: string;
        biz_id: number;
        payload_json: string | null;
        result_json: string | null;
      }>();

    if (!task) {
      return c.json({ success: false, error: { message: "AI关卡任务不存在" } }, 404);
    }

    let nodeKey: string | null = null;
    if (task.payload_json) {
      try {
        const payload = JSON.parse(task.payload_json) as { node_key?: unknown };
        nodeKey = typeof payload.node_key === "string" ? payload.node_key : null;
      } catch {
        nodeKey = null;
      }
    }

    let node = nodeKey
      ? await c.env.DB.prepare(
          `SELECT *
           FROM approval_node_instance
           WHERE instance_id = ?
             AND node_type = 'ai_gate'
             AND node_key = ?
             AND status = 'in_progress'
           ORDER BY id DESC
           LIMIT 1`
        )
          .bind(task.biz_id, nodeKey)
          .first<{ id: number; round: number; status: string }>()
      : await c.env.DB.prepare(
          `SELECT *
           FROM approval_node_instance
           WHERE instance_id = ?
             AND node_type = 'ai_gate'
             AND status = 'in_progress'
           ORDER BY id DESC
           LIMIT 1`
        )
          .bind(task.biz_id)
          .first<{ id: number; round: number; status: string }>();

    if (!node) {
      node = nodeKey
        ? await c.env.DB.prepare(
            `SELECT *
             FROM approval_node_instance
             WHERE instance_id = ?
               AND node_type = 'ai_gate'
               AND node_key = ?
             ORDER BY round DESC, id DESC
             LIMIT 1`
          )
            .bind(task.biz_id, nodeKey)
            .first<{ id: number; round: number; status: string }>()
        : await c.env.DB.prepare(
            `SELECT *
             FROM approval_node_instance
             WHERE instance_id = ?
               AND node_type = 'ai_gate'
             ORDER BY round DESC, id DESC
             LIMIT 1`
          )
            .bind(task.biz_id)
            .first<{ id: number; round: number; status: string }>();
    }

    if (!node) {
      const aiTaskRow = await c.env.DB.prepare(
        `SELECT node_instance_id, round
         FROM approval_task
         WHERE instance_id = ? AND assignee_userid = 'AI_GATE'
         ORDER BY id DESC
         LIMIT 1`
      )
        .bind(task.biz_id)
        .first<{ node_instance_id: number; round: number }>();

      if (aiTaskRow?.node_instance_id) {
        node = await c.env.DB.prepare(
          "SELECT id, round, status FROM approval_node_instance WHERE id = ?"
        )
          .bind(aiTaskRow.node_instance_id)
          .first<{ id: number; round: number; status: string }>();
      }
    }

    const now = nowIso();

    if (action === "comment") {
      if (!node) {
        await c.env.DB.prepare(
          `UPDATE task_queue
           SET updated_at = ?
           WHERE id = ?`
        )
          .bind(now, task.id)
          .run();

        return c.json({
          success: true,
          data: {
            task_id: task.id,
            handled: "comment",
            handled_without_node: true
          }
        });
      }

      await c.env.DB.prepare(
        `INSERT INTO approval_task
          (node_instance_id, instance_id, assignee_userid, action, comment, round, status, acted_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          node.id,
          task.biz_id,
          "AI_GATE",
          null,
          comment || "超级管理员补充AI节点意见",
          node.round,
          "completed",
          now,
          now,
          now
        )
        .run();

      return c.json({ success: true, data: { task_id: task.id, handled: "comment" } });
    }

    let resultPayload: Record<string, unknown> = {};
    if (task.result_json) {
      try {
        const parsed = JSON.parse(task.result_json) as Record<string, unknown>;
        resultPayload = parsed;
      } catch {
        resultPayload = {};
      }
    }

    const metadata =
      resultPayload.metadata && typeof resultPayload.metadata === "object"
        ? (resultPayload.metadata as Record<string, unknown>)
        : {};

    const mergedResult = {
      ...resultPayload,
      output:
        typeof resultPayload.output === "string" && resultPayload.output
          ? resultPayload.output
          : comment || "超级管理员手动处理AI关卡",
      metadata: {
        ...metadata,
        outcome: action,
        comment: comment || "超级管理员手动处理AI关卡",
        summary:
          typeof metadata.summary === "string" && metadata.summary
            ? metadata.summary
            : comment || "超级管理员手动处理AI关卡"
      }
    };

    await c.env.DB.prepare(
      `UPDATE task_queue
       SET status = 'completed',
           result_json = ?,
           error_message = NULL,
           completed_at = ?,
           updated_at = ?
       WHERE id = ?`
    )
      .bind(JSON.stringify(mergedResult), now, now, task.id)
      .run();

    if (!node) {
      return c.json({
        success: true,
        data: {
          task_id: task.id,
          handled: action,
          handled_without_node: true
        }
      });
    }

    if (node.status !== "completed") {
      await c.env.DB.prepare(
        "UPDATE approval_node_instance SET status = 'completed', completed_at = ?, updated_at = ? WHERE id = ?"
      )
        .bind(now, now, node.id)
        .run();
    }

    await c.env.DB.prepare(
      `INSERT INTO approval_task
        (node_instance_id, instance_id, assignee_userid, action, comment, round, status, acted_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        node.id,
        task.biz_id,
        "AI_GATE",
        action,
        comment || "超级管理员手动处理AI关卡",
        node.round,
        "completed",
        now,
        now,
        now
      )
      .run();

    await advanceWorkflow(c.env, task.biz_id, createAiGateHandler());

    return c.json({ success: true, data: { task_id: task.id, handled: action } });
  }
);

// POST /ai-routing — Create routing rule
adminRoutes.post("/ai-routing", requireRoles(["super_admin"]), async (c) => {
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
});

// PUT /ai-routing/:id — Update routing rule
adminRoutes.put("/ai-routing/:id", requireRoles(["super_admin"]), async (c) => {
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
});

// DELETE /ai-routing/:id — Soft delete routing rule
adminRoutes.delete("/ai-routing/:id", requireRoles(["super_admin"]), async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(
    "UPDATE ai_routing_rule SET status = 'disabled', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), id)
    .run();

  return c.json({ success: true });
});

// ─── AI Prompt Template CRUD ──────────

// GET /ai-prompt — List prompt templates
adminRoutes.get("/ai-prompt", requireRoles(["super_admin"]), async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM ai_prompt_template WHERE status != 'deleted' ORDER BY template_key ASC"
  ).all<AiPromptTemplate>();

  return c.json({ success: true, data: rows.results ?? [] });
});

// POST /ai-prompt — Create prompt template
adminRoutes.post("/ai-prompt", requireRoles(["super_admin"]), async (c) => {
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
});

// PUT /ai-prompt/:id — Update prompt template (increments version)
adminRoutes.put("/ai-prompt/:id", requireRoles(["super_admin"]), async (c) => {
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
});

// DELETE /ai-prompt/:id — Soft delete prompt template
adminRoutes.delete("/ai-prompt/:id", requireRoles(["super_admin"]), async (c) => {
  const id = Number(c.req.param("id"));
  await c.env.DB.prepare(
    "UPDATE ai_prompt_template SET status = 'disabled', updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), id)
    .run();

  return c.json({ success: true });
});
