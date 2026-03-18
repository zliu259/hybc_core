<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { statusLabel } from "@/utils/enum-labels";
import { getAssetProjectView } from "@/api/asset";

const props = defineProps<{ projectId: number }>();

const loading = ref(false);
const trackedAssets = ref<Array<Record<string, unknown>>>([]);
const consumptions = ref<Array<Record<string, unknown>>>([]);
const rentalAlert = ref({ active_count: 0, overdue_count: 0 });
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
    rentalAlert.value =
      (
        result.data.rental_alert as {
          active_count?: number;
          overdue_count?: number;
        }
      )?.active_count !== undefined
        ? {
            active_count: Number(
              (result.data.rental_alert as { active_count?: number })
                .active_count ?? 0
            ),
            overdue_count: Number(
              (result.data.rental_alert as { overdue_count?: number })
                .overdue_count ?? 0
            )
          }
        : { active_count: 0, overdue_count: 0 };
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
    <el-alert
      v-if="rentalAlert.active_count > 0"
      style="margin-bottom: 12px"
      :type="rentalAlert.overdue_count > 0 ? 'error' : 'info'"
      :title="
        rentalAlert.overdue_count > 0
          ? `存在 ${rentalAlert.overdue_count} 台逾期租赁设备（共 ${rentalAlert.active_count} 台租赁设备）`
          : `当前有 ${rentalAlert.active_count} 台租赁设备`
      "
      show-icon
    />
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
            <el-table-column label="状态" width="100">
              <template #default="scope">{{
                statusLabel(scope.row.status)
              }}</template>
            </el-table-column>
            <el-table-column label="租赁" width="120">
              <template #default="scope">
                <el-tag
                  v-if="scope.row.rental_mode"
                  :type="
                    scope.row.rental_mode === 'lease_in' ? 'warning' : 'primary'
                  "
                  size="small"
                >
                  {{ scope.row.rental_mode === "lease_in" ? "租入" : "外租" }}
                </el-tag>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column label="到期/逾期" min-width="160">
              <template #default="scope">
                <span>
                  {{ scope.row.rental_due_date || "-" }}
                  <el-tag
                    v-if="Number(scope.row.rental_overdue_days || 0) > 0"
                    type="danger"
                    size="small"
                    style="margin-left: 6px"
                  >
                    逾期{{ scope.row.rental_overdue_days }}天
                  </el-tag>
                </span>
              </template>
            </el-table-column>
            <el-table-column
              prop="current_location"
              label="位置"
              min-width="120"
            />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="scope">
                <el-button
                  link
                  type="primary"
                  @click="openAssetDetail(scope.row)"
                >
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
          {{
            currentAsset?.status
              ? statusLabel(currentAsset.status as string)
              : "-"
          }}
        </el-descriptions-item>
        <el-descriptions-item label="当前位置">
          {{ currentAsset?.current_location || "-" }}
        </el-descriptions-item>
        <el-descriptions-item label="租赁模式">
          {{
            currentAsset?.rental_mode
              ? currentAsset?.rental_mode === "lease_in"
                ? "租入"
                : "外租"
              : "-"
          }}
        </el-descriptions-item>
        <el-descriptions-item label="到期日">
          {{ currentAsset?.rental_due_date || "-" }}
        </el-descriptions-item>
        <el-descriptions-item label="逾期天数">
          {{ currentAsset?.rental_overdue_days || 0 }}
        </el-descriptions-item>
        <el-descriptions-item label="最近更新时间">
          {{ currentAsset?.updated_at || "-" }}
        </el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>
