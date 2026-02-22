<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { getAssetProjectView } from "@/api/asset";

const props = defineProps<{ projectId: number }>();

const loading = ref(false);
const trackedAssets = ref<Array<Record<string, unknown>>>([]);
const consumptions = ref<Array<Record<string, unknown>>>([]);
const assetDetailDrawerVisible = ref(false);
const currentAsset = ref<Record<string, unknown> | null>(null);

const openAssetDetail = (row: Record<string, unknown>) => {
  currentAsset.value = row;
  assetDetailDrawerVisible.value = true;
};

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
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="scope">
                <el-button link type="primary" @click="openAssetDetail(scope.row)">
                  详情
                </el-button>
              </template>
            </el-table-column>
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

    <el-drawer
      v-model="assetDetailDrawerVisible"
      title="设备详情"
      size="520px"
      destroy-on-close
    >
      <el-descriptions :column="1" border>
        <el-descriptions-item label="资产编码">
          {{ currentAsset?.asset_code || "-" }}
        </el-descriptions-item>
        <el-descriptions-item label="资产名称">
          {{ currentAsset?.asset_name || "-" }}
        </el-descriptions-item>
        <el-descriptions-item label="状态">
          {{ currentAsset?.status || "-" }}
        </el-descriptions-item>
        <el-descriptions-item label="当前位置">
          {{ currentAsset?.current_location || "-" }}
        </el-descriptions-item>
        <el-descriptions-item label="最近更新时间">
          {{ currentAsset?.updated_at || "-" }}
        </el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>
