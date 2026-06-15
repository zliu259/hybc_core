/**
 * 从正式发票记录中提取可下载的附件列表。
 *
 * 来源有两类，按顺序合并并按 file_key 去重（先出现者优先）：
 * 1. 历史单值列：上传的发票文件、PDF、OFD、XML；
 * 2. 后续补充上传的多附件（attachments_json，JSON 数组）。
 */
export interface InvoiceAttachmentSource {
  file_key?: string | null;
  pdf_file_key?: string | null;
  ofd_file_key?: string | null;
  xml_file_key?: string | null;
  attachments_json?: string | null;
}

export interface InvoiceAttachment {
  label: string;
  key: string;
}

const normalizeKey = (key: string | null | undefined): string =>
  typeof key === "string" ? key.trim() : "";

/**
 * 解析以 JSON 数组形式存储的附件（[{ file_key, file_name }]），
 * 兼容 key/name 别名，label 取 file_name，缺失时回退 key。
 * 适用于开票申请的 attachments_json、发票补充附件等场景。
 */
export const parseAttachmentEntries = (
  raw: string | null | undefined
): InvoiceAttachment[] => {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: InvoiceAttachment[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as {
        file_key?: string;
        key?: string;
        file_name?: string;
        name?: string;
      };
      const key = normalizeKey(row.file_key ?? row.key);
      if (!key) continue;
      const label = (row.file_name ?? row.name ?? "").trim() || key;
      result.push({ label, key });
    }
    return result;
  } catch {
    return [];
  }
};

export function buildInvoiceAttachments(
  invoice: InvoiceAttachmentSource
): InvoiceAttachment[] {
  const legacySlots: Array<{ label: string; key: string | null | undefined }> =
    [
      { label: "发票文件", key: invoice.file_key },
      { label: "PDF", key: invoice.pdf_file_key },
      { label: "OFD", key: invoice.ofd_file_key },
      { label: "XML", key: invoice.xml_file_key }
    ];

  const candidates: InvoiceAttachment[] = [
    ...legacySlots
      .map(slot => ({ label: slot.label, key: normalizeKey(slot.key) }))
      .filter(slot => slot.key.length > 0),
    ...parseAttachmentEntries(invoice.attachments_json)
  ];

  const seen = new Set<string>();
  const result: InvoiceAttachment[] = [];
  for (const item of candidates) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    result.push(item);
  }
  return result;
}
