<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { listContracts, type Contract } from "@/api/contract";
import {
  listInvoices,
  listReceipts,
  createReceipt,
  deleteReceipt,
  type Invoice,
  type Receipt
} from "@/api/receipt";

defineOptions({ name: "ReceiptList" });

const loading = ref(false);
const list = ref<Receipt[]>([]);
const contracts = ref<Contract[]>([]);
const invoices = ref<Invoice[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  contract_id: undefined as number | undefined,
  invoice_id: undefined as number | undefined
});

const contractMap = computed(() => {
  const map: Record<number, string> = {};
  contracts.value.forEach(item => {
    map[item.id] = item.contract_no;
  });
  return map;
});

const invoiceMap = computed(() => {
  const map: Record<number, string> = {};
  invoices.value.forEach(item => {
    map[item.id] = item.invoice_no;
  });
  return map;
});

const createDialogVisible = ref(false);
const creating = ref(false);
const createForm = ref({
  contract_id: undefined as number | undefined,
  invoice_id: undefined as number | undefined,
  received_date: "",
  amount: 0,
  payment_account: "",
  remark: ""
});

const loadContracts = async () => {
  const result = await listContracts({
    direction: "inbound",
    page: 1,
    pageSize: 300
  });
  contracts.value = result.data;
};

const loadInvoices = async () => {
  const result = await listInvoices({ page: 1, pageSize: 500 });
  invoices.value = result.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listReceipts({
      page: page.value,
      pageSize: pageSize.value,
      contract_id: filters.value.contract_id,
      invoice_id: filters.value.invoice_id
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  createForm.value = {
    contract_id: filters.value.contract_id,
    invoice_id: filters.value.invoice_id,
    received_date: "",
    amount: 0,
    payment_account: "",
    remark: ""
  };
  createDialogVisible.value = true;
};

const submitCreate = async () => {
  if (
    !createForm.value.contract_id ||
    !createForm.value.received_date ||
    createForm.value.amount <= 0
  ) {
    message("请填写合同、收款日期、金额", { type: "warning" });
    return;
  }
  creating.value = true;
  try {
    const result = await createReceipt({
      contract_id: createForm.value.contract_id,
      invoice_id: createForm.value.invoice_id,
      received_date: createForm.value.received_date,
      amount: createForm.value.amount,
      payment_account: createForm.value.payment_account || undefined,
      remark: createForm.value.remark || undefined
    });
    message(`收款登记成功：${result.data.receipt_no}`, { type: "success" });
    createDialogVisible.value = false;
    await loadData();
  } finally {
    creating.value = false;
  }
};

const onDelete = async (row: Receipt) => {
  await deleteReceipt(row.id);
  message("删除成功", { type: "success" });
  await loadData();
};

onMounted(async () => {
  await loadContracts();
  await loadInvoices();
  await loadData();
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>收款登记</span>
        <el-button type="primary" @click="openCreate">新增收款登记</el-button>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="合同">
        <el-select
          v-model="filters.contract_id"
          clearable
          filterable
          style="width: 260px"
        >
          <el-option
            v-for="item in contracts"
            :key="item.id"
            :label="`${item.contract_no} | ${item.counterparty}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="发票">
        <el-select
          v-model="filters.invoice_id"
          clearable
          filterable
          style="width: 240px"
        >
          <el-option
            v-for="item in invoices"
            :key="item.id"
            :label="item.invoice_no"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="receipt_no" label="收款单号" width="170" />
      <el-table-column label="合同号" width="170">
        <template #default="scope">{{
          contractMap[scope.row.contract_id] || scope.row.contract_id
        }}</template>
      </el-table-column>
      <el-table-column label="发票号" width="170">
        <template #default="scope">
          {{
            scope.row.invoice_id
              ? invoiceMap[scope.row.invoice_id] || scope.row.invoice_id
              : "-"
          }}
        </template>
      </el-table-column>
      <el-table-column prop="received_date" label="收款日期" width="130" />
      <el-table-column prop="amount" label="金额" width="120" />
      <el-table-column prop="payment_account" label="收款账户" width="180" />
      <el-table-column prop="receiver_userid" label="登记人" width="140" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="scope">
          <el-button link type="danger" @click="onDelete(scope.row)"
            >删除</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      background
      layout="prev, pager, next, total"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="
        (val: number) => {
          page = val;
          loadData();
        }
      "
    />
  </el-card>

  <el-dialog v-model="createDialogVisible" title="新增收款登记" width="560px">
    <el-form label-width="110px">
      <el-form-item label="合同" required>
        <el-select
          v-model="createForm.contract_id"
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in contracts"
            :key="item.id"
            :label="`${item.contract_no} | ${item.counterparty}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="关联发票">
        <el-select
          v-model="createForm.invoice_id"
          clearable
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in invoices"
            :key="item.id"
            :label="`${item.invoice_no} | ${item.amount}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="收款日期" required>
        <el-date-picker
          v-model="createForm.received_date"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 220px"
        />
      </el-form-item>
      <el-form-item label="金额" required>
        <el-input-number
          v-model="createForm.amount"
          :min="0"
          :precision="2"
          :step="100"
        />
      </el-form-item>
      <el-form-item label="收款账户">
        <el-input v-model="createForm.payment_account" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="createForm.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="createDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="creating" @click="submitCreate"
        >确认登记</el-button
      >
    </template>
  </el-dialog>
</template>
