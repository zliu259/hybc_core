// packages/api/src/services/cf-ai.ts
// cf_ai provider：Worker 内直调 env.AI（Unified Billing 第三方模型）。
// 触发三路（路由 waitUntil / Queue TASK_CREATED / cron 兜底），全部经原子抢占幂等。
import type { Env } from "../types/env";
import type { TaskQueueItem } from "../types/ai";
import { completeTask, failTask, resolvePrompt } from "./ai-slot";

export const CF_AI_NODE_ID = "cf-ai-worker";

export const CF_AI_TASK_TYPES = [
  "contract_draft_section",
  "contract_compliance_review",
  "contract_completeness_check"
] as const;
export type CfAiTaskType = (typeof CF_AI_TASK_TYPES)[number];

/** 决策：sol 暂缓启用；terra 与 sonnet-5 均衡交替，critic 异厂商。 */
export const CF_AI_MODELS = ["openai/gpt-5.6-terra", "anthropic/claude-sonnet-5"] as const;

const MAX_OUTPUT_TOKENS = 8192;

const nowIso = () => new Date().toISOString();

export const isCfAiTaskType = (taskType: string): taskType is CfAiTaskType =>
  (CF_AI_TASK_TYPES as readonly string[]).includes(taskType);

export const pickDraftModel = (sectionSort: number): string =>
  CF_AI_MODELS[Math.abs(Math.trunc(sectionSort)) % CF_AI_MODELS.length];

export const pickCriticModel = (draftModel: string): string =>
  CF_AI_MODELS.find((m) => m !== draftModel) ?? CF_AI_MODELS[0];

/** 成本分级（owner 07-22）：修改类走 Workers AI 免费层；首次起草保持高档交替。 */
export const CF_AI_CHEAP_MODEL = "@cf/zai-org/glm-4.7-flash";

export interface SectionModelContext {
  hasContent: boolean;
  hasInstruction: boolean;
  sectionSort: number;
}

export const pickSectionModel = (ctx: SectionModelContext): string =>
  ctx.hasContent && ctx.hasInstruction ? CF_AI_CHEAP_MODEL : pickDraftModel(ctx.sectionSort);

interface CfAiPrompt {
  system: string;
  user: string;
}

interface CfAiCallResult {
  output: string;
  latency_ms: number;
}

const mockOutput = (taskType: CfAiTaskType): string => {
  if (taskType === "contract_draft_section") {
    return JSON.stringify({
      content:
        "【本地MOCK生成】本节条款正文示例：甲方{{party_a}}应于验收合格后30日内向乙方{{party_b}}支付工程款。逾期付款的，每逾期一日按每日千分之三支付违约金。",
      risk_spans: [
        {
          text: "每逾期一日按每日千分之三支付违约金",
          level: "yellow",
          reason: "违约金费率畸高，存在被调减风险（mock标注）",
          legal_basis: "《民法典》第585条"
        }
      ]
    });
  }
  if (taskType === "contract_compliance_review") {
    return JSON.stringify({
      overall: "warn",
      issues: [
        {
          text: "每逾期一日按每日千分之三支付违约金",
          severity: "yellow",
          reason: "违约金费率畸高（mock审查）",
          legal_basis: "《民法典》第585条",
          suggestion: "建议调整为每日万分之五以内"
        }
      ]
    });
  }
  return JSON.stringify({
    missing: [
      {
        section_key: "geology_risk",
        title: "地质条件与地下障碍物风险",
        level: "recommended",
        reason: "顶管施工核心风险，建议补充（mock提示）"
      }
    ]
  });
};

/**
 * Workers AI 各模型返回形状不一（reasoning 模型含 <think> 推理块 / OpenAI 兼容 choices 结构），
 * 统一宽容提取正文；推理块（含被 max_tokens 截断的未闭合块）一律剥除。
 */
export const parseCfAiTextOutput = (resp: unknown): string => {
  const r = resp && typeof resp === "object" ? (resp as Record<string, unknown>) : {};
  const nested =
    r.result && typeof r.result === "object" ? (r.result as Record<string, unknown>) : {};
  const choices = Array.isArray(r.choices) ? (r.choices as Array<Record<string, unknown>>) : [];
  const firstMessage = choices[0]?.message;
  const choiceContent =
    firstMessage && typeof firstMessage === "object"
      ? (firstMessage as Record<string, unknown>).content
      : undefined;
  const candidates = [
    r.response,
    nested.response,
    choiceContent,
    r.output_text,
    nested.output_text
  ];
  const raw =
    candidates.find((v): v is string => typeof v === "string" && v.trim().length > 0) ?? "";
  return raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/, "")
    .trim();
};

/** 调用 env.AI；GPT-5.6 系走 Responses 格式，Claude 走 Messages 格式。本地环境返回确定性 mock。 */
export const callCfAi = async (
  env: Env,
  model: string,
  taskType: CfAiTaskType,
  prompt: CfAiPrompt
): Promise<CfAiCallResult> => {
  const startedAt = Date.now();
  if (env.APP_ENV === "local") {
    return { output: mockOutput(taskType), latency_ms: 0 };
  }
  if (model.startsWith("@cf/")) {
    const resp = await env.AI.run(model, {
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ],
      max_tokens: MAX_OUTPUT_TOKENS
    });
    return { output: parseCfAiTextOutput(resp), latency_ms: Date.now() - startedAt };
  }
  if (model.startsWith("anthropic/")) {
    const resp = (await env.AI.run(model, {
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      max_tokens: MAX_OUTPUT_TOKENS
    })) as { content?: Array<{ text?: string }> };
    const output = (resp.content ?? []).map((block) => block.text ?? "").join("");
    return { output, latency_ms: Date.now() - startedAt };
  }
  const resp = (await env.AI.run(model, {
    input: prompt.user,
    instructions: prompt.system,
    max_output_tokens: MAX_OUTPUT_TOKENS
  })) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const output =
    resp.output_text ??
    (resp.output ?? [])
      .flatMap((item) => item.content ?? [])
      .map((block) => block.text ?? "")
      .join("");
  return { output, latency_ms: Date.now() - startedAt };
};

/**
 * 执行一个 cf_ai 任务。原子抢占（pending→running）保证多触发路径幂等；
 * 成功走 completeTask（审计+回写分支），失败走 failTask（自动重试）。
 */
export const executeCfAiTask = async (env: Env, taskId: number): Promise<void> => {
  const now = nowIso();
  const claim = await env.DB.prepare(
    `UPDATE task_queue SET status = 'running', assigned_node_id = ?, started_at = ?, updated_at = ?
      WHERE id = ? AND status = 'pending'`
  )
    .bind(CF_AI_NODE_ID, now, now, taskId)
    .run();
  if (!claim.meta.changes) return;

  const task = await env.DB.prepare("SELECT * FROM task_queue WHERE id = ?")
    .bind(taskId)
    .first<TaskQueueItem>();
  if (!task) return;
  if (!isCfAiTaskType(task.task_type)) {
    await failTask(env, taskId, CF_AI_NODE_ID, `cf_ai 不支持任务类型 ${task.task_type}`);
    return;
  }

  try {
    const rule = await env.DB.prepare(
      `SELECT prompt_template_id FROM ai_routing_rule
        WHERE biz_type = ? AND task_type = ? AND status = 'active'
        ORDER BY priority ASC, id ASC LIMIT 1`
    )
      .bind(task.biz_type, task.task_type)
      .first<{ prompt_template_id: number | null }>();
    if (!rule?.prompt_template_id) {
      throw new Error(`缺少 ${task.biz_type}/${task.task_type} 的路由规则或提示词模板`);
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(task.payload_json) as Record<string, unknown>;
    } catch {
      payload = {};
    }

    const prompt = await resolvePrompt(env, rule.prompt_template_id, payload);
    if (!prompt) throw new Error(`提示词模板 ${rule.prompt_template_id} 不存在或未启用`);

    const preferredModel =
      typeof payload.model === "string" && payload.model.length > 0
        ? payload.model
        : pickDraftModel(Number(payload.section_sort ?? 0));

    // 廉价模型（Workers AI 免费层）失败或空输出时就地回退高档模型，
    // 避免任务进入"重试3次×cron兜底"的漫长失败循环。
    let usedModel = preferredModel;
    let result: CfAiCallResult | null = await callCfAi(
      env,
      preferredModel,
      task.task_type,
      prompt
    ).catch((err: unknown) => {
      if (preferredModel !== CF_AI_CHEAP_MODEL) throw err;
      console.warn(`cf_ai 廉价模型调用失败，回退高档模型 task=${taskId}`, err);
      return null;
    });
    if ((result === null || !result.output.trim()) && preferredModel === CF_AI_CHEAP_MODEL) {
      usedModel = pickDraftModel(Number(payload.section_sort ?? 0));
      result = await callCfAi(env, usedModel, task.task_type, prompt);
    }
    if (!result || !result.output.trim()) {
      throw new Error(`模型 ${usedModel} 返回空输出`);
    }
    await completeTask(env, taskId, CF_AI_NODE_ID, {
      output: result.output,
      latency_ms: result.latency_ms,
      metadata:
        usedModel === preferredModel
          ? { model: usedModel }
          : { model: usedModel, fallback_from: preferredModel }
    });
  } catch (err) {
    await failTask(env, taskId, CF_AI_NODE_ID, err instanceof Error ? err.message : String(err));
  }
};

/** cron 兜底：重试/超时后回到 pending 的 cf_ai 任务没有新事件，靠扫描补执行。 */
export const sweepPendingCfAiTasks = async (env: Env, limit = 5): Promise<void> => {
  try {
    const placeholders = CF_AI_TASK_TYPES.map(() => "?").join(", ");
    const rows = await env.DB.prepare(
      `SELECT id FROM task_queue WHERE status = 'pending' AND task_type IN (${placeholders})
        ORDER BY id ASC LIMIT ?`
    )
      .bind(...CF_AI_TASK_TYPES, limit)
      .all<{ id: number }>();
    for (const row of rows.results ?? []) {
      await executeCfAiTask(env, row.id);
    }
  } catch (err) {
    console.error("sweepPendingCfAiTasks failed", err);
  }
};
