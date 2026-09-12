import {
  matchInvoiceTitleEntity,
  resolveOcrTitleUpdate,
  type InvoiceTitleEntityCandidate,
  type OcrTitleUpdate
} from "./reimbursement-invoice-title-policy";
import { writeAuditLog } from "../services/audit-log";

export type SyncEnvelopeInvoiceTitleInput = {
  envelopeId: number;
  currentStatus: string;
  currentEntityId: number | null;
  currentName: string | null;
  currentSource: string | null;
  buyerName: string | null;
  pendingCount: number;
  completedCount: number;
};

// 与 PUT /:id 手工指定的锁定状态一致：离开办公室阶段后 OCR 不再改写抬头
const TITLE_LOCKED_STATUSES = new Set(["batched", "pending_approval", "approved", "paid"]);

const loadActiveEntities = async (db: D1Database): Promise<InvoiceTitleEntityCandidate[]> => {
  const rows = await db
    .prepare("SELECT id, entity_name, status FROM entity WHERE status = 'active'")
    .all<InvoiceTitleEntityCandidate>();
  return rows.results ?? [];
};

/**
 * OCR 同步阶段写抬头。手工指定过 / 识别未完成时不写；
 * UPDATE 自带 `!= 'manual'` 守卫，防止装载后办公室刚好手工指定的竞态。
 * 返回实际决定（便于调用方记录/测试）。
 * 与手工指定同样留痕：OCR 改写/清空抬头写审计（actor OCR_SYNC），值未变时不写
 */
export const syncEnvelopeInvoiceTitle = async (
  db: D1Database,
  input: SyncEnvelopeInvoiceTitleInput
): Promise<OcrTitleUpdate | null> => {
  if (TITLE_LOCKED_STATUSES.has(input.currentStatus)) return null;
  if (input.currentSource === "manual") return null;
  if (input.pendingCount > 0) return null;

  const match = input.buyerName
    ? matchInvoiceTitleEntity(input.buyerName, await loadActiveEntities(db))
    : { entityId: null, name: null };
  const update = resolveOcrTitleUpdate(
    { invoice_title_source: input.currentSource },
    {
      buyerName: input.buyerName,
      pendingCount: input.pendingCount,
      completedCount: input.completedCount
    },
    match
  );
  if (!update) return null;

  const unchanged =
    update.entityId === input.currentEntityId &&
    update.name === input.currentName &&
    update.source === input.currentSource;
  if (unchanged) return null;

  await db
    .prepare(
      `UPDATE reimbursement_envelope
          SET invoice_title_entity_id = ?, invoice_title_name = ?, invoice_title_source = ?,
              updated_at = ?
        WHERE id = ? AND COALESCE(invoice_title_source, '') != 'manual'`
    )
    .bind(update.entityId, update.name, update.source, new Date().toISOString(), input.envelopeId)
    .run();

  await writeAuditLog(db, {
    actorUserId: "OCR_SYNC",
    action: "reimbursement.envelope.ocr_invoice_title",
    targetType: "reimbursement_envelope",
    targetId: input.envelopeId,
    detail: {
      before: {
        entity_id: input.currentEntityId,
        name: input.currentName,
        source: input.currentSource
      },
      after: { entity_id: update.entityId, name: update.name, source: update.source },
      buyer_name: input.buyerName
    }
  });

  return update;
};
