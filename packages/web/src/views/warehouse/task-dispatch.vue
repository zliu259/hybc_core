<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  assignWarehouseAssetWorkOrder,
  listWarehouseTaskEvidence,
  listWarehouseAssetWorkOrders,
  reviewWarehouseAssetWorkOrder,
  startWarehouseAssetWorkOrder,
  type WarehouseAssetWorkOrder,
  type WarehouseTaskEvidence
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
const assignVisible = ref(false);
const evidenceVisible = ref(false);
const evidenceRows = ref<WarehouseTaskEvidence[]>([]);
const evidenceLoading = ref(false);
const activeTaskNo = ref("");
const manuals = ref<WarehouseManual[]>([]);
const assignForm = ref({
  id: 0,
  assignee_userid: "",
  scheduled_date: "",
  manual_version_id: undefined as number | undefined
});
const filters = ref<{
  status?: WarehouseAssetWorkOrder["status"];
  source?: WarehouseAssetWorkOrder["source"];
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
    const result = await listWarehouseAssetWorkOrders(filters.value);
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
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
  const [manualRes] = await Promise.all([
    listWarehouseManuals({ status: "active" }),
    loadWecomUsers(),
    loadData()
  ]);
  manuals.value = manualRes.data;
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
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="rows" border>
      <el-table-column prop="work_order_no" label="任务号" width="160" />
      <el-table-column label="类型" width="100">
        <template #default="{ row }">{{
          typeText[row.work_order_type] || row.work_order_type
        }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态" width="130" />
      <el-table-column label="优先级" width="100">
        <template #default="{ row }">
          <el-tag :type="priorityTag(row.priority)">{{ row.priority }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="assignee_userid" label="执行人" width="140" />
      <el-table-column
        prop="required_photo_count"
        label="照片要求"
        width="100"
      />
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
</style>
