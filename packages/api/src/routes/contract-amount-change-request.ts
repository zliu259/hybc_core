import { changeTypes, type ChangeType } from "../types/contract";

/**
 * 合同金额变更申请的入参校验与附件存取。
 * 附件选填；只允许引用合同类目（`contract/`）下的上传件，
 * 避免借审批页去引用 AI 文书、历史财务件等受保护目录。
 */

export const MAX_AMOUNT_CHANGE_REASON_LENGTH = 1000;
export const MAX_AMOUNT_CHANGE_ATTACHMENTS = 20;

const ATTACHMENT_KEY_PREFIX = "contract/";
const MAX_FILE_KEY_LENGTH = 512;
const MAX_FILE_NAME_LENGTH = 255;

export interface AmountChangeAttachment {
  file_key: string;
  file_name: string;
  file_size: number | null;
}

export interface AmountChangeAttachmentView extends AmountChangeAttachment {
  file_url: string;
}

export interface AmountChangeInput {
  change_type: ChangeType;
  new_amount: number;
  reason: string;
  attachments: AmountChangeAttachment[];
}

export type AmountChangeParseResult =
  | { ok: true; value: AmountChangeInput }
  | { ok: false; message: string };

type AttachmentParseResult =
  | { ok: true; value: AmountChangeAttachment[] }
  | { ok: false; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isChangeType = (value: unknown): value is ChangeType =>
  typeof value === "string" && (changeTypes as readonly string[]).includes(value);

const toFileSize = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

const isAllowedFileKey = (key: string): boolean =>
  key.startsWith(ATTACHMENT_KEY_PREFIX) &&
  key.length <= MAX_FILE_KEY_LENGTH &&
  !key.split("/").includes("..");

const parseAttachments = (raw: unknown): AttachmentParseResult => {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "附件格式不正确" };
  if (raw.length > MAX_AMOUNT_CHANGE_ATTACHMENTS) {
    return { ok: false, message: `附件最多 ${MAX_AMOUNT_CHANGE_ATTACHMENTS} 个` };
  }

  const seen = new Set<string>();
  const attachments: AmountChangeAttachment[] = [];
  for (const item of raw) {
    if (!isRecord(item)) return { ok: false, message: "附件格式不正确" };
    const fileKey = typeof item.file_key === "string" ? item.file_key.trim() : "";
    const fileName = typeof item.file_name === "string" ? item.file_name.trim() : "";
    if (!isAllowedFileKey(fileKey)) return { ok: false, message: "附件来源无效，请重新上传" };
    if (!fileName || fileName.length > MAX_FILE_NAME_LENGTH) {
      return { ok: false, message: "附件文件名无效" };
    }
    if (seen.has(fileKey)) continue;
    seen.add(fileKey);
    attachments.push({
      file_key: fileKey,
      file_name: fileName,
      file_size: toFileSize(item.file_size)
    });
  }
  return { ok: true, value: attachments };
};

export function parseAmountChangeRequest(body: unknown): AmountChangeParseResult {
  if (!isRecord(body)) return { ok: false, message: "请求格式不正确" };

  if (!isChangeType(body.change_type)) return { ok: false, message: "变更类型无效" };

  const newAmount = body.new_amount;
  if (typeof newAmount !== "number" || !Number.isFinite(newAmount) || newAmount < 0) {
    return { ok: false, message: "新合同金额无效" };
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return { ok: false, message: "请填写变更缘由" };
  if (reason.length > MAX_AMOUNT_CHANGE_REASON_LENGTH) {
    return { ok: false, message: `变更缘由不能超过 ${MAX_AMOUNT_CHANGE_REASON_LENGTH} 字` };
  }

  const attachments = parseAttachments(body.attachments);
  if (!attachments.ok) return attachments;

  return {
    ok: true,
    value: {
      change_type: body.change_type,
      new_amount: newAmount,
      reason,
      attachments: attachments.value
    }
  };
}

export function serializeAmountChangeAttachments(
  attachments: readonly AmountChangeAttachment[]
): string | null {
  return attachments.length > 0 ? JSON.stringify(attachments) : null;
}

/** 读取库内附件列表；库内数据由本模块写入，仍按不可信数据逐项兜底。 */
export function readAmountChangeAttachments(raw: string | null): AmountChangeAttachmentView[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((item) => {
    if (!isRecord(item) || typeof item.file_key !== "string" || !item.file_key) return [];
    const fileKey = item.file_key;
    return [
      {
        file_key: fileKey,
        file_name: typeof item.file_name === "string" && item.file_name ? item.file_name : fileKey,
        file_size: toFileSize(item.file_size),
        file_url: `/api/v1/upload/object/${encodeURIComponent(fileKey)}`
      }
    ];
  });
}

export type AmountChangeView<T extends { attachments_json: string | null }> = Omit<
  T,
  "attachments_json"
> & {
  attachments: AmountChangeAttachmentView[];
};

/** 对外返回时把 attachments_json 换成解析后的 attachments，前端不再各自解析。 */
export function presentAmountChange<T extends { attachments_json: string | null }>(
  change: T
): AmountChangeView<T> {
  const { attachments_json: attachmentsJson, ...rest } = change;
  return { ...rest, attachments: readAmountChangeAttachments(attachmentsJson) };
}
