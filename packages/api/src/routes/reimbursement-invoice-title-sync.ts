import {
  matchInvoiceTitleEntity,
  resolveOcrTitleUpdate,
  type InvoiceTitleEntityCandidate,
  type OcrTitleUpdate
} from "./reimbursement-invoice-title-policy";

export type SyncEnvelopeInvoiceTitleInput = {
  envelopeId: number;
  currentSource: string | null;
  buyerName: string | null;
  pendingCount: number;
};

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
 */
export const syncEnvelopeInvoiceTitle = async (
  db: D1Database,
  input: SyncEnvelopeInvoiceTitleInput
): Promise<OcrTitleUpdate | null> => {
  if (input.currentSource === "manual") return null;
  if (input.pendingCount > 0) return null;

  const match = input.buyerName
    ? matchInvoiceTitleEntity(input.buyerName, await loadActiveEntities(db))
    : { entityId: null, name: null };
  const update = resolveOcrTitleUpdate(
    { invoice_title_source: input.currentSource },
    { buyerName: input.buyerName, pendingCount: input.pendingCount },
    match
  );
  if (!update) return null;

  await db
    .prepare(
      `UPDATE reimbursement_envelope
          SET invoice_title_entity_id = ?, invoice_title_name = ?, invoice_title_source = ?
        WHERE id = ? AND COALESCE(invoice_title_source, '') != 'manual'`
    )
    .bind(update.entityId, update.name, update.source, input.envelopeId)
    .run();
  return update;
};
