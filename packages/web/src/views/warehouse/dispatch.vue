<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  executeStockOrder,
  listStockOrders,
  type StockOrder
} from "@/api/warehouse";

defineOptions({ name: "WarehouseDispatch" });

const loading = ref(false);
const actionLoading = ref(false);
const rows = ref<StockOrder[]>([]);

const columns = [
  { key: "inbound_pending", title: "待处理入库" },
  { key: "outbound_pending", title: "待处理出库" },
  { key: "executing", title: "调拨执行中" },
  { key: "done", title: "已完成" }
] as const;

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listStockOrders();
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const grouped = computed(() => {
  const result: Record<string, StockOrder[]> = {
    inbound_pending: [],
    outbound_pending: [],
    executing: [],
    done: []
  };

  rows.value.forEach(row => {
    if (row.status === "approved") {
      result.executing.push(row);
      return;
    }

    if (["executed", "cancelled", "rejected"].includes(row.status)) {
      result.done.push(row);
      return;
    }

    if (row.order_type === "inbound") result.inbound_pending.push(row);
    else result.outbound_pending.push(row);
  });

  return result;
});

const onDragStart = (event: DragEvent, row: StockOrder) => {
  event.dataTransfer?.setData("text/plain", String(row.id));
};

const onDrop = async (event: DragEvent, columnKey: string) => {
  event.preventDefault();
  const value = event.dataTransfer?.getData("text/plain");
  const orderId = Number(value);
  const row = rows.value.find(item => item.id === orderId);
  if (!row) return;

  if (columnKey === "done" && row.status === "approved") {
    actionLoading.value = true;
    try {
      await executeStockOrder(row.id);
      message(`单据 ${row.order_no} 已确认执行`, { type: "success" });
      await loadData();
    } finally {
      actionLoading.value = false;
    }
    return;
  }

  message("当前拖拽仅支持将已审批单据拖入“已完成”并执行", { type: "info" });
};

const onDragOver = (event: DragEvent) => {
  event.preventDefault();
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" class="dispatch" v-loading="loading || actionLoading">
    <template #header>
      <div>
        <div class="dispatch__title">出入库调度</div>
        <div class="dispatch__sub">拖拽已审批单据到“已完成”即执行确认</div>
      </div>
    </template>

    <div class="kanban">
      <div
        v-for="col in columns"
        :key="col.key"
        class="kanban-col"
        @drop="(e: DragEvent) => onDrop(e, col.key)"
        @dragover="onDragOver"
      >
        <div class="kanban-col__title">{{ col.title }}</div>
        <div class="kanban-col__list">
          <div
            v-for="item in grouped[col.key]"
            :key="item.id"
            class="kanban-card"
            draggable="true"
            @dragstart="(e: DragEvent) => onDragStart(e, item)"
          >
            <div class="kanban-card__no">{{ item.order_no }}</div>
            <div class="kanban-card__meta">类型：{{ item.order_type }}</div>
            <div class="kanban-card__meta">状态：{{ item.status }}</div>
            <div class="kanban-card__meta">项目：{{ item.project_id || "-" }}</div>
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

.kanban {
  display: grid;
  grid-template-columns: repeat(4, minmax(220px, 1fr));
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
  cursor: grab;
}

.kanban-card__no {
  font-weight: 600;
  color: #2a241d;
}

.kanban-card__meta {
  margin-top: 4px;
  font-size: 12px;
  color: #6e6458;
}

@media (max-width: 1200px) {
  .kanban {
    grid-template-columns: repeat(2, minmax(240px, 1fr));
  }
}

@media (max-width: 768px) {
  .kanban {
    grid-template-columns: 1fr;
  }
}
</style>
