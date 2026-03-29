<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { storageLocal } from "@pureadmin/utils";
import { message } from "@/utils/message";
import {
  forceApproveTask,
  forceTransferApproval,
  getApprovalDetail,
  listAllApprovalInstances,
  type ApprovalInstance,
  type ApprovalTask
} from "@/api/approval";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import { statusLabel } from "@/utils/enum-labels";
import { formatBeijingDateTime } from "@/utils/datetime";
import { toBizTypeLabel } from "./labels";

defineOptions({ name: "ApprovalAdminMonitor" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

type PendingTaskOption = Pick<ApprovalTask, "id" | "assignee_userid" | "status"> & {
  node_name: string;
};

const userStore = useUserStoreHook();
const isSuperAdmin = computed(() =>
  (userStore.roles ?? []).includes("super_admin")
);

const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const loading = ref(false);
const list = ref<ApprovalInstance[]>([]);
const page = ref(1);
const pageSize = ref(30);
const total = ref(0);

type AdminMonitorFilterState = {
  biz_type: string;
  status: string;
  initiator: string;
  keyword: string;
};

const defaultFilters = (): AdminMonitorFilterState => ({
  biz_type: "",
  status: "",
  initiator: "",
  keyword: ""
});

const filters = reactive<AdminMonitorFilterState>(defaultFilters());

const filterStorageKey = computed(() => {
  const userIdentity = userStore.username?.trim() || userStore.nickname?.trim();
  if (!userIdentity) return "";
  return `approval-admin-monitor:filters:${userIdentity}`;
});

const restoreFilters = () => {
  if (!filterStorageKey.value) return;
  const saved = storageLocal().getItem<Partial<AdminMonitorFilterState>>(
    filterStorageKey.value
  );
  if (!saved || typeof saved !== "object") return;

  filters.biz_type = typeof saved.biz_type === "string" ? saved.biz_type : "";
  filters.status = typeof saved.status === "string" ? saved.status : "";
  filters.initiator =
    typeof saved.initiator === "string" ? saved.initiator : "";
  filters.keyword = typeof saved.keyword === "string" ? saved.keyword : "";
};

const persistFilters = () => {
  if (!filterStorageKey.value) return;
  storageLocal().setItem(filterStorageKey.value, {
    biz_type: filters.biz_type,
    status: filters.status,
    initiator: filters.initiator.trim(),
    keyword: filters.keyword.trim()
  });
};

const statusTagType: Record<string, TagType> = {
  pending: "warning",
  in_progress: "primary",
  approved: "success",
  rejected: "danger",
  cancelled: "info",
  withdrawn: "info",
  completed: "success"
};

const bizTypeOptions = [
  { label: "对外合同审批", value: "outbound_contract" },
  { label: "收款合同审批", value: "inbound_contract" },
  { label: "开票申请审批", value: "invoice_request" },
  { label: "收款退款审批", value: "receipt_refund" },
  { label: "付款审批", value: "payment_request" },
  { label: "报销审批", value: "reimbursement_batch" },
  { label: "出入库审批", value: "stock_order" },
  { label: "合同金额变更", value: "contract_amount_change" }
];

const statusOptions = [
  { label: "待处理", value: "pending" },
  { label: "进行中", value: "in_progress" },
  { label: "已通过", value: "approved" },
  { label: "已驳回", value: "rejected" },
  { label: "已完成", value: "completed" },
  { label: "已取消", value: "cancelled" },
  { label: "已撤回", value: "withdrawn" }
];

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

const loadList = async () => {
  loading.value = true;
  try {
    const result = await listAllApprovalInstances({
      biz_type: filters.biz_type || undefined,
      status: filters.status || undefined,
      initiator: filters.initiator.trim() || undefined,
      keyword: filters.keyword.trim() || undefined,
      page: page.value,
      pageSize: pageSize.value
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const handleSearch = async () => {
  page.value = 1;
  await loadList();
};

const handleReset = async () => {
  const defaults = defaultFilters();
  filters.biz_type = defaults.biz_type;
  filters.status = defaults.status;
  filters.initiator = defaults.initiator;
  filters.keyword = defaults.keyword;
  page.value = 1;
  await loadList();
};

watch(
  filters,
  () => {
    persistFilters();
  },
  { deep: true }
);

const forceApproveDialogVisible = ref(false);
const forceApproveLoading = ref(false);
const activeApproveInstanceId = ref<number | null>(null);
const pendingTasksForApprove = ref<PendingTaskOption[]>([]);
const forceApproveForm = reactive({
  task_id: 0,
  comment: ""
});

const forceTransferDialogVisible = ref(false);
const forceTransferLoading = ref(false);
const activeTransferInstanceId = ref<number | null>(null);
const pendingTasksForTransfer = ref<PendingTaskOption[]>([]);
const forceTransferForm = reactive({
  task_id: 0,
  to_userid: "",
  reason: ""
});

const currentTransferTaskAssignee = computed(() => {
  const task = pendingTasksForTransfer.value.find(
    item => item.id === forceTransferForm.task_id
  );
  return task?.assignee_userid ?? "";
});

const pickPendingTasks = (tasks: ApprovalTask[], nodes: Array<{ id: number; node_name: string }>) => {
  const nodeMap = new Map<number, string>();
  for (const node of nodes) {
    nodeMap.set(node.id, node.node_name);
  }

  return tasks
    .filter(task => task.status === "pending")
    .map(task => ({
      id: task.id,
      assignee_userid: task.assignee_userid,
      status: task.status,
      node_name: nodeMap.get(task.node_instance_id) ?? "当前节点"
    }));
};

const openForceApproveDialog = async (row: ApprovalInstance) => {
  try {
    const result = await getApprovalDetail(row.id);
    const pendingTasks = pickPendingTasks(result.data.tasks, result.data.nodes);
    if (!pendingTasks.length) {
      message("该实例无待处理任务", { type: "warning" });
      return;
    }
    activeApproveInstanceId.value = row.id;
    pendingTasksForApprove.value = pendingTasks;
    forceApproveForm.task_id = pendingTasks[0].id;
    forceApproveForm.comment = "";
    forceApproveDialogVisible.value = true;
  } catch {
    message("加载待处理任务失败", { type: "error" });
  }
};

const submitForceApprove = async () => {
  if (!activeApproveInstanceId.value) return;
  if (!Number.isFinite(forceApproveForm.task_id) || forceApproveForm.task_id <= 0) {
    message("请选择任务", { type: "warning" });
    return;
  }

  forceApproveLoading.value = true;
  try {
    await forceApproveTask(activeApproveInstanceId.value, {
      task_id: forceApproveForm.task_id,
      comment: forceApproveForm.comment.trim() || undefined
    });
    message("已强制通过", { type: "success" });
    forceApproveDialogVisible.value = false;
    await loadList();
  } catch {
    message("强制通过失败", { type: "error" });
  } finally {
    forceApproveLoading.value = false;
  }
};

const openForceTransferDialog = async (row: ApprovalInstance) => {
  try {
    const result = await getApprovalDetail(row.id);
    const pendingTasks = pickPendingTasks(result.data.tasks, result.data.nodes).filter(
      item => item.assignee_userid !== "AI_GATE"
    );
    if (!pendingTasks.length) {
      message("该实例无可改派的待处理任务", { type: "warning" });
      return;
    }

    activeTransferInstanceId.value = row.id;
    pendingTasksForTransfer.value = pendingTasks;
    forceTransferForm.task_id = pendingTasks[0].id;
    forceTransferForm.to_userid = "";
    forceTransferForm.reason = "";
    forceTransferDialogVisible.value = true;
  } catch {
    message("加载待处理任务失败", { type: "error" });
  }
};

const submitForceTransfer = async () => {
  if (!activeTransferInstanceId.value) return;
  if (!Number.isFinite(forceTransferForm.task_id) || forceTransferForm.task_id <= 0) {
    message("请选择任务", { type: "warning" });
    return;
  }
  if (!forceTransferForm.to_userid.trim() || !forceTransferForm.reason.trim()) {
    message("请填写改派目标和原因", { type: "warning" });
    return;
  }
  if (forceTransferForm.to_userid.trim() === currentTransferTaskAssignee.value) {
    message("目标审批人与当前审批人相同", { type: "warning" });
    return;
  }

  forceTransferLoading.value = true;
  try {
    await forceTransferApproval(activeTransferInstanceId.value, {
      task_id: forceTransferForm.task_id,
      to_userid: forceTransferForm.to_userid.trim(),
      reason: forceTransferForm.reason.trim()
    });
    message("已强制改派", { type: "success" });
    forceTransferDialogVisible.value = false;
    await loadList();
  } catch {
    message("强制改派失败", { type: "error" });
  } finally {
    forceTransferLoading.value = false;
  }
};

onMounted(async () => {
  restoreFilters();
  await Promise.all([loadWecomUsers(), loadList()]);
});
</script>

<template>
  <el-card shadow="never">
    <template #header>
      <div style="font-size: 18px; font-weight: 600">审批监控台</div>
    </template>

    <el-form inline>
      <el-form-item label="业务类型">
        <el-select v-model="filters.biz_type" clearable placeholder="全部" style="width: 160px">
          <el-option
            v-for="item in bizTypeOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable placeholder="全部" style="width: 140px">
          <el-option
            v-for="item in statusOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="发起人">
        <el-input
          v-model="filters.initiator"
          placeholder="发起人 userid"
          clearable
          style="width: 180px"
        />
      </el-form-item>

      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          placeholder="摘要关键字"
          clearable
          style="width: 220px"
        />
      </el-form-item>

      <el-form-item>
        <el-button type="primary" @click="handleSearch">查询</el-button>
        <el-button @click="handleReset">重置</el-button>
        <el-button @click="loadList">刷新</el-button>
      </el-form-item>
    </el-form>

    <el-table v-loading="loading" :data="list" border style="width: 100%">
      <el-table-column prop="instance_no" label="审批单号" min-width="170" />

      <el-table-column label="业务类型" min-width="140">
        <template #default="{ row }">
          {{ toBizTypeLabel(row.biz_type) }}
        </template>
      </el-table-column>

      <el-table-column prop="biz_summary" label="摘要" min-width="260" show-overflow-tooltip />

      <el-table-column label="发起人" min-width="160">
        <template #default="{ row }">
          {{ toUserLabel(row.initiator_userid) }}
        </template>
      </el-table-column>

      <el-table-column prop="current_node_key" label="当前节点" min-width="140" />

      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag :type="statusTagType[row.status] ?? 'info'" size="small">
            {{ statusLabel(row.status) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="提交时间" min-width="180">
        <template #default="{ row }">
          {{ formatBeijingDateTime(row.submitted_at) }}
        </template>
      </el-table-column>

      <el-table-column label="完成时间" min-width="180">
        <template #default="{ row }">
          {{ row.completed_at ? formatBeijingDateTime(row.completed_at) : "-" }}
        </template>
      </el-table-column>

      <el-table-column label="操作" width="300" fixed="right">
        <template #default="{ row }">
          <router-link :to="`/approval/detail/${row.id}`">查看详情</router-link>
          <el-button
            v-if="isSuperAdmin && row.status === 'in_progress'"
            link
            type="success"
            @click="openForceApproveDialog(row)"
          >
            强制通过
          </el-button>
          <el-button
            v-if="isSuperAdmin && row.status === 'in_progress'"
            link
            type="warning"
            @click="openForceTransferDialog(row)"
          >
            强制转签
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      background
      layout="total, sizes, prev, pager, next"
      :current-page="page"
      :page-size="pageSize"
      :page-sizes="[20, 30, 50, 100]"
      :total="total"
      @current-change="
        async (val: number) => {
          page = val;
          await loadList();
        }
      "
      @size-change="
        async (val: number) => {
          pageSize = val;
          page = 1;
          await loadList();
        }
      "
    />
  </el-card>

  <el-dialog v-model="forceApproveDialogVisible" title="强制通过审批任务" width="760px">
    <el-alert
      type="warning"
      :closable="false"
      title="该操作会直接将所选待审批任务标记为通过，并继续推进流程。"
      style="margin-bottom: 12px"
    />

    <el-table :data="pendingTasksForApprove" border max-height="280">
      <el-table-column label="选择" width="90">
        <template #default="{ row }">
          <el-radio v-model="forceApproveForm.task_id" :value="row.id">选中</el-radio>
        </template>
      </el-table-column>
      <el-table-column prop="id" label="任务ID" width="100" />
      <el-table-column prop="node_name" label="节点" min-width="160" />
      <el-table-column label="当前审批人" min-width="180">
        <template #default="{ row }">
          {{ toUserLabel(row.assignee_userid) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <el-form label-width="90px" style="margin-top: 12px">
      <el-form-item label="审批意见">
        <el-input
          v-model="forceApproveForm.comment"
          type="textarea"
          :rows="3"
          placeholder="可选，留空则使用系统默认意见"
        />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="forceApproveDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="forceApproveLoading" @click="submitForceApprove"
        >确认强制通过</el-button
      >
    </template>
  </el-dialog>

  <el-dialog v-model="forceTransferDialogVisible" title="强制转签" width="760px">
    <el-alert
      type="warning"
      :closable="false"
      title="该操作会替换当前任务审批人，并记录超管强制改派痕迹。"
      style="margin-bottom: 12px"
    />

    <el-table :data="pendingTasksForTransfer" border max-height="280">
      <el-table-column label="选择" width="90">
        <template #default="{ row }">
          <el-radio v-model="forceTransferForm.task_id" :value="row.id">选中</el-radio>
        </template>
      </el-table-column>
      <el-table-column prop="id" label="任务ID" width="100" />
      <el-table-column prop="node_name" label="节点" min-width="160" />
      <el-table-column label="当前审批人" min-width="180">
        <template #default="{ row }">
          {{ toUserLabel(row.assignee_userid) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
    </el-table>

    <el-form label-width="90px" style="margin-top: 12px">
      <el-form-item label="改派给">
        <el-select
          v-model="forceTransferForm.to_userid"
          clearable
          filterable
          placeholder="选择公司人员"
          style="width: 100%"
        >
          <el-option
            v-for="item in wecomUsers"
            :key="item.userid"
            :label="`${item.name} (${item.userid})`"
            :value="item.userid"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="改派原因">
        <el-input v-model="forceTransferForm.reason" type="textarea" :rows="3" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="forceTransferDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="forceTransferLoading" @click="submitForceTransfer"
        >确认强制转签</el-button
      >
    </template>
  </el-dialog>
</template>
