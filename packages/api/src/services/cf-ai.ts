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
  "contract_completeness_check",
  "contract_completeness_audit"
] as const;
export type CfAiTaskType = (typeof CF_AI_TASK_TYPES)[number];

/**
 * 模型分工（owner 07-23 定稿）：
 * - 生成（默认/按指令合一）= gpt-5.6-luna（GPT-5.6 家族成本优化档）
 * - AI 审查 = claude-sonnet-5（异厂商挑错 + 输出修正稿）
 * - 完整性检查 = terra 与 sonnet-5 双模型同时全量审（定稿前最后一道关）
 * GLM 免费层因输出质量不达标已于 07-23 撤下。
 */
export const CF_AI_DRAFT_MODEL = "openai/gpt-5.6-luna";
export const CF_AI_REVIEW_MODEL = "anthropic/claude-sonnet-5";
export const CF_AI_COMPLETENESS_MODELS = [
  "openai/gpt-5.6-terra",
  "anthropic/claude-sonnet-5"
] as const;

const MAX_OUTPUT_TOKENS = 8192;
/** @cf/ 开源模型档收紧输出预算：防 reasoning 模型长时间占用执行上下文。 */
const CHEAP_MAX_OUTPUT_TOKENS = 2048;
/** 完整检查全量审整份合同+逐节修正稿，输出量大，需要更高预算防截断。 */
const COMPLETENESS_MAX_OUTPUT_TOKENS = 32000;
/** 单次模型调用超时：超过即失败重试，防 env.AI.run 长时间 hang 拖死执行上下文。 */
const CALL_TIMEOUT_MS = 220_000;

const nowIso = () => new Date().toISOString();

/**
 * 抢救被截断的 JSON：模型输出超 max_tokens 时 JSON 会在中途断掉。
 * 扫描到最后一个"值边界"（不在字符串内、栈平衡可闭合处），截取并补齐闭合括号。
 * 返回可解析的最大前缀对象，无法抢救则返回 null。
 */
export const salvageTruncatedJson = (raw: string): unknown => {
  const s = raw.trim();
  if (!s.startsWith("{") && !s.startsWith("[")) return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  let lastSafe = -1; // 可安全截断并补齐的位置（下一字符前）
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
    } else if (c === "{" || c === "[") {
      stack.push(c);
    } else if (c === "}" || c === "]") {
      stack.pop();
      // 一个容器/值刚闭合：此处截断后补齐剩余栈即为合法 JSON
      lastSafe = i + 1;
    }
  }
  if (lastSafe <= 0) return null;
  let candidate = s.slice(0, lastSafe);
  // 重新计算截断点处仍未闭合的栈，逆序补齐
  const closeStack: string[] = [];
  let str = false;
  let esc = false;
  for (let i = 0; i < candidate.length; i++) {
    const c = candidate[i];
    if (str) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') str = false;
      continue;
    }
    if (c === '"') str = true;
    else if (c === "{" || c === "[") closeStack.push(c);
    else if (c === "}" || c === "]") closeStack.pop();
  }
  while (closeStack.length > 0) {
    candidate += closeStack.pop() === "{" ? "}" : "]";
  }
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
};

/** Promise 超时竞速（AI binding 不支持 abort，超时后放弃等待原调用）。 */
export const raceWithTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`调用超时（${ms}ms）`)), ms);
    })
  ]);

export const isCfAiTaskType = (taskType: string): taskType is CfAiTaskType =>
  (CF_AI_TASK_TYPES as readonly string[]).includes(taskType);

/** 宽容 JSON 解析：剥 markdown 围栏；失败尝试抢救截断输出；仍失败则包为 {raw}。 */
export const tolerantJsonParse = (raw: string): unknown => {
  const stripped = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(stripped);
  } catch {
    const salvaged = salvageTruncatedJson(stripped);
    if (salvaged && typeof salvaged === "object") {
      return { ...(salvaged as Record<string, unknown>), _truncated: true };
    }
    return { raw };
  }
};

interface CfAiPrompt {
  system: string;
  user: string;
}

interface CfAiCallResult {
  output: string;
  latency_ms: number;
}

const mockOutput = (taskType: CfAiTaskType): string => {
  if (taskType === "contract_completeness_audit") {
    return JSON.stringify({
      missing: [
        {
          section_key: "service_notice",
          title: "送达条款",
          level: "recommended",
          reason: "缺失送达条款会导致争议阶段送达僵局（mock复核确认）",
          verdict: "confirmed",
          audit_note: ""
        }
      ],
      section_issues: [
        {
          section_key: "payment",
          title: "价款结算与支付",
          issues: [
            {
              text: "{{late_fee_rate}}",
              severity: "yellow",
              reason: "逾期违约金费率占位符未填写（mock复核确认）",
              suggestion: "建议填写为日万分之五",
              verdict: "confirmed",
              audit_note: ""
            }
          ],
          revised_content:
            "【本地MOCK复核修正稿】甲方逾期付款的，每逾期一日按未付金额的万分之五向乙方支付违约金。其余内容保持原节不变。",
          revision_approved: true
        }
      ],
      overall_summary: "【本地MOCK复核】初版结论基本成立，修正稿已通过复核。",
      ready_to_finalize: false
    });
  }
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
          suggestion: "建议调整为每日万分之五以内"
        }
      ],
      revised_content:
        "【本地MOCK修正稿】甲方{{party_a}}应于验收合格后30日内向乙方{{party_b}}支付工程款。逾期付款的，每逾期一日按未付金额的万分之五支付违约金。"
    });
  }
  return JSON.stringify({
    missing: [
      {
        section_key: "service_notice",
        title: "送达条款",
        level: "recommended",
        reason: "缺失送达条款会导致争议阶段送达僵局（mock提示）"
      }
    ],
    section_issues: [
      {
        section_key: "payment",
        title: "价款结算与支付",
        issues: [
          {
            text: "{{late_fee_rate}}",
            severity: "yellow",
            reason: "逾期违约金费率占位符未填写（mock全量审）",
            suggestion: "建议填写为日万分之五"
          }
        ]
      }
    ],
    overall_summary: "【本地MOCK总评】合同结构完整，个别关键占位符未填写，建议补齐后定稿。",
    ready_to_finalize: false
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
  // 完整检查两阶段（初版诊断/复核出修正稿）输出量大，需要高预算防截断。
  const isCompleteness =
    taskType === "contract_completeness_check" || taskType === "contract_completeness_audit";
  const budget = isCompleteness ? COMPLETENESS_MAX_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS;
  if (model.startsWith("@cf/")) {
    // Workers AI 开源模型（OpenAI 兼容 schema）：关闭思考模式并收紧输出预算，
    // 否则 reasoning 模型（如 GLM-4.7-flash）会把预算烧在推理块上、耗时数分钟。
    const resp = await env.AI.run(model, {
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user }
      ],
      max_tokens: CHEAP_MAX_OUTPUT_TOKENS,
      reasoning_effort: "low",
      chat_template_kwargs: { enable_thinking: false }
    });
    return { output: parseCfAiTextOutput(resp), latency_ms: Date.now() - startedAt };
  }
  if (model.startsWith("anthropic/")) {
    const resp = (await raceWithTimeout(
      env.AI.run(model, {
        system: prompt.system,
        messages: [{ role: "user", content: prompt.user }],
        max_tokens: budget
      }),
      CALL_TIMEOUT_MS
    )) as { content?: Array<{ text?: string }> };
    const output = (resp.content ?? []).map((block) => block.text ?? "").join("");
    return { output, latency_ms: Date.now() - startedAt };
  }
  const resp = (await raceWithTimeout(
    env.AI.run(model, {
      input: prompt.user,
      instructions: prompt.system,
      max_output_tokens: budget
    }),
    CALL_TIMEOUT_MS
  )) as {
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
  const cfTaskType: CfAiTaskType = task.task_type;

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

    // 完整检查两阶段（check=terra 初版诊断 / audit=sonnet 复核出修正稿）与生成/审查一样
    // 走通用单模型流程：每个任务只一次调用，单独在时限内。递进链由 completeTask 串接
    // （check 完成后自动派生 audit 任务），避免单任务内串行两次大调用超时。
    const model =
      typeof payload.model === "string" && payload.model.length > 0
        ? payload.model
        : CF_AI_DRAFT_MODEL;
    const { output, latency_ms } = await callCfAi(env, model, cfTaskType, prompt);
    if (!output.trim()) throw new Error(`模型 ${model} 返回空输出`);
    await completeTask(env, taskId, CF_AI_NODE_ID, {
      output,
      latency_ms,
      metadata: { model }
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
