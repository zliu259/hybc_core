<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { listContracts, type Contract } from "@/api/contract";
import {
  deleteInvoice,
  listInvoices,
  listInvoiceRequests,
  createInvoiceRequest,
  submitInvoiceRequestApproval,
  issueInvoiceFromRequest,
  triggerInvoiceVerify,
  type Invoice,
  type InvoiceRequest
} from "@/api/receipt";

defineOptions({ name: "InvoiceList" });

const activeTab = ref<"request" | "invoice">("request");
const loadingRequest = ref(false);
const loadingInvoice = ref(false);
const contracts = ref<Contract[]>([]);
const requestList = ref<InvoiceRequest[]>([]);
const invoiceList = ref<Invoice[]>([]);

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

const requestDialogVisible = ref(false);
const requesting = ref(false);
const requestForm = ref({
  contract_id: undefined as number | undefined,
  customer_name: "",
  customer_tax_no: "",
  invoice_type: "electronic" as "special" | "normal" | "electronic",
  invoice_category: "service" as "goods" | "service" | "construction",
  tax_rate: 0.06,
  amount_without_tax: 0,
  tax_amount_estimated: 0,
  amount_with_tax: 0,
  items_json:
    '[{"name":"服务费","specification":"","unit":"项","quantity":1,"unit_price":0,"amount":0}]',
  delivery_reference: "",
  payment_reference: "",
  department: "",
  attachments_json: "",
  remark: ""
});

const issueDialogVisible = ref(false);
const issuing = ref(false);
const selectedRequest = ref<InvoiceRequest | null>(null);
const issueForm = ref({
  issue_date: "",
  invoice_code: "",
  invoice_number: "",
  check_code: "",
  tax_amount: 0,
  amount_with_tax: 0,
  file_key: "",
  pdf_file_key: "",
  ofd_file_key: "",
  xml_file_key: "",
  qr_code: "",
  remark: ""
});

const loadContracts = async () => {
  const result = await listContracts({
    direction: "inbound",
    page: 1,
    pageSize: 300
  });
  contracts.value = result.data;
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
  requestForm.value = {
    contract_id: filters.value.contract_id,
    customer_name: "",
    customer_tax_no: "",
    invoice_type: "electronic",
    invoice_category: "service",
    tax_rate: 0.06,
    amount_without_tax: 0,
    tax_amount_estimated: 0,
    amount_with_tax: 0,
    items_json:
      '[{"name":"服务费","specification":"","unit":"项","quantity":1,"unit_price":0,"amount":0}]',
    delivery_reference: "",
    payment_reference: "",
    department: "",
    attachments_json: "",
    remark: ""
  };
  requestDialogVisible.value = true;
};

const submitCreateRequest = async () => {
  if (!requestForm.value.contract_id || !requestForm.value.customer_name.trim() || !requestForm.value.customer_tax_no.trim()) {
    message("请填写合同、客户名称、客户税号", { type: "warning" });
    return;
  }
  requesting.value = true;
  try {
    const result = await createInvoiceRequest({
      contract_id: requestForm.value.contract_id,
      customer_name: requestForm.value.customer_name,
      customer_tax_no: requestForm.value.customer_tax_no,
      invoice_type: requestForm.value.invoice_type,
      invoice_category: requestForm.value.invoice_category,
      tax_rate: requestForm.value.tax_rate,
      amount_without_tax: requestForm.value.amount_without_tax,
      tax_amount_estimated: requestForm.value.tax_amount_estimated,
      amount_with_tax: requestForm.value.amount_with_tax,
      items_json: requestForm.value.items_json,
      delivery_reference: requestForm.value.delivery_reference || undefined,
      payment_reference: requestForm.value.payment_reference || undefined,
      department: requestForm.value.department || undefined,
      attachments_json: requestForm.value.attachments_json || undefined,
      remark: requestForm.value.remark || undefined
    });
    message(`开票申请创建成功：${result.data.request_no}`, { type: "success" });
    requestDialogVisible.value = false;
    await loadData();
  } finally {
    requesting.value = false;
  }
};

const submitApproval = async (row: InvoiceRequest) => {
  await submitInvoiceRequestApproval(row.id);
  message("已提交审批", { type: "success" });
  await loadData();
};

const openIssue = (row: InvoiceRequest) => {
  selectedRequest.value = row;
  issueForm.value = {
    issue_date: "",
    invoice_code: "",
    invoice_number: "",
    check_code: "",
    tax_amount: row.tax_amount_estimated,
    amount_with_tax: row.amount_with_tax,
    file_key: "",
    pdf_file_key: "",
    ofd_file_key: "",
    xml_file_key: "",
    qr_code: "",
    remark: row.remark || ""
  };
  issueDialogVisible.value = true;
};

const submitIssue = async () => {
  if (!selectedRequest.value) return;
  if (!issueForm.value.issue_date) {
    message("请填写开票日期", { type: "warning" });
    return;
  }
  issuing.value = true;
  try {
    const result = await issueInvoiceFromRequest(selectedRequest.value.id, {
      issue_date: issueForm.value.issue_date,
      invoice_code: issueForm.value.invoice_code || undefined,
      invoice_number: issueForm.value.invoice_number || undefined,
      check_code: issueForm.value.check_code || undefined,
      tax_amount: issueForm.value.tax_amount,
      amount_with_tax: issueForm.value.amount_with_tax,
      file_key: issueForm.value.file_key || undefined,
      pdf_file_key: issueForm.value.pdf_file_key || undefined,
      ofd_file_key: issueForm.value.ofd_file_key || undefined,
      xml_file_key: issueForm.value.xml_file_key || undefined,
      qr_code: issueForm.value.qr_code || undefined,
      remark: issueForm.value.remark || undefined
    });
    message(`签发成功：${result.data.invoice_no}`, { type: "success" });
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

onMounted(async () => {
  await loadContracts();
  await loadData();
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center">
        <span>发票签发管理（收款）</span>
        <el-button v-if="activeTab === 'request'" type="primary" @click="openCreateRequest">新建开票申请</el-button>
      </div>
    </template>

    <el-tabs v-model="activeTab" @tab-change="loadData">
      <el-tab-pane label="开票申请" name="request" />
      <el-tab-pane label="正式发票" name="invoice" />
    </el-tabs>

    <el-form inline>
      <el-form-item label="合同">
        <el-select v-model="filters.contract_id" clearable filterable style="width: 260px">
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
          <el-option v-if="activeTab === 'request'" label="草稿" value="draft" />
          <el-option v-if="activeTab === 'request'" label="审批中" value="pending_approval" />
          <el-option v-if="activeTab === 'request'" label="已通过" value="approved" />
          <el-option v-if="activeTab === 'request'" label="已驳回" value="rejected" />
          <el-option v-if="activeTab === 'request'" label="已签发" value="issued" />

          <el-option v-if="activeTab === 'invoice'" label="已签发" value="issued" />
          <el-option v-if="activeTab === 'invoice'" label="已作废" value="cancelled" />
          <el-option v-if="activeTab === 'invoice'" label="红冲" value="red_issued" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          clearable
          :placeholder="activeTab === 'request' ? '申请单号/客户/税号' : '发票号/抬头/税号'"
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
        <template #default="scope">{{ contractMap[scope.row.contract_id] || scope.row.contract_id }}</template>
      </el-table-column>
      <el-table-column prop="customer_name" label="客户名称" min-width="180" />
      <el-table-column prop="customer_tax_no" label="客户税号" min-width="180" />
      <el-table-column prop="amount_with_tax" label="价税合计" width="120" />
      <el-table-column prop="invoice_type" label="类型" width="110" />
      <el-table-column prop="status" label="状态" width="120" />
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="scope">
          <el-button
            v-if="scope.row.status === 'draft' || scope.row.status === 'rejected'"
            link
            type="primary"
            @click="submitApproval(scope.row)"
          >
            提交审批
          </el-button>
          <el-button
            v-if="scope.row.status === 'approved' || scope.row.status === 'ready_to_issue'"
            link
            type="success"
            @click="openIssue(scope.row)"
          >
            签发发票
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
        <template #default="scope">{{ contractMap[scope.row.contract_id] || scope.row.contract_id }}</template>
      </el-table-column>
      <el-table-column prop="title" label="发票抬头" min-width="180" />
      <el-table-column prop="issue_date" label="开票日期" width="130" />
      <el-table-column prop="amount_with_tax" label="价税合计" width="120" />
      <el-table-column prop="verification_status" label="校验状态" width="110" />
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="scope">
          <el-button
            v-if="scope.row.status === 'issued'"
            link
            type="primary"
            @click="runVerify(scope.row)"
          >
            OCR/二维码校验
          </el-button>
          <el-button link type="danger" @click="onDelete(scope.row)">删除</el-button>
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

  <el-dialog v-model="requestDialogVisible" title="新建开票申请" width="700px">
    <el-form label-width="120px">
      <el-form-item label="收款合同" required>
        <el-select v-model="requestForm.contract_id" filterable style="width: 100%">
          <el-option
            v-for="item in contracts"
            :key="item.id"
            :label="`${item.contract_no} | ${item.counterparty}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="客户名称" required>
        <el-input v-model="requestForm.customer_name" />
      </el-form-item>
      <el-form-item label="客户税号" required>
        <el-input v-model="requestForm.customer_tax_no" />
      </el-form-item>
      <el-form-item label="发票类型">
        <el-select v-model="requestForm.invoice_type" style="width: 220px">
          <el-option label="电子发票" value="electronic" />
          <el-option label="增值税专票" value="special" />
          <el-option label="增值税普票" value="normal" />
        </el-select>
      </el-form-item>
      <el-form-item label="发票类目">
        <el-select v-model="requestForm.invoice_category" style="width: 220px">
          <el-option label="服务" value="service" />
          <el-option label="商品" value="goods" />
          <el-option label="工程" value="construction" />
        </el-select>
      </el-form-item>
      <el-form-item label="税率">
        <el-input-number v-model="requestForm.tax_rate" :min="0" :step="0.01" :precision="2" />
      </el-form-item>
      <el-form-item label="不含税金额">
        <el-input-number v-model="requestForm.amount_without_tax" :min="0" :precision="2" :step="100" />
      </el-form-item>
      <el-form-item label="预计税额">
        <el-input-number v-model="requestForm.tax_amount_estimated" :min="0" :precision="2" :step="100" />
      </el-form-item>
      <el-form-item label="价税合计">
        <el-input-number v-model="requestForm.amount_with_tax" :min="0" :precision="2" :step="100" />
      </el-form-item>
      <el-form-item label="开票明细JSON">
        <el-input v-model="requestForm.items_json" type="textarea" :rows="4" />
      </el-form-item>
      <el-form-item label="发货凭证">
        <el-input v-model="requestForm.delivery_reference" />
      </el-form-item>
      <el-form-item label="回款凭证">
        <el-input v-model="requestForm.payment_reference" />
      </el-form-item>
      <el-form-item label="部门">
        <el-input v-model="requestForm.department" />
      </el-form-item>
      <el-form-item label="附件JSON">
        <el-input v-model="requestForm.attachments_json" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="requestForm.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="requestDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="requesting" @click="submitCreateRequest">创建申请</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="issueDialogVisible" title="签发正式发票" width="620px">
    <el-form label-width="120px">
      <el-form-item label="开票日期" required>
        <el-date-picker v-model="issueForm.issue_date" type="date" value-format="YYYY-MM-DD" style="width: 220px" />
      </el-form-item>
      <el-form-item label="发票代码">
        <el-input v-model="issueForm.invoice_code" />
      </el-form-item>
      <el-form-item label="发票号码">
        <el-input v-model="issueForm.invoice_number" />
      </el-form-item>
      <el-form-item label="校验码">
        <el-input v-model="issueForm.check_code" />
      </el-form-item>
      <el-form-item label="税额">
        <el-input-number v-model="issueForm.tax_amount" :min="0" :precision="2" :step="100" />
      </el-form-item>
      <el-form-item label="价税合计">
        <el-input-number v-model="issueForm.amount_with_tax" :min="0" :precision="2" :step="100" />
      </el-form-item>
      <el-form-item label="原始文件Key">
        <el-input v-model="issueForm.file_key" />
      </el-form-item>
      <el-form-item label="PDF文件Key">
        <el-input v-model="issueForm.pdf_file_key" />
      </el-form-item>
      <el-form-item label="OFD文件Key">
        <el-input v-model="issueForm.ofd_file_key" />
      </el-form-item>
      <el-form-item label="XML文件Key">
        <el-input v-model="issueForm.xml_file_key" />
      </el-form-item>
      <el-form-item label="二维码串">
        <el-input v-model="issueForm.qr_code" type="textarea" :rows="2" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="issueForm.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="issueDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="issuing" @click="submitIssue">确认签发</el-button>
    </template>
  </el-dialog>
</template>
