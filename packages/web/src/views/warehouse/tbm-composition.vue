<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  createTrackedAssetConfiguration,
  getDispatchBoard,
  listTrackedAssetConfigurations,
  type DispatchBoardItem,
  type TrackedAssetConfiguration
} from "@/api/asset";
import { createWarehouseAssetWorkOrder } from "@/api/warehouse";
import { message } from "@/utils/message";

defineOptions({ name: "WarehouseTbmComposition" });

const loading = ref(false);
const items = ref<DispatchBoardItem[]>([]);
const configurations = ref<TrackedAssetConfiguration[]>([]);
const selectedCoreId = ref<number | null>(null);
const selectedConsoleId = ref<number | null>(null);
const selectedShellId = ref<number | null>(null);
const wholeMachineCode = ref("");

const coreOptions = computed(() =>
  items.value.filter(item => {
    const text = `${item.asset_type_code || ""} ${item.asset_type_name || ""} ${item.asset_name}`;
    return text.includes("机芯") || text.toLowerCase().includes("core");
  })
);

const consoleOptions = computed(() =>
  items.value.filter(item => {
    const text = `${item.asset_type_code || ""} ${item.asset_type_name || ""} ${item.asset_name}`;
    return text.includes("操作台") || text.toLowerCase().includes("console");
  })
);

const shellOptions = computed(() =>
  items.value.filter(item => {
    const text = `${item.asset_type_code || ""} ${item.asset_type_name || ""} ${item.asset_name}`;
    return text.includes("壳") || text.toLowerCase().includes("shell");
  })
);

const blockedItems = computed(() =>
  items.value.filter(item => item.dispatch_state === "blocked")
);

const loadData = async () => {
  loading.value = true;
  try {
    const [boardRes, configRes] = await Promise.all([
      getDispatchBoard(),
      listTrackedAssetConfigurations()
    ]);
    items.value = boardRes.data.items;
    configurations.value = configRes.data;
  } finally {
    loading.value = false;
  }
};

const createModificationTask = async (assetId: number) => {
  const result = await createWarehouseAssetWorkOrder({
    work_order_type: "modification",
    tracked_asset_id: assetId,
    source: "manual",
    priority: "high",
    mobile_enabled: 1,
    required_photo_count: 3,
    remark: "顶管机组合方案调整：按所选机芯重新检查搭配、改装和照片简报。"
  });
  message(`改装任务已创建：${result.data.work_order_no}`, { type: "success" });
};

const createCompositionPlan = async () => {
  if (!selectedCoreId.value) {
    message("请选择机芯", { type: "warning" });
    return;
  }

  const result = await createTrackedAssetConfiguration({
    whole_machine_code: wholeMachineCode.value || undefined,
    shell_asset_id: selectedShellId.value,
    core_asset_id: selectedCoreId.value,
    console_asset_id: selectedConsoleId.value,
    status: "planned",
    note: "Web 顶管机组合方案台创建，后续改装动作进入库房任务队列。"
  });
  message(`组合方案已创建：${result.data.configuration_code}`, {
    type: "success"
  });
  wholeMachineCode.value = "";
  selectedShellId.value = null;
  selectedCoreId.value = null;
  selectedConsoleId.value = null;
  await loadData();
};

onMounted(loadData);
</script>

<template>
  <el-card v-loading="loading" shadow="never" class="page">
    <template #header>
      <div class="page__head">
        <div>
          <div class="page__title">顶管机组合方案台</div>
          <div class="page__sub">
            以机芯为中心查看操作台、壳体和阻塞任务，改装动作进入任务队列
          </div>
        </div>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="整机号">
        <el-input
          v-model="wholeMachineCode"
          clearable
          placeholder="可选"
          style="width: 180px"
        />
      </el-form-item>
      <el-form-item label="壳体">
        <el-select
          v-model="selectedShellId"
          clearable
          filterable
          style="width: 260px"
        >
          <el-option
            v-for="item in shellOptions"
            :key="item.id"
            :label="`${item.asset_code} · ${item.asset_name}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="机芯">
        <el-select
          v-model="selectedCoreId"
          clearable
          filterable
          style="width: 280px"
        >
          <el-option
            v-for="item in coreOptions"
            :key="item.id"
            :label="`${item.asset_code} · ${item.asset_name}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="操作台">
        <el-select
          v-model="selectedConsoleId"
          clearable
          filterable
          style="width: 260px"
        >
          <el-option
            v-for="item in consoleOptions"
            :key="item.id"
            :label="`${item.asset_code} · ${item.asset_name}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="createCompositionPlan"
        >创建组合方案</el-button
      >
    </el-form>

    <div class="layout">
      <div class="panel">
        <div class="panel__title">可搭配操作台</div>
        <el-table :data="consoleOptions" border height="360">
          <el-table-column prop="asset_code" label="编码" width="150" />
          <el-table-column prop="asset_name" label="名称" min-width="180" />
          <el-table-column prop="dispatch_state" label="调度状态" width="150" />
          <el-table-column label="动作" width="120">
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                @click="createModificationTask(row.id)"
                >改装任务</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="panel">
        <div class="panel__title">现有组合</div>
        <el-table :data="configurations" border height="360">
          <el-table-column
            prop="configuration_code"
            label="组合号"
            width="160"
          />
          <el-table-column
            prop="whole_machine_code"
            label="整机号"
            width="160"
          />
          <el-table-column prop="core_asset_id" label="机芯ID" width="100" />
          <el-table-column
            prop="console_asset_id"
            label="操作台ID"
            width="110"
          />
          <el-table-column prop="status" label="状态" width="120" />
        </el-table>
      </div>
    </div>

    <div class="panel panel--full">
      <div class="panel__title">阻塞设备</div>
      <el-table :data="blockedItems" border>
        <el-table-column prop="asset_code" label="编码" width="150" />
        <el-table-column prop="asset_name" label="名称" min-width="180" />
        <el-table-column prop="status" label="资产状态" width="120" />
        <el-table-column label="阻塞原因" min-width="260">
          <template #default="{ row }">{{ row.reasons.join("；") }}</template>
        </el-table-column>
        <el-table-column label="动作" width="120">
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              @click="createModificationTask(row.id)"
              >改装任务</el-button
            >
          </template>
        </el-table-column>
      </el-table>
    </div>
  </el-card>
</template>

<style scoped>
.page {
  background: #fffaf2;
}

.page__head {
  display: flex;
  justify-content: space-between;
}

.page__title {
  font-size: 20px;
  font-weight: 700;
  color: #2a241d;
}

.page__sub {
  margin-top: 4px;
  color: #6e6458;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 14px;
}

.panel {
  min-width: 0;
  padding: 12px;
  border: 1px solid #d9ceb9;
  border-radius: 8px;
  background: #fff;
}

.panel--full {
  margin-top: 14px;
}

.panel__title {
  margin-bottom: 10px;
  font-weight: 700;
  color: #2a241d;
}
</style>
