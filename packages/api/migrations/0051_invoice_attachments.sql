-- 正式发票多附件支持
-- 历史上发票仅有 file_key / pdf_file_key / ofd_file_key / xml_file_key 四个单值列，
-- 无法满足后续补充上传多个附件的需求。新增 attachments_json 以 JSON 数组存储
-- 补充上传的附件（[{ file_key, file_name, file_size }]），与 invoice_request /
-- receipt 的附件存储方式保持一致。
ALTER TABLE invoice ADD COLUMN attachments_json TEXT;
