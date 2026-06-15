import assert from "node:assert/strict";
import { test } from "node:test";

const loadFn = async () => {
  const mod = await import("../src/utils/invoice-attachments.ts");
  return mod.buildInvoiceAttachments;
};

test("builds all four legacy attachment slots in a stable order", async () => {
  const buildInvoiceAttachments = await loadFn();
  const result = buildInvoiceAttachments({
    file_key: "receipt/a.jpg",
    pdf_file_key: "receipt/a.pdf",
    ofd_file_key: "receipt/a.ofd",
    xml_file_key: "receipt/a.xml"
  });
  assert.deepEqual(result, [
    { label: "发票文件", key: "receipt/a.jpg" },
    { label: "PDF", key: "receipt/a.pdf" },
    { label: "OFD", key: "receipt/a.ofd" },
    { label: "XML", key: "receipt/a.xml" }
  ]);
});

test("includes only legacy slots that have a key", async () => {
  const buildInvoiceAttachments = await loadFn();
  const result = buildInvoiceAttachments({
    file_key: "receipt/only.pdf",
    pdf_file_key: null,
    ofd_file_key: undefined,
    xml_file_key: ""
  });
  assert.deepEqual(result, [{ label: "发票文件", key: "receipt/only.pdf" }]);
});

test("ignores whitespace-only keys and trims valid keys", async () => {
  const buildInvoiceAttachments = await loadFn();
  const result = buildInvoiceAttachments({
    file_key: "   ",
    pdf_file_key: "  receipt/trim.pdf  "
  });
  assert.deepEqual(result, [{ label: "PDF", key: "receipt/trim.pdf" }]);
});

test("appends supplementary attachments from attachments_json after legacy slots", async () => {
  const buildInvoiceAttachments = await loadFn();
  const result = buildInvoiceAttachments({
    file_key: "receipt/main.jpg",
    attachments_json: JSON.stringify([
      { file_key: "receipt/extra-1.pdf", file_name: "补充协议.pdf" },
      { file_key: "receipt/extra-2.jpg", file_name: "银行回单.jpg" }
    ])
  });
  assert.deepEqual(result, [
    { label: "发票文件", key: "receipt/main.jpg" },
    { label: "补充协议.pdf", key: "receipt/extra-1.pdf" },
    { label: "银行回单.jpg", key: "receipt/extra-2.jpg" }
  ]);
});

test("uses the key as label when a supplementary attachment has no file_name", async () => {
  const buildInvoiceAttachments = await loadFn();
  const result = buildInvoiceAttachments({
    attachments_json: JSON.stringify([{ file_key: "receipt/no-name.bin" }])
  });
  assert.deepEqual(result, [
    { label: "receipt/no-name.bin", key: "receipt/no-name.bin" }
  ]);
});

test("deduplicates by key, keeping the first (legacy) label", async () => {
  const buildInvoiceAttachments = await loadFn();
  const result = buildInvoiceAttachments({
    file_key: "receipt/dup.pdf",
    attachments_json: JSON.stringify([
      { file_key: "receipt/dup.pdf", file_name: "重复文件.pdf" },
      { file_key: "receipt/unique.pdf", file_name: "唯一文件.pdf" }
    ])
  });
  assert.deepEqual(result, [
    { label: "发票文件", key: "receipt/dup.pdf" },
    { label: "唯一文件.pdf", key: "receipt/unique.pdf" }
  ]);
});

test("safely ignores malformed attachments_json", async () => {
  const buildInvoiceAttachments = await loadFn();
  const result = buildInvoiceAttachments({
    file_key: "receipt/main.jpg",
    attachments_json: "not-json{"
  });
  assert.deepEqual(result, [{ label: "发票文件", key: "receipt/main.jpg" }]);
});

test("returns empty array when no attachments exist", async () => {
  const buildInvoiceAttachments = await loadFn();
  assert.deepEqual(buildInvoiceAttachments({}), []);
  assert.deepEqual(
    buildInvoiceAttachments({
      file_key: null,
      pdf_file_key: null,
      ofd_file_key: null,
      xml_file_key: null,
      attachments_json: null
    }),
    []
  );
});
