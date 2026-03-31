<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  getDispatchBoard,
  listAssetTypes,
  type AssetType,
  type DispatchBoardItem,
  type DispatchBoardState
} from "@/api/asset";
import { listProjects, type Project } from "@/api/project";
import { listWarehouses, type Warehouse } from "@/api/warehouse";

defineOptions({ name: "WarehouseDispatch" });

const router = useRouter();
const loading = ref(false);
const assetTypes = ref<AssetType[]>([]);
const warehouses = ref<Warehouse[]>([]);
const projects = ref<Project[]>([]);
const board = ref<{
  summary: Record<DispatchBoardState, number>;
  by_type: Array<{
    asset_type_id: number;
    type_code: string | null;
    type_name: string | null;
    count: number;
  }>;
  by_warehouse: Array<{
    warehouse_id: number;
    count: number;
  }>;
  items: DispatchBoardItem[];
} | null>(null);

const filters = ref<{
  warehouse_id?: number;
  asset_type_id?: number;
  project_id?: number;
  dispatch_state?: DispatchBoardState;
}>({});

const columns: Array<{ key: DispatchBoardState; title: string }> = [
  { key: "available_now", title: "可立即调度" },
  { key: "available_after_modification", title: "改装后可用" },
  { key: "blocked", title: "阻塞中" },
  { key: "reserved", title: "已预留" },
  { key: "in_transit", title: "运输中" },
  { key: "on_project", title: "项目占用" },
  { key: "scrapped", title: "已报废" }
];

const groupedItems = computed<Record<DispatchBoardState, DispatchBoardItem[]>>(() => {
  const initial = {
    available_now: [],
    available_after_modification: [],
    blocked: [],
    reserved: [],
    in_transit: [],
    on_project: [],
    scrapped: []
  } satisfies Record<DispatchBoardState, DispatchBoardItem[]>;

  for (const item of board.value?.items ?? []) {
    initial[item.dispatch_state].push(item);
  }
  return initial;
});

const warehouseNameMap = computed(() => {
  return Object.fromEntries(
    warehouses.value.map(item => [item.id, item.warehouse_name])
  ) as Record<number, string>;
});

const loadMeta = async () => {
  const [warehouseRes, assetTypeRes, projectRes] = await Promise.all([
    listWarehouses(),
    listAssetTypes({ tracked_flag: 1 }),
    listProjects({ page: 1, pageSize: 500 })
  ]);
  warehouses.value = warehouseRes.data;
  assetTypes.value = assetTypeRes.data;
  projects.value = projectRes.data;
};

const loadBoard = async () => {
  loading.value = true;
  try {
    const result = await getDispatchBoard(filters.value);
    board.value = result.data;
  } finally {
    loading.value = false;
  }
};

const resetFilters = async () => {
  filters.value = {};
  await loadBoard();
};

const goToAsset = (id: number) => router.push(`/warehouse-assets/device/${id}`);

onMounted(async () => {
  await loadMeta();
  await loadBoard();
});
</script>

<template>
  <el-card v-loading="loading" shadow="never" class="dispatch">
    <template #header>
      <div class="dispatch__header">
        <div>
          <div class="dispatch__title">可用资产调度台</div>
          <div class="dispatch__sub">按资产实时状态、工单阻塞、预留与改装需求聚合展示</div>
        </div>
      </div>
    </template>

    <el-form inline class="dispatch__filters">
      <el-form-item label="仓库">
        <el-select v-model="filters.warehouse_id" clearable filterable style="width: 180px">
          <el-option
            v-for="item in warehouses"
            :key="item.id"
            :label="item.warehouse_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="资产类型">
        <el-select v-model="filters.asset_type_id" clearable filterable style="width: 220px">
          <el-option
            v-for="item in assetTypes"
            :key="item.id"
            :label="`${item.type_name} (${item.type_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="项目">
        <el-select v-model="filters.project_id" clearable filterable style="width: 220px">
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="`${item.project_name} (${item.project_code})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="调度状态">
        <el-select v-model="filters.dispatch_state" clearable style="width: 180px">
          <el-option v-for="item in columns" :key="item.key" :label="item.title" :value="item.key" />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadBoard">查询</el-button>
      <el-button @click="resetFilters">重置</el-button>
    </el-form>

    <el-row :gutter="12" class="dispatch__summary">
      <el-col v-for="item in columns" :key="item.key" :lg="3" :md="6" :sm="8" :xs="12">
        <div class="summary-card">
          <div class="summary-card__title">{{ item.title }}</div>
          <div class="summary-card__value">{{ board?.summary[item.key] ?? 0 }}</div>
        </div>
      </el-col>
    </el-row>

    <div class="kanban">
      <div v-for="col in columns" :key="col.key" class="kanban-col">
        <div class="kanban-col__title">
          <span>{{ col.title }}</span>
          <el-tag type="info">{{ groupedItems[col.key].length }}</el-tag>
        </div>

        <div class="kanban-col__list">
          <div v-for="item in groupedItems[col.key]" :key="item.id" class="kanban-card">
            <div class="kanban-card__head">
              <div>
                <div class="kanban-card__no">{{ item.asset_code }}</div>
                <div class="kanban-card__name">{{ item.asset_name }}</div>
              </div>
              <el-button link type="primary" @click="goToAsset(item.id)">详情</el-button>
            </div>

            <div class="kanban-card__meta">类型：{{ item.asset_type_name || item.asset_type_code || "-" }}</div>
            <div class="kanban-card__meta">资产状态：{{ item.status }}</div>
            <div class="kanban-card__meta">
              仓库：{{ item.current_warehouse_id ? warehouseNameMap[item.current_warehouse_id] || `#${item.current_warehouse_id}` : "-" }}
            </div>
            <div class="kanban-card__meta">项目：{{ item.current_project_id || "-" }}</div>

            <div v-if="item.configurations.length" class="kanban-card__section">
              <div class="kanban-card__section-title">组合配置</div>
              <el-tag
                v-for="config in item.configurations"
                :key="config.id"
                size="small"
                class="kanban-card__tag"
              >
                {{ config.configuration_code }} / {{ config.status }}
              </el-tag>
            </div>

            <div v-if="item.blocking_work_orders.length" class="kanban-card__section">
              <div class="kanban-card__section-title">阻塞工单</div>
              <div v-for="workOrder in item.blocking_work_orders" :key="workOrder.work_order_no" class="kanban-card__reason">
                {{ workOrder.work_order_no }} · {{ workOrder.status }}
              </div>
            </div>

            <div v-if="item.reservations.length" class="kanban-card__section">
              <div class="kanban-card__section-title">预留记录</div>
              <div v-for="reservation in item.reservations" :key="reservation.order_no" class="kanban-card__reason">
                {{ reservation.order_no }} · {{ reservation.status }}
                <span v-if="reservation.requires_modification === 1"> · 需改装</span>
              </div>
            </div>

            <div v-if="item.reasons.length" class="kanban-card__section">
              <div class="kanban-card__section-title">调度原因</div>
              <div v-for="reason in item.reasons" :key="reason" class="kanban-card__reason">
                {{ reason }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.dispatch {
  background: #fffaf2;
}

.dispatch__header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.dispatch__title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.dispatch__sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}

.dispatch__filters,
.dispatch__summary {
  margin-bottom: 12px;
}

.summary-card {
  border: 1px solid #e8ddc8;
  border-radius: 10px;
  background: #fffcf7;
  padding: 12px;
  margin-bottom: 12px;
}

.summary-card__title {
  font-size: 13px;
  color: #6e6458;
}

.summary-card__value {
  margin-top: 8px;
  font-size: 24px;
  font-weight: 700;
  color: #2a241d;
}

.kanban {
  display: grid;
  grid-template-columns: repeat(7, minmax(240px, 1fr));
  gap: 10px;
  overflow-x: auto;
}

.kanban-col {
  background: #fff;
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  min-height: 420px;
  padding: 10px;
}

.kanban-col__title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #2a241d;
  margin-bottom: 10px;
}

.kanban-col__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kanban-card {
  border: 1px solid #e8ddc8;
  border-radius: 8px;
  padding: 10px;
  background: #fffcf7;
}

.kanban-card__head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.kanban-card__no {
  font-weight: 600;
  color: #2a241d;
}

.kanban-card__name {
  margin-top: 4px;
  font-size: 12px;
  color: #6e6458;
}

.kanban-card__meta,
.kanban-card__reason {
  margin-top: 4px;
  font-size: 12px;
  color: #6e6458;
}

.kanban-card__section {
  margin-top: 8px;
}

.kanban-card__section-title {
  font-size: 12px;
  font-weight: 600;
  color: #2a241d;
  margin-bottom: 4px;
}

.kanban-card__tag {
  margin-right: 6px;
  margin-bottom: 6px;
}

@media (max-width: 1200px) {
  .kanban {
    grid-template-columns: repeat(3, minmax(240px, 1fr));
  }
}

@media (max-width: 768px) {
  .kanban {
    grid-template-columns: 1fr;
  }
}
</style>
