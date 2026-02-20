<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { getAssetProjectView } from "@/api/asset";

const props = defineProps<{ projectId: number }>();

const loading = ref(false);
const trackedAssets = ref<Array<Record<string, unknown>>>([]);
const consumptions = ref<Array<Record<string, unknown>>>([]);

const loadData = async () => {
  if (!props.projectId) return;
  loading.value = true;
  try {
    const result = await getAssetProjectView(props.projectId);
    trackedAssets.value =
      (result.data.tracked_assets as Array<Record<string, unknown>>) ?? [];
    consumptions.value =
      (result.data.consumptions as Array<Record<string, unknown>>) ?? [];
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
  <div v-loading="loading">
    <el-row :gutter="16">
      <el-col :md="14" :xs="24">
        <el-card shadow="never" header="项目设备列表">
          <el-table :data="trackedAssets">
            <el-table-column prop="asset_code" label="资产编码" width="160" />
            <el-table-column
              prop="asset_name"
              label="资产名称"
              min-width="140"
            />
            <el-table-column prop="status" label="状态" width="100" />
            <el-table-column
              prop="current_location"
              label="位置"
              min-width="120"
            />
          </el-table>
        </el-card>
      </el-col>
      <el-col :md="10" :xs="24">
        <el-card shadow="never" header="物资消耗">
          <el-table :data="consumptions">
            <el-table-column prop="type_name" label="类型" min-width="120" />
            <el-table-column prop="total_qty" label="总消耗" width="110" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
