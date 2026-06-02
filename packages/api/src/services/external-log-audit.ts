import type { TaskResultSubmission } from "../types/ai";
import type { Env } from "../types/env";
import { publishEvent } from "./event-bus";

const nowIso = () => new Date().toISOString();

type JsonObject = Record<string, unknown>;

export type ExternalLogSubmissionRow = {
  id: number;
  project_id: number;
  section_id: number | null;
  submitter_name: string;
  submitter_company: string | null;
  submitter_phone: string | null;
  log_date: string;
  shift: string;
  operator_log_payload_json: string;
  project_log_payload_json: string;
  photo_keys_json: string | null;
  review_status: string;
  ai_review_task_id: number | null;
  ai_review_result_json: string | null;
  ai_review_score: number | null;
  ai_review_risk_level: string | null;
  ai_review_summary: string | null;
  reviewed_by_userid: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  adopted_operator_log_id: number | null;
  adopted_manager_log_id: number | null;
  created_at: string;
  updated_at: string;
};

export type ExternalLogAiReview = {
  decision: "auto_approve" | "needs_manual_review";
  risk_level: "low" | "medium" | "high" | "unknown";
  score: number;
  summary: string;
  issues: Array<{ severity?: string; message: string }>;
};

const safeParseObject = (raw: string | null): JsonObject => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch {
    return {};
  }
};

const safeParseStringArray = (raw: string | null): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    );
  } catch {
    return [];
  }
};

const toNumber = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const toText = (value: unknown, fallback = ""): string => {
  return typeof value === "string" ? value.trim() : fallback;
};

const normalizeAiReview = (result: TaskResultSubmission): ExternalLogAiReview => {
  const parsed = safeParseObject(result.output);
  const rawIssues = parsed.issues;
  const issues = Array.isArray(rawIssues)
    ? rawIssues
        .map((item) => {
          if (typeof item === "string") return { message: item };
          if (item && typeof item === "object") {
            const row = item as JsonObject;
            const message = toText(row.message) || toText(row.summary) || toText(row.reason);
            if (!message) return null;
            return {
              severity: toText(row.severity) || undefined,
              message
            };
          }
          return null;
        })
        .filter((item): item is { severity?: string; message: string } => item !== null)
    : [];

  const risk = toText(parsed.risk_level, "unknown").toLowerCase();
  const riskLevel = risk === "low" || risk === "medium" || risk === "high" ? risk : "unknown";
  const score = Math.max(0, Math.min(100, Math.round(toNumber(parsed.score, 0))));
  const rawDecision = toText(parsed.decision).toLowerCase();
  const hasBlockingIssue = issues.some((issue) =>
    ["high", "critical", "blocking"].includes((issue.severity || "").toLowerCase())
  );
  const autoApprove =
    rawDecision === "auto_approve" ||
    (score >= 85 && riskLevel === "low" && !hasBlockingIssue && issues.length === 0);

  return {
    decision: autoApprove ? "auto_approve" : "needs_manual_review",
    risk_level: riskLevel,
    score,
    summary:
      toText(parsed.summary) || (autoApprove ? "AI审计未发现明显异常。" : "AI审计需要管理员复核。"),
    issues
  };
};

export const loadExternalSubmission = async (
  env: Env,
  id: number
): Promise<ExternalLogSubmissionRow | null> => {
  return env.DB.prepare("SELECT * FROM external_log_submission WHERE id = ?")
    .bind(id)
    .first<ExternalLogSubmissionRow>();
};

export const adoptExternalSubmission = async (
  env: Env,
  submissionId: number,
  reviewerUserid: string,
  reviewComment: string
): Promise<{ operatorLogId: number | null; managerLogId: number | null }> => {
  const submission = await loadExternalSubmission(env, submissionId);
  if (!submission) {
    throw new Error("External log submission not found");
  }

  if (submission.adopted_operator_log_id || submission.adopted_manager_log_id) {
    return {
      operatorLogId: submission.adopted_operator_log_id,
      managerLogId: submission.adopted_manager_log_id
    };
  }

  const operatorPayload = safeParseObject(submission.operator_log_payload_json);
  const projectPayload = safeParseObject(submission.project_log_payload_json);
  const operatorEnabled = operatorPayload.enabled !== false;
  const projectEnabled = projectPayload.enabled !== false;
  const photoKeys = safeParseStringArray(submission.photo_keys_json);
  const completed = toNumber(operatorPayload.completed_pipe_count, 0);
  const cumulative = toNumber(operatorPayload.cumulative_pipe_count, completed);
  const footage = toNumber(operatorPayload.footage_m, 0);
  const cumulativeFootage = toNumber(operatorPayload.cumulative_footage_m, footage);
  const now = nowIso();
  const sourceUserid = `external:${submission.submitter_name}`.slice(0, 120);
  let operatorLogId: number | null = null;
  let managerLogId: number | null = null;

  if (operatorEnabled) {
    const operatorResult = await env.DB.prepare(
      `INSERT INTO operator_log
        (project_id, section_id, log_date, shift, weather, completed_pipe_count, cumulative_pipe_count,
         footage_m, cumulative_footage_m, main_thrust_mpa, main_thrust_text, chamber_pressure_mpa,
         cutter_current_a, cutter_current_text, cutter_frequency_hz, soil_type,
         deviation_direction, deviation_value_mm, horizontal_deviation_direction,
         horizontal_deviation_mm, vertical_deviation_direction, vertical_deviation_mm,
         issue_summary, remark, operator_userid, source_type, external_submission_id,
         external_submitter_name, external_submitter_company, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'external', ?, ?, ?, 'submitted', ?, ?)`
    )
      .bind(
        submission.project_id,
        submission.section_id,
        submission.log_date,
        submission.shift,
        toText(operatorPayload.weather) || null,
        completed,
        cumulative,
        operatorPayload.footage_m === undefined ? null : footage,
        cumulativeFootage,
        operatorPayload.main_thrust_mpa === undefined
          ? null
          : toNumber(operatorPayload.main_thrust_mpa, 0),
        toText(operatorPayload.main_thrust_text) || null,
        operatorPayload.chamber_pressure_mpa === undefined
          ? null
          : toNumber(operatorPayload.chamber_pressure_mpa, 0),
        operatorPayload.cutter_current_a === undefined
          ? null
          : toNumber(operatorPayload.cutter_current_a, 0),
        toText(operatorPayload.cutter_current_text) || null,
        operatorPayload.cutter_frequency_hz === undefined
          ? null
          : toNumber(operatorPayload.cutter_frequency_hz, 0),
        toText(operatorPayload.soil_type) || null,
        toText(operatorPayload.deviation_direction) || null,
        operatorPayload.deviation_value_mm === undefined
          ? null
          : toNumber(operatorPayload.deviation_value_mm, 0),
        toText(operatorPayload.horizontal_deviation_direction) || null,
        operatorPayload.horizontal_deviation_mm === undefined
          ? null
          : toNumber(operatorPayload.horizontal_deviation_mm, 0),
        toText(operatorPayload.vertical_deviation_direction) || null,
        operatorPayload.vertical_deviation_mm === undefined
          ? null
          : toNumber(operatorPayload.vertical_deviation_mm, 0),
        toText(operatorPayload.issue_summary) || null,
        toText(operatorPayload.remark) || null,
        sourceUserid,
        submission.id,
        submission.submitter_name,
        submission.submitter_company,
        now,
        now
      )
      .run();

    operatorLogId = Number(operatorResult.meta.last_row_id);
  }

  if (projectEnabled) {
    const managerResult = await env.DB.prepare(
      `INSERT INTO manager_log
        (project_id, log_date, title, detail_html, risk_note, manager_userid, source_type,
         external_submission_id, external_submitter_name, external_submitter_company,
         status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'external', ?, ?, ?, 'submitted', ?, ?)`
    )
      .bind(
        submission.project_id,
        submission.log_date,
        toText(projectPayload.title) || `外包项目日志 ${submission.log_date}`,
        toText(projectPayload.detail_html) || toText(projectPayload.detail) || null,
        toText(projectPayload.risk_note) || null,
        sourceUserid,
        submission.id,
        submission.submitter_name,
        submission.submitter_company,
        now,
        now
      )
      .run();

    managerLogId = Number(managerResult.meta.last_row_id);
    let sortOrder = 0;
    for (const fileKey of photoKeys) {
      await env.DB.prepare(
        `INSERT INTO manager_log_photo
          (manager_log_id, file_key, caption, sort_order, status, created_at)
         VALUES (?, ?, ?, ?, 'active', ?)`
      )
        .bind(managerLogId, fileKey, "外包项目日志照片", sortOrder, now)
        .run();
      sortOrder += 1;
    }
  }

  await env.DB.prepare(
    `UPDATE external_log_submission SET
       review_status = ?,
       reviewed_by_userid = ?,
       reviewed_at = ?,
       review_comment = ?,
       adopted_operator_log_id = ?,
       adopted_manager_log_id = ?,
       updated_at = ?
     WHERE id = ?`
  )
    .bind(
      reviewerUserid === "ai:auto" ? "approved_auto" : "approved_manual",
      reviewerUserid,
      now,
      reviewComment,
      operatorLogId,
      managerLogId,
      now,
      submission.id
    )
    .run();

  if (managerLogId) {
    await publishEvent(env, "EXTERNAL_LOG_ADOPTED", "external-log-audit.adopt", {
      project_id: submission.project_id,
      manager_log_id: managerLogId,
      external_submission_id: submission.id
    });
  }

  return { operatorLogId, managerLogId };
};

export const applyExternalLogAuditResult = async (
  env: Env,
  submissionId: number,
  taskId: number,
  result: TaskResultSubmission
): Promise<ExternalLogAiReview> => {
  const review = normalizeAiReview(result);
  const now = nowIso();
  const submission = await loadExternalSubmission(env, submissionId);

  if (!submission || submission.ai_review_task_id !== taskId) {
    return review;
  }

  const canApplyDecision = submission.review_status === "pending_ai_review";

  await env.DB.prepare(
    `UPDATE external_log_submission SET
       ai_review_result_json = ?,
       ai_review_score = ?,
       ai_review_risk_level = ?,
       ai_review_summary = ?,
       review_status = CASE
         WHEN review_status = 'pending_ai_review' THEN ?
         ELSE review_status
       END,
       updated_at = ?
     WHERE id = ? AND ai_review_task_id = ?`
  )
    .bind(
      JSON.stringify(review),
      review.score,
      review.risk_level,
      review.summary,
      review.decision === "auto_approve" ? "ai_approved" : "needs_manual_review",
      now,
      submissionId,
      taskId
    )
    .run();

  if (review.decision === "auto_approve" && canApplyDecision) {
    await adoptExternalSubmission(env, submissionId, "ai:auto", review.summary);
  }

  return review;
};
