<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import { formatToken, getToken } from "@/utils/auth";
import { listContracts, type Contract } from "@/api/contract";
import {
  listInvoices,
  listReceipts,
  listReceiptAccounts,
  createReceipt,
  createReceiptRefund,
  submitReceiptRefundApproval,
  deleteReceipt,
  type Invoice,
  type Receipt,
  type ReceiptAccountOption
} from "@/api/receipt";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { invoiceReceivableAmount } from "@/utils/invoice-amount";
import ReceiptDetailDrawer from "./components/ReceiptDetailDrawer.vue";

defineOptions({ name: "ReceiptList" });

const loading = ref(false);
const list = ref<Receipt[]>([]);
const contracts = ref<Contract[]>([]);
const invoices = ref<Invoice[]>([]);
const receiptAccounts = ref<ReceiptAccountOption[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  contract_id: undefined as number | undefined,
  invoice_id: undefined as number | undefined
});

const contractMap = computed(() => {
  const map: Record<number, string> = {};
  contracts.value.forEach(item => {
    map[item.id] = item.contract_no;
  });
  return map;
});

const invoiceMap = computed(() => {
  const map: Record<number, string> = {};
  invoices.value.forEach(item => {
    map[item.id] = item.invoice_no;
  });
  return map;
});

// 新增收款登记时，发票必须归属所选合同；金额统一展示价税合计（税后）
const createInvoiceOptions = computed(() => {
  const contractId = createForm.value.contract_id;
  if (!contractId) {
    return [] as Array<{ id: number; label: string }>;
  }
  return invoices.value
    .filter(item => item.contract_id === contractId)
    .map(item => ({
      id: item.id,
      label: `${item.invoice_no} | ¥${invoiceReceivableAmount(item)}`
    }));
});

const createDialogVisible = ref(false);
const creating = ref(false);
const createForm = ref({
  contract_id: undefined as number | undefined,
  invoice_id: undefined as number | undefined,
  received_date: "",
  amount: 0,
  receiver_account_id: undefined as number | undefined,
  remark: ""
});
const createVoucherList = ref<
  Array<{ file_key: string; file_name: string; file_size?: number }>
>([]);
const uploadingVoucher = ref(false);

const refundDialogVisible = ref(false);
const refunding = ref(false);
const refundTarget = ref<Receipt | null>(null);
const refundForm = ref({
  refund_mode: "full" as "full" | "partial",
  amount: 0,
  reason: "",
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

const loadInvoices = async () => {
  const result = await listInvoices({ page: 1, pageSize: 500 });
  invoices.value = result.data;
};

const loadReceiptAccounts = async () => {
  const result = await listReceiptAccounts();
  receiptAccounts.value = result.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listReceipts({
      page: page.value,
      pageSize: pageSize.value,
      contract_id: filters.value.contract_id,
      invoice_id: filters.value.invoice_id
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  const contractId = filters.value.contract_id;
  // 仅当预填发票确实归属该合同时才保留，否则置空，避免合同/发票不匹配
  const invoiceId =
    filters.value.invoice_id &&
    invoices.value.some(
      item =>
        item.id === filters.value.invoice_id && item.contract_id === contractId
    )
      ? filters.value.invoice_id
      : undefined;
  createForm.value = {
    contract_id: contractId,
    invoice_id: invoiceId,
    received_date: "",
    amount: 0,
    receiver_account_id: undefined,
    remark: ""
  };
  createVoucherList.value = [];
  createDialogVisible.value = true;
};

// 切换合同后，清空已选发票（旧发票可能不属于新合同）
const onCreateContractChange = () => {
  createForm.value = { ...createForm.value, invoice_id: undefined };
};

const uploadVoucher = async (options: UploadRequestOptions) => {
  const rawFile = options.file;
  uploadingVoucher.value = true;
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

    createVoucherList.value.unshift({
      file_key: signRes.data.key,
      file_name: rawFile.name,
      file_size: rawFile.size
    });
    options.onSuccess?.({});
    message("凭证上传成功", { type: "success" });
  } catch {
    options.onError?.(new Error("upload_failed") as never);
    message("凭证上传失败", { type: "error" });
  } finally {
    uploadingVoucher.value = false;
  }
};

const submitCreate = async () => {
  if (
    !createForm.value.contract_id ||
    !createForm.value.received_date ||
    createForm.value.amount <= 0
  ) {
    message("请填写合同、收款日期、金额", { type: "warning" });
    return;
  }
  if (!createForm.value.receiver_account_id) {
    message("请选择收款账户", { type: "warning" });
    return;
  }
  if (!createVoucherList.value.length) {
    message("请上传收款凭证", { type: "warning" });
    return;
  }
  creating.value = true;
  try {
    const result = await createReceipt({
      contract_id: createForm.value.contract_id,
      invoice_id: createForm.value.invoice_id,
      received_date: createForm.value.received_date,
      amount: createForm.value.amount,
      receiver_account_id: createForm.value.receiver_account_id,
      vouchers_json: JSON.stringify(createVoucherList.value),
      remark: createForm.value.remark || undefined
    });
    message(`收款登记成功：${result.data.receipt_no}`, { type: "success" });
    createDialogVisible.value = false;
    await loadData();
  } catch (error) {
    message(resolveApiErrorMessage(error, "收款登记失败，请稍后重试"), {
      type: "error"
    });
  } finally {
    creating.value = false;
  }
};

const openRefund = (row: Receipt) => {
  refundTarget.value = row;
  refundForm.value = {
    refund_mode: "full",
    amount: row.amount,
    reason: "",
    remark: ""
  };
  refundDialogVisible.value = true;
};

const submitRefund = async () => {
  if (!refundTarget.value) return;
  if (
    refundForm.value.refund_mode === "partial" &&
    refundForm.value.amount <= 0
  ) {
    message("部分退款金额必须大于0", { type: "warning" });
    return;
  }
  refunding.value = true;
  try {
    const created = await createReceiptRefund({
      receipt_id: refundTarget.value.id,
      refund_mode: refundForm.value.refund_mode,
      amount:
        refundForm.value.refund_mode === "partial"
          ? refundForm.value.amount
          : undefined,
      reason: refundForm.value.reason || undefined,
      remark: refundForm.value.remark || undefined
    });
    await submitReceiptRefundApproval(created.data.id, {
      biz_summary: `退款申请 ${created.data.refund_no} | 收款单 ${refundTarget.value.receipt_no}`
    });
    message(`退款已发起并提交审批：${created.data.refund_no}`, {
      type: "success"
    });
    refundDialogVisible.value = false;
  } catch (error) {
    message(resolveApiErrorMessage(error, "发起退款失败，请稍后重试"), {
      type: "error"
    });
  } finally {
    refunding.value = false;
  }
};

const onDelete = async (row: Receipt) => {
  try {
    await deleteReceipt(row.id);
    message("删除成功", { type: "success" });
    await loadData();
  } catch (error) {
    message(resolveApiErrorMessage(error, "删除失败，请稍后重试"), {
      type: "error"
    });
  }
};

const detailDrawerVisible = ref(false);
const activeReceiptId = ref<number | null>(null);

const goDetail = (row: Receipt) => {
  activeReceiptId.value = row.id;
  detailDrawerVisible.value = true;
};

onMounted(async () => {
  await loadContracts();
  await loadInvoices();
  await loadReceiptAccounts();
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
        <span>收款登记</span>
        <el-button type="primary" @click="openCreate">新增收款登记</el-button>
      </div>
    </template>

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
      <el-form-item label="发票">
        <el-select
          v-model="filters.invoice_id"
          clearable
          filterable
          style="width: 240px"
        >
          <el-option
            v-for="item in invoices"
            :key="item.id"
            :label="item.invoice_no"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="receipt_no" label="收款单号" width="170" />
      <el-table-column label="合同号" width="170">
        <template #default="scope">{{
          contractMap[scope.row.contract_id] || scope.row.contract_id
        }}</template>
      </el-table-column>
      <el-table-column label="发票号" width="170">
        <template #default="scope">
          {{
            scope.row.invoice_id
              ? invoiceMap[scope.row.invoice_id] || scope.row.invoice_id
              : "-"
          }}
        </template>
      </el-table-column>
      <el-table-column prop="received_date" label="收款日期" width="130" />
      <el-table-column prop="amount" label="金额" width="120" />
      <el-table-column prop="payment_account" label="收款账户" width="180" />
      <el-table-column label="凭证" width="100">
        <template #default="scope">
          {{ scope.row.vouchers_json ? "已上传" : "-" }}
        </template>
      </el-table-column>
      <el-table-column prop="receiver_userid" label="登记人" width="140" />
      <el-table-column label="状态" width="100">
        <template #default="scope">{{
          statusLabel(scope.row.status)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="goDetail(scope.row)"
            >详情</el-button
          >
          <el-button
            v-if="scope.row.status === 'recorded'"
            link
            type="warning"
            @click="openRefund(scope.row)"
            >发起退款</el-button
          >
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

  <el-dialog v-model="createDialogVisible" title="新增收款登记" width="560px">
    <el-form label-width="110px">
      <el-form-item label="合同" required>
        <el-select
          v-model="createForm.contract_id"
          filterable
          style="width: 100%"
          @change="onCreateContractChange"
        >
          <el-option
            v-for="item in contracts"
            :key="item.id"
            :label="`${item.contract_no} | ${item.counterparty}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="关联发票">
        <el-select
          v-model="createForm.invoice_id"
          clearable
          filterable
          style="width: 100%"
          :disabled="!createForm.contract_id"
          :placeholder="
            createForm.contract_id ? '请选择该合同下的发票' : '请先选择合同'
          "
        >
          <el-option
            v-for="item in createInvoiceOptions"
            :key="item.id"
            :label="item.label"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="收款日期" required>
        <el-date-picker
          v-model="createForm.received_date"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 220px"
        />
      </el-form-item>
      <el-form-item label="金额" required>
        <el-input-number
          v-model="createForm.amount"
          :min="0"
          :precision="2"
          :step="100"
        />
      </el-form-item>
      <el-form-item label="收款账户" required>
        <el-select
          v-model="createForm.receiver_account_id"
          filterable
          style="width: 100%"
          placeholder="选择我方实体及账户"
        >
          <el-option
            v-for="item in receiptAccounts"
            :key="item.account_id"
            :label="item.label"
            :value="item.account_id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="收款凭证" required>
        <div style="width: 100%">
          <el-upload
            drag
            action="#"
            :show-file-list="false"
            :disabled="uploadingVoucher"
            :http-request="uploadVoucher"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
          >
            <div class="el-upload__text">
              拖拽文件到这里，或 <em>点击上传</em>
            </div>
          </el-upload>
          <el-table
            :data="createVoucherList"
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
            <el-table-column label="操作" width="100">
              <template #default="scope">
                <el-button
                  link
                  type="danger"
                  @click="createVoucherList.splice(scope.$index, 1)"
                  >移除</el-button
                >
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="createForm.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="createDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="creating" @click="submitCreate"
        >确认登记</el-button
      >
    </template>
  </el-dialog>

  <el-dialog v-model="refundDialogVisible" title="发起退款" width="520px">
    <el-form label-width="120px">
      <el-form-item label="收款单号">
        <el-input :model-value="refundTarget?.receipt_no || ''" disabled />
      </el-form-item>
      <el-form-item label="退款方式" required>
        <el-radio-group v-model="refundForm.refund_mode">
          <el-radio value="full">全部退款</el-radio>
          <el-radio value="partial">部分退款</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item
        v-if="refundForm.refund_mode === 'partial'"
        label="退款金额"
        required
      >
        <el-input-number
          v-model="refundForm.amount"
          :min="0"
          :precision="2"
          :step="100"
        />
      </el-form-item>
      <el-form-item label="退款原因">
        <el-input v-model="refundForm.reason" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="refundForm.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="refundDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="refunding" @click="submitRefund"
        >发起并提交审批</el-button
      >
    </template>
  </el-dialog>

  <ReceiptDetailDrawer
    v-model:visible="detailDrawerVisible"
    :receipt-id="activeReceiptId"
    @closed="loadData"
  />
</template>
