<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { getAssetProjectView } from "@/api/asset";
import { listProjects, type Project } from "@/api/project";

defineOptions({ name: "ProjectEquipmentView" });

const loading = ref(false);
const projects = ref<Project[]>([]);
const projectId = ref<number | undefined>(undefined);
const trackedAssets = ref<Array<Record<string, unknown>>>([]);
const consumptions = ref<Array<Record<string, unknown>>>([]);
const rentalAlert = ref({ active_count: 0, overdue_count: 0 });

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 500 });
  projects.value = result.data;
  if (!projectId.value && projects.value.length > 0) {
    projectId.value = projects.value[0].id;
  }
};

const loadData = async () => {
  if (!projectId.value) return;
  loading.value = true;
  try {
    const result = await getAssetProjectView(projectId.value);
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

onMounted(async () => {
  await loadProjects();
  await loadData();
});
</script>

<template>
  <div v-loading="loading">
    <el-card shadow="never" style="margin-bottom: 16px; background: #fffaf2">
      <el-form inline>
        <el-form-item label="项目">
          <el-select v-model="projectId" filterable style="width: 300px">
            <el-option
              v-for="item in projects"
              :key="item.id"
              :label="item.project_name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-button type="primary" @click="loadData">查询</el-button>
      </el-form>
      <div v-if="projectId" style="margin-top: 8px; color: #6e6458">
        当前项目：{{ projectMap[projectId] || projectId }}
      </div>
      <el-alert
        v-if="rentalAlert.active_count > 0"
        style="margin-top: 8px"
        :type="rentalAlert.overdue_count > 0 ? 'error' : 'info'"
        :title="
          rentalAlert.overdue_count > 0
            ? `存在 ${rentalAlert.overdue_count} 台逾期租赁设备（共 ${rentalAlert.active_count} 台租赁设备）`
            : `当前有 ${rentalAlert.active_count} 台租赁设备`
        "
        show-icon
      />
    </el-card>

    <el-row :gutter="16">
      <el-col :md="14" :xs="24">
        <el-card
          shadow="never"
          header="项目设备列表"
          style="background: #fffaf2"
        >
          <el-table :data="trackedAssets">
            <el-table-column prop="asset_code" label="资产编码" width="160" />
            <el-table-column
              prop="asset_name"
              label="资产名称"
              min-width="140"
            />
            <el-table-column prop="status" label="状态" width="100" />
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
          </el-table>
        </el-card>
      </el-col>
      <el-col :md="10" :xs="24">
        <el-card shadow="never" header="物资消耗" style="background: #fffaf2">
          <el-table :data="consumptions">
            <el-table-column prop="type_name" label="类型" min-width="120" />
            <el-table-column prop="total_qty" label="总消耗" width="110" />
          </el-table>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>
