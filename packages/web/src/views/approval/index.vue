<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  listPendingApprovals,
  listProcessedApprovals,
  listCcApprovals,
  type PendingApprovalItem,
  type ProcessedApprovalItem,
  type ApprovalInstance
} from "@/api/approval";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { toActionLabel, toBizTypeLabel, toStatusLabel } from "./labels";
import { formatBeijingDateTime } from "@/utils/datetime";

defineOptions({ name: "ApprovalCenter" });

const router = useRouter();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const activeTab = ref("pending");

const bizTypeOptions = [
  { label: "合同审批", value: "outbound_contract" },
  { label: "收款合同审批", value: "inbound_contract" },
  { label: "开票申请审批", value: "invoice_request" },
  { label: "付款审批", value: "payment_request" },
  { label: "报销审批", value: "reimbursement_batch" },
  { label: "出入库审批", value: "stock_order" }
];

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const statusTagType: Record<string, TagType> = {
  pending: "warning",
  in_progress: "primary",
  approved: "success",
  rejected: "danger",
  cancelled: "info",
  withdrawn: "info"
};

const pendingLoading = ref(false);
const pendingList = ref<PendingApprovalItem[]>([]);
const pendingPage = ref(1);
const pendingPageSize = ref(20);
const pendingTotal = ref(0);

const processedLoading = ref(false);
const processedList = ref<ProcessedApprovalItem[]>([]);
const processedPage = ref(1);
const processedPageSize = ref(20);
const processedTotal = ref(0);

const ccLoading = ref(false);
const ccList = ref<ApprovalInstance[]>([]);
const ccPage = ref(1);
const ccPageSize = ref(20);
const ccTotal = ref(0);

const filters = ref({ keyword: "", biz_type: "" });

const loadPending = async () => {
  pendingLoading.value = true;
  try {
    const result = await listPendingApprovals({
      page: pendingPage.value,
      pageSize: pendingPageSize.value,
      biz_type: filters.value.biz_type || undefined,
      keyword: filters.value.keyword || undefined
    });
    pendingList.value = result.data;
    pendingTotal.value = result.pagination.total;
  } finally {
    pendingLoading.value = false;
  }
};

const loadProcessed = async () => {
  processedLoading.value = true;
  try {
    const result = await listProcessedApprovals({
      page: processedPage.value,
      pageSize: processedPageSize.value,
      biz_type: filters.value.biz_type || undefined,
      keyword: filters.value.keyword || undefined
    });
    processedList.value = result.data;
    processedTotal.value = result.pagination.total;
  } finally {
    processedLoading.value = false;
  }
};

const loadCc = async () => {
  ccLoading.value = true;
  try {
    const result = await listCcApprovals({
      page: ccPage.value,
      pageSize: ccPageSize.value,
      biz_type: filters.value.biz_type || undefined,
      keyword: filters.value.keyword || undefined
    });
    ccList.value = result.data;
    ccTotal.value = result.pagination.total;
  } finally {
    ccLoading.value = false;
  }
};

const loadCurrentTab = () => {
  if (activeTab.value === "pending") loadPending();
  else if (activeTab.value === "processed") loadProcessed();
  else loadCc();
};

const onTabChange = () => loadCurrentTab();

const gotoDetail = (id: number) => {
  router.push(`/approval/detail/${id}`);
};

const businessDetailRoute = (row: { biz_type: string; biz_id?: number }) => {
  if (row.biz_type === "reimbursement_batch" && row.biz_id) {
    return `/finance/reimbursement/batch/${row.biz_id}`;
  }
  return null;
};

const goToBusinessDetail = (row: { biz_type: string; biz_id?: number }) => {
  const target = businessDetailRoute(row);
  if (!target) return;
  router.push(target);
};

const bizTypeLabel = (value: string) =>
  bizTypeOptions.find(o => o.value === value)?.label ?? toBizTypeLabel(value);

const userNameMap = computed(() => {
  const map = new Map<string, string>();
  for (const item of wecomUsers.value) {
    map.set(item.userid, item.name || item.userid);
  }
  return map;
});

const toUserLabel = (userid: string | null | undefined) => {
  if (!userid) return "-";
  return userNameMap.value.get(userid) ?? userid;
};

const formatAmount = (value: number | null | undefined) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

const projectLabel = (
  row:
    | Pick<PendingApprovalItem, "project_name" | "project_code">
    | Pick<ProcessedApprovalItem, "project_name" | "project_code">
) => {
  if (row.project_name && row.project_code)
    return `${row.project_name} (${row.project_code})`;
  return row.project_name || row.project_code || "-";
};

const reimbursementApplicantLabel = (
  row:
    | Pick<PendingApprovalItem, "biz_type" | "biz_applicant_userid">
    | Pick<ProcessedApprovalItem, "biz_type" | "biz_applicant_userid">
    | Pick<ApprovalInstance, "biz_type" | "biz_applicant_userid">
) => {
  if (row.biz_type !== "reimbursement_batch") return "-";
  return toUserLabel(row.biz_applicant_userid);
};

onMounted(async () => {
  await loadWecomUsers();
  await loadPending();
});
</script>

<template>
  <el-card shadow="never">
    <el-form inline>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          placeholder="摘要关键字"
          clearable
        />
      </el-form-item>
      <el-form-item label="业务类型">
        <el-select v-model="filters.biz_type" clearable placeholder="全部">
          <el-option
            v-for="opt in bizTypeOptions"
            :key="opt.value"
            :label="opt.label"
            :value="opt.value"
          />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadCurrentTab">查询</el-button>
    </el-form>

    <el-tabs v-model="activeTab" @tab-change="onTabChange">
      <el-tab-pane name="pending">
        <template #label>
          <span>待审批</span>
          <el-badge
            v-if="pendingTotal > 0"
            :value="pendingTotal"
            :max="99"
            style="margin-left: 6px"
          />
        </template>
        <el-table
          v-loading="pendingLoading"
          :data="pendingList"
          style="width: 100%"
          @row-click="(row: PendingApprovalItem) => gotoDetail(row.id)"
        >
          <el-table-column label="业务类型" width="130">
            <template #default="{ row }">{{
              bizTypeLabel(row.biz_type)
            }}</template>
          </el-table-column>
          <el-table-column prop="instance_no" label="审批单号" width="170" />
          <el-table-column
            label="所属项目"
            min-width="180"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ projectLabel(row) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="140">
            <template #default="{ row }">{{
              formatAmount(row.biz_amount)
            }}</template>
          </el-table-column>
          <el-table-column
            label="业务明细"
            min-width="220"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <el-link
                v-if="businessDetailRoute(row)"
                type="primary"
                @click.stop="goToBusinessDetail(row)"
              >
                {{ row.biz_detail || "-" }}
              </el-link>
              <template v-else>{{ row.biz_detail || "-" }}</template>
            </template>
          </el-table-column>
          <el-table-column
            prop="biz_summary"
            label="摘要"
            min-width="240"
            show-overflow-tooltip
          />
          <el-table-column label="发起人" width="140">
            <template #default="{ row }">{{
              toUserLabel(row.initiator_userid)
            }}</template>
          </el-table-column>
          <el-table-column label="被报销人" width="140">
            <template #default="{ row }">{{
              reimbursementApplicantLabel(row)
            }}</template>
          </el-table-column>
          <el-table-column
            prop="current_node_name"
            label="当前节点"
            width="140"
          />
          <el-table-column label="提交时间" width="180">
            <template #default="{ row }">{{
              formatBeijingDateTime(row.submitted_at)
            }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag
                :type="statusTagType[row.task_status] ?? 'info'"
                size="small"
              >
                {{ toStatusLabel(row.task_status) }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          style="margin-top: 12px; justify-content: flex-end"
          background
          layout="prev, pager, next, total"
          :current-page="pendingPage"
          :page-size="pendingPageSize"
          :total="pendingTotal"
          @current-change="
            (val: number) => {
              pendingPage = val;
              loadPending();
            }
          "
        />
      </el-tab-pane>

      <el-tab-pane label="已处理" name="processed">
        <el-table
          v-loading="processedLoading"
          :data="processedList"
          style="width: 100%"
          @row-click="(row: ProcessedApprovalItem) => gotoDetail(row.id)"
        >
          <el-table-column label="业务类型" width="130">
            <template #default="{ row }">{{
              bizTypeLabel(row.biz_type)
            }}</template>
          </el-table-column>
          <el-table-column prop="instance_no" label="审批单号" width="170" />
          <el-table-column
            label="所属项目"
            min-width="180"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ projectLabel(row) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="140">
            <template #default="{ row }">{{
              formatAmount(row.biz_amount)
            }}</template>
          </el-table-column>
          <el-table-column
            label="业务明细"
            min-width="220"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              <el-link
                v-if="businessDetailRoute(row)"
                type="primary"
                @click.stop="goToBusinessDetail(row)"
              >
                {{ row.biz_detail || "-" }}
              </el-link>
              <template v-else>{{ row.biz_detail || "-" }}</template>
            </template>
          </el-table-column>
          <el-table-column
            prop="biz_summary"
            label="摘要"
            min-width="240"
            show-overflow-tooltip
          />
          <el-table-column label="发起人" width="140">
            <template #default="{ row }">{{
              toUserLabel(row.initiator_userid)
            }}</template>
          </el-table-column>
          <el-table-column label="被报销人" width="140">
            <template #default="{ row }">{{
              reimbursementApplicantLabel(row)
            }}</template>
          </el-table-column>
          <el-table-column label="实例状态" width="110">
            <template #default="{ row }">
              <el-tag :type="statusTagType[row.status] ?? 'info'" size="small">
                {{ toStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="action" label="操作" width="100">
            <template #default="{ row }">
              <el-tag
                v-if="row.action"
                :type="row.action === 'approve' ? 'success' : 'danger'"
                size="small"
                >{{ toActionLabel(row.action) }}</el-tag
              >
            </template>
          </el-table-column>
          <el-table-column label="操作时间" width="180">
            <template #default="{ row }">{{
              formatBeijingDateTime(row.acted_at)
            }}</template>
          </el-table-column>
          <el-table-column
            prop="comment"
            label="意见"
            min-width="150"
            show-overflow-tooltip
          />
        </el-table>
        <el-pagination
          style="margin-top: 12px; justify-content: flex-end"
          background
          layout="prev, pager, next, total"
          :current-page="processedPage"
          :page-size="processedPageSize"
          :total="processedTotal"
          @current-change="
            (val: number) => {
              processedPage = val;
              loadProcessed();
            }
          "
        />
      </el-tab-pane>

      <el-tab-pane label="抄送我的" name="cc">
        <el-table
          v-loading="ccLoading"
          :data="ccList"
          style="width: 100%"
          @row-click="(row: ApprovalInstance) => gotoDetail(row.id)"
        >
          <el-table-column label="业务类型" width="130">
            <template #default="{ row }">{{
              bizTypeLabel(row.biz_type)
            }}</template>
          </el-table-column>
          <el-table-column
            prop="biz_summary"
            label="摘要"
            min-width="220"
            show-overflow-tooltip
          />
          <el-table-column label="发起人" width="140">
            <template #default="{ row }">{{
              toUserLabel(row.initiator_userid)
            }}</template>
          </el-table-column>
          <el-table-column label="被报销人" width="140">
            <template #default="{ row }">{{
              reimbursementApplicantLabel(row)
            }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusTagType[row.status] ?? 'info'" size="small">
                {{ toStatusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="提交时间" width="180">
            <template #default="{ row }">{{
              formatBeijingDateTime(row.submitted_at)
            }}</template>
          </el-table-column>
        </el-table>
        <el-pagination
          style="margin-top: 12px; justify-content: flex-end"
          background
          layout="prev, pager, next, total"
          :current-page="ccPage"
          :page-size="ccPageSize"
          :total="ccTotal"
          @current-change="
            (val: number) => {
              ccPage = val;
              loadCc();
            }
          "
        />
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>
