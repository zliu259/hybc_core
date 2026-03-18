<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  listComputeNodes,
  listTaskQueue,
  type ComputeNode,
  type TaskQueueItem
} from "@/api/task";
import {
  listRunnerRuntimeConfig,
  upsertRunnerRuntimeConfig,
  createAiRuntimeTestTask,
  activateRunnerNode,
  type AiRuntimeTestTaskResult
} from "@/api/admin";

defineOptions({ name: "ComputeNodes" });

const nodesLoading = ref(false);
const nodes = ref<ComputeNode[]>([]);
const queueLoading = ref(false);
const queue = ref<TaskQueueItem[]>([]);
const queuePage = ref(1);
const queuePageSize = ref(20);
const queueTotal = ref(0);
const queueFilters = ref({ status: "", task_type: "" });

const runtimeLoading = ref(false);
const runtimeSaving = ref(false);
const runtimeForm = ref({
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "gpt-5.2",
  OPENAI_BASE_URL: "https://api.openai.com/v1",
  OPENAI_MODEL_CONTRACT_REVIEW_TEXT: "gpt-5.2",
  OPENAI_MODEL_CONTRACT_REVIEW_VISION: "gpt-4o",
  ANTHROPIC_API_KEY: "",
  ANTHROPIC_MODEL: "claude-sonnet-4-20250514",
  MOCK_AI_ONLY: "false"
});

const testTaskType = ref("contract_review");
const testCreating = ref(false);
const lastCreatedTestTask = ref<AiRuntimeTestTaskResult | null>(null);
const activatingNodeId = ref("");

let refreshTimer: ReturnType<typeof setInterval> | null = null;

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const nodeStatusType: Record<string, TagType> = {
  online: "success",
  offline: "danger",
  draining: "warning"
};

const taskStatusOptions = [
  "pending",
  "assigned",
  "running",
  "completed",
  "failed",
  "timeout"
];
const taskTypeOptions = [
  "contract_review",
  "payment_risk_assessment",
  "risk_assessment",
  "reimbursement_check",
  "reimbursement_anomaly",
  "log_smart_fill",
  "log_analysis",
  "log_summary",
  "equipment_recommend",
  "consumable_estimation",
  "inventory_alert_analysis",
  "consumption_anomaly",
  "ocr_extract",
  "file_generate",
  "voice_stt",
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
    const end = row.completed_at
      ? new Date(row.completed_at).getTime()
      : Date.now();
    const seconds = Math.floor(
      (end - new Date(row.started_at).getTime()) / 1000
    );
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

const loadRuntimeConfig = async () => {
  runtimeLoading.value = true;
  try {
    const result = await listRunnerRuntimeConfig();
    const map = new Map(
      result.data.map(item => [item.config_key, item.config_value])
    );
    runtimeForm.value = {
      OPENAI_API_KEY: map.get("OPENAI_API_KEY") ?? "",
      OPENAI_MODEL: map.get("OPENAI_MODEL") ?? "gpt-5.2",
      OPENAI_BASE_URL:
        map.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1",
      OPENAI_MODEL_CONTRACT_REVIEW_TEXT:
        map.get("OPENAI_MODEL_CONTRACT_REVIEW_TEXT") ?? "gpt-5.2",
      OPENAI_MODEL_CONTRACT_REVIEW_VISION:
        map.get("OPENAI_MODEL_CONTRACT_REVIEW_VISION") ?? "gpt-4o",
      ANTHROPIC_API_KEY: map.get("ANTHROPIC_API_KEY") ?? "",
      ANTHROPIC_MODEL: map.get("ANTHROPIC_MODEL") ?? "claude-sonnet-4-20250514",
      MOCK_AI_ONLY: map.get("MOCK_AI_ONLY") ?? "false"
    };
  } finally {
    runtimeLoading.value = false;
  }
};

const saveRuntimeConfig = async () => {
  runtimeSaving.value = true;
  try {
    await upsertRunnerRuntimeConfig([
      {
        config_key: "OPENAI_API_KEY",
        config_value: runtimeForm.value.OPENAI_API_KEY,
        is_secret: true
      },
      {
        config_key: "OPENAI_MODEL",
        config_value: runtimeForm.value.OPENAI_MODEL
      },
      {
        config_key: "OPENAI_BASE_URL",
        config_value: runtimeForm.value.OPENAI_BASE_URL
      },
      {
        config_key: "OPENAI_MODEL_CONTRACT_REVIEW_TEXT",
        config_value: runtimeForm.value.OPENAI_MODEL_CONTRACT_REVIEW_TEXT
      },
      {
        config_key: "OPENAI_MODEL_CONTRACT_REVIEW_VISION",
        config_value: runtimeForm.value.OPENAI_MODEL_CONTRACT_REVIEW_VISION
      },
      {
        config_key: "ANTHROPIC_API_KEY",
        config_value: runtimeForm.value.ANTHROPIC_API_KEY,
        is_secret: true
      },
      {
        config_key: "ANTHROPIC_MODEL",
        config_value: runtimeForm.value.ANTHROPIC_MODEL
      },
      {
        config_key: "MOCK_AI_ONLY",
        config_value: runtimeForm.value.MOCK_AI_ONLY
      }
    ]);
    message("Runner运行参数已保存", { type: "success" });
  } catch {
    message("保存失败", { type: "error" });
  } finally {
    runtimeSaving.value = false;
  }
};

const createTestTask = async () => {
  testCreating.value = true;
  try {
    const result = await createAiRuntimeTestTask({
      task_type: testTaskType.value,
      biz_type: "ai_runtime_ui_test",
      priority: 9
    });
    lastCreatedTestTask.value = result.data;
    message(`测试任务已创建：${result.data.task_code}`, { type: "success" });
    queuePage.value = 1;
    await loadQueue();
  } catch {
    message("创建测试任务失败", { type: "error" });
  } finally {
    testCreating.value = false;
  }
};

const activateNode = async (node: ComputeNode) => {
  activatingNodeId.value = node.node_id;
  try {
    await activateRunnerNode(node.node_id);
    message(`已手动激活节点 ${node.node_id}`, { type: "success" });
    await loadNodes();
  } catch {
    message("手动激活失败", { type: "error" });
  } finally {
    activatingNodeId.value = "";
  }
};

onMounted(() => {
  loadNodes();
  loadQueue();
  loadRuntimeConfig();
  refreshTimer = setInterval(loadNodes, 30000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<template>
  <el-card shadow="never" header="Runner运行参数" style="margin-bottom: 16px">
    <el-form v-loading="runtimeLoading" label-width="150px">
      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="OPENAI_API_KEY">
            <el-input
              v-model="runtimeForm.OPENAI_API_KEY"
              type="password"
              show-password
              placeholder="sk-..."
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="OPENAI_MODEL">
            <el-input v-model="runtimeForm.OPENAI_MODEL" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="OPENAI_BASE_URL">
            <el-input v-model="runtimeForm.OPENAI_BASE_URL" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="OPENAI_TEXT_MODEL">
            <el-input v-model="runtimeForm.OPENAI_MODEL_CONTRACT_REVIEW_TEXT" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="OPENAI_VISION_MODEL">
            <el-input
              v-model="runtimeForm.OPENAI_MODEL_CONTRACT_REVIEW_VISION"
            />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="ANTHROPIC_API_KEY">
            <el-input
              v-model="runtimeForm.ANTHROPIC_API_KEY"
              type="password"
              show-password
            />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="ANTHROPIC_MODEL">
            <el-input v-model="runtimeForm.ANTHROPIC_MODEL" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="MOCK_AI_ONLY">
            <el-select v-model="runtimeForm.MOCK_AI_ONLY" style="width: 100%">
              <el-option label="false" value="false" />
              <el-option label="true" value="true" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item>
        <el-button
          type="primary"
          :loading="runtimeSaving"
          @click="saveRuntimeConfig"
          >保存运行参数</el-button
        >
      </el-form-item>
    </el-form>
  </el-card>

  <el-card shadow="never" header="AI运行测试" style="margin-bottom: 16px">
    <el-form inline>
      <el-form-item label="任务类型">
        <el-select v-model="testTaskType" style="width: 220px">
          <el-option
            v-for="t in taskTypeOptions"
            :key="t"
            :label="t"
            :value="t"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-button
          type="primary"
          :loading="testCreating"
          @click="createTestTask"
          >创建测试任务</el-button
        >
      </el-form-item>
    </el-form>

    <el-alert
      v-if="lastCreatedTestTask"
      type="success"
      :closable="false"
      show-icon
      style="margin-top: 8px"
      :title="`已创建任务 ${lastCreatedTestTask.task_code}（${lastCreatedTestTask.task_type}）`"
      :description="`任务ID: ${lastCreatedTestTask.task_id}，状态: ${lastCreatedTestTask.status}。可在下方任务队列中查看执行结果。`"
    />
  </el-card>

  <el-card shadow="never" header="计算节点" style="margin-bottom: 16px">
    <el-table v-loading="nodesLoading" :data="nodes" style="width: 100%">
      <el-table-column
        prop="node_id"
        label="节点ID"
        width="160"
        show-overflow-tooltip
      />
      <el-table-column prop="node_name" label="名称" width="140" />
      <el-table-column prop="node_type" label="类型" width="100" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag :type="nodeStatusType[row.status] ?? 'info'" size="small">{{
            row.status
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="能力" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{
          parseCapabilities(row.capabilities_json)
        }}</template>
      </el-table-column>
      <el-table-column prop="cpu_cores" label="CPU" width="70" />
      <el-table-column prop="memory_mb" label="内存(MB)" width="100" />
      <el-table-column label="最后心跳" width="120">
        <template #default="{ row }">{{
          relativeTime(row.last_heartbeat_at)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            :loading="activatingNodeId === row.node_id"
            :disabled="row.status === 'online'"
            @click="activateNode(row)"
          >
            手动激活
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-card shadow="never" header="任务队列">
    <el-form inline style="margin-bottom: 12px">
      <el-form-item label="状态">
        <el-select v-model="queueFilters.status" clearable placeholder="全部">
          <el-option
            v-for="s in taskStatusOptions"
            :key="s"
            :label="s"
            :value="s"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="任务类型">
        <el-select
          v-model="queueFilters.task_type"
          clearable
          placeholder="全部"
        >
          <el-option
            v-for="t in taskTypeOptions"
            :key="t"
            :label="t"
            :value="t"
          />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadQueue">查询</el-button>
    </el-form>

    <el-table v-loading="queueLoading" :data="queue" style="width: 100%">
      <el-table-column
        prop="task_code"
        label="任务编号"
        width="180"
        show-overflow-tooltip
      />
      <el-table-column prop="task_type" label="任务类型" width="150" />
      <el-table-column prop="biz_type" label="业务类型" width="130" />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tag
            :type="
              row.status === 'completed'
                ? 'success'
                : row.status === 'failed'
                  ? 'danger'
                  : row.status === 'running'
                    ? 'primary'
                    : 'info'
            "
            size="small"
            >{{ row.status }}</el-tag
          >
        </template>
      </el-table-column>
      <el-table-column
        prop="assigned_node_id"
        label="节点"
        width="140"
        show-overflow-tooltip
      />
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
      @current-change="
        (val: number) => {
          queuePage = val;
          loadQueue();
        }
      "
    />
  </el-card>
</template>
