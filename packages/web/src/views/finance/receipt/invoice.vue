<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { listContracts, type Contract } from "@/api/contract";
import {
  deleteInvoice,
  listInvoices,
  createInvoice,
  type Invoice
} from "@/api/receipt";

defineOptions({ name: "InvoiceList" });

const loading = ref(false);
const list = ref<Invoice[]>([]);
const contracts = ref<Contract[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  contract_id: undefined as number | undefined,
  status: "",
  keyword: ""
});

const contractMap = computed(() => {
  const map: Record<number, string> = {};
  contracts.value.forEach(item => {
    map[item.id] = item.contract_no;
  });
  return map;
});

const createDialogVisible = ref(false);
const creating = ref(false);
const createForm = ref({
  contract_id: undefined as number | undefined,
  issue_date: "",
  amount: 0,
  title: "",
  tax_no: "",
  file_key: "",
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

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listInvoices({
      page: page.value,
      pageSize: pageSize.value,
      contract_id: filters.value.contract_id,
      status: filters.value.status || undefined,
      keyword: filters.value.keyword || undefined
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
    issue_date: "",
    amount: 0,
    title: "",
    tax_no: "",
    file_key: "",
    remark: ""
  };
  createDialogVisible.value = true;
};

const submitCreate = async () => {
  if (
    !createForm.value.contract_id ||
    !createForm.value.issue_date ||
    !createForm.value.title.trim()
  ) {
    message("请填写合同、开票日期、发票抬头", { type: "warning" });
    return;
  }
  creating.value = true;
  try {
    const result = await createInvoice({
      contract_id: createForm.value.contract_id,
      issue_date: createForm.value.issue_date,
      amount: createForm.value.amount,
      title: createForm.value.title,
      tax_no: createForm.value.tax_no || undefined,
      file_key: createForm.value.file_key || undefined,
      remark: createForm.value.remark || undefined
    });
    message(`发票创建成功：${result.data.invoice_no}`, { type: "success" });
    createDialogVisible.value = false;
    await loadData();
    await loadContracts();
  } finally {
    creating.value = false;
  }
};

const onDelete = async (row: Invoice) => {
  await deleteInvoice(row.id);
  message("删除成功", { type: "success" });
  await loadData();
};

onMounted(async () => {
  await loadContracts();
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
        <span>发票管理</span>
        <el-button type="primary" @click="openCreate">签发发票</el-button>
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
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 150px">
          <el-option label="已签发" value="issued" />
          <el-option label="已作废" value="cancelled" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="发票号/抬头/税号"
        />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="invoice_no" label="发票单号" width="170" />
      <el-table-column label="合同号" width="170">
        <template #default="scope">{{
          contractMap[scope.row.contract_id] || scope.row.contract_id
        }}</template>
      </el-table-column>
      <el-table-column prop="title" label="发票抬头" min-width="180" />
      <el-table-column prop="tax_no" label="税号" width="160" />
      <el-table-column prop="issue_date" label="开票日期" width="130" />
      <el-table-column prop="amount" label="金额" width="120" />
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

  <el-dialog v-model="createDialogVisible" title="签发发票" width="560px">
    <el-form label-width="110px">
      <el-form-item label="收款合同" required>
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
      <el-form-item label="开票日期" required>
        <el-date-picker
          v-model="createForm.issue_date"
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
      <el-form-item label="发票抬头" required>
        <el-input v-model="createForm.title" />
      </el-form-item>
      <el-form-item label="税号">
        <el-input v-model="createForm.tax_no" />
      </el-form-item>
      <el-form-item label="文件Key">
        <el-input
          v-model="createForm.file_key"
          placeholder="可选，R2 file key"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="createForm.remark" type="textarea" :rows="2" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="createDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="creating" @click="submitCreate"
        >确认签发</el-button
      >
    </template>
  </el-dialog>
</template>
