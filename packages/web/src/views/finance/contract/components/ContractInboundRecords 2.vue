<script setup lang="ts">
/** 收款合同专属：开票记录和收款登记。两类记录互不影响，一类取不到另一类照常显示。 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import type { ContractDetail } from "@/api/contract";
import {
  listInvoiceRequests,
  listInvoices,
  listReceipts,
  type Invoice,
  type InvoiceRequest,
  type Receipt
} from "@/api/receipt";
import { statusLabel } from "@/utils/enum-labels";
import FinSection from "../../shared/components/FinSection.vue";
import { formatMoney } from "../../shared/format";
import ReceiptDetailDrawer from "../../receipt/components/ReceiptDetailDrawer.vue";

defineOptions({ name: "ContractInboundRecords" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const props = defineProps<{ detail: ContractDetail }>();

const emit = defineEmits<{
  (e: "refresh"): void;
  /** 跳到了别的页面，宿主抽屉要关闭 */
  (e: "nav"): void;
}>();

// 开票申请/正式发票共用一套状态口径（键覆盖后端两套枚举全集，文案与 invoice.vue 一致）
const INVOICE_STATUS_TAGS: Record<string, TagType> = {
  draft: "info",
  submitted: "warning",
  pending_approval: "warning",
  approved: "primary",
  ready_to_issue: "warning",
  issued: "success",
  rejected: "danger",
  cancelled: "info",
  red_issued: "warning",
  voided: "info"
};
const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  submitted: "已提交",
  pending_approval: "审批中",
  approved: "已通过",
  ready_to_issue: "待签发",
  issued: "已签发",
  rejected: "已驳回",
  cancelled: "已取消",
  red_issued: "已红冲",
  voided: "已作废"
};
const RECEIPT_STATUS_TAGS: Record<string, TagType> = {
  recorded: "success",
  partial_refunded: "warning",
  refunded: "info"
};
/** 已签发/已驳回/已取消的申请属于历史，不再算在途（与项目收款全貌口径一致） */
const SETTLED_REQUEST_STATUSES = ["issued", "rejected", "cancelled"];

const router = useRouter();
const invoiceRequests = ref<InvoiceRequest[]>([]);
const invoices = ref<Invoice[]>([]);
const receipts = ref<Receipt[]>([]);
const activeReceiptId = ref<number | null>(null);
const receiptDrawerVisible = ref(false);

const pendingRequests = computed(() =>
  invoiceRequests.value.filter(
    item => !SETTLED_REQUEST_STATUSES.includes(item.status)
  )
);

const toInvoiceTag = (value: string): TagType =>
  INVOICE_STATUS_TAGS[value] ?? "info";
const toInvoiceLabel = (value: string): string =>
  INVOICE_STATUS_LABELS[value] ?? statusLabel(value);

const load = async () => {
  const params = { contract_id: props.detail.id, pageSize: 100 };
  const [requestRes, invoiceRes, receiptRes] = await Promise.allSettled([
    listInvoiceRequests(params),
    listInvoices(params),
    listReceipts(params)
  ]);
  invoiceRequests.value =
    requestRes.status === "fulfilled" ? requestRes.value.data : [];
  invoices.value =
    invoiceRes.status === "fulfilled" ? invoiceRes.value.data : [];
  receipts.value =
    receiptRes.status === "fulfilled" ? receiptRes.value.data : [];
};

const go = (path: string) => {
  router.push(path);
  emit("nav");
};

const openReceipt = (id: number) => {
  activeReceiptId.value = id;
  receiptDrawerVisible.value = true;
};

const onReceiptDrawerClosed = async () => {
  activeReceiptId.value = null;
  // 收款登记可能在抽屉里变化，已到账金额要跟着刷新
  await load();
  emit("refresh");
};

onMounted(load);
</script>

<template>
  <FinSection title="开票记录">
    <template #extra>
      <span class="inbound-records__stat">
        已开票合计 ¥{{ formatMoney(detail.invoiced_amount) }}
      </span>
      <el-button
        link
        type="primary"
        @click="go('/finance/receipt/workbench?step=invoice')"
      >
        去开票
      </el-button>
    </template>
    <template v-if="pendingRequests.length || invoices.length">
      <div v-if="pendingRequests.length" class="inbound-records__block">
        <div class="inbound-records__title">在途开票申请</div>
        <el-table :data="pendingRequests" size="small">
          <el-table-column label="申请单号" min-width="170">
            <template #default="scope">
              <span class="inbound-records__no">
                {{ scope.row.request_no }}
              </span>
            </template>
          </el-table-column>
          <el-table-column
            prop="invoice_category"
            label="发票类目"
            min-width="140"
          />
          <el-table-column label="含税金额" width="140" align="right">
            <template #default="scope">
              {{ formatMoney(scope.row.amount_with_tax) }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="scope">
              <el-tag :type="toInvoiceTag(scope.row.status)">
                {{ toInvoiceLabel(scope.row.status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
      <div v-if="invoices.length" class="inbound-records__block">
        <div class="inbound-records__title">正式发票</div>
        <el-table :data="invoices" size="small">
          <el-table-column label="发票单号" min-width="170">
            <template #default="scope">
              <span class="inbound-records__no">
                {{ scope.row.invoice_no }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="含税金额" width="140" align="right">
            <template #default="scope">
              {{ formatMoney(scope.row.amount_with_tax ?? scope.row.amount) }}
            </template>
          </el-table-column>
          <el-table-column prop="issue_date" label="开票日期" width="130" />
          <el-table-column label="状态" width="110">
            <template #default="scope">
              <el-tag :type="toInvoiceTag(scope.row.status)">
                {{ toInvoiceLabel(scope.row.status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </template>
    <p v-else class="inbound-records__empty">还没有开票记录</p>
  </FinSection>

  <FinSection title="收款登记">
    <template #extra>
      <span class="inbound-records__stat">
        已到账合计 ¥{{ formatMoney(detail.received_amount) }}
      </span>
      <el-button
        link
        type="primary"
        @click="go('/finance/receipt/workbench?step=receipt')"
      >
        新增收款登记
      </el-button>
    </template>
    <el-table v-if="receipts.length" :data="receipts" size="small">
      <el-table-column label="收款单号" min-width="170">
        <template #default="scope">
          <span class="inbound-records__no">{{ scope.row.receipt_no }}</span>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="140" align="right">
        <template #default="scope">
          {{ formatMoney(scope.row.amount) }}
        </template>
      </el-table-column>
      <el-table-column prop="received_date" label="到账日期" width="130" />
      <el-table-column label="收款账户" min-width="160">
        <template #default="scope">
          {{ scope.row.payment_account || "-" }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="scope">
          <el-tag :type="RECEIPT_STATUS_TAGS[scope.row.status] ?? 'info'">
            {{ statusLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="80" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openReceipt(scope.row.id)">
            查看
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <p v-else class="inbound-records__empty">还没有收款登记</p>

    <ReceiptDetailDrawer
      v-model:visible="receiptDrawerVisible"
      :receipt-id="activeReceiptId"
      @closed="onReceiptDrawerClosed"
    />
  </FinSection>
</template>

<style scoped>
.inbound-records__stat {
  font-size: 12px;
  color: #8c6a2f;
}

.inbound-records__no {
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.inbound-records__block + .inbound-records__block {
  margin-top: 14px;
}

.inbound-records__title {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #8c6a2f;
}

.inbound-records__empty {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
