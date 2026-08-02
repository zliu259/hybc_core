<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import { getProjectById, type Project } from "@/api/project";
import { listContracts, type Contract } from "@/api/contract";
import {
  listInvoiceRequests,
  listInvoices,
  listReceipts,
  type Invoice,
  type InvoiceRequest,
  type Receipt
} from "@/api/receipt";
import ContractDetailDrawer from "../../contract/components/ContractDetailDrawer.vue";
import FinanceDetailHeader from "../../shared/components/FinanceDetailHeader.vue";
import FinSection from "../../shared/components/FinSection.vue";
import { formatMoney } from "../../shared/format";
import ReceiptDetailDrawer from "./ReceiptDetailDrawer.vue";

defineOptions({ name: "ProjectReceiptPanel" });

const props = defineProps<{
  projectId: number;
}>();
const emit = defineEmits<{
  (e: "nav"): void;
}>();

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const loading = ref(false);
const project = ref<Project | null>(null);
const contracts = ref<Contract[]>([]);
const invoices = ref<Invoice[]>([]);
const invoiceRequests = ref<InvoiceRequest[]>([]);
const receipts = ref<Receipt[]>([]);

const projectStatusTagType: Record<string, TagType> = {
  planning: "info",
  preparing: "warning",
  active: "success",
  completing: "primary",
  archived: "info"
};

const projectStatusLabelMap: Record<string, string> = {
  planning: "规划中",
  preparing: "筹备中",
  active: "施工中",
  completing: "收尾中",
  archived: "已归档"
};

const contractStatusTagType: Record<string, TagType> = {
  draft: "info",
  pending_approval: "warning",
  active: "success",
  completed: "primary",
  terminated: "danger"
};

const contractStatusLabelMap: Record<string, string> = {
  draft: "草稿",
  pending_approval: "待审批",
  active: "生效中",
  completed: "已完成",
  terminated: "已终止"
};

const toContractStatusLabel = (status: string) =>
  contractStatusLabelMap[status] ?? statusLabel(status);

const invoiceStatusTagType: Record<string, TagType> = {
  issued: "success",
  voided: "info",
  red_issued: "warning",
  cancelled: "info"
};

const invoiceStatusLabelMap: Record<string, string> = {
  issued: "已签发",
  voided: "已作废",
  red_issued: "已红冲",
  cancelled: "已取消"
};

const toInvoiceStatusLabel = (status: string) =>
  invoiceStatusLabelMap[status] ?? statusLabel(status);

const invoiceRequestStatusTagType: Record<string, TagType> = {
  draft: "info",
  submitted: "warning",
  pending_approval: "warning",
  approved: "success",
  ready_to_issue: "primary",
  cancelled: "info"
};

const invoiceRequestStatusLabelMap: Record<string, string> = {
  draft: "草稿",
  submitted: "已提交",
  pending_approval: "审批中",
  approved: "已通过",
  ready_to_issue: "待签发",
  cancelled: "已取消"
};

const toInvoiceRequestStatusLabel = (status: string) =>
  invoiceRequestStatusLabelMap[status] ?? statusLabel(status);

const receiptStatusTagType = (status: string): TagType => {
  if (status === "recorded") return "success";
  if (status === "partial_refunded") return "warning";
  return "info";
};

const contractTotalAmount = computed(() =>
  contracts.value.reduce((sum, item) => sum + item.total_amount, 0)
);
const invoicedTotalAmount = computed(() =>
  contracts.value.reduce((sum, item) => sum + item.invoiced_amount, 0)
);
const receivedTotalAmount = computed(() =>
  contracts.value.reduce((sum, item) => sum + item.received_amount, 0)
);

const toPercentage = (part: number, total: number) =>
  total > 0 ? Math.min(100, Math.round((part / total) * 100)) : 0;

const invoicedPercentage = computed(() =>
  toPercentage(invoicedTotalAmount.value, contractTotalAmount.value)
);
const receivedPercentage = computed(() =>
  toPercentage(receivedTotalAmount.value, contractTotalAmount.value)
);

const invoiceAmountOf = (row: Invoice) => row.amount_with_tax ?? row.amount;

const invoiceTotalAmount = computed(() =>
  invoices.value.reduce((sum, item) => sum + invoiceAmountOf(item), 0)
);
const receiptTotalAmount = computed(() =>
  receipts.value.reduce((sum, item) => sum + item.amount, 0)
);

// 在途开票申请：尚未签发、未被驳回且未取消的申请
const pendingInvoiceRequests = computed(() =>
  invoiceRequests.value.filter(
    item =>
      item.status !== "issued" &&
      item.status !== "rejected" &&
      item.status !== "cancelled"
  )
);

const contractNoMap = computed<Record<number, string>>(() =>
  Object.fromEntries(contracts.value.map(item => [item.id, item.contract_no]))
);
const contractNoOf = (contractId: number) =>
  contractNoMap.value[contractId] ?? `#${contractId}`;

const activeContractId = ref<number | null>(null);
const contractDrawerVisible = ref(false);
const activeReceiptId = ref<number | null>(null);
const receiptDrawerVisible = ref(false);

const truncatedLists = ref<string[]>([]);

const loadAll = async () => {
  loading.value = true;
  try {
    const [projectRes, contractRes, invoiceRes, requestRes, receiptRes] =
      await Promise.all([
        getProjectById(props.projectId),
        listContracts({
          direction: "inbound",
          project_id: props.projectId,
          page: 1,
          pageSize: 200
        }),
        listInvoices({ project_id: props.projectId, page: 1, pageSize: 500 }),
        listInvoiceRequests({
          project_id: props.projectId,
          page: 1,
          pageSize: 200
        }),
        listReceipts({ project_id: props.projectId, page: 1, pageSize: 500 })
      ]);
    project.value = projectRes.data;
    contracts.value = contractRes.data;
    invoices.value = invoiceRes.data;
    invoiceRequests.value = requestRes.data;
    receipts.value = receiptRes.data;
    truncatedLists.value = [
      contractRes.pagination.total > contractRes.data.length ? "收款合同" : "",
      invoiceRes.pagination.total > invoiceRes.data.length ? "正式发票" : "",
      requestRes.pagination.total > requestRes.data.length ? "开票申请" : "",
      receiptRes.pagination.total > receiptRes.data.length ? "收款登记" : ""
    ].filter(Boolean);
  } catch {
    message("项目收款数据加载失败，请关闭抽屉后重试", { type: "error" });
  } finally {
    loading.value = false;
  }
};

const openContractDrawer = (id: number) => {
  activeContractId.value = id;
  contractDrawerVisible.value = true;
};

const onContractDrawerClosed = async () => {
  activeContractId.value = null;
  await loadAll();
};

const openReceiptDrawer = (id: number) => {
  activeReceiptId.value = id;
  receiptDrawerVisible.value = true;
};

const onReceiptDrawerClosed = async () => {
  activeReceiptId.value = null;
  await loadAll();
};

onMounted(loadAll);
</script>

<template>
  <div v-loading="loading" class="project-receipt-panel">
    <FinanceDetailHeader
      serial-label="项目编号"
      :serial="project?.project_code ?? null"
      amount-label="收款合同总额"
      :amount="project ? contractTotalAmount : null"
    >
      <template #tags>
        <el-tag
          v-if="project"
          :type="projectStatusTagType[project.status] || 'info'"
          size="small"
        >
          {{ projectStatusLabelMap[project.status] || project.status }}
        </el-tag>
      </template>
      <template v-if="project" #meta>
        <span>项目名称：{{ project.project_name }}</span>
        <span>负责人：{{ project.manager_userid || "-" }}</span>
        <span v-if="project.external_party_name">
          外部单位：{{ project.external_party_name }}
        </span>
      </template>
      <template v-if="project" #extra>
        <div class="receipt-progress">
          <div class="receipt-progress__item">
            <div class="receipt-progress__figures">
              <span>
                已开票
                <b class="mono">{{ formatMoney(invoicedTotalAmount) }}</b>
              </span>
            </div>
            <el-progress
              :percentage="invoicedPercentage"
              :stroke-width="8"
              color="#c9a35c"
            />
          </div>
          <div class="receipt-progress__item">
            <div class="receipt-progress__figures">
              <span>
                已到账
                <b class="mono">{{ formatMoney(receivedTotalAmount) }}</b>
              </span>
            </div>
            <el-progress
              :percentage="receivedPercentage"
              :stroke-width="8"
              color="#c9a35c"
            />
          </div>
        </div>
      </template>
    </FinanceDetailHeader>

    <el-alert
      v-if="truncatedLists.length"
      type="warning"
      :closable="false"
      :title="`数据量较大：${truncatedLists.join('、')}仅展示部分记录，头部合计按已加载数据计算，完整数据请到对应列表页查看`"
      style="margin-bottom: 12px"
    />

    <FinSection title="收款合同">
      <template #extra>
        <span class="section-stat">共 {{ contracts.length }} 份</span>
      </template>
      <el-table :data="contracts" size="small" border>
        <el-table-column label="合同号" min-width="170">
          <template #default="scope">
            <span class="mono">{{ scope.row.contract_no }}</span>
          </template>
        </el-table-column>
        <el-table-column
          prop="counterparty"
          label="对方单位"
          min-width="160"
          show-overflow-tooltip
        />
        <el-table-column label="合同金额" width="130" align="right">
          <template #default="scope">
            {{ formatMoney(scope.row.total_amount) }}
          </template>
        </el-table-column>
        <el-table-column label="已开票" width="130" align="right">
          <template #default="scope">
            {{ formatMoney(scope.row.invoiced_amount) }}
          </template>
        </el-table-column>
        <el-table-column label="已到账" width="130" align="right">
          <template #default="scope">
            {{ formatMoney(scope.row.received_amount) }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag
              :type="contractStatusTagType[scope.row.status] || 'info'"
              size="small"
            >
              {{ toContractStatusLabel(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              @click="openContractDrawer(scope.row.id)"
            >
              查看
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无收款合同" :image-size="60" />
        </template>
      </el-table>
    </FinSection>

    <FinSection title="开票记录">
      <template #extra>
        <span class="section-stat">
          正式发票 {{ invoices.length }} 张 / 合计
          {{ formatMoney(invoiceTotalAmount) }}
        </span>
      </template>
      <el-table :data="invoices" size="small" border>
        <el-table-column label="发票号" min-width="180">
          <template #default="scope">
            <span class="mono">{{ scope.row.invoice_no }}</span>
          </template>
        </el-table-column>
        <el-table-column label="所属合同" min-width="160">
          <template #default="scope">
            <span class="mono">{{ contractNoOf(scope.row.contract_id) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="含税金额" width="130" align="right">
          <template #default="scope">
            {{ formatMoney(invoiceAmountOf(scope.row)) }}
          </template>
        </el-table-column>
        <el-table-column prop="issue_date" label="开票日期" width="110" />
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag
              :type="invoiceStatusTagType[scope.row.status] || 'info'"
              size="small"
            >
              {{ toInvoiceStatusLabel(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无开票记录" :image-size="60" />
        </template>
      </el-table>

      <template v-if="pendingInvoiceRequests.length">
        <div class="sub-table-title">在途开票申请</div>
        <el-table :data="pendingInvoiceRequests" size="small" border>
          <el-table-column label="申请单号" min-width="180">
            <template #default="scope">
              <span class="mono">{{ scope.row.request_no }}</span>
            </template>
          </el-table-column>
          <el-table-column label="含税金额" width="130" align="right">
            <template #default="scope">
              {{ formatMoney(scope.row.amount_with_tax) }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110">
            <template #default="scope">
              <el-tag
                :type="invoiceRequestStatusTagType[scope.row.status] || 'info'"
                size="small"
              >
                {{ toInvoiceRequestStatusLabel(scope.row.status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </FinSection>

    <FinSection title="收款登记">
      <template #extra>
        <span class="section-stat">
          共 {{ receipts.length }} 笔 / 合计
          {{ formatMoney(receiptTotalAmount) }}
        </span>
      </template>
      <el-table :data="receipts" size="small" border>
        <el-table-column label="收款单号" min-width="180">
          <template #default="scope">
            <span class="mono">{{ scope.row.receipt_no }}</span>
          </template>
        </el-table-column>
        <el-table-column label="所属合同" min-width="160">
          <template #default="scope">
            <span class="mono">{{ contractNoOf(scope.row.contract_id) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="130" align="right">
          <template #default="scope">
            {{ formatMoney(scope.row.amount) }}
          </template>
        </el-table-column>
        <el-table-column prop="received_date" label="收款日期" width="110" />
        <el-table-column label="状态" width="100">
          <template #default="scope">
            <el-tag :type="receiptStatusTagType(scope.row.status)" size="small">
              {{ statusLabel(scope.row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              @click="openReceiptDrawer(scope.row.id)"
            >
              查看
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无收款登记" :image-size="60" />
        </template>
      </el-table>
    </FinSection>

    <ContractDetailDrawer
      v-model:visible="contractDrawerVisible"
      :contract-id="activeContractId"
      @closed="onContractDrawerClosed"
      @nav="emit('nav')"
    />

    <ReceiptDetailDrawer
      v-model:visible="receiptDrawerVisible"
      :receipt-id="activeReceiptId"
      @closed="onReceiptDrawerClosed"
    />
  </div>
</template>

<style scoped>
.project-receipt-panel {
  min-height: 240px;
}

.mono {
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.receipt-progress {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 32px;
}

.receipt-progress__figures {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 24px;
  margin-bottom: 6px;
  font-size: 13px;
  color: #6e6458;
}

.receipt-progress__figures b {
  color: #3f3527;
}

.section-stat {
  font-size: 12px;
  color: #8c6a2f;
}

.sub-table-title {
  margin: 12px 0 6px;
  font-size: 12px;
  color: #8c6a2f;
}

@media (max-width: 720px) {
  .receipt-progress {
    grid-template-columns: 1fr;
  }
}
</style>
