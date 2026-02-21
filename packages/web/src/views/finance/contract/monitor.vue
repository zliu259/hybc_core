<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  listContracts,
  createAmountChange,
  submitAmountChangeApproval,
  type Contract
} from "@/api/contract";

defineOptions({ name: "ContractMonitor" });

const loading = ref(false);
const rows = ref<Contract[]>([]);
const filters = ref({ keyword: "", status: "" });

const drawerVisible = ref(false);
const submitting = ref(false);
const activeRow = ref<Contract | null>(null);
const amountForm = ref({ new_amount: 0, reason: "" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const statusMap: Record<string, { label: string; type: TagType }> = {
  draft: { label: "草稿", type: "info" },
  active: { label: "执行中", type: "success" },
  completed: { label: "已完成", type: "primary" }
};

const progressColor = (ratio: number) => {
  if (ratio > 95) return "#bd3f3f";
  if (ratio >= 80) return "#c4872b";
  return "#2d5f9a";
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
  amountForm.value = {
    new_amount: Number(row.total_amount),
    reason: ""
  };
  drawerVisible.value = true;
};

const submitAmountChange = async () => {
  if (!activeRow.value || !amountForm.value.reason.trim()) {
    message("请填写变更原因", { type: "warning" });
    return;
  }

  submitting.value = true;
  try {
    const change = await createAmountChange(activeRow.value.id, {
      change_type: "adjust",
      new_amount: amountForm.value.new_amount,
      reason: amountForm.value.reason.trim()
    });

    await submitAmountChangeApproval(activeRow.value.id, change.data.id, {
      instance_config: {
        note: "合同金额变更发起自合同执行监控大屏"
      }
    });

    message("已提交变更审批", { type: "success" });
    drawerVisible.value = false;
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const tableRows = computed(() => rows.value);

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
        <el-input v-model="filters.keyword" clearable placeholder="合同号/对方单位" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 160px">
          <el-option label="草稿" value="draft" />
          <el-option label="执行中" value="active" />
          <el-option label="已完成" value="completed" />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="tableRows" :loading="loading" style="margin-top: 14px" stripe>
      <el-table-column prop="contract_no" label="合同号" width="170" />
      <el-table-column prop="counterparty" label="对方单位" min-width="180" />
      <el-table-column prop="total_amount" label="合同总额" width="140" />
      <el-table-column prop="paid_amount" label="已打款" width="120" />
      <el-table-column label="打款进度" min-width="260">
        <template #default="{ row }">
          <el-progress
            :percentage="Number(((row.paid_amount / row.total_amount) * 100 || 0).toFixed(2))"
            :stroke-width="16"
            :color="progressColor((row.paid_amount / row.total_amount) * 100)"
          />
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
          <el-button link type="primary" @click="openAmountDrawer(row)">变更金额</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-drawer
    v-model="drawerVisible"
    title="发起金额变更"
    size="480px"
    destroy-on-close
  >
    <el-form label-width="110px">
      <el-form-item label="合同号">
        <el-input :model-value="activeRow?.contract_no" disabled />
      </el-form-item>
      <el-form-item label="原合同金额">
        <el-input :model-value="String(activeRow?.total_amount ?? '')" disabled />
      </el-form-item>
      <el-form-item label="新合同金额" required>
        <el-input-number
          v-model="amountForm.new_amount"
          :min="0"
          :precision="2"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="变更缘由" required>
        <el-input v-model="amountForm.reason" type="textarea" :rows="4" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="drawerVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submitAmountChange">
        提交审批
      </el-button>
    </template>
  </el-drawer>
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
</style>
