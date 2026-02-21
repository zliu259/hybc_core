<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  getReimbursementBatch,
  listReimbursementBatches,
  markBatchPaid,
  type ReimbursementBatch,
  type ReimbursementBatchDetail
} from "@/api/reimbursement";

defineOptions({ name: "ReimbursementPayout" });

const loading = ref(false);
const actionLoading = ref(false);
const rows = ref<ReimbursementBatch[]>([]);
const selectedIds = ref<number[]>([]);
const detailsMap = ref<Record<number, ReimbursementBatchDetail>>({});

const payDialogVisible = ref(false);
const payTargetIds = ref<number[]>([]);
const payForm = ref({
  paid_at: "",
  payment_reference: "",
  payment_account: ""
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listReimbursementBatches({
      status: "approved",
      page: 1,
      pageSize: 200
    });
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openPayDialog = (ids: number[]) => {
  if (!ids.length) {
    message("请先选择要登记打款的批次", { type: "warning" });
    return;
  }
  payTargetIds.value = ids;
  payForm.value = {
    paid_at: "",
    payment_reference: "",
    payment_account: ""
  };
  payDialogVisible.value = true;
};

const submitMarkPaid = async () => {
  if (!payForm.value.paid_at || !payForm.value.payment_reference || !payForm.value.payment_account) {
    message("请补全打款信息", { type: "warning" });
    return;
  }

  actionLoading.value = true;
  try {
    await Promise.all(
      payTargetIds.value.map(id =>
        markBatchPaid(id, {
          paid_at: payForm.value.paid_at,
          payment_reference: payForm.value.payment_reference,
          payment_account: payForm.value.payment_account
        })
      )
    );
    message("打款登记成功", { type: "success" });
    payDialogVisible.value = false;
    await loadData();
  } finally {
    actionLoading.value = false;
  }
};

const onExpand = async (row: ReimbursementBatch, expandedRows: ReimbursementBatch[]) => {
  const isExpanded = expandedRows.some(item => item.id === row.id);
  if (!isExpanded || detailsMap.value[row.id]) return;
  const detail = await getReimbursementBatch(row.id);
  detailsMap.value = { ...detailsMap.value, [row.id]: detail.data };
};

const onSelectionChange = (selection: ReimbursementBatch[]) => {
  selectedIds.value = selection.map(item => item.id);
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div class="toolbar">
        <div>
          <div class="title">报内报销集中打款台</div>
          <div class="sub">已审批批次可在此登记打款流水与付款账户</div>
        </div>
        <el-button type="primary" @click="openPayDialog(selectedIds)">登记打款</el-button>
      </div>
    </template>

    <el-table
      :data="rows"
      :loading="loading"
      stripe
      @selection-change="onSelectionChange"
      @expand-change="onExpand"
    >
      <el-table-column type="selection" width="48" />
      <el-table-column type="expand">
        <template #default="{ row }">
          <el-table
            :data="detailsMap[row.id]?.items || []"
            size="small"
            style="margin: 8px 0"
          >
            <el-table-column prop="envelope_no" label="信封编号" width="160" />
            <el-table-column prop="applicant_userid" label="归属人" width="130" />
            <el-table-column prop="amount" label="报销金额" width="120" />
            <el-table-column prop="invoice_no" label="发票号" min-width="180" />
            <el-table-column prop="description" label="报销说明" min-width="200" />
          </el-table>
        </template>
      </el-table-column>
      <el-table-column prop="batch_no" label="批次号" width="170" />
      <el-table-column prop="total_amount" label="总金额" width="130" />
      <el-table-column prop="item_count" label="信封数" width="100" />
      <el-table-column prop="status" label="状态" width="120">
        <template #default="{ row }">
          <el-tag type="success">{{ row.status }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openPayDialog([row.id])">登记打款</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="payDialogVisible" title="登记打款" width="520px">
    <el-form label-width="110px">
      <el-form-item label="打款日期" required>
        <el-date-picker
          v-model="payForm.paid_at"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="支付流水号" required>
        <el-input v-model="payForm.payment_reference" />
      </el-form-item>
      <el-form-item label="付款账户" required>
        <el-input v-model="payForm.payment_account" placeholder="例如 建行尾号8888" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="payDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="actionLoading" @click="submitMarkPaid">
        提交
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}
</style>
