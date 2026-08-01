<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  getPaymentConsoleSummary,
  listPaymentRequests,
  markPaymentPaid,
  type PaymentConsoleSummary,
  type PaymentRequest
} from "@/api/payment";
import { listProjects, type Project } from "@/api/project";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import PaymentDetailDrawer from "./components/PaymentDetailDrawer.vue";
import {
  formatBeijingDateTime,
  paymentStatusTagType,
  toPaymentMethodLabel,
  toPaymentStatusLabel,
  type PaymentTagType
} from "./payment-labels";

defineOptions({ name: "PaymentList" });

type Stage = "pending" | "in_approval" | "to_pay" | "paid" | "all";

const STAGE_STATUS: Record<Stage, string> = {
  pending: "draft",
  in_approval: "pending_approval",
  to_pay: "approved",
  paid: "paid",
  all: ""
};

const RESUBMITTABLE = new Set(["returned", "pending", "withdrawn"]);

const aiTagType: Record<string, PaymentTagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};

const aiRiskLabelMap: Record<string, string> = {
  none: "未触发",
  pending: "评估中",
  completed: "已完成",
  failed: "评估失败"
};

const toAiRiskLabel = (value: string | null | undefined): string => {
  if (!value) return "-";
  return aiRiskLabelMap[value] ?? value;
};

const router = useRouter();
const loading = ref(false);
const list = ref<PaymentRequest[]>([]);
const projects = ref<Project[]>([]);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const summary = ref<PaymentConsoleSummary | null>(null);
const stage = ref<Stage>("pending");
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const filters = ref({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  keyword: ""
});

const todayStr = new Date().toISOString().slice(0, 10);

const isReturned = (row: PaymentRequest) =>
  row.status === "draft" && RESUBMITTABLE.has(row.approval_status ?? "");

const isOverdue = (row: PaymentRequest) =>
  row.status === "approved" && row.expected_payment_date < todayStr;

const displayList = computed(() => {
  if (stage.value !== "to_pay") return list.value;
  return [...list.value].sort(
    (a, b) => Number(isOverdue(b)) - Number(isOverdue(a))
  );
});

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const stageTabs = computed(() => [
  {
    key: "pending" as Stage,
    label: "待处理",
    count: summary.value?.pending_count
  },
  {
    key: "in_approval" as Stage,
    label: "审批中",
    count: summary.value?.in_approval_count
  },
  {
    key: "to_pay" as Stage,
    label: "待付款",
    count: summary.value?.to_pay_count
  },
  { key: "paid" as Stage, label: "已付款", count: undefined },
  { key: "all" as Stage, label: "全部", count: undefined }
]);

const formatMoney = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "-"
    : value.toLocaleString("zh-CN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

const loadSummary = async () => {
  try {
    const result = await getPaymentConsoleSummary();
    summary.value = result.data;
  } catch {
    summary.value = null; // 汇总失败不阻塞列表,显示 "-"
  }
};

let loadSeq = 0;

const loadData = async () => {
  const seq = ++loadSeq;
  loading.value = true;
  try {
    const result = await listPaymentRequests({
      page: page.value,
      pageSize: pageSize.value,
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid || undefined,
      status: STAGE_STATUS[stage.value] || undefined,
      keyword: filters.value.keyword || undefined
    });
    if (seq !== loadSeq) return;
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
};

const switchStage = (next: Stage) => {
  stage.value = next;
  page.value = 1;
  loadData();
};

const onHeaderSearch = () => {
  page.value = 1;
  loadData();
};

const detailDrawerVisible = ref(false);
const activeRequestId = ref<number | null>(null);

const goCreate = () => router.push("/finance/payment/wizard");
const goDetail = (id: number) => {
  activeRequestId.value = id;
  detailDrawerVisible.value = true;
};
const onDetailDrawerClosed = async () => {
  await Promise.all([loadData(), loadSummary()]);
};
const goEdit = (id: number) =>
  router.push(`/finance/payment/detail/${id}?edit=1`);
const goApproval = (row: PaymentRequest) => {
  if (row.approval_instance_id)
    router.push(`/approval/detail/${row.approval_instance_id}`);
};

const onMarkPaid = async (id: number) => {
  await markPaymentPaid(id);
  message("已标记为已付款", { type: "success" });
  await Promise.all([loadData(), loadSummary()]);
};

onMounted(async () => {
  await Promise.all([
    listProjects({ page: 1, pageSize: 300 }).then(res => {
      projects.value = res.data;
    }),
    loadWecomUsers(),
    loadSummary()
  ]);
  await loadData();
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <!-- 汇总条:4 块可点击 -->
    <el-row :gutter="12" class="summary-strip">
      <el-col :md="6" :xs="12">
        <button
          class="summary-block"
          type="button"
          @click="switchStage('to_pay')"
        >
          <span>待付总额</span>
          <strong>¥ {{ formatMoney(summary?.to_pay_total) }}</strong>
        </button>
      </el-col>
      <el-col :md="6" :xs="12">
        <button
          class="summary-block"
          type="button"
          @click="switchStage('paid')"
        >
          <span>本月已付</span>
          <strong>¥ {{ formatMoney(summary?.paid_month_total) }}</strong>
        </button>
      </el-col>
      <el-col :md="6" :xs="12">
        <button
          class="summary-block summary-block--alert"
          type="button"
          @click="switchStage('to_pay')"
        >
          <span>超期未付</span>
          <strong>{{ summary?.overdue_count ?? "-" }} 笔</strong>
        </button>
      </el-col>
      <el-col :md="6" :xs="12">
        <button
          class="summary-block summary-block--alert"
          type="button"
          @click="switchStage('pending')"
        >
          <span>退回待改</span>
          <strong>{{ summary?.returned_count ?? "-" }} 笔</strong>
        </button>
      </el-col>
    </el-row>

    <!-- 阶段页签 + 筛选 -->
    <div class="console-toolbar">
      <el-tabs
        :model-value="stage"
        @tab-change="key => switchStage(String(key) as Stage)"
      >
        <el-tab-pane v-for="tab in stageTabs" :key="tab.key" :name="tab.key">
          <template #label>
            {{ tab.label
            }}<el-badge
              v-if="tab.count"
              :value="tab.count"
              :max="99"
              class="tab-badge"
            />
          </template>
        </el-tab-pane>
      </el-tabs>
      <el-space wrap>
        <el-select
          v-model="filters.project_id"
          clearable
          filterable
          placeholder="所属项目"
          style="width: 200px"
          @change="onHeaderSearch"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
        <el-select
          v-model="filters.applicant_userid"
          clearable
          filterable
          placeholder="申请人"
          style="width: 160px"
          @change="onHeaderSearch"
        >
          <el-option
            v-for="item in wecomUsers"
            :key="item.userid"
            :label="item.name || item.userid"
            :value="item.userid"
          />
        </el-select>
        <el-button type="primary" @click="goCreate">发起付款</el-button>
      </el-space>
    </div>

    <el-table
      v-loading="loading"
      :data="displayList"
      style="margin-top: 12px"
      :row-class-name="
        ({ row }) => (isOverdue(row) ? 'payment-row-overdue' : '')
      "
    >
      <el-table-column prop="serial_no" label="流水号" width="150" />
      <el-table-column label="所属项目" width="180">
        <template #default="scope">{{
          projectMap[scope.row.project_id] || scope.row.project_id
        }}</template>
      </el-table-column>
      <el-table-column min-width="220" show-overflow-tooltip>
        <template #header>
          <div class="content-search-header">
            <span>付款内容</span>
            <el-input
              v-model="filters.keyword"
              size="small"
              clearable
              placeholder="全局搜索内容/流水号"
              @keyup.enter="onHeaderSearch"
              @clear="onHeaderSearch"
            />
          </div>
        </template>
        <template #default="scope">{{ scope.row.content || "-" }}</template>
      </el-table-column>
      <el-table-column prop="amount" label="金额" width="120" />
      <el-table-column prop="amount_cn" label="金额大写" min-width="160" />
      <el-table-column label="付款方式" width="120">
        <template #default="scope">{{
          toPaymentMethodLabel(scope.row.payment_method)
        }}</template>
      </el-table-column>
      <el-table-column label="标签" width="110">
        <template #default="scope">
          <el-tag v-if="isReturned(scope.row)" type="danger">已退回</el-tag>
          <el-tag v-else-if="isOverdue(scope.row)" type="danger">超期</el-tag>
          <el-tag
            v-else
            :type="paymentStatusTagType[scope.row.status] || 'info'"
          >
            {{ toPaymentStatusLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="AI风险" width="110">
        <template #default="scope">
          <el-tag :type="aiTagType[scope.row.ai_risk_status] || 'info'">{{
            toAiRiskLabel(scope.row.ai_risk_status)
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="申请时间" width="180">
        <template #default="scope">{{
          formatBeijingDateTime(scope.row.created_at)
        }}</template>
      </el-table-column>
      <el-table-column label="支付时间" width="180">
        <template #default="scope">{{
          formatBeijingDateTime(scope.row.paid_at)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="scope">
          <el-button
            v-if="stage === 'pending' || isReturned(scope.row)"
            link
            type="danger"
            @click="goEdit(scope.row.id)"
            >去修改</el-button
          >
          <el-button
            v-if="isReturned(scope.row) || stage === 'in_approval'"
            link
            type="warning"
            @click="goApproval(scope.row)"
            >审批详情</el-button
          >
          <el-button
            v-if="scope.row.status === 'approved'"
            link
            type="success"
            @click="onMarkPaid(scope.row.id)"
            >标记付款</el-button
          >
          <el-button link type="primary" @click="goDetail(scope.row.id)"
            >详情</el-button
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

  <PaymentDetailDrawer
    v-model:visible="detailDrawerVisible"
    :request-id="activeRequestId"
    @closed="onDetailDrawerClosed"
  />
</template>

<style scoped>
.summary-strip {
  margin-bottom: 12px;
}

.summary-block {
  width: 100%;
  padding: 12px 16px;
  text-align: left;
  cursor: pointer;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.summary-block span {
  display: block;
  font-size: 13px;
  color: #6b7280;
}

.summary-block strong {
  display: block;
  margin-top: 6px;
  font-size: 20px;
}

.summary-block--alert {
  background: #fef2f2;
  border-color: #fecaca;
}

.summary-block--alert strong {
  color: #dc2626;
}

.console-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tab-badge {
  margin-left: 4px;
}

:deep(.payment-row-overdue) {
  background: #fef2f2;
}

.content-search-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.content-search-header span {
  flex-shrink: 0;
}

.content-search-header .el-input {
  max-width: 200px;
}
</style>
