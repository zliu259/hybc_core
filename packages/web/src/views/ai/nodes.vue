<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import {
  listComputeNodes,
  listTaskQueue,
  type ComputeNode,
  type TaskQueueItem
} from "@/api/task";

defineOptions({ name: "ComputeNodes" });

const nodesLoading = ref(false);
const nodes = ref<ComputeNode[]>([]);
const queueLoading = ref(false);
const queue = ref<TaskQueueItem[]>([]);
const queuePage = ref(1);
const queuePageSize = ref(20);
const queueTotal = ref(0);
const queueFilters = ref({ status: "", task_type: "" });

let refreshTimer: ReturnType<typeof setInterval> | null = null;

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const nodeStatusType: Record<string, TagType> = {
  online: "success",
  offline: "danger",
  draining: "warning"
};

const taskStatusOptions = ["pending", "assigned", "running", "completed", "failed", "timeout"];
const taskTypeOptions = [
  "contract_review",
  "risk_assessment",
  "reimbursement_check",
  "log_analysis",
  "equipment_recommend",
  "ocr_extract",
  "file_generate",
  "approval_ai_gate"
];

const relativeTime = (isoStr: string | null) => {
  if (!isoStr) return "—";
  const diff = Date.now() - new Date(isoStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  return `${Math.floor(hours / 24)}天前`;
};

const parseCapabilities = (json: string | null): string => {
  if (!json) return "—";
  try {
    const arr = JSON.parse(json) as string[];
    return arr.join(", ");
  } catch {
    return json;
  }
};

const taskDuration = computed(() => {
  return (row: TaskQueueItem) => {
    if (!row.started_at) return "—";
    const end = row.completed_at ? new Date(row.completed_at).getTime() : Date.now();
    const seconds = Math.floor((end - new Date(row.started_at).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };
});

const loadNodes = async () => {
  nodesLoading.value = true;
  try {
    const result = await listComputeNodes();
    nodes.value = result.data;
  } finally {
    nodesLoading.value = false;
  }
};

const loadQueue = async () => {
  queueLoading.value = true;
  try {
    const result = await listTaskQueue({
      status: queueFilters.value.status || undefined,
      task_type: queueFilters.value.task_type || undefined,
      page: queuePage.value,
      pageSize: queuePageSize.value
    });
    queue.value = result.data;
    queueTotal.value = result.pagination.total;
  } finally {
    queueLoading.value = false;
  }
};

onMounted(() => {
  loadNodes();
  loadQueue();
  refreshTimer = setInterval(loadNodes, 30000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <el-card shadow="never" header="计算节点" style="margin-bottom: 16px">
    <el-table :data="nodes" v-loading="nodesLoading" style="width: 100%">
      <el-table-column prop="node_id" label="节点ID" width="160" show-overflow-tooltip />
      <el-table-column prop="node_name" label="名称" width="140" />
      <el-table-column prop="node_type" label="类型" width="100" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="nodeStatusType[row.status] ?? 'info'" size="small">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="能力" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ parseCapabilities(row.capabilities_json) }}</template>
      </el-table-column>
      <el-table-column prop="cpu_cores" label="CPU" width="70" />
      <el-table-column prop="memory_mb" label="内存(MB)" width="100" />
      <el-table-column label="最后心跳" width="120">
        <template #default="{ row }">{{ relativeTime(row.last_heartbeat_at) }}</template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-card shadow="never" header="任务队列">
    <el-form inline style="margin-bottom: 12px">
      <el-form-item label="状态">
        <el-select v-model="queueFilters.status" clearable placeholder="全部">
          <el-option v-for="s in taskStatusOptions" :key="s" :label="s" :value="s" />
        </el-select>
      </el-form-item>
      <el-form-item label="任务类型">
        <el-select v-model="queueFilters.task_type" clearable placeholder="全部">
          <el-option v-for="t in taskTypeOptions" :key="t" :label="t" :value="t" />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadQueue">查询</el-button>
    </el-form>

    <el-table :data="queue" v-loading="queueLoading" style="width: 100%">
      <el-table-column prop="task_code" label="任务编号" width="180" show-overflow-tooltip />
      <el-table-column prop="task_type" label="任务类型" width="150" />
      <el-table-column prop="biz_type" label="业务类型" width="130" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag
            :type="row.status === 'completed' ? 'success' : row.status === 'failed' ? 'danger' : row.status === 'running' ? 'primary' : 'info'"
            size="small"
          >{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="assigned_node_id" label="节点" width="140" show-overflow-tooltip />
      <el-table-column prop="priority" label="优先级" width="70" />
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column label="耗时" width="90">
        <template #default="{ row }">{{ taskDuration(row) }}</template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      background
      layout="prev, pager, next, total"
      :current-page="queuePage"
      :page-size="queuePageSize"
      :total="queueTotal"
      @current-change="(val: number) => { queuePage = val; loadQueue(); }"
    />
  </el-card>
</template>
