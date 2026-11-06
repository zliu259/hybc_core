<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { listContracts, type Contract } from "@/api/contract";
import AmountChangeDrawer from "./components/AmountChangeDrawer.vue";

defineOptions({ name: "ContractMonitor" });

const loading = ref(false);
const rows = ref<Contract[]>([]);
const filters = ref({ keyword: "", status: "" });

const drawerVisible = ref(false);
const activeRow = ref<Contract | null>(null);

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const statusMap: Record<string, { label: string; type: TagType }> = {
  draft: { label: "草稿", type: "info" },
  pending_approval: { label: "审批中", type: "warning" },
  active: { label: "生效", type: "success" },
  completed: { label: "已完成", type: "primary" }
};

const progressColor = (ratio: number) => {
  if (ratio >= 100) return "#3f9c5c";
  if (ratio > 95) return "#bd3f3f";
  if (ratio >= 80) return "#c4872b";
  return "#2d5f9a";
};

const paidRatio = (row: Contract) => {
  if (!row.total_amount || row.total_amount <= 0) return 0;
  return Number(((row.paid_amount / row.total_amount) * 100).toFixed(2));
};

const riskTag = (ratio: number): { type: TagType; label: string } => {
  if (ratio >= 100) return { type: "success", label: "合同执行完成" };
  if (ratio > 95) return { type: "danger", label: "超高风险" };
  if (ratio >= 80) return { type: "warning", label: "阈值预警" };
  return { type: "success", label: "正常" };
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listContracts({
      direction: "outbound",
      page: 1,
      pageSize: 200,
      keyword: filters.value.keyword || undefined,
      status: filters.value.status || undefined
    });
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openAmountDrawer = (row: Contract) => {
  activeRow.value = row;
  drawerVisible.value = true;
};

const tableRows = computed(() => rows.value);

const tableRowClassName = ({ row }: { row: Contract }) => {
  const ratio = paidRatio(row);
  return ratio > 90 && ratio < 100 ? "danger-row" : "";
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" class="contract-monitor">
    <template #header>
      <div class="head">
        <div>
          <div class="head__title">合同执行与监控大屏</div>
          <div class="head__sub">重点监控付款进度接近阈值的合同</div>
        </div>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="合同号/对方单位"
        />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 160px">
          <el-option label="草稿" value="draft" />
          <el-option label="审批中" value="pending_approval" />
          <el-option label="生效" value="active" />
          <el-option label="已完成" value="completed" />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table
      :data="tableRows"
      :loading="loading"
      :row-class-name="tableRowClassName"
      style="margin-top: 14px"
      stripe
      size="small"
    >
      <el-table-column prop="contract_no" label="合同号" width="170" />
      <el-table-column prop="counterparty" label="对方单位" min-width="180" />
      <el-table-column prop="total_amount" label="合同总额" width="140" />
      <el-table-column prop="paid_amount" label="已打款" width="120" />
      <el-table-column label="打款进度" min-width="260">
        <template #default="{ row }">
          <el-progress
            :percentage="paidRatio(row)"
            :stroke-width="16"
            :color="progressColor(paidRatio(row))"
          />
        </template>
      </el-table-column>
      <el-table-column label="风险等级" width="120">
        <template #default="{ row }">
          <el-tag :type="riskTag(paidRatio(row)).type">
            {{ riskTag(paidRatio(row)).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag :type="statusMap[row.status]?.type || 'info'">
            {{ statusMap[row.status]?.label || row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openAmountDrawer(row)"
            >变更金额</el-button
          >
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <AmountChangeDrawer
    v-model:visible="drawerVisible"
    :contract="activeRow"
    note="合同金额变更发起自合同执行监控大屏"
    @changed="loadData"
  />
</template>

<style scoped>
.contract-monitor {
  background: #fffaf2;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.head__title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.head__sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}

:deep(.danger-row > td) {
  background: #fff1f1 !important;
}
</style>
