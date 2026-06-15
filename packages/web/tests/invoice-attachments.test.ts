import assert from "node:assert/strict";
import { test } from "node:test";

const loadFn = async () => {
  const mod = await import("../src/utils/invoice-attachments.ts");
  return mod.buildInvoiceAttachments;
};

test("builds all four attachment types in a stable order", async () => {
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

test("includes only attachments that have a key", async () => {
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

test("returns empty array when no attachments exist", async () => {
  const buildInvoiceAttachments = await loadFn();
  assert.deepEqual(buildInvoiceAttachments({}), []);
  assert.deepEqual(
    buildInvoiceAttachments({
      file_key: null,
      pdf_file_key: null,
      ofd_file_key: null,
      xml_file_key: null
    }),
    []
  );
});
