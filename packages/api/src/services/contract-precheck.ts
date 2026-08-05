/**
 * 合同预审（contract_precheck）结果处理。
 *
 * 双层审计合并：AI 多维审计（contract_precheck_review 任务，CF AI Gateway 执行）
 * + contract-draft-rules 确定性红线规则（16 条正则 + 质保金比例）。
 * 「明显错误」判定 = AI critical 级 issue 或规则 red 级命中 —— 存在即 status='reviewed'，
 * 否则 'passed'（可确认签署）。分级由代码判定，模型输出仅提供事实。
 */

import type { Env } from "../types/env";
import type { RiskAnnotation } from "../types/contract-draft";
import { checkClauseText } from "./contract-draft-rules";
import { tolerantJsonParse } from "./cf-ai";

const nowIso = () => new Date().toISOString();

/** 送审文本长度闸门（route 与提取回调共用，避免两处漂移） */
export const PRECHECK_MIN_TEXT = 50;
export const PRECHECK_MAX_TEXT = 150_000;

export const PRECHECK_DIMENSIONS = [
  "subject_signing",
  "clause_completeness",
  "amount_payment",
  "liability_balance",
  "invalid_terms",
  "stance_risk"
] as const;

export interface PrecheckIssue {
  dimension: string;
  severity: "critical" | "major" | "minor";
  quote: string;
  problem: string;
  suggestion: string;
}

export interface PrecheckResult {
  summary: string;
  /** 总体判定：pass 无问题 / minor / major / critical（含明显错误） */
  overall: "pass" | "minor" | "major" | "critical";
  issues: PrecheckIssue[];
  rule_findings: RiskAnnotation[];
  has_blocking: boolean;
  model: string | null;
  /** AI 输出无法解析时为 true（保留原文供人工），此时视为需人工复核 */
  unparsed: boolean;
  /** AI 输出被截断抢救（_truncated）：审计不完整，同样阻断签署 */
  truncated: boolean;
  raw_output?: string;
}

const asStr = (value: unknown, maxLen: number): string =>
  typeof value === "string" ? value.trim().slice(0, maxLen) : "";

const normalizeSeverity = (value: unknown): PrecheckIssue["severity"] => {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "critical" || raw === "red" || raw === "fail" || raw === "high") return "critical";
  if (raw === "minor" || raw === "low" || raw === "info") return "minor";
  return "major";
};

const SEVERITY_ORDER: Record<PrecheckIssue["severity"], number> = {
  critical: 0,
  major: 1,
  minor: 2
};

/**
 * 红线规则的预审语境适配：checkClauseText 是为「起草模板」写的规则集，
 * 预审对象是 case-by-case 的真实合同——身份证号在自然人签约场景属签约必需，
 * 不应按模板红线阻断，降级为提示并改写措辞（owner 08-04 反馈）。
 */
const adaptRuleFindingsForPrecheck = (findings: RiskAnnotation[]): RiskAnnotation[] =>
  findings.map((finding) =>
    finding.reason.includes("身份证号")
      ? {
          ...finding,
          level: "yellow" as const,
          reason:
            "正文含身份证号明文：如为自然人签约主体属正常，请确认必要性并注意文本流转的个人信息保护"
        }
      : finding
  );

/**
 * 纯函数：模型输出 + 合同文本 → 规范化预审结果。
 * 模型输出无法解析时不抛错——降级为「需人工复核」并保留原文。
 */
export const buildPrecheckResult = (
  output: string,
  contractText: string,
  model: string | null
): PrecheckResult => {
  const ruleFindings = adaptRuleFindingsForPrecheck(checkClauseText(contractText ?? ""));

  const parsed = tolerantJsonParse(output ?? "") as Record<string, unknown>;
  const rawIssues = Array.isArray(parsed?.issues) ? (parsed.issues as unknown[]) : null;
  const unparsed = rawIssues === null && typeof parsed?.summary !== "string";
  // 截断抢救的输出（salvageTruncatedJson 标记）：issues 可能不完整，不能当完整审计放行
  const truncated = parsed?._truncated === true;

  const issues: PrecheckIssue[] = (rawIssues ?? [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({
      dimension: asStr(item.dimension, 40) || "unknown",
      severity: normalizeSeverity(item.severity),
      quote: asStr(item.quote, 200),
      problem: asStr(item.problem, 200),
      suggestion: asStr(item.suggestion, 500)
    }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, 20);

  const hasRuleRed = ruleFindings.some((f) => f.level === "red");
  const hasCritical = issues.some((i) => i.severity === "critical");
  const hasBlocking = hasRuleRed || hasCritical || unparsed || truncated;

  const overall: PrecheckResult["overall"] =
    hasRuleRed || hasCritical
      ? "critical"
      : issues.some((i) => i.severity === "major") || ruleFindings.length > 0
        ? "major"
        : issues.length > 0
          ? "minor"
          : "pass";

  let summary: string;
  if (unparsed) {
    summary = "AI 输出无法解析，请人工复核审计结果后再决定是否签署。";
  } else {
    summary =
      asStr(parsed.summary, 300) ||
      (issues.length === 0 && ruleFindings.length === 0
        ? "未发现明显问题。"
        : "发现待处理问题，详见明细。");
    if (truncated) {
      summary = `【AI输出被截断，以下审计不完整，请重新预审】${summary}`;
    }
  }

  const result: PrecheckResult = {
    summary,
    overall,
    issues,
    rule_findings: ruleFindings,
    has_blocking: hasBlocking,
    model,
    unparsed,
    truncated
  };
  if (unparsed) {
    result.raw_output = (output ?? "").slice(0, 2000);
  }
  return result;
};

/**
 * completeTask 分支：contract_precheck_review 任务完成后的落库。
 * 写回以任务指针为键（WHERE review_task_id = taskId），复审换任务后旧结果不会被误写。
 */
export const applyContractPrecheckResult = async (
  env: Env,
  task: { id: number; biz_id: number; payload_json: string },
  resultOutput: string,
  model: string | null
): Promise<void> => {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(task.payload_json) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const contractText = typeof payload.contract_text === "string" ? payload.contract_text : "";

  const result = buildPrecheckResult(resultOutput, contractText, model);
  const resultJson = JSON.stringify(result);
  const now = nowIso();
  const nextStatus = result.has_blocking ? "reviewed" : "passed";

  await env.DB.prepare(
    `UPDATE contract_precheck SET
       status = ?, review_result_json = ?, adopted_json = NULL, updated_at = ?
     WHERE review_task_id = ? AND status = 'reviewing'`
  )
    .bind(nextStatus, resultJson, now, task.id)
    .run();

  await env.DB.prepare(
    "UPDATE contract_precheck_round SET status = 'done', result_json = ?, updated_at = ? WHERE task_id = ?"
  )
    .bind(resultJson, now, task.id)
    .run();
};

/**
 * 终态失败回写（failTask 终态 / checkTimeouts 重试耗尽时调用；
 * 非终态严禁调用，否则会打断自动重试）。同时清洗敏感 payload。
 */
/**
 * completeTask 分支：contract_precheck_extract（服务端提取）完成后的链式推进。
 *
 * 小程序无 docx/pdf 解析能力，改由 task-runner 下载原件提取全文；提取任务完成后
 * 在此把文本落库并派生真正的审计任务，同时把 review_task_id 指针改指新任务
 * （与合同完整检查 check→audit 链同一手法：轮询/超时回收始终跟随活任务）。
 *
 * createReviewTask 由调用方注入，避免 services/ai-slot ↔ contract-precheck 循环依赖。
 */
export const applyContractPrecheckExtract = async (
  env: Env,
  task: { id: number; biz_id: number; payload_json: string },
  resultOutput: string,
  createReviewTask: (payload: Record<string, unknown>) => Promise<{ id: number }>
): Promise<void> => {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(task.payload_json) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  // 提取结果：runner 返回 {text, chars} 或 {text:"", error}；OCR 转写为裸文本
  let text = "";
  let extractError = "";
  const parsed = tolerantJsonParse(resultOutput ?? "") as Record<string, unknown>;
  if (parsed && typeof parsed.text === "string") {
    text = parsed.text.trim();
    extractError = typeof parsed.error === "string" ? parsed.error : "";
  } else if (typeof resultOutput === "string") {
    text = resultOutput.trim();
  }
  if (text.length > PRECHECK_MAX_TEXT) text = text.slice(0, PRECHECK_MAX_TEXT);

  // 辨认度闸门：OCR 提示词用〔本段无法辨认〕/〔？〕标注模糊内容，
  // 大面积无法辨认的转写不能当完整合同送审（漏条款风险），确定性拦截
  if (!extractError && text.length >= PRECHECK_MIN_TEXT) {
    const paragraphMarks = (text.match(/〔本段无法辨认〕/g) ?? []).length;
    const charMarks = (text.match(/〔？〕/g) ?? []).length;
    if (paragraphMarks >= 3 || charMarks >= 30) {
      extractError = `扫描件清晰度不足：转写中有 ${paragraphMarks} 段无法辨认、${charMarks} 处字符存疑，无法可靠审计`;
      text = "";
    }
  }

  const now = nowIso();

  // 提取/OCR 失败（模糊、加密、超页数等）：落终态并把原因写进结果供前端展示
  if (text.length < PRECHECK_MIN_TEXT) {
    const reason = extractError || "未能从文件中识别出足够文字（文件可能过于模糊、加密或损坏）";
    const failedResult: PrecheckResult = {
      summary: `${reason}。可上传更清晰的扫描件或电子版文件后重新预审。`,
      overall: "critical",
      issues: [],
      rule_findings: [],
      has_blocking: true,
      model: null,
      unparsed: false,
      truncated: false
    };
    await env.DB.prepare(
      `UPDATE contract_precheck SET
         status = 'review_failed', review_result_json = ?, updated_at = ?
       WHERE review_task_id = ? AND status = 'reviewing'`
    )
      .bind(JSON.stringify(failedResult), now, task.id)
      .run();
    await env.DB.prepare(
      "UPDATE contract_precheck_round SET status = 'error', result_json = ?, updated_at = ? WHERE task_id = ?"
    )
      .bind(JSON.stringify(failedResult), now, task.id)
      .run();
    return;
  }

  await env.DB.prepare(
    "UPDATE contract_precheck SET contract_text = ?, updated_at = ? WHERE id = ?"
  )
    .bind(text, now, task.biz_id)
    .run();

  // 派生审计任务：提取任务 payload 已带齐审计所需字段（route 一次性构造）
  const reviewTask = await createReviewTask({
    precheck_id: payload.precheck_id ?? task.biz_id,
    round: payload.round ?? 1,
    title: payload.title ?? "",
    counterparty: payload.counterparty ?? "（未填写）",
    direction: payload.direction ?? "inbound",
    direction_label: payload.direction_label ?? "",
    our_entities: payload.our_entities ?? "",
    contract_text: text,
    model: payload.model
  });

  // 指针改指审计任务（旧提取任务已终态；WHERE 谓词保证不覆盖并发复审）
  await env.DB.prepare(
    "UPDATE contract_precheck SET review_task_id = ?, updated_at = ? WHERE id = ? AND review_task_id = ?"
  )
    .bind(reviewTask.id, nowIso(), task.biz_id, task.id)
    .run();
  await env.DB.prepare(
    "UPDATE contract_precheck_round SET task_id = ?, updated_at = ? WHERE task_id = ?"
  )
    .bind(reviewTask.id, nowIso(), task.id)
    .run();
};

/**
 * 卡死回收（cron 兜底）：completeTask 先置任务 completed 再做域回写，
 * 两步之间 Worker 被打断会留下「任务已终态但预审单永远 reviewing」的孤儿——
 * checkTimeouts/sweep 都不扫终态任务，用户侧复审/删除又被 reviewing 挡住。
 * 这里按 updated_at 超时扫描 reviewing 预审单：
 * - 指向任务 completed 且 result_json 未清洗 → 补做回写（幂等，WHERE status='reviewing'）；
 * - 任务缺失/终态失败/已清洗 → 标 review_failed，恢复用户复审入口。
 */
export const reconcileStuckPrechecks = async (
  env: Env,
  createReviewTask?: (
    bizId: number,
    payload: Record<string, unknown>
  ) => Promise<{ id: number }>
): Promise<number> => {
  const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const rows = await env.DB.prepare(
    `SELECT p.id, p.review_task_id, t.id AS task_id, t.task_type, t.status AS task_status,
            t.result_json, t.payload_json, t.retry_count, t.max_retries
     FROM contract_precheck p
     LEFT JOIN task_queue t ON t.id = p.review_task_id
     WHERE p.status = 'reviewing' AND p.updated_at < ?
     LIMIT 20`
  )
    .bind(cutoff)
    .all<{
      id: number;
      review_task_id: number | null;
      task_id: number | null;
      task_type: string | null;
      task_status: string | null;
      result_json: string | null;
      payload_json: string | null;
      retry_count: number | null;
      max_retries: number | null;
    }>();

  let reconciled = 0;
  for (const row of rows.results ?? []) {
    const now = nowIso();
    const stillRetrying =
      (row.task_status === "pending" ||
        row.task_status === "assigned" ||
        row.task_status === "running") ||
      ((row.task_status === "failed" || row.task_status === "timeout") &&
        (row.retry_count ?? 0) < (row.max_retries ?? 0));
    if (stillRetrying) continue; // 任务还活着，交给正常管线

    if (
      row.task_id !== null &&
      row.task_status === "completed" &&
      row.result_json &&
      row.result_json !== "{}"
    ) {
      // 回写丢失但结果还在（清洗发生在回写之后）：按任务类型补做对应回写。
      // 必须区分类型——提取任务的 output 是 {text}，喂给审计解析会被判成
      // 「AI 输出无法解析」写成假的 reviewed 结果，属数据污染。
      try {
        const parsed = JSON.parse(row.result_json) as {
          output?: string;
          metadata?: { model?: string };
        };
        const taskRef = {
          id: row.task_id,
          biz_id: row.id,
          payload_json: row.payload_json ?? "{}"
        };
        const output = typeof parsed.output === "string" ? parsed.output : "";

        if (row.task_type === "contract_precheck_extract") {
          // 提取已完成但链式派生丢失：注入可用时补派审计任务，否则标失败让用户复审
          if (createReviewTask) {
            await applyContractPrecheckExtract(env, taskRef, output, (payload) =>
              createReviewTask(row.id, payload)
            );
            await env.DB.prepare(
              "UPDATE task_queue SET payload_json = '{}', result_json = '{}' WHERE id = ?"
            )
              .bind(row.task_id)
              .run();
            reconciled += 1;
            continue;
          }
        } else if (row.task_type === "contract_precheck_review") {
          await applyContractPrecheckResult(
            env,
            taskRef,
            output,
            typeof parsed.metadata?.model === "string" ? parsed.metadata.model : null
          );
          await env.DB.prepare(
            "UPDATE task_queue SET payload_json = '{}', result_json = '{}' WHERE id = ?"
          )
            .bind(row.task_id)
            .run();
          reconciled += 1;
          continue;
        }
      } catch (error) {
        console.error("Precheck reconcile re-apply failed", { precheck_id: row.id, error });
      }
    }

    // 任务缺失/终态失败/结果已清洗：标失败，恢复复审入口
    await env.DB.prepare(
      "UPDATE contract_precheck SET status = 'review_failed', updated_at = ? WHERE id = ? AND status = 'reviewing'"
    )
      .bind(now, row.id)
      .run();
    if (row.task_id !== null) {
      await env.DB.prepare(
        "UPDATE contract_precheck_round SET status = 'error', updated_at = ? WHERE task_id = ? AND status = 'reviewing'"
      )
        .bind(now, row.task_id)
        .run();
    }
    reconciled += 1;
  }
  return reconciled;
};

export const markContractPrecheckTaskError = async (
  env: Env,
  task: { id: number },
  now: string
): Promise<void> => {
  await env.DB.prepare(
    "UPDATE contract_precheck SET status = 'review_failed', updated_at = ? WHERE review_task_id = ? AND status = 'reviewing'"
  )
    .bind(now, task.id)
    .run();
  await env.DB.prepare(
    "UPDATE contract_precheck_round SET status = 'error', updated_at = ? WHERE task_id = ?"
  )
    .bind(now, task.id)
    .run();
  await env.DB.prepare("UPDATE task_queue SET payload_json = '{}' WHERE id = ?")
    .bind(task.id)
    .run();
};
