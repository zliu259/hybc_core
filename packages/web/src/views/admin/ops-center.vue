<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { getOpsStatusCenter, type OpsServiceHealth } from "@/api/system";

defineOptions({ name: "AdminOpsCenter" });

const loading = ref(false);
const checkedAt = ref("");
const services = ref<OpsServiceHealth[]>([]);
const runnerOnline = ref(0);
const runnerSampled = ref(0);
const latestNodes = ref<
  Array<{
    node_id: string;
    node_name: string;
    status: string;
    last_heartbeat_at: string | null;
  }>
>([]);

let timer: ReturnType<typeof setInterval> | null = null;

const upCount = computed(
  () => services.value.filter(item => item.status === "up").length
);
const downCount = computed(
  () => services.value.filter(item => item.status === "down").length
);

const relativeTime = (iso: string | null): string => {
  if (!iso) {
    return "-";
  }
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
};

const refresh = async () => {
  loading.value = true;
  try {
    const result = await getOpsStatusCenter();
    checkedAt.value = result.data.checked_at;
    services.value = result.data.services;
    runnerOnline.value = result.data.runner_nodes.online_recent_count;
    runnerSampled.value = result.data.runner_nodes.sampled_total;
    latestNodes.value = result.data.runner_nodes.latest;
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  refresh();
  timer = setInterval(refresh, 30000);
});

onUnmounted(() => {
  if (timer) {
    clearInterval(timer);
  }
});
</script>

<template>
  <el-card shadow="never" style="margin-bottom: 16px">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>Service Monitoring Center</span>
        <el-button type="primary" :loading="loading" @click="refresh"
          >Refresh</el-button
        >
      </div>
    </template>

    <el-row :gutter="16">
      <el-col :span="8">
        <el-statistic title="Services Up" :value="upCount" />
      </el-col>
      <el-col :span="8">
        <el-statistic title="Services Down" :value="downCount" />
      </el-col>
      <el-col :span="8">
        <el-statistic
          title="Runner Nodes (online/sample)"
          :value="runnerOnline"
        >
          <template #suffix>/ {{ runnerSampled }}</template>
        </el-statistic>
      </el-col>
    </el-row>

    <div style="margin-top: 12px; color: var(--el-text-color-secondary)">
      Last check: {{ checkedAt || "-" }}
    </div>
  </el-card>

  <el-card shadow="never" header="Service Status" style="margin-bottom: 16px">
    <el-table v-loading="loading" :data="services" style="width: 100%">
      <el-table-column prop="key" label="Service" min-width="180" />
      <el-table-column label="Status" width="120">
        <template #default="{ row }">
          <el-tag
            :type="row.status === 'up' ? 'success' : 'danger'"
            size="small"
          >
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="latency_ms" label="Latency(ms)" width="120" />
      <el-table-column
        prop="detail"
        label="Detail"
        min-width="280"
        show-overflow-tooltip
      />
      <el-table-column prop="checked_at" label="Checked At" width="220" />
    </el-table>
  </el-card>

  <el-card shadow="never" header="Latest Runner Nodes">
    <el-table v-loading="loading" :data="latestNodes" style="width: 100%">
      <el-table-column
        prop="node_id"
        label="Node ID"
        min-width="200"
        show-overflow-tooltip
      />
      <el-table-column prop="node_name" label="Name" width="180" />
      <el-table-column label="Status" width="120">
        <template #default="{ row }">
          <el-tag
            :type="row.status === 'online' ? 'success' : 'danger'"
            size="small"
          >
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="Last Heartbeat" width="180">
        <template #default="{ row }">
          {{ relativeTime(row.last_heartbeat_at) }}
        </template>
      </el-table-column>
      <el-table-column
        prop="last_heartbeat_at"
        label="Heartbeat Time"
        width="220"
      />
    </el-table>
  </el-card>
</template>
