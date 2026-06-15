/**
 * 从正式发票记录中提取可下载的附件列表。
 *
 * 正式发票可能附带多种文件：上传的发票文件、PDF、OFD、XML。
 * 仅返回实际存在 file_key 的附件，并保持稳定展示顺序。
 */
export interface InvoiceAttachmentSource {
  file_key?: string | null;
  pdf_file_key?: string | null;
  ofd_file_key?: string | null;
  xml_file_key?: string | null;
}

export interface InvoiceAttachment {
  label: string;
  key: string;
}

export function buildInvoiceAttachments(
  invoice: InvoiceAttachmentSource
): InvoiceAttachment[] {
  const sources: Array<{ label: string; key: string | null | undefined }> = [
    { label: "发票文件", key: invoice.file_key },
    { label: "PDF", key: invoice.pdf_file_key },
    { label: "OFD", key: invoice.ofd_file_key },
    { label: "XML", key: invoice.xml_file_key }
  ];

  return sources
    .map(item => ({
      label: item.label,
      key: typeof item.key === "string" ? item.key.trim() : ""
    }))
    .filter(item => item.key.length > 0);
}
