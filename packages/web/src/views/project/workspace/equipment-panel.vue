<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";

import { getProjectHoldings } from "@/api/wh/doc";
import type { ProjectHoldings } from "@/api/wh/types";
import { DEVICE_STATE_TAG } from "@/views/wh/shared/labels";
import { resolveApiErrorMessage } from "@/utils/api-error";

const props = defineProps<{ projectId: number }>();
const router = useRouter();

const loading = ref(false);
const loadError = ref("");
const holdings = ref<ProjectHoldings>({ devices: [], materials: [] });

const loadData = async () => {
  if (!props.projectId) return;
  loading.value = true;
  loadError.value = "";
  try {
    holdings.value = (await getProjectHoldings(props.projectId)).data;
  } catch (error) {
    loadError.value = resolveApiErrorMessage(error, "在场设备加载失败");
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.projectId,
  () => {
    void loadData();
  }
);

onMounted(loadData);
</script>

<template>
  <div v-loading="loading" class="equipment-panel">
    <el-alert
      v-if="loadError"
      :title="loadError"
      type="error"
      show-icon
      :closable="false"
    />
    <el-row :gutter="16">
      <el-col :md="14" :xs="24">
        <el-card shadow="never">
          <template #header><span class="sec-title">在场设备</span></template>
          <el-table
            :data="holdings.devices"
            size="small"
            empty-text="这个项目上没有设备"
          >
            <el-table-column prop="device_code" label="编号" width="110" />
            <el-table-column label="名称" min-width="160">
              <template #default="{ row }">
                <el-link
                  type="primary"
                  @click="router.push(`/wh/device/${row.id}`)"
                  >{{ row.name }}</el-link
                >
              </template>
            </el-table-column>
            <el-table-column prop="category_name" label="类别" width="100" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="DEVICE_STATE_TAG[row.state]" size="small">{{
                  row.state_label
                }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :md="10" :xs="24">
        <el-card shadow="never">
          <template #header><span class="sec-title">在场周转件</span></template>
          <el-table
            :data="holdings.materials"
            size="small"
            empty-text="这个项目名下没有周转件"
          >
            <el-table-column prop="name" label="品名" min-width="100" />
            <el-table-column prop="spec" label="规格" min-width="90" />
            <el-table-column label="数量" width="90" align="right">
              <template #default="{ row }"
                >{{ row.holding }} {{ row.unit }}</template
              >
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.sec-title {
  font-weight: 600;
}
</style>
