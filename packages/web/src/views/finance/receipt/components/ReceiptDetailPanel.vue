<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import { formatToken, getToken } from "@/utils/auth";
import {
  createReceiptRefund,
  getReceipt,
  submitReceiptRefundApproval,
  updateReceiptRefundBankSlips,
  type AttachmentDraft,
  type ReceiptDetail,
  type ReceiptRefund
} from "@/api/receipt";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import FinanceDetailHeader from "../../shared/components/FinanceDetailHeader.vue";
import FinSection from "../../shared/components/FinSection.vue";
import { formatMoney } from "../../shared/format";

defineOptions({ name: "ReceiptDetailPanel" });

const props = defineProps<{
  receiptId: number;
}>();

const loading = ref(false);
const detail = ref<ReceiptDetail | null>(null);

const refundDialogVisible = ref(false);
const refunding = ref(false);
const refundForm = ref({
  refund_mode: "full" as "full" | "partial",
  amount: 0,
  reason: "",
  remark: ""
});

const slipDialogVisible = ref(false);
const uploadingSlip = ref(false);
const savingSlip = ref(false);
const slipTarget = ref<ReceiptRefund | null>(null);
const bankSlipList = ref<AttachmentDraft[]>([]);

const receiptStatusTagType = computed<"success" | "warning" | "info">(() => {
  const status = detail.value?.receipt.status;
  if (status === "recorded") return "success";
  if (status === "partial_refunded") return "warning";
  return "info";
});

const refundStatusTagType = (
  status: string
): "success" | "warning" | "danger" | "info" => {
  if (
    status === "pending" ||
    status === "pending_approval" ||
    status === "in_progress"
  )
    return "warning";
  if (status === "approved" || status === "completed") return "success";
  if (status === "rejected") return "danger";
  return "info";
};

const formatFileSize = (size: number | null | undefined): string => {
  if (size === null || size === undefined || !Number.isFinite(size)) {
    return "-";
  }
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${size} B`;
};

const invoiceText = computed(() => {
  const invoice = detail.value?.invoice;
  if (!invoice) return "-";
  return `${invoice.invoice_no} / ¥ ${formatMoney(invoice.amount_with_tax ?? invoice.amount)}`;
});

const parseAttachmentDrafts = (
  raw: string | null | undefined
): AttachmentDraft[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const rows: AttachmentDraft[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as {
        file_key?: string;
        key?: string;
        file_name?: string;
        name?: string;
        file_size?: number;
        size?: number;
      };
      const key = row.file_key ?? row.key;
      if (!key || typeof key !== "string") continue;
      rows.push({
        file_key: key,
        file_name: row.file_name ?? row.name ?? key,
        file_size: row.file_size ?? row.size ?? null
      });
    }
    return rows;
  } catch {
    return [];
  }
};

const voucherList = computed(() =>
  parseAttachmentDrafts(detail.value?.receipt.vouchers_json)
);

const fileUrl = (key: string) => {
  return resolveUploadUrl(`/api/v1/upload/object/${encodeURIComponent(key)}`);
};

const loadDetail = async () => {
  loading.value = true;
  try {
    const res = await getReceipt(props.receiptId);
    detail.value = res.data;
  } finally {
    loading.value = false;
  }
};

const openRefund = () => {
  if (!detail.value) return;
  refundForm.value = {
    refund_mode: "full",
    amount: detail.value.receipt.amount,
    reason: "",
    remark: ""
  };
  refundDialogVisible.value = true;
};

const submitRefund = async () => {
  if (!detail.value) return;
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
      receipt_id: detail.value.receipt.id,
      refund_mode: refundForm.value.refund_mode,
      amount:
        refundForm.value.refund_mode === "partial"
          ? refundForm.value.amount
          : undefined,
      reason: refundForm.value.reason || undefined,
      remark: refundForm.value.remark || undefined
    });
    await submitReceiptRefundApproval(created.data.id, {
      biz_summary: `退款申请 ${created.data.refund_no} | 收款单 ${detail.value.receipt.receipt_no}`
    });
    message(`退款已发起并提交审批：${created.data.refund_no}`, {
      type: "success"
    });
    refundDialogVisible.value = false;
    await loadDetail();
  } finally {
    refunding.value = false;
  }
};

const openBankSlips = (row: ReceiptRefund) => {
  slipTarget.value = row;
  bankSlipList.value = parseAttachmentDrafts(row.bank_slips_json);
  slipDialogVisible.value = true;
};

const uploadBankSlip = async (options: UploadRequestOptions) => {
  const rawFile = options.file;
  uploadingSlip.value = true;
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

    bankSlipList.value.unshift({
      file_key: signRes.data.key,
      file_name: rawFile.name,
      file_size: rawFile.size
    });
    options.onSuccess?.({});
    message("汇款单上传成功", { type: "success" });
  } catch {
    options.onError?.(new Error("upload_failed") as never);
    message("汇款单上传失败", { type: "error" });
  } finally {
    uploadingSlip.value = false;
  }
};

const saveBankSlips = async () => {
  if (!slipTarget.value) return;
  if (!bankSlipList.value.length) {
    message("请至少上传一份银行汇款单", { type: "warning" });
    return;
  }
  savingSlip.value = true;
  try {
    await updateReceiptRefundBankSlips(slipTarget.value.id, {
      bank_slips_json: JSON.stringify(bankSlipList.value),
      append: false
    });
    message("银行汇款单已保存", { type: "success" });
    slipDialogVisible.value = false;
    await loadDetail();
  } finally {
    savingSlip.value = false;
  }
};

onMounted(loadDetail);
</script>

<template>
  <div v-loading="loading" style="min-height: 240px">
    <FinanceDetailHeader
      serial-label="收款单号"
      :serial="detail?.receipt.receipt_no ?? null"
      amount-label="收款金额"
      :amount="detail?.receipt.amount ?? null"
    >
      <template #tags>
        <el-tag v-if="detail" :type="receiptStatusTagType" size="small">{{
          statusLabel(detail.receipt.status)
        }}</el-tag>
      </template>
      <template v-if="detail" #meta>
        <span>合同号：{{ detail.contract.contract_no }}</span>
        <span>合同对方：{{ detail.contract.counterparty }}</span>
        <span>收款日期：{{ detail.receipt.received_date }}</span>
        <span>收款账户：{{ detail.receipt.payment_account || "-" }}</span>
        <span>关联发票：{{ detail.invoice?.invoice_no || "-" }}</span>
      </template>
      <template v-if="detail?.receipt.status === 'recorded'" #actions>
        <el-button type="warning" @click="openRefund">发起退款</el-button>
      </template>
    </FinanceDetailHeader>

    <template v-if="detail">
      <FinSection title="收款信息">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="收款账户">{{
            detail.receipt.payment_account || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="关联发票">{{
            invoiceText
          }}</el-descriptions-item>
          <el-descriptions-item label="登记人">{{
            detail.receipt.receiver_userid
          }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{
            detail.receipt.created_at
          }}</el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{
            detail.receipt.remark || "-"
          }}</el-descriptions-item>
        </el-descriptions>
      </FinSection>

      <FinSection title="收款凭证附件">
        <el-table :data="voucherList" size="small" border>
          <el-table-column label="文件名" min-width="300">
            <template #default="scope">{{ scope.row.file_name }}</template>
          </el-table-column>
          <el-table-column label="大小" width="120" align="right">
            <template #default="scope">{{
              formatFileSize(scope.row.file_size)
            }}</template>
          </el-table-column>
          <el-table-column label="操作" width="120">
            <template #default="scope">
              <el-link
                :href="fileUrl(scope.row.file_key)"
                target="_blank"
                type="primary"
                >查看</el-link
              >
            </template>
          </el-table-column>
        </el-table>
      </FinSection>

      <FinSection title="退款记录">
        <el-table :data="detail.refunds" size="small" border>
          <el-table-column prop="refund_no" label="退款单号" min-width="180" />
          <el-table-column label="退款方式" width="110">
            <template #default="scope">{{
              scope.row.refund_mode === "full" ? "全部退款" : "部分退款"
            }}</template>
          </el-table-column>
          <el-table-column label="退款金额" width="130" align="right">
            <template #default="scope">{{
              formatMoney(scope.row.amount)
            }}</template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="scope">
              <el-tag :type="refundStatusTagType(scope.row.status)" size="small"
                >{{ statusLabel(scope.row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="银行汇款单" width="120">
            <template #default="scope">{{
              scope.row.bank_slips_json ? "已上传" : "-"
            }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="openBankSlips(scope.row)"
                >上传汇款单</el-button
              >
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="暂无退款记录" :image-size="60" />
          </template>
        </el-table>
      </FinSection>
    </template>
  </div>

  <el-dialog
    v-model="refundDialogVisible"
    title="发起退款"
    width="520px"
    append-to-body
  >
    <el-form label-width="120px">
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

  <el-dialog
    v-model="slipDialogVisible"
    title="上传银行汇款单"
    width="620px"
    append-to-body
  >
    <el-upload
      drag
      action="#"
      :show-file-list="false"
      :disabled="uploadingSlip"
      :http-request="uploadBankSlip"
      accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
    >
      <div class="el-upload__text">拖拽文件到这里，或 <em>点击上传</em></div>
    </el-upload>

    <el-table :data="bankSlipList" size="small" style="margin-top: 12px" border>
      <el-table-column label="文件名" min-width="300">
        <template #default="scope">{{ scope.row.file_name }}</template>
      </el-table-column>
      <el-table-column label="大小" width="120" align="right">
        <template #default="scope">{{
          formatFileSize(scope.row.file_size)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170">
        <template #default="scope">
          <el-link
            :href="fileUrl(scope.row.file_key)"
            target="_blank"
            type="primary"
            >查看</el-link
          >
          <el-button
            link
            type="danger"
            @click="bankSlipList.splice(scope.$index, 1)"
            >移除</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-button @click="slipDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="savingSlip" @click="saveBankSlips"
        >保存</el-button
      >
    </template>
  </el-dialog>
</template>
