<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  listPendingApprovals,
  listProcessedApprovals,
  listCcApprovals,
  type PendingApprovalItem,
  type ProcessedApprovalItem,
  type ApprovalInstance
} from "@/api/approval";

defineOptions({ name: "ApprovalCenter" });

const router = useRouter();
const activeTab = ref("pending");

const bizTypeOptions = [
  { label: "合同审批", value: "outbound_contract" },
  { label: "收款合同审批", value: "inbound_contract" },
  { label: "付款审批", value: "payment_request" },
  { label: "报销审批", value: "reimbursement_batch" }
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
      pageSize: pendingPageSize.value
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
      pageSize: processedPageSize.value
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
      pageSize: ccPageSize.value
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

const bizTypeLabel = (value: string) =>
  bizTypeOptions.find(o => o.value === value)?.label ?? value;

onMounted(loadPending);
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
          <el-table-column
            prop="biz_summary"
            label="摘要"
            min-width="220"
            show-overflow-tooltip
          />
          <el-table-column prop="initiator_userid" label="发起人" width="140" />
          <el-table-column
            prop="current_node_name"
            label="当前节点"
            width="140"
          />
          <el-table-column prop="submitted_at" label="提交时间" width="180" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag
                :type="statusTagType[row.task_status] ?? 'info'"
                size="small"
              >
                {{ row.task_status }}
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
          <el-table-column
            prop="biz_summary"
            label="摘要"
            min-width="220"
            show-overflow-tooltip
          />
          <el-table-column prop="initiator_userid" label="发起人" width="140" />
          <el-table-column prop="action" label="操作" width="100">
            <template #default="{ row }">
              <el-tag
                v-if="row.action"
                :type="row.action === 'approve' ? 'success' : 'danger'"
                size="small"
                >{{ row.action }}</el-tag
              >
            </template>
          </el-table-column>
          <el-table-column prop="acted_at" label="操作时间" width="180" />
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
          <el-table-column prop="initiator_userid" label="发起人" width="140" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="statusTagType[row.status] ?? 'info'" size="small">
                {{ row.status }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="submitted_at" label="提交时间" width="180" />
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
