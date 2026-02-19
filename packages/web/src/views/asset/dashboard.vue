<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getAssetOverview } from "@/api/asset";

defineOptions({ name: "AssetDashboard" });

const loading = ref(false);
const byType = ref<Array<Record<string, unknown>>>([]);
const byStatus = ref<Array<Record<string, unknown>>>([]);
const byLocation = ref<Array<Record<string, unknown>>>([]);

const loadData = async () => {
  loading.value = true;
  try {
    const result = await getAssetOverview();
    const data = result.data;
    byType.value = (data.by_type as Array<Record<string, unknown>>) ?? [];
    byStatus.value = (data.by_status as Array<Record<string, unknown>>) ?? [];
    byLocation.value =
      (data.by_location as Array<Record<string, unknown>>) ?? [];
  } finally {
    loading.value = false;
  }
};

onMounted(loadData);
</script>

<template>
  <div v-loading="loading">
    <el-row :gutter="16">
      <el-col :md="8" :xs="24">
        <el-card shadow="never" header="按类型统计" style="background: #fffaf2">
          <el-table :data="byType" size="small">
            <el-table-column prop="type_name" label="类型" min-width="120" />
            <el-table-column prop="cnt" label="数量" width="100" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :md="8" :xs="24">
        <el-card shadow="never" header="按状态统计" style="background: #fffaf2">
          <el-table :data="byStatus" size="small">
            <el-table-column prop="status" label="状态" min-width="120" />
            <el-table-column prop="cnt" label="数量" width="100" />
          </el-table>
        </el-card>
      </el-col>
      <el-col :md="8" :xs="24">
        <el-card shadow="never" header="按位置统计" style="background: #fffaf2">
          <el-table :data="byLocation" size="small">
            <el-table-column prop="location" label="位置" min-width="120" />
            <el-table-column prop="cnt" label="数量" width="100" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
