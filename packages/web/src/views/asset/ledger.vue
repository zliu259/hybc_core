<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { listTrackedAssets, type TrackedAsset } from "@/api/asset";

defineOptions({ name: "AssetLedgerBoard" });

const router = useRouter();
const loading = ref(false);
const keyword = ref("");
const status = ref("");
const rows = ref<TrackedAsset[]>([]);
const selected = ref<Record<number, boolean>>({});

const statusMap: Record<string, { label: string; color: string }> = {
  idle: { label: "在库", color: "#2f7a53" },
  using: { label: "出库中", color: "#2d5f9a" },
  repair: { label: "维修", color: "#c4872b" },
  scrapped: { label: "报废", color: "#bd3f3f" }
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listTrackedAssets({
      page: 1,
      pageSize: 200,
      keyword: keyword.value || undefined,
      status: status.value || undefined
    });
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const checkedIds = computed(() =>
  Object.keys(selected.value)
    .map(Number)
    .filter(id => selected.value[id])
);

const goDetail = (id: number) => {
  router.push(`/asset/detail/${id}`);
};

const handleBatchPrint = () => {
  if (!checkedIds.value.length) {
    message("请先选择资产", { type: "warning" });
    return;
  }
  message(`已加入打印队列：${checkedIds.value.length} 项`, { type: "success" });
};

const handleBatchQr = () => {
  if (!checkedIds.value.length) {
    message("请先选择资产", { type: "warning" });
    return;
  }
  message(`已生成二维码标签任务：${checkedIds.value.length} 项`, { type: "success" });
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" class="ledger" v-loading="loading">
    <template #header>
      <div class="ledger__head">
        <div>
          <div class="ledger__title">资产台账与设备管理</div>
          <div class="ledger__sub">图片卡片化展示，支持批量操作</div>
        </div>
        <div class="ledger__actions">
          <el-button @click="handleBatchPrint">打印入库单</el-button>
          <el-button type="primary" @click="handleBatchQr">批量生成二维码标签</el-button>
        </div>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="关键字">
        <el-input v-model="keyword" clearable placeholder="编码/名称/序列号" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="status" clearable style="width: 160px">
          <el-option label="在库" value="idle" />
          <el-option label="出库中" value="using" />
          <el-option label="维修" value="repair" />
          <el-option label="报废" value="scrapped" />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <div class="asset-grid">
      <div v-for="row in rows" :key="row.id" class="asset-card" @click="goDetail(row.id)">
        <div class="asset-card__check" @click.stop>
          <el-checkbox v-model="selected[row.id]" />
        </div>
        <div class="asset-card__image">🧰</div>
        <div class="asset-card__body">
          <div class="asset-card__name">{{ row.asset_name }}</div>
          <div class="asset-card__code">{{ row.asset_code }}</div>
          <div class="asset-card__status">
            <span
              class="status-dot"
              :style="{ backgroundColor: statusMap[row.status]?.color || '#6e6458' }"
            />
            {{ statusMap[row.status]?.label || row.status }}
          </div>
        </div>
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.ledger {
  background: #fffaf2;
}

.ledger__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.ledger__title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.ledger__sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}

.ledger__actions {
  display: flex;
  gap: 8px;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.asset-card {
  position: relative;
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  background: #fff;
  overflow: hidden;
  cursor: pointer;
}

.asset-card__check {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
}

.asset-card__image {
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 48px;
  background: linear-gradient(160deg, #f7efe2 0%, #f2e3ce 100%);
}

.asset-card__body {
  padding: 10px;
}

.asset-card__name {
  font-weight: 600;
  color: #2a241d;
}

.asset-card__code {
  margin-top: 4px;
  font-size: 12px;
  color: #6e6458;
}

.asset-card__status {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #2a241d;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
</style>
