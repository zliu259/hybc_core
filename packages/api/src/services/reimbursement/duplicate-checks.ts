import {
  classifyFuzzyDuplicate,
  isBlockingRiskLevel,
  type DuplicateScanResult
} from "../../routes/reimbursement-duplicate-scan";
import type { Env } from "../../types/env";
import type { ReimbursementEnvelope } from "../../types/reimbursement";
import { UNASSIGNED_APPLICANT, type InvoiceReviewRow } from "./review-helpers";

const nowIso = () => new Date().toISOString();

// 所有查重都只和已提交及之后的单比：草稿现在也识别，而申请人删不掉自己的废弃草稿，
// 不排除的话会被旧草稿拦下。两张草稿有同一张发票时，先提交的不报，后提交的报。
const COMPARABLE_ENVELOPE_SQL = "NOT IN ('draft', 'unregistered', 'cancelled', 'deleted')";
const INVOICE_LEVEL_MATCH_SQL = "'invoice_no_date', 'qr_hash', 'same_envelope'";

const buildDuplicateInsert = (
  env: Env,
  row: {
    envelopeId: number;
    matchedEnvelopeId: number;
    matchedInvoiceNo: string | null;
    matchType: string;
    riskLevel: string;
    summary: string;
    evidence: Record<string, unknown>;
    now: string;
  }
) =>
  env.DB.prepare(
    `INSERT INTO reimbursement_duplicate_check
      (envelope_id, matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`
  )
    .bind(
      row.envelopeId,
      row.matchedEnvelopeId,
      row.matchedInvoiceNo,
      row.matchType,
      row.riskLevel,
      row.summary,
      JSON.stringify(row.evidence),
      row.now
    );

/** 同一张发票在同一单里出现的判断依据，任何一项相同都算。 */
const sameInvoiceKeys = (row: InvoiceReviewRow): string[] => {
  const invoiceNo = row.invoice_no?.trim();
  const invoiceDate = row.invoice_date?.trim();
  const qrHash = row.qr_hash?.trim();
  const uniqueNo = row.invoice_unique_no?.trim();
  return [
    invoiceNo && invoiceDate ? `no:${invoiceNo}|${invoiceDate}` : null,
    qrHash ? `qr:${qrHash}` : null,
    uniqueNo ? `unique:${uniqueNo}` : null
  ].filter((key): key is string => Boolean(key));
};

const buildSameEnvelopeInserts = (
  env: Env,
  envelopeId: number,
  rows: InvoiceReviewRow[],
  now: string
): D1PreparedStatement[] => {
  let firstSeen = new Map<string, InvoiceReviewRow>();
  const inserts: D1PreparedStatement[] = [];
  for (const row of rows) {
    const keys = sameInvoiceKeys(row);
    const earlier = keys.map((key) => firstSeen.get(key)).find(Boolean);
    firstSeen = new Map([...keys.map((key) => [key, firstSeen.get(key) ?? row] as const), ...firstSeen]);
    if (!earlier) continue;
    inserts.push(
      buildDuplicateInsert(env, {
        envelopeId,
        matchedEnvelopeId: envelopeId,
        matchedInvoiceNo: row.invoice_no,
        matchType: "same_envelope",
        riskLevel: "high",
        summary: "同一张发票在这张报销里传了不止一次",
        evidence: {
          attachment_id: earlier.attachment_id,
          other_attachment_id: row.attachment_id,
          invoice_no: row.invoice_no,
          invoice_date: row.invoice_date
        },
        now
      })
    );
  }
  return inserts;
};

export const applyInvoiceReviewDuplicateChecks = async (
  env: Env,
  envelopeId: number,
  rows: InvoiceReviewRow[]
): Promise<number> => {
  const now = nowIso();
  const completedRows = rows.filter((row) => row.task_status === "completed");
  const inserts: D1PreparedStatement[] = [];
  for (const row of completedRows) {
    const invoiceNo = row.invoice_no?.trim();
    const invoiceDate = row.invoice_date?.trim();
    if (invoiceNo && invoiceDate) {
      const matched = await env.DB.prepare(
        `SELECT DISTINCT r.envelope_id
           FROM reimbursement_invoice_review r
           JOIN envelope_attachment a ON a.id = r.attachment_id AND a.envelope_id = r.envelope_id AND a.status = 'active'
           JOIN reimbursement_envelope e ON e.id = r.envelope_id
          WHERE r.envelope_id != ?
            AND r.invoice_no = ?
            AND r.invoice_date = ?
            AND r.task_status = 'completed'
            AND r.review_round > 0
            AND e.status ${COMPARABLE_ENVELOPE_SQL}
          ORDER BY r.envelope_id DESC
          LIMIT 10`
      )
        .bind(envelopeId, invoiceNo, invoiceDate)
        .all<{ envelope_id: number }>();

      for (const item of matched.results ?? []) {
        inserts.push(buildDuplicateInsert(env, {
          envelopeId,
          matchedEnvelopeId: item.envelope_id,
          matchedInvoiceNo: invoiceNo,
          matchType: "invoice_no_date",
          riskLevel: row.invoice_unique_no ? "high" : "medium",
          summary: row.invoice_unique_no
            ? "电子发票号+日期重复且唯一编号可交叉验证，疑似重复票据"
            : "电子发票号+日期重复，建议办公室结合附件原件进一步核对",
          evidence: {
            attachment_id: row.attachment_id,
            invoice_no: invoiceNo,
            invoice_date: invoiceDate,
            invoice_unique_no: row.invoice_unique_no,
            confidence: row.invoice_unique_no ? "strong" : "medium"
          },
          now
        }));
      }
    }

    const qrHash = row.qr_hash?.trim();
    if (!qrHash) continue;
    const matchedQr = await env.DB.prepare(
      `SELECT DISTINCT r.envelope_id
         FROM reimbursement_invoice_review r
         JOIN envelope_attachment a ON a.id = r.attachment_id AND a.envelope_id = r.envelope_id AND a.status = 'active'
         JOIN reimbursement_envelope e ON e.id = r.envelope_id
        WHERE r.envelope_id != ?
          AND r.qr_hash = ?
          AND r.task_status = 'completed'
          AND r.review_round > 0
          AND e.status ${COMPARABLE_ENVELOPE_SQL}
        ORDER BY r.envelope_id DESC
        LIMIT 10`
    )
      .bind(envelopeId, qrHash)
      .all<{ envelope_id: number }>();
    for (const item of matchedQr.results ?? []) {
      inserts.push(buildDuplicateInsert(env, {
        envelopeId,
        matchedEnvelopeId: item.envelope_id,
        matchedInvoiceNo: row.invoice_no,
        matchType: "qr_hash",
        riskLevel: "high",
        summary: "电子发票二维码内容重复，疑似重复票据",
        evidence: {
          attachment_id: row.attachment_id,
          qr_hash: qrHash,
          invoice_no: row.invoice_no,
          invoice_date: row.invoice_date
        },
        now
      }));
    }
  }

  const allInserts = [...inserts, ...buildSameEnvelopeInserts(env, envelopeId, completedRows, now)];
  // 删除和写入放进同一个 batch：复核通过要读这张表，读到空窗就会漏掉重复直接放行
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM reimbursement_duplicate_check WHERE envelope_id = ? AND match_type IN (${INVOICE_LEVEL_MATCH_SQL})`
    ).bind(envelopeId),
    ...allInserts
  ]);
  return allInserts.length;
};

export const applyDuplicateChecks = async (
  env: Env,
  envelopeId: number,
  hints?: {
    invoice_unique_no?: string | null;
    invoice_no?: string | null;
    expense_date?: string | null;
    attachment_id?: number | null;
  }
): Promise<DuplicateScanResult> => {
  const envelope = await env.DB.prepare("SELECT * FROM reimbursement_envelope WHERE id = ?")
    .bind(envelopeId)
    .first<ReimbursementEnvelope>();

  if (!envelope || envelope.status === "deleted") {
    return { total: 0, blocking: 0 };
  }

  const now = nowIso();
  const inserts: D1PreparedStatement[] = [];
  let total = 0;
  let blocking = 0;

  const invoiceUniqueNo = hints?.invoice_unique_no?.trim() || envelope.invoice_unique_no?.trim();
  const invoiceNo = hints?.invoice_no?.trim() || envelope.invoice_no?.trim();
  const expenseDate = hints?.expense_date?.trim() || envelope.expense_date;
  if (invoiceUniqueNo || invoiceNo) {
    const rows = invoiceUniqueNo
      ? await env.DB.prepare(
          `SELECT id, project_id, invoice_no, invoice_unique_no FROM reimbursement_envelope
           WHERE id != ? AND status ${COMPARABLE_ENVELOPE_SQL} AND invoice_unique_no = ?`
        )
          .bind(envelopeId, invoiceUniqueNo)
          .all<{ id: number; project_id: number; invoice_no: string | null; invoice_unique_no: string | null }>()
      : await env.DB.prepare(
          `SELECT id, project_id, invoice_no, invoice_unique_no FROM reimbursement_envelope
           WHERE id != ? AND status ${COMPARABLE_ENVELOPE_SQL} AND invoice_no = ?`
        )
          .bind(envelopeId, invoiceNo ?? "")
          .all<{ id: number; project_id: number; invoice_no: string | null; invoice_unique_no: string | null }>();

    for (const row of rows.results ?? []) {
      const matchType = row.project_id === envelope.project_id ? "exact" : "cross_project";
      inserts.push(env.DB.prepare(
        `INSERT INTO reimbursement_duplicate_check
          (envelope_id, matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json, created_at)
         VALUES (?, ?, ?, ?, ?, 'high', ?, ?, ?)`
      )
        .bind(
          envelopeId,
          row.id,
          row.invoice_unique_no ?? row.invoice_no,
          matchType,
          1,
          matchType === "exact" ? "发票唯一编号完全重复" : "发票唯一编号跨项目重复",
          JSON.stringify({
            matched_envelope_id: row.id,
            invoice_unique_no: row.invoice_unique_no,
            invoice_no: row.invoice_no,
            attachment_id: hints?.attachment_id ?? null
          }),
          now
        ));
      total += 1;
      blocking += 1;
    }
  }

  if (envelope.amount > 0 && envelope.applicant_userid !== UNASSIGNED_APPLICANT) {
    const splitParentId = envelope.split_from_envelope_id ?? -1;
    const fuzzyRows = await env.DB.prepare(
      `SELECT id, project_id, invoice_no, amount, expense_date FROM reimbursement_envelope
       WHERE id != ? AND status ${COMPARABLE_ENVELOPE_SQL}
         AND applicant_userid = ?
         AND ABS(amount - ?) <= 1
         AND (
           expense_date IS NULL OR ? IS NULL OR ABS(julianday(expense_date) - julianday(?)) <= 7
         )
         AND id != ?
         AND (split_from_envelope_id IS NULL OR split_from_envelope_id NOT IN (?, ?))
       ORDER BY updated_at DESC
       LIMIT 10`
    )
      .bind(
        envelopeId,
        envelope.applicant_userid,
        envelope.amount,
        expenseDate,
        expenseDate,
        // 同一次拆出来的单金额可能相同，不算重复
        splitParentId,
        envelopeId,
        splitParentId
      )
      .all<{
        id: number;
        project_id: number;
        invoice_no: string | null;
        amount: number;
        expense_date: string | null;
      }>();

    for (const row of fuzzyRows.results ?? []) {
      const classification = classifyFuzzyDuplicate(expenseDate ?? null, row.expense_date);
      inserts.push(env.DB.prepare(
        `INSERT INTO reimbursement_duplicate_check
          (envelope_id, matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json, created_at)
         VALUES (?, ?, ?, 'fuzzy', ?, ?, ?, ?, ?)`
      )
        .bind(
          envelopeId,
          row.id,
          row.invoice_no,
          classification.match_score,
          classification.risk_level,
          classification.summary,
          JSON.stringify({
            matched_envelope_id: row.id,
            amount: row.amount,
            expense_date: row.expense_date
          }),
          now
        ));
      total += 1;
      if (isBlockingRiskLevel(classification.risk_level)) {
        blocking += 1;
      }
    }
  }

  const attachmentRows = await env.DB.prepare(
    "SELECT file_key FROM envelope_attachment WHERE envelope_id = ? AND status = 'active' AND file_key IS NOT NULL"
  )
    .bind(envelopeId)
    .all<{ file_key: string }>();
  const fileKeys = Array.from(
    new Set(
      (attachmentRows.results ?? [])
        .map(row => row.file_key?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );

  for (const fileKey of fileKeys) {
    const matched = await env.DB.prepare(
      `SELECT ea.envelope_id
         FROM envelope_attachment ea
         JOIN reimbursement_envelope re ON re.id = ea.envelope_id
        WHERE ea.file_key = ?
          AND ea.status = 'active'
          AND ea.envelope_id != ?
          AND re.status != 'deleted'
        ORDER BY ea.id DESC
        LIMIT 10`
    )
      .bind(fileKey, envelopeId)
      .all<{ envelope_id: number }>();

    for (const row of matched.results ?? []) {
      inserts.push(env.DB.prepare(
        `INSERT INTO reimbursement_duplicate_check
          (envelope_id, matched_envelope_id, matched_invoice_no, match_type, match_score, risk_level, summary, evidence_json, created_at)
         VALUES (?, ?, NULL, 'attachment_file_key', ?, 'high', ?, ?, ?)`
      )
        .bind(
          envelopeId,
          row.envelope_id,
          0.95,
          "附件文件疑似重复提交（file_key 一致）",
          JSON.stringify({ matched_envelope_id: row.envelope_id, file_key: fileKey }),
          now
        ));
      total += 1;
      blocking += 1;
    }
  }

  // 只换这里写的几种，发票级的由 applyInvoiceReviewDuplicateChecks 负责。放进同一个 batch，别的请求读不到空窗。
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM reimbursement_duplicate_check WHERE envelope_id = ? AND match_type NOT IN (${INVOICE_LEVEL_MATCH_SQL})`
    ).bind(envelopeId),
    ...inserts
  ]);

  return { total, blocking };
};

/** 当前轮次里每个有效附件的识别行。 */
export const loadCurrentReviewRows = async (env: Env, envelopeId: number): Promise<InvoiceReviewRow[]> => {
  const rows = await env.DB.prepare(
    `SELECT r.id, r.attachment_id, r.review_round, r.task_id, r.task_status, r.extraction_json,
            r.qr_text, r.qr_hash, r.invoice_unique_no, r.invoice_no, r.invoice_date, r.invoice_amount,
            r.source, r.risk_level, r.risk_hint
       FROM reimbursement_invoice_review r
       JOIN envelope_attachment a ON a.id = r.attachment_id AND a.envelope_id = r.envelope_id AND a.status = 'active'
      WHERE r.envelope_id = ?
        AND r.review_round = (SELECT MAX(review_round) FROM reimbursement_invoice_review WHERE envelope_id = ?)
      ORDER BY r.id ASC`
  )
    .bind(envelopeId, envelopeId)
    .all<InvoiceReviewRow>();
  return rows.results ?? [];
};

/** 写到信封上的发票号提示取最完整的一行。 */
export const pickBestReviewRow = (completedRows: InvoiceReviewRow[]): InvoiceReviewRow | undefined =>
  completedRows.find((row) => row.qr_text && row.invoice_no && row.invoice_date) ??
  completedRows.find((row) => row.invoice_no || row.invoice_unique_no || row.invoice_date);

/** 提交时用：整单规则加上每张发票的识别结果。发票级的只写 high、medium，全部算阻断。 */
export const scanEnvelopeDuplicates = async (env: Env, envelopeId: number): Promise<DuplicateScanResult> => {
  const rows = await loadCurrentReviewRows(env, envelopeId);
  const best = pickBestReviewRow(rows.filter((row) => row.task_status === "completed"));
  const scan = await applyDuplicateChecks(
    env,
    envelopeId,
    best
      ? {
          invoice_unique_no: best.invoice_unique_no,
          invoice_no: best.invoice_no,
          expense_date: best.invoice_date,
          attachment_id: best.attachment_id
        }
      : undefined
  );
  const invoiceLevel = await applyInvoiceReviewDuplicateChecks(env, envelopeId, rows);
  return { total: scan.total + invoiceLevel, blocking: scan.blocking + invoiceLevel };
};
