import type { Env } from "../../types/env";
import type { AttachmentInput } from "../../types/reimbursement";

// 报销附件的统一规则。两端只做提前提示，以这里为准。

export const MAX_ATTACHMENTS_PER_ENVELOPE = 30;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_EXTENSIONS = ["pdf", "jpg", "jpeg", "png"];
export const REIMBURSEMENT_KEY_PREFIX = "reimbursement/";

export type NewAttachmentInput = AttachmentInput;

export type AttachmentValidationResult =
  | { ok: true; attachments: NewAttachmentInput[] }
  | { ok: false; message: string };

const nowIso = () => new Date().toISOString();

const displayName = (attachment: NewAttachmentInput): string => {
  const name = attachment.file_name?.trim();
  if (name) return name;
  return attachment.file_key?.trim().split("/").at(-1) || "附件";
};

const hasAllowedExtension = (name: string): boolean => {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return ALLOWED_ATTACHMENT_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
};

const uniqueByFileKey = (attachments: NewAttachmentInput[]): NewAttachmentInput[] =>
  attachments.filter(
    (item, index) => attachments.findIndex((other) => other.file_key === item.file_key) === index
  );

const loadActiveFileKeys = async (env: Env, envelopeId: number): Promise<string[]> => {
  const rows = await env.DB.prepare(
    "SELECT file_key FROM envelope_attachment WHERE envelope_id = ? AND status = 'active'"
  )
    .bind(envelopeId)
    .all<{ file_key: string }>();
  return (rows.results ?? []).map((row) => row.file_key);
};

/**
 * 检查后返回去重过的列表，file_size 换成 R2 里的实际大小。envelopeId 为 null 表示新建，不查已有附件。
 * 重试已绑定的文件不算新增，所以不占数量。
 */
export const validateNewAttachments = async (
  env: Env,
  envelopeId: number | null,
  attachments: NewAttachmentInput[]
): Promise<AttachmentValidationResult> => {
  const unique = uniqueByFileKey(attachments);

  for (const attachment of unique) {
    const name = displayName(attachment);
    if (!hasAllowedExtension(name)) {
      return { ok: false, message: `${name}：只支持 PDF、JPG、PNG` };
    }
    if (!attachment.file_key?.trim().startsWith(REIMBURSEMENT_KEY_PREFIX)) {
      return { ok: false, message: `${name}：文件地址不对，请重新上传` };
    }
  }

  const activeKeys = envelopeId === null ? [] : await loadActiveFileKeys(env, envelopeId);
  const newCount = unique.filter((item) => !activeKeys.includes(item.file_key)).length;
  if (activeKeys.length + newCount > MAX_ATTACHMENTS_PER_ENVELOPE) {
    return { ok: false, message: `一张报销最多 ${MAX_ATTACHMENTS_PER_ENVELOPE} 个附件` };
  }

  const heads = await Promise.all(unique.map((item) => env.FILES.head(item.file_key)));
  for (const [index, head] of heads.entries()) {
    const name = displayName(unique[index]);
    if (!head) {
      return { ok: false, message: `${name}：文件没有传上来，请重新上传` };
    }
    if (head.size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, message: `${name}：不能超过 20MB` };
    }
  }

  return {
    ok: true,
    attachments: unique.map((item, index) => ({ ...item, file_size: heads[index]?.size ?? item.file_size }))
  };
};

/** 写入附件，同一单已有相同 file_key 的不重复写。按请求顺序返回每个文件的附件编号。 */
export const bindEnvelopeAttachments = async (
  env: Env,
  envelopeId: number,
  attachments: NewAttachmentInput[]
): Promise<number[]> => {
  const activeKeys = await loadActiveFileKeys(env, envelopeId);
  const newOnes = attachments.filter((item) => !activeKeys.includes(item.file_key));

  if (newOnes.length > 0) {
    const now = nowIso();
    await env.DB.batch(
      newOnes.map((item) =>
        env.DB.prepare(
          `INSERT INTO envelope_attachment
            (envelope_id, attachment_type, file_key, file_name, file_size, invoice_no, amount, issue_date, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`
        ).bind(
          envelopeId,
          item.attachment_type ?? "invoice",
          item.file_key,
          item.file_name ?? null,
          item.file_size ?? null,
          item.invoice_no ?? null,
          item.amount ?? null,
          item.issue_date ?? null,
          now
        )
      )
    );
  }

  const rows = await env.DB.prepare(
    "SELECT id, file_key FROM envelope_attachment WHERE envelope_id = ? AND status = 'active' ORDER BY id ASC"
  )
    .bind(envelopeId)
    .all<{ id: number; file_key: string }>();
  const idByKey = new Map((rows.results ?? []).map((row) => [row.file_key, row.id]));
  return attachments
    .map((item) => idByKey.get(item.file_key))
    .filter((id): id is number => id !== undefined);
};
