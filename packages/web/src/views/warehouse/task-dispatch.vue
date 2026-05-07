<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { listAssetTypes, type AssetType } from "@/api/asset";
import { listProjects, type Project } from "@/api/project";
import {
  assignWarehouseAssetWorkOrder,
  assignWarehouseTaskPackageTasks,
  createWarehouseTaskPackage,
  listWarehouseTaskEvidence,
  listWarehouseAssetWorkOrders,
  listWarehouses,
  listWarehouseTaskPackages,
  listWarehouseTaskWorkload,
  reviewWarehouseAssetWorkOrder,
  startWarehouseAssetWorkOrder,
  triggerWarehouseDispatchRecommendation,
  type Warehouse,
  type WarehouseAssetWorkOrder,
  type WarehouseTaskEvidence,
  type WarehouseTaskPackage,
  type WarehouseTaskWorkloadSummary
} from "@/api/warehouse";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import {
  listWarehouseManuals,
  type WarehouseManual
} from "@/api/warehouse-manual";

defineOptions({ name: "WarehouseTaskDispatch" });

const loading = ref(false);
const actionId = ref<number | null>(null);
const rows = ref<WarehouseAssetWorkOrder[]>([]);
const selectedRows = ref<WarehouseAssetWorkOrder[]>([]);
const packageRows = ref<WarehouseTaskPackage[]>([]);
const workloadRows = ref<WarehouseTaskWorkloadSummary[]>([]);
const assignVisible = ref(false);
const packageVisible = ref(false);
const batchVisible = ref(false);
const evidenceVisible = ref(false);
const evidenceRows = ref<WarehouseTaskEvidence[]>([]);
const evidenceLoading = ref(false);
const aiDispatchLoading = ref(false);
const activeTaskNo = ref("");
const manuals = ref<WarehouseManual[]>([]);
const warehouses = ref<Warehouse[]>([]);
const projects = ref<Project[]>([]);
const assetTypes = ref<AssetType[]>([]);
const assignForm = ref({
  id: 0,
  assignee_userid: "",
  scheduled_date: "",
  manual_version_id: undefined as number | undefined
});
const packageForm = ref({
  package_title: "",
  assignee_userid: "",
  due_date: "",
  priority: "normal" as WarehouseAssetWorkOrder["priority"],
  remark: ""
});
const batchForm = ref({
  package_id: undefined as number | undefined,
  assignee_userid: "",
  scheduled_date: "",
  manual_version_id: undefined as number | undefined
});
const filters = ref<{
  status?: WarehouseAssetWorkOrder["status"];
  source?: WarehouseAssetWorkOrder["source"];
  assignee_userid?: string;
  warehouse_id?: number;
  project_id?: number;
  asset_type_id?: number;
}>({});
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const statusOptions: Array<{
  label: string;
  value: WarehouseAssetWorkOrder["status"];
}> = [
  { label: "待派工", value: "pending_assignment" },
  { label: "已派工", value: "assigned" },
  { label: "执行中", value: "in_progress" },
  { label: "待复核", value: "submitted" },
  { label: "已退回", value: "rejected" },
  { label: "已完成", value: "completed" }
];

const taskStatusText: Record<string, string> = {
  draft: "草稿",
  pending_assignment: "待派工",
  assigned: "已派工",
  pending_approval: "审批中",
  approved: "已批准",
  in_progress: "执行中",
  submitted: "待复核",
  completed: "已完成",
  rejected: "已退回",
  cancelled: "已取消"
};

const packageStatusText: Record<WarehouseTaskPackage["status"], string> = {
  open: "未开始",
  in_progress: "进行中",
  completed: "已完成",
  exception: "有异常"
};

const sourceOptions: Array<{
  label: string;
  value: WarehouseAssetWorkOrder["source"];
}> = [
  { label: "手动创建", value: "manual" },
  { label: "返库签收", value: "return_receipt" },
  { label: "出入库单", value: "stock_order" },
  { label: "盘库", value: "stocktake" },
  { label: "AI调度", value: "ai_schedule" }
];

const typeText: Record<string, string> = {
  inspection: "检查",
  maintenance: "维修",
  servicing: "保养",
  modification: "改装",
  scrapping: "报废"
};

const priorityTag = (priority: WarehouseAssetWorkOrder["priority"]) => {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  if (priority === "low") return "info";
  return "success";
};

const packageStatusTag = (status: WarehouseTaskPackage["status"]) => {
  if (status === "exception") return "danger";
  if (status === "completed") return "success";
  if (status === "in_progress") return "warning";
  return "info";
};

const isTaskOverdue = (row: WarehouseAssetWorkOrder) => {
  if (!row.scheduled_date || ["completed", "cancelled"].includes(row.status)) {
    return false;
  }
  return row.scheduled_date < new Date().toISOString().slice(0, 10);
};

const hasTaskException = (row: WarehouseAssetWorkOrder) =>
  row.status === "rejected" || isTaskOverdue(row);

const workerText = (userid: string | null) => {
  if (!userid) return "未派工";
  const user = wecomUsers.value.find(item => item.userid === userid);
  return user ? `${user.name} (${userid})` : userid;
};

const evidenceTypeText: Record<string, string> = {
  photo: "照片",
  video: "视频",
  voice: "语音",
  brief: "简报",
  document: "文档"
};

const loadData = async () => {
  loading.value = true;
  try {
    const [taskResult, packageResult, workloadResult] = await Promise.all([
      listWarehouseAssetWorkOrders(filters.value),
      listWarehouseTaskPackages({
        assignee_userid: filters.value.assignee_userid,
        warehouse_id: filters.value.warehouse_id,
        project_id: filters.value.project_id
      }),
      listWarehouseTaskWorkload({
        source: filters.value.source,
        assignee_userid: filters.value.assignee_userid,
        warehouse_id: filters.value.warehouse_id,
        project_id: filters.value.project_id
      })
    ]);
    rows.value = taskResult.data;
    packageRows.value = packageResult.data;
    workloadRows.value = workloadResult.data;
  } finally {
    loading.value = false;
  }
};

const handleSelectionChange = (selection: WarehouseAssetWorkOrder[]) => {
  selectedRows.value = selection;
};

const openAssign = (row: WarehouseAssetWorkOrder) => {
  assignForm.value = {
    id: row.id,
    assignee_userid: row.assignee_userid || "",
    scheduled_date: row.scheduled_date || "",
    manual_version_id: row.manual_version_id || undefined
  };
  assignVisible.value = true;
};

const openEvidence = async (row: WarehouseAssetWorkOrder) => {
  activeTaskNo.value = row.work_order_no;
  evidenceVisible.value = true;
  evidenceLoading.value = true;
  try {
    const result = await listWarehouseTaskEvidence(row.id);
    evidenceRows.value = result.data;
  } finally {
    evidenceLoading.value = false;
  }
};

const submitAssign = async () => {
  if (!assignForm.value.assignee_userid) {
    message("请选择执行人", { type: "warning" });
    return;
  }
  await assignWarehouseAssetWorkOrder(assignForm.value.id, {
    assignee_userid: assignForm.value.assignee_userid,
    scheduled_date: assignForm.value.scheduled_date || null,
    manual_version_id: assignForm.value.manual_version_id || null
  });
  assignVisible.value = false;
  message("任务已派工", { type: "success" });
  await loadData();
};

const submitPackage = async () => {
  if (!packageForm.value.package_title.trim()) {
    message("请输入任务包名称", { type: "warning" });
    return;
  }
  await createWarehouseTaskPackage({
    package_title: packageForm.value.package_title.trim(),
    assignee_userid: packageForm.value.assignee_userid || null,
    due_date: packageForm.value.due_date || null,
    priority: packageForm.value.priority,
    remark: packageForm.value.remark || null
  });
  packageVisible.value = false;
  packageForm.value = {
    package_title: "",
    assignee_userid: "",
    due_date: "",
    priority: "normal",
    remark: ""
  };
  message("任务包已创建", { type: "success" });
  await loadData();
};

const openBatchAssign = () => {
  if (selectedRows.value.length === 0) {
    message("请先勾选任务", { type: "warning" });
    return;
  }
  batchForm.value = {
    package_id: packageRows.value[0]?.id,
    assignee_userid: "",
    scheduled_date: "",
    manual_version_id: undefined
  };
  batchVisible.value = true;
};

const submitBatchAssign = async () => {
  if (!batchForm.value.package_id) {
    message("请选择任务包", { type: "warning" });
    return;
  }
  const result = await assignWarehouseTaskPackageTasks(
    batchForm.value.package_id,
    {
      task_ids: selectedRows.value.map(item => item.id),
      assignee_userid: batchForm.value.assignee_userid || null,
      scheduled_date: batchForm.value.scheduled_date || null,
      manual_version_id: batchForm.value.manual_version_id || null
    }
  );
  batchVisible.value = false;
  message(`已更新 ${result.data.updated} 个任务`, { type: "success" });
  await loadData();
};

const triggerAiDispatch = async () => {
  aiDispatchLoading.value = true;
  try {
    const result = await triggerWarehouseDispatchRecommendation({
      task_ids:
        selectedRows.value.length > 0
          ? selectedRows.value.map(item => item.id)
          : undefined,
      warehouse_id: filters.value.warehouse_id,
      project_id: filters.value.project_id,
      source: filters.value.source,
      assignee_userid: filters.value.assignee_userid,
      limit: selectedRows.value.length > 0 ? selectedRows.value.length : 50
    });
    message(`AI调度建议已进入队列：#${result.data.task_id}`, {
      type: "success"
    });
  } finally {
    aiDispatchLoading.value = false;
  }
};

const startTask = async (row: WarehouseAssetWorkOrder) => {
  actionId.value = row.id;
  try {
    await startWarehouseAssetWorkOrder(row.id);
    message("任务已开始", { type: "success" });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

const reviewTask = async (
  row: WarehouseAssetWorkOrder,
  action: "approve" | "reject"
) => {
  actionId.value = row.id;
  try {
    await reviewWarehouseAssetWorkOrder(row.id, {
      action,
      result_summary:
        action === "approve" ? "库房负责人复核通过" : "库房负责人退回重做"
    });
    message(action === "approve" ? "已复核完成" : "已退回任务", {
      type: "success"
    });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

onMounted(async () => {
  const [manualRes, warehouseRes, assetTypeRes, projectRes] = await Promise.all(
    [
      listWarehouseManuals({ status: "active" }),
      listWarehouses(),
      listAssetTypes({ tracked_flag: 1 }),
      listProjects({ page: 1, pageSize: 500 }),
      loadWecomUsers(),
      loadData()
    ]
  );
  manuals.value = manualRes.data;
  warehouses.value = warehouseRes.data;
  assetTypes.value = assetTypeRes.data;
  projects.value = projectRes.data;
});
</script>

<template>
  <el-card v-loading="loading" shadow="never" class="page">
    <template #header>
      <div class="page__head">
        <div>
          <div class="page__title">任务调度台</div>
          <div class="page__sub">库房负责人统一派工、跟进执行、复核完成</div>
        </div>
        <div class="page__actions">
          <el-button :loading="aiDispatchLoading" @click="triggerAiDispatch">
            AI建议
          </el-button>
          <el-button @click="packageVisible = true">新建任务包</el-button>
          <el-button type="primary" @click="openBatchAssign">
            选中加入任务包
          </el-button>
        </div>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 160px">
          <el-option
            v-for="item in statusOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="来源">
        <el-select v-model="filters.source" clearable style="width: 160px">
          <el-option
            v-for="item in sourceOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="执行人">
        <el-select
          v-model="filters.assignee_userid"
          clearable
          filterable
          style="width: 180px"
        >
          <el-option
            v-for="item in wecomUsers"
            :key="item.userid"
            :label="`${item.name} (${item.userid})`"
            :value="item.userid"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="仓库">
        <el-select
          v-model="filters.warehouse_id"
          clearable
          filterable
          style="width: 180px"
        >
          <el-option
            v-for="item in warehouses"
            :key="item.id"
            :label="item.warehouse_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="项目">
        <el-select
          v-model="filters.project_id"
          clearable
          filterable
          style="width: 220px"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="资产类型">
        <el-select
          v-model="filters.asset_type_id"
          clearable
          filterable
          style="width: 220px"
        >
          <el-option
            v-for="item in assetTypes"
            :key="item.id"
            :label="`${item.type_name} (${item.type_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <div class="workload">
      <div class="workload__title">人员负载</div>
      <el-table :data="workloadRows" size="small" border>
        <el-table-column label="人员" min-width="180">
          <template #default="{ row }">
            {{ workerText(row.assignee_userid) }}
          </template>
        </el-table-column>
        <el-table-column prop="open_count" label="未完任务" width="110" />
        <el-table-column prop="urgent_count" label="紧急" width="90" />
        <el-table-column prop="submitted_count" label="待复核" width="100" />
      </el-table>
    </div>

    <div class="workload">
      <div class="workload__title">任务包状态</div>
      <el-table :data="packageRows" size="small" border>
        <el-table-column prop="package_title" label="任务包" min-width="180" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="packageStatusTag(row.status)">
              {{ packageStatusText[row.status] || row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="task_count" label="任务" width="80" />
        <el-table-column prop="completed_count" label="完成" width="80" />
        <el-table-column prop="open_count" label="未完" width="80" />
        <el-table-column prop="overdue_count" label="超时" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.overdue_count" type="danger" effect="plain">
              {{ row.overdue_count }}
            </el-tag>
            <span v-else>0</span>
          </template>
        </el-table-column>
        <el-table-column prop="exception_count" label="异常" width="80">
          <template #default="{ row }">
            <el-tag v-if="row.exception_count" type="danger" effect="dark">
              {{ row.exception_count }}
            </el-tag>
            <span v-else>0</span>
          </template>
        </el-table-column>
        <el-table-column prop="due_date" label="截止" width="120" />
      </el-table>
    </div>

    <el-table :data="rows" border @selection-change="handleSelectionChange">
      <el-table-column type="selection" width="44" />
      <el-table-column prop="work_order_no" label="任务号" width="160" />
      <el-table-column label="类型" width="100">
        <template #default="{ row }">{{
          typeText[row.work_order_type] || row.work_order_type
        }}</template>
      </el-table-column>
      <el-table-column label="状态" width="150">
        <template #default="{ row }">
          <el-tag
            :type="hasTaskException(row) ? 'danger' : 'info'"
            effect="plain"
          >
            {{ taskStatusText[row.status] || row.status }}
          </el-tag>
          <el-tag
            v-if="isTaskOverdue(row)"
            type="danger"
            effect="dark"
            class="task-flag"
          >
            超时
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="package_id" label="任务包" width="90" />
      <el-table-column label="优先级" width="100">
        <template #default="{ row }">
          <el-tag :type="priorityTag(row.priority)">{{ row.priority }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="执行人" width="180">
        <template #default="{ row }">
          {{ workerText(row.assignee_userid) }}
        </template>
      </el-table-column>
      <el-table-column
        prop="required_photo_count"
        label="照片要求"
        width="100"
      />
      <el-table-column prop="scheduled_date" label="计划日期" width="120" />
      <el-table-column
        prop="remark"
        label="说明"
        min-width="260"
        show-overflow-tooltip
      />
      <el-table-column label="操作" width="310" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openAssign(row)"
            >派工</el-button
          >
          <el-button link type="primary" @click="openEvidence(row)"
            >证据</el-button
          >
          <el-button
            link
            type="primary"
            :loading="actionId === row.id"
            @click="startTask(row)"
            >开始</el-button
          >
          <el-button
            link
            type="success"
            :disabled="
              row.status !== 'submitted' && row.status !== 'in_progress'
            "
            @click="reviewTask(row, 'approve')"
            >完成</el-button
          >
          <el-button
            link
            type="danger"
            :disabled="row.status !== 'submitted'"
            @click="reviewTask(row, 'reject')"
            >退回</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="assignVisible" title="任务派工" width="420px">
      <el-form label-width="90px">
        <el-form-item label="执行人">
          <el-select
            v-model="assignForm.assignee_userid"
            filterable
            clearable
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
        <el-form-item label="计划日期">
          <el-date-picker
            v-model="assignForm.scheduled_date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="操作手册">
          <el-select
            v-model="assignForm.manual_version_id"
            filterable
            clearable
            style="width: 100%"
          >
            <el-option
              v-for="item in manuals"
              :key="item.id"
              :label="`${item.manual_title} v${item.latest_version_no || '-'}`"
              :value="
                item.active_version_id || item.latest_version_no || undefined
              "
              :disabled="!item.active_version_id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assignVisible = false">取消</el-button>
        <el-button type="primary" @click="submitAssign">确认派工</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="packageVisible" title="新建任务包" width="460px">
      <el-form label-width="90px">
        <el-form-item label="任务包名">
          <el-input
            v-model="packageForm.package_title"
            placeholder="如：返库检查一组"
          />
        </el-form-item>
        <el-form-item label="执行人">
          <el-select
            v-model="packageForm.assignee_userid"
            filterable
            clearable
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
        <el-form-item label="截止日期">
          <el-date-picker
            v-model="packageForm.due_date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="优先级">
          <el-select v-model="packageForm.priority" style="width: 100%">
            <el-option label="普通" value="normal" />
            <el-option label="高" value="high" />
            <el-option label="紧急" value="urgent" />
            <el-option label="低" value="low" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="packageForm.remark" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="packageVisible = false">取消</el-button>
        <el-button type="primary" @click="submitPackage">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="batchVisible" title="批量加入任务包" width="460px">
      <el-alert
        :title="`已选择 ${selectedRows.length} 个任务`"
        type="info"
        show-icon
        :closable="false"
      />
      <el-form label-width="90px" class="dialog-form">
        <el-form-item label="任务包">
          <el-select
            v-model="batchForm.package_id"
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="item in packageRows"
              :key="item.id"
              :label="`${item.package_title} (${item.package_no})`"
              :value="item.id"
              :disabled="item.status === 'completed'"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="执行人">
          <el-select
            v-model="batchForm.assignee_userid"
            filterable
            clearable
            placeholder="为空则沿用任务包执行人"
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
        <el-form-item label="计划日期">
          <el-date-picker
            v-model="batchForm.scheduled_date"
            value-format="YYYY-MM-DD"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="操作手册">
          <el-select
            v-model="batchForm.manual_version_id"
            filterable
            clearable
            style="width: 100%"
          >
            <el-option
              v-for="item in manuals"
              :key="item.id"
              :label="`${item.manual_title} v${item.latest_version_no || '-'}`"
              :value="
                item.active_version_id || item.latest_version_no || undefined
              "
              :disabled="!item.active_version_id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchVisible = false">取消</el-button>
        <el-button type="primary" @click="submitBatchAssign"
          >确认更新</el-button
        >
      </template>
    </el-dialog>

    <el-dialog
      v-model="evidenceVisible"
      :title="`任务证据：${activeTaskNo}`"
      width="760px"
    >
      <el-table v-loading="evidenceLoading" :data="evidenceRows" border>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            {{ evidenceTypeText[row.evidence_type] || row.evidence_type }}
          </template>
        </el-table-column>
        <el-table-column
          prop="file_name"
          label="文件名"
          min-width="140"
          show-overflow-tooltip
        />
        <el-table-column
          prop="file_key"
          label="文件Key"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column
          prop="summary"
          label="说明"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column prop="operator_userid" label="提交人" width="120" />
      </el-table>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.page {
  background: #fffaf2;
}

.page__head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.page__title {
  font-size: 20px;
  font-weight: 700;
  color: #2a241d;
}

.page__sub {
  margin-top: 4px;
  color: #6e6458;
}

.page__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.workload {
  margin-bottom: 14px;
}

.workload__title {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #2a241d;
}

.dialog-form {
  margin-top: 16px;
}

.task-flag {
  margin-left: 6px;
}
</style>
