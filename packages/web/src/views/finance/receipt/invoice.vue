<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import { formatToken, getToken } from "@/utils/auth";
import { listContracts, type Contract } from "@/api/contract";
import { listEntities, type Entity } from "@/api/entity";
import {
  listPayees,
  createPayee,
  updatePayee,
  type Payee
} from "@/api/payment";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import {
  buildInvoiceAttachments,
  parseAttachmentEntries,
  type InvoiceAttachment
} from "@/utils/invoice-attachments";
import { useProjectOptions } from "@/composables/useProjectOptions";
import {
  deleteInvoice,
  listInvoices,
  listInvoiceRequests,
  createInvoiceRequest,
  submitInvoiceRequestApproval,
  issueInvoiceFromRequest,
  triggerInvoiceVerify,
  appendInvoiceAttachments,
  type Invoice,
  type InvoiceRequest
} from "@/api/receipt";

defineOptions({ name: "InvoiceList" });
const router = useRouter();
const route = useRoute();

type AttachmentDraft = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
};

type InvoiceItemDraft = {
  name: string;
  specification: string;
  unit: string;
  quantity: number;
  /** Tax-inclusive unit price. Stored as unit_price for API compatibility. */
  unit_price: number;
};

type InvoiceItemTemplate = {
  key: string;
  label: string;
  items: InvoiceItemDraft[];
};

const activeTab = ref<"request" | "invoice">("request");
const loadingRequest = ref(false);
const loadingInvoice = ref(false);
const contracts = ref<Contract[]>([]);
const requestList = ref<InvoiceRequest[]>([]);
const invoiceList = ref<Invoice[]>([]);
const payees = ref<Payee[]>([]);
const entities = ref<Entity[]>([]);
const { projects, loadProjects } = useProjectOptions();

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  contract_id: undefined as number | undefined,
  status: "",
  keyword: ""
});

const contractMap = computed(() => {
  const map: Record<number, string> = {};
  contracts.value.forEach(item => {
    map[item.id] = item.contract_no;
  });
  return map;
});

const entityMap = computed(() => {
  const map: Record<number, string> = {};
  entities.value.forEach(item => {
    map[item.id] = item.entity_name;
  });
  return map;
});

const requestDialogVisible = ref(false);
const requesting = ref(false);
const uploadingAttachment = ref(false);
const counterpartyMode = ref<"select" | "manual">("select");
const saveCounterparty = ref(true);
const remittanceAttachments = ref<AttachmentDraft[]>([]);
const taxRateQuickValues = [0, 1, 3, 6, 9, 13];

const invoiceTypeLabelMap: Record<string, string> = {
  electronic: "电子发票",
  special: "增值税专票",
  normal: "增值税普票"
};

const invoiceRequestStatusLabelMap: Record<string, string> = {
  draft: "草稿",
  submitted: "已提交",
  pending_approval: "审批中",
  approved: "已通过",
  rejected: "已驳回",
  ready_to_issue: "待签发",
  issued: "已签发",
  cancelled: "已取消"
};

const toInvoiceTypeLabel = (value: string) =>
  invoiceTypeLabelMap[value] || value;
const toInvoiceRequestStatusLabel = (value: string) =>
  invoiceRequestStatusLabelMap[value] || value;

const requestForm = ref({
  contract_id: undefined as number | undefined,
  project_id: undefined as number | undefined,
  seller_entity_id: undefined as number | undefined,
  counterparty_payee_id: undefined as number | undefined,
  counterparty_name: "",
  counterparty_tax_no: "",
  counterparty_contact: "",
  invoice_type: "electronic" as "special" | "normal" | "electronic",
  invoice_category: "",
  tax_rate_percent: 6,
  remark: ""
});

const invoiceItems = ref<InvoiceItemDraft[]>([
  { name: "服务费", specification: "", unit: "项", quantity: 1, unit_price: 0 }
]);

const itemTemplates: InvoiceItemTemplate[] = [
  {
    key: "service-basic",
    label: "服务费模板",
    items: [
      {
        name: "技术服务费",
        specification: "",
        unit: "项",
        quantity: 1,
        unit_price: 0
      }
    ]
  },
  {
    key: "office-admin",
    label: "行政办公模板",
    items: [
      {
        name: "办公耗材",
        specification: "",
        unit: "批",
        quantity: 1,
        unit_price: 0
      },
      {
        name: "行政服务费",
        specification: "",
        unit: "项",
        quantity: 1,
        unit_price: 0
      }
    ]
  },
  {
    key: "project-mix",
    label: "项目混合模板",
    items: [
      {
        name: "材料费",
        specification: "",
        unit: "批",
        quantity: 1,
        unit_price: 0
      },
      {
        name: "人工服务费",
        specification: "",
        unit: "项",
        quantity: 1,
        unit_price: 0
      },
      {
        name: "运输服务费",
        specification: "",
        unit: "次",
        quantity: 1,
        unit_price: 0
      }
    ]
  }
];

const toLineAmountWithTax = (item: InvoiceItemDraft) => {
  const quantity = Number.isFinite(item.quantity) ? item.quantity : 0;
  const priceWithTax = Number.isFinite(item.unit_price) ? item.unit_price : 0;
  return quantity * priceWithTax;
};

const amountWithTax = computed(() => {
  return invoiceItems.value.reduce(
    (sum, item) => sum + toLineAmountWithTax(item),
    0
  );
});

const taxRateRatio = computed(() => {
  const taxRate = Number.isFinite(requestForm.value.tax_rate_percent)
    ? requestForm.value.tax_rate_percent
    : 0;
  return Math.max(taxRate, 0) / 100;
});

const amountWithoutTax = computed(() => {
  const divisor = 1 + taxRateRatio.value;
  if (divisor <= 0) return amountWithTax.value;
  return amountWithTax.value / divisor;
});

const taxAmountEstimated = computed(() => {
  return amountWithTax.value - amountWithoutTax.value;
});

const toChineseAmount = (amount: number): string => {
  if (!Number.isFinite(amount) || amount < 0) return "金额格式错误";
  if (amount === 0) return "零元整";

  const fractionUnits = ["角", "分"];
  const digit = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const intUnits = ["", "拾", "佰", "仟"];
  const sectionUnits = ["", "万", "亿", "兆"];

  let value = Math.round(amount * 100);
  const fraction = value % 100;
  let result = "";

  if (fraction === 0) {
    result = "整";
  } else {
    const jiao = Math.floor(fraction / 10);
    const fen = fraction % 10;
    if (jiao > 0) result += `${digit[jiao]}${fractionUnits[0]}`;
    if (fen > 0) result += `${digit[fen]}${fractionUnits[1]}`;
  }

  value = Math.floor(value / 100);
  let sectionIndex = 0;
  let intResult = "";

  while (value > 0 && sectionIndex < sectionUnits.length) {
    const sectionValue = value % 10000;
    if (sectionValue !== 0) {
      let sectionText = "";
      let unitIndex = 0;
      let section = sectionValue;
      let zeroPending = false;
      while (section > 0) {
        const num = section % 10;
        if (num === 0) {
          if (!zeroPending && sectionText) {
            zeroPending = true;
            sectionText = `零${sectionText}`;
          }
        } else {
          zeroPending = false;
          sectionText = `${digit[num]}${intUnits[unitIndex]}${sectionText}`;
        }
        unitIndex += 1;
        section = Math.floor(section / 10);
      }
      sectionText = sectionText.replace(/零+/g, "零").replace(/零$/g, "");
      intResult = `${sectionText}${sectionUnits[sectionIndex]}${intResult}`;
    } else if (intResult && !intResult.startsWith("零")) {
      intResult = `零${intResult}`;
    }
    sectionIndex += 1;
    value = Math.floor(value / 10000);
  }

  intResult = intResult.replace(/零+/g, "零").replace(/零([万亿兆])/g, "$1");
  intResult = intResult.replace(/亿万/g, "亿").replace(/零$/g, "");
  return `${intResult || "零"}元${result}`;
};

const amountWithoutTaxCn = computed(() =>
  toChineseAmount(amountWithoutTax.value)
);
const taxAmountEstimatedCn = computed(() =>
  toChineseAmount(taxAmountEstimated.value)
);
const amountWithTaxCn = computed(() => toChineseAmount(amountWithTax.value));

const issueDialogVisible = ref(false);
const issuing = ref(false);
const issueUploading = ref(false);
const selectedRequest = ref<InvoiceRequest | null>(null);
const issueForm = ref({
  file_key: "",
  file_name: "",
  remark: ""
});

watch(
  () => requestForm.value.contract_id,
  contractId => {
    if (!contractId) return;
    const contract = contracts.value.find(item => item.id === contractId);
    if (!contract) return;

    requestForm.value.project_id = contract.project_id;
    requestForm.value.seller_entity_id = contract.entity_id;
    if (!requestForm.value.counterparty_name) {
      requestForm.value.counterparty_name = contract.counterparty;
    }
  }
);

watch(
  () => requestForm.value.counterparty_payee_id,
  payeeId => {
    if (counterpartyMode.value !== "select" || !payeeId) return;
    const payee = payees.value.find(item => item.id === payeeId);
    if (!payee) return;
    requestForm.value.counterparty_name = payee.name;
    requestForm.value.counterparty_contact = payee.phone ?? "";
  }
);

const loadContracts = async () => {
  const result = await listContracts({
    direction: "inbound",
    page: 1,
    pageSize: 300
  });
  contracts.value = result.data;
};

const loadMeta = async () => {
  const [payeeRes, entityRes] = await Promise.all([
    listPayees({ type: "external" }),
    listEntities({ status: "active" })
  ]);
  payees.value = payeeRes.data;
  entities.value = entityRes.data;
  await loadProjects();
};

const loadInvoiceRequests = async () => {
  loadingRequest.value = true;
  try {
    const result = await listInvoiceRequests({
      page: page.value,
      pageSize: pageSize.value,
      contract_id: filters.value.contract_id,
      status: filters.value.status || undefined,
      keyword: filters.value.keyword || undefined
    });
    requestList.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loadingRequest.value = false;
  }
};

const loadInvoices = async () => {
  loadingInvoice.value = true;
  try {
    const result = await listInvoices({
      page: page.value,
      pageSize: pageSize.value,
      contract_id: filters.value.contract_id,
      status: filters.value.status || undefined,
      keyword: filters.value.keyword || undefined
    });
    invoiceList.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loadingInvoice.value = false;
  }
};

const loadData = async () => {
  if (activeTab.value === "request") {
    await loadInvoiceRequests();
    return;
  }
  await loadInvoices();
};

const openCreateRequest = () => {
  counterpartyMode.value = "select";
  saveCounterparty.value = true;
  remittanceAttachments.value = [];
  requestForm.value = {
    contract_id: filters.value.contract_id,
    project_id: undefined,
    seller_entity_id: undefined,
    counterparty_payee_id: undefined,
    counterparty_name: "",
    counterparty_tax_no: "",
    counterparty_contact: "",
    invoice_type: "electronic",
    invoice_category: "",
    tax_rate_percent: 6,
    remark: ""
  };
  invoiceItems.value = [
    {
      name: "服务费",
      specification: "",
      unit: "项",
      quantity: 1,
      unit_price: 0
    }
  ];
  requestDialogVisible.value = true;
};

const addInvoiceItem = () => {
  invoiceItems.value.push({
    name: "",
    specification: "",
    unit: "",
    quantity: 1,
    unit_price: 0
  });
};

const cloneItem = (item: InvoiceItemDraft): InvoiceItemDraft => ({
  name: item.name,
  specification: item.specification,
  unit: item.unit,
  quantity: item.quantity,
  unit_price: item.unit_price
});

const duplicateLastItem = () => {
  const lastItem = invoiceItems.value[invoiceItems.value.length - 1];
  if (!lastItem) {
    addInvoiceItem();
    return;
  }
  invoiceItems.value.push(cloneItem(lastItem));
};

const duplicatePreviousItem = (index: number) => {
  if (index <= 0 || !invoiceItems.value[index - 1]) {
    message("上一行不存在，无法复制", { type: "warning" });
    return;
  }
  invoiceItems.value.splice(index, 0, cloneItem(invoiceItems.value[index - 1]));
};

const importTemplate = (templateKey: string) => {
  const template = itemTemplates.find(item => item.key === templateKey);
  if (!template) return;
  invoiceItems.value = template.items.map(item => cloneItem(item));
  message(`已导入${template.label}，可继续调整数量和含税单价`, {
    type: "success"
  });
};

const setTaxRateQuick = (rate: number) => {
  requestForm.value.tax_rate_percent = rate;
};

const removeInvoiceItem = (index: number) => {
  invoiceItems.value.splice(index, 1);
  if (invoiceItems.value.length === 0) {
    addInvoiceItem();
  }
};

const serializeAttachments = (items: AttachmentDraft[]): string => {
  return JSON.stringify(
    items.map(item => ({
      file_key: item.file_key,
      file_name: item.file_name,
      file_size: item.file_size ?? undefined
    }))
  );
};

const uploadAttachment = async (options: UploadRequestOptions) => {
  uploadingAttachment.value = true;
  const rawFile = options.file;
  try {
    const signRes = await createUploadSignature({
      fileName: rawFile.name,
      contentType: rawFile.type,
      category: "payment"
    });

    const uploadResp = await fetch(resolveUploadUrl(signRes.data.uploadUrl), {
      method: "PUT",
      headers: {
        "content-type": rawFile.type || "application/octet-stream",
        Authorization: formatToken(getToken().accessToken)
      },
      body: rawFile
    });

    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }

    // 不可变追加，确保多次/批量上传时不会覆盖已上传的附件
    remittanceAttachments.value = [
      ...remittanceAttachments.value,
      {
        file_key: signRes.data.key,
        file_name: rawFile.name,
        file_size: rawFile.size
      }
    ];
    message("附件上传成功", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("附件上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploadingAttachment.value = false;
  }
};

const removeAttachment = (index: number) => {
  remittanceAttachments.value.splice(index, 1);
};

const saveCounterpartyIfNeeded = async () => {
  if (!saveCounterparty.value) return;
  if (!requestForm.value.counterparty_name.trim()) return;

  if (counterpartyMode.value === "manual") {
    const existing = payees.value.find(
      item => item.name === requestForm.value.counterparty_name.trim()
    );
    if (existing) {
      requestForm.value.counterparty_payee_id = existing.id;
      if (!existing.phone && requestForm.value.counterparty_contact.trim()) {
        await updatePayee(existing.id, {
          phone: requestForm.value.counterparty_contact.trim()
        });
      }
      return;
    }

    const created = await createPayee({
      name: requestForm.value.counterparty_name.trim(),
      bank_name: "待补充",
      bank_account: "待补充",
      phone: requestForm.value.counterparty_contact.trim() || undefined,
      type: "external"
    });
    requestForm.value.counterparty_payee_id = created.data.id;
    const payeeRes = await listPayees({ type: "external" });
    payees.value = payeeRes.data;
    return;
  }

  const payeeId = requestForm.value.counterparty_payee_id;
  if (!payeeId) return;
  const selected = payees.value.find(item => item.id === payeeId);
  if (!selected) return;
  if (!selected.phone && requestForm.value.counterparty_contact.trim()) {
    await updatePayee(payeeId, {
      phone: requestForm.value.counterparty_contact.trim()
    });
  }
};

const submitCreateRequest = async () => {
  if (!requestForm.value.contract_id) {
    message("请先选择收款合同", { type: "warning" });
    return;
  }
  if (
    !requestForm.value.counterparty_name.trim() ||
    !requestForm.value.counterparty_tax_no.trim()
  ) {
    message("请填写对方名称和对方税号", { type: "warning" });
    return;
  }
  if (!requestForm.value.invoice_category.trim()) {
    message("请填写发票类目", { type: "warning" });
    return;
  }
  if (
    !invoiceItems.value.length ||
    invoiceItems.value.some(item => !item.name.trim())
  ) {
    message("请完善开票明细（至少一行且名称必填）", { type: "warning" });
    return;
  }

  requesting.value = true;
  try {
    await saveCounterpartyIfNeeded();

    const selectedEntityName = requestForm.value.seller_entity_id
      ? entityMap.value[requestForm.value.seller_entity_id] || ""
      : "";

    const result = await createInvoiceRequest({
      contract_id: requestForm.value.contract_id,
      project_id: requestForm.value.project_id,
      counterparty_name: requestForm.value.counterparty_name.trim(),
      counterparty_tax_no: requestForm.value.counterparty_tax_no.trim(),
      counterparty_contact:
        requestForm.value.counterparty_contact.trim() || undefined,
      seller_entity_id: requestForm.value.seller_entity_id,
      seller_entity_name: selectedEntityName || undefined,
      buyer_json: JSON.stringify({
        counterparty_payee_id: requestForm.value.counterparty_payee_id ?? null,
        counterparty_contact:
          requestForm.value.counterparty_contact.trim() || null,
        seller_entity_id: requestForm.value.seller_entity_id ?? null,
        seller_entity_name: selectedEntityName || null
      }),
      invoice_type: requestForm.value.invoice_type,
      invoice_category: requestForm.value.invoice_category.trim(),
      tax_rate: requestForm.value.tax_rate_percent,
      amount_without_tax: Number(amountWithoutTax.value.toFixed(2)),
      tax_amount_estimated: Number(taxAmountEstimated.value.toFixed(2)),
      amount_with_tax: Number(amountWithTax.value.toFixed(2)),
      items_json: JSON.stringify(
        invoiceItems.value.map(item => ({
          ...item,
          unit_price_with_tax: Number(item.unit_price.toFixed(2)),
          amount: Number(toLineAmountWithTax(item).toFixed(2)),
          amount_with_tax: Number(toLineAmountWithTax(item).toFixed(2))
        }))
      ),
      attachments_json: remittanceAttachments.value.length
        ? serializeAttachments(remittanceAttachments.value)
        : undefined,
      payment_reference: remittanceAttachments.value.length
        ? "汇款凭证已上传"
        : undefined,
      remark: requestForm.value.remark || undefined
    });

    message(`开票申请创建成功：${result.data.request_no}`, { type: "success" });
    requestDialogVisible.value = false;
    await Promise.all([loadData(), loadMeta()]);
  } finally {
    requesting.value = false;
  }
};

const submitApproval = async (row: InvoiceRequest) => {
  const result = await submitInvoiceRequestApproval(row.id);
  message(`已提交审批（实例号：${result.data.instance_no}）`, {
    type: "success"
  });
  await loadData();
};

const viewApprovalProgress = (row: InvoiceRequest) => {
  if (!row.approval_instance_id) {
    message("当前申请暂无审批实例", { type: "warning" });
    return;
  }
  router.push(`/approval/detail/${row.approval_instance_id}`);
};

const openIssue = (row: InvoiceRequest) => {
  selectedRequest.value = row;
  issueForm.value = {
    file_key: "",
    file_name: "",
    remark: row.remark || ""
  };
  issueDialogVisible.value = true;
};

const uploadIssueAttachment = async (options: UploadRequestOptions) => {
  issueUploading.value = true;
  const rawFile = options.file;
  try {
    const signRes = await createUploadSignature({
      fileName: rawFile.name,
      contentType: rawFile.type,
      category: "receipt"
    });

    const uploadResp = await fetch(resolveUploadUrl(signRes.data.uploadUrl), {
      method: "PUT",
      headers: {
        "content-type": rawFile.type || "application/octet-stream",
        Authorization: formatToken(getToken().accessToken)
      },
      body: rawFile
    });

    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }

    issueForm.value.file_key = signRes.data.key;
    issueForm.value.file_name = rawFile.name;
    message("发票附件上传成功", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("发票附件上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    issueUploading.value = false;
  }
};

const submitIssue = async () => {
  if (!selectedRequest.value) return;
  if (!issueForm.value.file_key) {
    message("请先上传发票附件", { type: "warning" });
    return;
  }
  issuing.value = true;
  try {
    const result = await issueInvoiceFromRequest(selectedRequest.value.id, {
      file_key: issueForm.value.file_key,
      remark: issueForm.value.remark || undefined
    });
    message(`签发成功：${result.data.invoice_no}，已自动触发二维码/OCR解析`, {
      type: "success"
    });
    issueDialogVisible.value = false;
    activeTab.value = "invoice";
    await loadData();
  } finally {
    issuing.value = false;
  }
};

const onDelete = async (row: Invoice) => {
  await deleteInvoice(row.id);
  message("删除成功", { type: "success" });
  await loadData();
};

const runVerify = async (row: Invoice) => {
  await triggerInvoiceVerify(row.id, { file_key: row.file_key || undefined });
  message("已触发OCR/二维码校验，请稍后刷新", { type: "success" });
  await loadData();
};

const invoiceStatusLabelMap: Record<string, string> = {
  issued: "已签发",
  voided: "已作废",
  red_issued: "已红冲",
  cancelled: "已取消"
};
const verificationStatusLabelMap: Record<string, string> = {
  none: "未校验",
  pending: "校验中",
  verified: "已核验",
  failed: "校验失败",
  mismatch: "信息不一致"
};
const paymentStatusLabelMap: Record<string, string> = {
  unpaid: "未收款",
  partial: "部分收款",
  paid: "已收款"
};
const sendStatusLabelMap: Record<string, string> = {
  unsent: "未发送",
  sent: "已发送"
};
const labelOf = (map: Record<string, string>, value: string | null) =>
  value ? (map[value] ?? value) : "-";

const detailDrawerVisible = ref(false);
const detailInvoice = ref<Invoice | null>(null);

const detailAttachments = computed<InvoiceAttachment[]>(() =>
  detailInvoice.value ? buildInvoiceAttachments(detailInvoice.value) : []
);

const openInvoiceDetail = (row: Invoice) => {
  detailInvoice.value = row;
  detailDrawerVisible.value = true;
};

const attachmentUrl = (key: string) =>
  resolveUploadUrl(`/api/v1/upload/object/${encodeURIComponent(key)}`);

const downloadAttachment = (attachment: InvoiceAttachment) => {
  window.open(attachmentUrl(attachment.key), "_blank", "noopener,noreferrer");
};

const detailUploading = ref(false);

const uploadDetailAttachment = async (options: UploadRequestOptions) => {
  const invoice = detailInvoice.value;
  if (!invoice) return;
  const rawFile = options.file;
  detailUploading.value = true;
  try {
    const signRes = await createUploadSignature({
      fileName: rawFile.name,
      contentType: rawFile.type,
      category: "receipt"
    });

    const uploadResp = await fetch(resolveUploadUrl(signRes.data.uploadUrl), {
      method: "PUT",
      headers: {
        "content-type": rawFile.type || "application/octet-stream",
        Authorization: formatToken(getToken().accessToken)
      },
      body: rawFile
    });
    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }

    const result = await appendInvoiceAttachments(invoice.id, {
      attachments_json: JSON.stringify([
        {
          file_key: signRes.data.key,
          file_name: rawFile.name,
          file_size: rawFile.size
        }
      ]),
      append: true
    });

    // 同步抽屉与列表，立即反映新增附件
    detailInvoice.value = {
      ...invoice,
      attachments_json: result.data.attachments_json
    };
    const index = invoiceList.value.findIndex(item => item.id === invoice.id);
    if (index >= 0) {
      invoiceList.value = invoiceList.value.map(item =>
        item.id === invoice.id
          ? { ...item, attachments_json: result.data.attachments_json }
          : item
      );
    }
    message("附件上传成功", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("附件上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    detailUploading.value = false;
  }
};

type ParsedInvoiceItem = {
  name: string;
  specification: string;
  unit: string;
  quantity: number;
  amount_with_tax: number;
};

const requestDetailDrawerVisible = ref(false);
const detailRequest = ref<InvoiceRequest | null>(null);

const requestDetailAttachments = computed<InvoiceAttachment[]>(() =>
  detailRequest.value
    ? parseAttachmentEntries(detailRequest.value.attachments_json)
    : []
);

const requestDetailItems = computed<ParsedInvoiceItem[]>(() => {
  const raw = detailRequest.value?.items_json;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => {
      const row = (item ?? {}) as Record<string, unknown>;
      return {
        name: typeof row.name === "string" ? row.name : "",
        specification:
          typeof row.specification === "string" ? row.specification : "",
        unit: typeof row.unit === "string" ? row.unit : "",
        quantity: typeof row.quantity === "number" ? row.quantity : 0,
        amount_with_tax:
          typeof row.amount_with_tax === "number"
            ? row.amount_with_tax
            : typeof row.amount === "number"
              ? row.amount
              : 0
      };
    });
  } catch {
    return [];
  }
});

const openRequestDetail = (row: InvoiceRequest) => {
  detailRequest.value = row;
  requestDetailDrawerVisible.value = true;
};

onMounted(async () => {
  const queryKeyword = route.query.keyword;
  if (typeof queryKeyword === "string" && queryKeyword.trim()) {
    filters.value.keyword = queryKeyword.trim();
    activeTab.value = "request";
    page.value = 1;
  }
  await Promise.all([loadContracts(), loadMeta()]);
  await loadData();
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>发票签发管理（收款）</span>
        <el-button
          v-if="activeTab === 'request'"
          type="primary"
          @click="openCreateRequest"
          >新建开票申请</el-button
        >
      </div>
    </template>

    <el-tabs v-model="activeTab" @tab-change="loadData">
      <el-tab-pane label="开票申请" name="request" />
      <el-tab-pane label="正式发票" name="invoice" />
    </el-tabs>

    <el-form inline>
      <el-form-item label="合同">
        <el-select
          v-model="filters.contract_id"
          clearable
          filterable
          style="width: 260px"
        >
          <el-option
            v-for="item in contracts"
            :key="item.id"
            :label="`${item.contract_no} | ${item.counterparty}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 170px">
          <el-option
            v-if="activeTab === 'request'"
            label="草稿"
            value="draft"
          />
          <el-option
            v-if="activeTab === 'request'"
            label="审批中"
            value="pending_approval"
          />
          <el-option
            v-if="activeTab === 'request'"
            label="已通过"
            value="approved"
          />
          <el-option
            v-if="activeTab === 'request'"
            label="已驳回"
            value="rejected"
          />
          <el-option
            v-if="activeTab === 'request'"
            label="已签发"
            value="issued"
          />

          <el-option
            v-if="activeTab === 'invoice'"
            label="已签发"
            value="issued"
          />
          <el-option
            v-if="activeTab === 'invoice'"
            label="已作废"
            value="cancelled"
          />
          <el-option
            v-if="activeTab === 'invoice'"
            label="红冲"
            value="red_issued"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          clearable
          :placeholder="
            activeTab === 'request'
              ? '申请单号/对方名称/税号'
              : '发票号/抬头/税号'
          "
        />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table
      v-if="activeTab === 'request'"
      :data="requestList"
      :loading="loadingRequest"
      style="margin-top: 12px"
    >
      <el-table-column prop="request_no" label="申请单号" width="170" />
      <el-table-column label="合同号" width="170">
        <template #default="scope">{{
          contractMap[scope.row.contract_id] || scope.row.contract_id
        }}</template>
      </el-table-column>
      <el-table-column prop="customer_name" label="对方名称" min-width="180" />
      <el-table-column
        prop="customer_tax_no"
        label="对方税号"
        min-width="180"
      />
      <el-table-column prop="amount_with_tax" label="价税合计" width="120" />
      <el-table-column label="类型" width="120">
        <template #default="scope">{{
          toInvoiceTypeLabel(scope.row.invoice_type)
        }}</template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="scope">{{
          toInvoiceRequestStatusLabel(scope.row.status)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="360" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openRequestDetail(scope.row)">
            查看详情
          </el-button>
          <el-button
            v-if="
              scope.row.status === 'draft' || scope.row.status === 'rejected'
            "
            link
            type="primary"
            @click="submitApproval(scope.row)"
          >
            提交审批
          </el-button>
          <el-button
            v-if="
              scope.row.status === 'approved' ||
              scope.row.status === 'ready_to_issue'
            "
            link
            type="success"
            @click="openIssue(scope.row)"
          >
            签发发票
          </el-button>
          <el-button
            v-if="scope.row.approval_instance_id"
            link
            type="info"
            @click="viewApprovalProgress(scope.row)"
          >
            查看进度
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-table
      v-else
      :data="invoiceList"
      :loading="loadingInvoice"
      style="margin-top: 12px"
    >
      <el-table-column prop="invoice_no" label="系统单号" width="170" />
      <el-table-column prop="invoice_number" label="税务发票号" width="170" />
      <el-table-column label="合同号" width="170">
        <template #default="scope">{{
          contractMap[scope.row.contract_id] || scope.row.contract_id
        }}</template>
      </el-table-column>
      <el-table-column prop="title" label="发票抬头" min-width="180" />
      <el-table-column prop="issue_date" label="开票日期" width="130" />
      <el-table-column prop="amount_with_tax" label="价税合计" width="120" />
      <el-table-column
        prop="verification_status"
        label="校验状态"
        width="110"
      />
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openInvoiceDetail(scope.row)">
            查看详情
          </el-button>
          <el-button
            v-if="scope.row.status === 'issued'"
            link
            type="primary"
            @click="runVerify(scope.row)"
          >
            OCR/二维码校验
          </el-button>
          <el-button link type="danger" @click="onDelete(scope.row)"
            >删除</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      background
      layout="prev, pager, next, total"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="
        (val: number) => {
          page = val;
          loadData();
        }
      "
    />
  </el-card>

  <el-dialog v-model="requestDialogVisible" title="新建开票申请" width="80%">
    <el-form label-width="130px">
      <el-form-item label="收款合同" required>
        <el-select
          v-model="requestForm.contract_id"
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in contracts"
            :key="item.id"
            :label="`${item.contract_no} | ${item.counterparty}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="项目（统计）">
        <el-select
          v-model="requestForm.project_id"
          clearable
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="`${item.project_name} (${item.project_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="我方开票主体">
        <el-select
          v-model="requestForm.seller_entity_id"
          clearable
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in entities"
            :key="item.id"
            :label="item.entity_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="对方信息模式">
        <el-radio-group v-model="counterpartyMode">
          <el-radio label="select">从对方名录选择</el-radio>
          <el-radio label="manual">手工录入</el-radio>
        </el-radio-group>
      </el-form-item>

      <el-form-item
        v-if="counterpartyMode === 'select'"
        label="对方名称（选择）"
      >
        <el-select
          v-model="requestForm.counterparty_payee_id"
          clearable
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in payees"
            :key="item.id"
            :label="item.name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="对方名称" required>
        <el-input
          v-model="requestForm.counterparty_name"
          placeholder="公司全称"
        />
      </el-form-item>

      <el-form-item label="对方税号" required>
        <el-input v-model="requestForm.counterparty_tax_no" />
      </el-form-item>

      <el-form-item label="对方联系方式">
        <el-input
          v-model="requestForm.counterparty_contact"
          placeholder="手机号/联系人"
        />
      </el-form-item>

      <el-form-item label="保存对方信息">
        <el-switch v-model="saveCounterparty" />
      </el-form-item>

      <el-form-item label="发票类型">
        <el-select v-model="requestForm.invoice_type" style="width: 220px">
          <el-option label="电子发票" value="electronic" />
          <el-option label="增值税专票" value="special" />
          <el-option label="增值税普票" value="normal" />
        </el-select>
      </el-form-item>

      <el-form-item label="发票类目">
        <el-input
          v-model="requestForm.invoice_category"
          placeholder="支持自定义，如：技术服务费"
        />
      </el-form-item>

      <el-form-item label="税率（%）">
        <el-input-number
          v-model="requestForm.tax_rate_percent"
          :min="0"
          :max="100"
          :precision="2"
          :step="1"
          :controls="false"
          style="width: 220px"
        />
        <div style="width: 100%; margin-top: 8px">
          <el-space wrap>
            <el-button
              v-for="rate in taxRateQuickValues"
              :key="rate"
              size="small"
              @click="setTaxRateQuick(rate)"
            >
              {{ rate }}%
            </el-button>
          </el-space>
        </div>
      </el-form-item>

      <el-divider>开票明细</el-divider>
      <el-table :data="invoiceItems" border>
        <el-table-column label="名称" min-width="160">
          <template #default="scope">
            <el-input v-model="scope.row.name" />
          </template>
        </el-table-column>
        <el-table-column label="规格" min-width="120">
          <template #default="scope">
            <el-input v-model="scope.row.specification" />
          </template>
        </el-table-column>
        <el-table-column label="单位" width="90">
          <template #default="scope">
            <el-input v-model="scope.row.unit" />
          </template>
        </el-table-column>
        <el-table-column label="数量" width="120">
          <template #default="scope">
            <el-input-number
              v-model="scope.row.quantity"
              :min="0"
              :precision="4"
              :step="1"
              :controls="false"
            />
          </template>
        </el-table-column>
        <el-table-column label="含税单价" width="150">
          <template #default="scope">
            <el-input-number
              v-model="scope.row.unit_price"
              :min="0"
              :precision="2"
              :step="100"
              :controls="false"
            />
          </template>
        </el-table-column>
        <el-table-column label="含税金额" width="200">
          <template #default="scope">
            {{ toLineAmountWithTax(scope.row).toFixed(2) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              @click="duplicatePreviousItem(scope.$index)"
              >复制上行</el-button
            >
            <el-button
              link
              type="danger"
              @click="removeInvoiceItem(scope.$index)"
              >删除</el-button
            >
          </template>
        </el-table-column>
      </el-table>
      <div style="margin-top: 10px">
        <el-button link type="primary" @click="addInvoiceItem"
          >+ 新增明细行</el-button
        >
        <el-button link type="primary" @click="duplicateLastItem"
          >复制上一行</el-button
        >
        <el-dropdown @command="importTemplate">
          <el-button link type="primary">从模板导入</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item
                v-for="template in itemTemplates"
                :key="template.key"
                :command="template.key"
              >
                {{ template.label }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <el-form-item label="含税金额合计">
        <el-input :model-value="amountWithTax.toFixed(2)" readonly />
        <div
          style="width: 100%; margin-top: 6px; font-weight: 700; color: #5c3b00"
        >
          大写：{{ amountWithTaxCn }}
        </div>
      </el-form-item>
      <el-form-item label="不含税金额">
        <el-input :model-value="amountWithoutTax.toFixed(2)" readonly />
        <div
          style="width: 100%; margin-top: 6px; font-weight: 700; color: #5c3b00"
        >
          大写：{{ amountWithoutTaxCn }}
        </div>
      </el-form-item>
      <el-form-item label="预计税额">
        <el-input :model-value="taxAmountEstimated.toFixed(2)" readonly />
        <div
          style="width: 100%; margin-top: 6px; font-weight: 700; color: #5c3b00"
        >
          大写：{{ taxAmountEstimatedCn }}
        </div>
      </el-form-item>

      <el-form-item label="汇款凭证附件">
        <div style="width: 100%">
          <el-upload
            drag
            multiple
            action="#"
            :show-file-list="false"
            :disabled="uploadingAttachment"
            :http-request="uploadAttachment"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
          >
            <div class="el-upload__text">
              拖拽文件到这里，或 <em>点击上传</em>（可多选）
            </div>
          </el-upload>
          <el-table
            :data="remittanceAttachments"
            size="small"
            style="margin-top: 12px"
          >
            <el-table-column label="文件名" min-width="260">
              <template #default="scope">{{ scope.row.file_name }}</template>
            </el-table-column>
            <el-table-column label="大小" width="120">
              <template #default="scope">{{
                scope.row.file_size ?? "-"
              }}</template>
            </el-table-column>
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="scope">
                <el-button
                  link
                  type="danger"
                  @click="removeAttachment(scope.$index)"
                  >移除</el-button
                >
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-form-item>

      <el-form-item label="备注">
        <el-input v-model="requestForm.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="requestDialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="requesting"
        @click="submitCreateRequest"
        >创建申请</el-button
      >
    </template>
  </el-dialog>

  <el-dialog v-model="issueDialogVisible" title="签发正式发票" width="620px">
    <el-form label-width="120px">
      <el-alert
        type="info"
        :closable="false"
        title="签发时仅需上传发票附件。发票代码、号码、日期、金额等信息将通过二维码/OCR自动识别回填。"
        style="margin-bottom: 12px"
      />
      <el-form-item label="发票附件" required>
        <div style="width: 100%">
          <el-upload
            drag
            action="#"
            :show-file-list="false"
            :disabled="issueUploading"
            :http-request="uploadIssueAttachment"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
          >
            <div class="el-upload__text">
              拖拽发票到这里，或 <em>点击上传</em>
            </div>
          </el-upload>
          <div style="margin-top: 8px; color: #666">
            {{
              issueForm.file_name
                ? `已上传：${issueForm.file_name}`
                : "未上传附件"
            }}
          </div>
        </div>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="issueForm.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="issueDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="issuing" @click="submitIssue"
        >确认签发</el-button
      >
    </template>
  </el-dialog>

  <el-drawer
    v-model="detailDrawerVisible"
    title="正式发票详情"
    direction="rtl"
    size="520px"
  >
    <template v-if="detailInvoice">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="系统单号">{{
          detailInvoice.invoice_no
        }}</el-descriptions-item>
        <el-descriptions-item label="税务发票号">{{
          detailInvoice.invoice_number || "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="发票代码">{{
          detailInvoice.invoice_code || "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="校验码">{{
          detailInvoice.check_code || "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="合同号">{{
          contractMap[detailInvoice.contract_id] || detailInvoice.contract_id
        }}</el-descriptions-item>
        <el-descriptions-item label="发票抬头">{{
          detailInvoice.title
        }}</el-descriptions-item>
        <el-descriptions-item label="对方税号">{{
          detailInvoice.tax_no || "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="开票日期">{{
          detailInvoice.issue_date
        }}</el-descriptions-item>
        <el-descriptions-item label="金额（税前）">{{
          detailInvoice.amount
        }}</el-descriptions-item>
        <el-descriptions-item label="税额">{{
          detailInvoice.tax_amount ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="价税合计">{{
          detailInvoice.amount_with_tax ?? detailInvoice.amount
        }}</el-descriptions-item>
        <el-descriptions-item label="发票状态">{{
          labelOf(invoiceStatusLabelMap, detailInvoice.status)
        }}</el-descriptions-item>
        <el-descriptions-item label="收款状态">{{
          labelOf(paymentStatusLabelMap, detailInvoice.payment_status)
        }}</el-descriptions-item>
        <el-descriptions-item label="发送状态">{{
          labelOf(sendStatusLabelMap, detailInvoice.send_status)
        }}</el-descriptions-item>
        <el-descriptions-item label="校验状态">{{
          labelOf(verificationStatusLabelMap, detailInvoice.verification_status)
        }}</el-descriptions-item>
        <el-descriptions-item label="备注">{{
          detailInvoice.remark || "-"
        }}</el-descriptions-item>
      </el-descriptions>

      <div class="detail-attachments">
        <div class="detail-attachments__title">发票附件</div>
        <template v-if="detailAttachments.length">
          <div
            v-for="attachment in detailAttachments"
            :key="attachment.key"
            class="detail-attachments__item"
          >
            <span>{{ attachment.label }}</span>
            <el-button
              link
              type="primary"
              @click="downloadAttachment(attachment)"
              >下载</el-button
            >
          </div>
        </template>
        <el-empty v-else description="暂无可下载的发票附件" :image-size="80" />

        <el-upload
          class="detail-attachments__upload"
          action="#"
          :show-file-list="false"
          :disabled="detailUploading"
          :http-request="uploadDetailAttachment"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.ofd,.xml,.doc,.docx,.xls,.xlsx"
        >
          <el-button type="primary" plain :loading="detailUploading">
            继续上传附件
          </el-button>
          <template #tip>
            <div class="detail-attachments__tip">
              支持补充上传 PDF、图片、OFD、XML 等发票相关文件
            </div>
          </template>
        </el-upload>
      </div>
    </template>
  </el-drawer>

  <el-drawer
    v-model="requestDetailDrawerVisible"
    title="开票申请详情"
    direction="rtl"
    size="560px"
  >
    <template v-if="detailRequest">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="申请单号">{{
          detailRequest.request_no
        }}</el-descriptions-item>
        <el-descriptions-item label="合同号">{{
          contractMap[detailRequest.contract_id] || detailRequest.contract_id
        }}</el-descriptions-item>
        <el-descriptions-item label="对方名称">{{
          detailRequest.customer_name
        }}</el-descriptions-item>
        <el-descriptions-item label="对方税号">{{
          detailRequest.customer_tax_no || "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="发票类型">{{
          toInvoiceTypeLabel(detailRequest.invoice_type)
        }}</el-descriptions-item>
        <el-descriptions-item label="开票类目">{{
          detailRequest.invoice_category || "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="税率">{{
          detailRequest.tax_rate
        }}</el-descriptions-item>
        <el-descriptions-item label="不含税金额">{{
          detailRequest.amount_without_tax
        }}</el-descriptions-item>
        <el-descriptions-item label="预计税额">{{
          detailRequest.tax_amount_estimated
        }}</el-descriptions-item>
        <el-descriptions-item label="价税合计">{{
          detailRequest.amount_with_tax
        }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{
          toInvoiceRequestStatusLabel(detailRequest.status)
        }}</el-descriptions-item>
        <el-descriptions-item label="申请人">{{
          detailRequest.applicant_userid
        }}</el-descriptions-item>
        <el-descriptions-item label="备注">{{
          detailRequest.remark || "-"
        }}</el-descriptions-item>
      </el-descriptions>

      <div class="detail-attachments">
        <div class="detail-attachments__title">开票明细</div>
        <el-table
          v-if="requestDetailItems.length"
          :data="requestDetailItems"
          size="small"
          border
        >
          <el-table-column prop="name" label="名称" min-width="140" />
          <el-table-column prop="specification" label="规格" width="100" />
          <el-table-column prop="unit" label="单位" width="70" />
          <el-table-column prop="quantity" label="数量" width="80" />
          <el-table-column
            prop="amount_with_tax"
            label="含税金额"
            width="110"
          />
        </el-table>
        <el-empty v-else description="暂无开票明细" :image-size="60" />
      </div>

      <div class="detail-attachments">
        <div class="detail-attachments__title">汇款凭证 / 附件</div>
        <template v-if="requestDetailAttachments.length">
          <div
            v-for="attachment in requestDetailAttachments"
            :key="attachment.key"
            class="detail-attachments__item"
          >
            <span>{{ attachment.label }}</span>
            <el-button
              link
              type="primary"
              @click="downloadAttachment(attachment)"
              >下载</el-button
            >
          </div>
        </template>
        <el-empty v-else description="暂无附件" :image-size="80" />
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.detail-attachments {
  margin-top: 20px;
}

.detail-attachments__title {
  margin-bottom: 12px;
  font-weight: 600;
  color: #1f2937;
}

.detail-attachments__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  margin-bottom: 8px;
  background: #f8fafc;
  border: 1px solid #ebeef5;
  border-radius: 6px;
}

.detail-attachments__upload {
  margin-top: 12px;
}

.detail-attachments__tip {
  margin-top: 6px;
  font-size: 12px;
  color: #909399;
}
</style>
