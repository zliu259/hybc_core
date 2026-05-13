<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import { createUploadSignature } from "@/api/upload";
import { resolveUploadUrl } from "@/api/upload";
import { formatToken, getToken } from "@/utils/auth";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import {
  getReimbursementBatch,
  listReimbursementBatches,
  markBatchPaid,
  type ReimbursementBatch,
  type ReimbursementBatchDetail
} from "@/api/reimbursement";
import ReimbursementDetail from "./detail.vue";

defineOptions({ name: "ReimbursementPayout" });
const route = useRoute();

const loading = ref(false);
const actionLoading = ref(false);
const rows = ref<ReimbursementBatch[]>([]);
const selectedIds = ref<number[]>([]);
const detailsMap = ref<Record<number, ReimbursementBatchDetail>>({});
const envelopeDetailDrawerVisible = ref(false);
const activeEnvelopeDetailId = ref<number | null>(null);

const payDialogVisible = ref(false);
const payTargetIds = ref<number[]>([]);
const entities = ref<Entity[]>([]);
const bankAccounts = ref<EntityBankAccount[]>([]);
const voucherItems = ref<
  Array<{
    file_key: string;
    file_name: string;
    file_size?: number;
    is_new: boolean;
  }>
>([]);
const uploadingVoucher = ref(false);
const payForm = ref({
  paid_at: "",
  payment_reference: "",
  payment_account: "",
  payment_entity_id: undefined as number | undefined,
  payment_entity_bank_account_id: undefined as number | undefined
});

const activeEntities = computed(() =>
  entities.value.filter(item => item.status === "active")
);
const activeBankAccounts = computed(() =>
  bankAccounts.value.filter(item => item.status === "active")
);

const selectedAmount = computed(() => {
  return rows.value
    .filter(row => selectedIds.value.includes(row.id))
    .reduce((sum, row) => sum + Number(row.total_amount), 0);
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
    payment_account: "",
    payment_entity_id: undefined,
    payment_entity_bank_account_id: undefined
  };
  bankAccounts.value = [];
  voucherItems.value = [];
  payDialogVisible.value = true;
};

const onEntityChange = async () => {
  payForm.value.payment_entity_bank_account_id = undefined;
  payForm.value.payment_account = "";
  const entityId = payForm.value.payment_entity_id;
  if (!entityId) {
    bankAccounts.value = [];
    return;
  }
  const res = await listEntityBankAccounts(entityId);
  bankAccounts.value = res.data;
};

const onBankAccountChange = () => {
  const accountId = payForm.value.payment_entity_bank_account_id;
  if (!accountId) {
    payForm.value.payment_account = "";
    return;
  }
  const account = activeBankAccounts.value.find(item => item.id === accountId);
  if (!account) {
    payForm.value.payment_account = "";
    return;
  }
  payForm.value.payment_account = `${account.bank_name} / ${account.account_no}`;
};

const uploadVoucher = async (options: UploadRequestOptions) => {
  const rawFile = options.file;
  uploadingVoucher.value = true;
  try {
    const signRes = await createUploadSignature({
      fileName: rawFile.name,
      contentType: rawFile.type,
      category: "reimbursement"
    });
    const uploadResp = await fetch(resolveUploadUrl(signRes.data.uploadUrl), {
      method: "PUT",
      headers: {
        "content-type": rawFile.type || "application/octet-stream",
        Authorization: formatToken(getToken().accessToken)
      },
      body: rawFile
    });
    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }
    voucherItems.value.unshift({
      file_key: signRes.data.key,
      file_name: rawFile.name,
      file_size: rawFile.size,
      is_new: true
    });
    message("支付凭证上传成功", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("支付凭证上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploadingVoucher.value = false;
  }
};

const removeVoucher = (index: number) => {
  voucherItems.value.splice(index, 1);
};

const submitMarkPaid = async () => {
  if (
    !payForm.value.paid_at ||
    !payForm.value.payment_reference ||
    !payForm.value.payment_account
  ) {
    message("请补全打款信息", { type: "warning" });
    return;
  }
  if (
    !payForm.value.payment_entity_id ||
    !payForm.value.payment_entity_bank_account_id
  ) {
    message("请选择支付实体和支付账号", { type: "warning" });
    return;
  }

  actionLoading.value = true;
  try {
    await Promise.all(
      payTargetIds.value.map(id =>
        markBatchPaid(
          id,
          {
            paid_at: payForm.value.paid_at,
            payment_reference: payForm.value.payment_reference,
            payment_account: payForm.value.payment_account,
            payment_entity_id: payForm.value.payment_entity_id,
            payment_entity_bank_account_id:
              payForm.value.payment_entity_bank_account_id,
            payment_vouchers: voucherItems.value.map(item => ({
              file_key: item.file_key,
              file_name: item.file_name,
              file_size: item.file_size
            }))
          },
          {
            idempotencyKey: `reimbursement-batch-paid-${id}-${crypto.randomUUID()}`
          }
        )
      )
    );
    message("打款登记成功", { type: "success" });
    payDialogVisible.value = false;
    await loadData();
  } finally {
    actionLoading.value = false;
  }
};

const onExpand = async (
  row: ReimbursementBatch,
  expandedRows: ReimbursementBatch[]
) => {
  const isExpanded = expandedRows.some(item => item.id === row.id);
  if (!isExpanded || detailsMap.value[row.id]) return;
  const detail = await getReimbursementBatch(row.id);
  detailsMap.value = { ...detailsMap.value, [row.id]: detail.data };
};

const onSelectionChange = (selection: ReimbursementBatch[]) => {
  selectedIds.value = selection.map(item => item.id);
};

const openEnvelopeDetail = (id: number) => {
  activeEnvelopeDetailId.value = id;
  envelopeDetailDrawerVisible.value = true;
};

const closeEnvelopeDetail = () => {
  envelopeDetailDrawerVisible.value = false;
};

const onEnvelopeDetailClosed = () => {
  activeEnvelopeDetailId.value = null;
};

const onEnvelopeDetailChanged = async () => {
  detailsMap.value = {};
  await loadData();
};

onMounted(async () => {
  await Promise.all([
    loadData(),
    listEntities().then(result => {
      entities.value = result.data;
    })
  ]);
  const batchIdFromQuery = Number(route.query.batch_id || 0);
  if (
    batchIdFromQuery > 0 &&
    rows.value.some(item => item.id === batchIdFromQuery)
  ) {
    openPayDialog([batchIdFromQuery]);
  }
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div class="toolbar">
        <div>
          <div class="title">报内报销集中打款台</div>
          <div class="sub">已审批批次可在此登记打款流水与付款账户</div>
          <div v-if="selectedIds.length > 0" class="summary">
            已选 {{ selectedIds.length }} 批次，合计 ¥{{
              selectedAmount.toFixed(2)
            }}
          </div>
        </div>
        <el-button type="primary" @click="openPayDialog(selectedIds)"
          >登记打款</el-button
        >
      </div>
    </template>

    <el-table
      :data="rows"
      :loading="loading"
      size="small"
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
            <el-table-column
              prop="applicant_userid"
              label="归属人"
              width="130"
            />
            <el-table-column prop="amount" label="报销金额" width="120" />
            <el-table-column prop="invoice_no" label="发票号" min-width="180" />
            <el-table-column
              prop="description"
              label="报销说明"
              min-width="200"
            />
            <el-table-column label="操作" width="90" fixed="right">
              <template #default="{ row: item }">
                <el-button
                  link
                  type="primary"
                  @click="openEnvelopeDetail(item.id)"
                >
                  详情
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </el-table-column>
      <el-table-column prop="batch_no" label="批次号" width="170" />
      <el-table-column prop="total_amount" label="总金额" width="130" />
      <el-table-column prop="item_count" label="信封数" width="100" />
      <el-table-column prop="status" label="状态" width="120">
        <template #default="{ row }">
          <el-tag type="success">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openPayDialog([row.id])"
            >登记打款</el-button
          >
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-drawer
    v-model="payDialogVisible"
    title="登记打款"
    size="520px"
    destroy-on-close
  >
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
      <el-form-item label="支付实体" required>
        <el-select
          v-model="payForm.payment_entity_id"
          filterable
          placeholder="请选择支付实体"
          style="width: 100%"
          @change="onEntityChange"
        >
          <el-option
            v-for="item in activeEntities"
            :key="item.id"
            :label="item.entity_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="支付账号" required>
        <el-select
          v-model="payForm.payment_entity_bank_account_id"
          filterable
          placeholder="请选择支付账号"
          style="width: 100%"
          @change="onBankAccountChange"
        >
          <el-option
            v-for="item in activeBankAccounts"
            :key="item.id"
            :label="`${item.bank_name} / ${item.account_no}`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="付款账户" required>
        <el-input
          v-model="payForm.payment_account"
          placeholder="例如 建行尾号8888"
        />
      </el-form-item>
      <el-form-item label="支付凭证">
        <el-upload
          drag
          :show-file-list="false"
          :multiple="true"
          :disabled="uploadingVoucher"
          :http-request="uploadVoucher"
        >
          <div class="el-upload__text">
            拖拽文件到这里，或 <em>点击上传</em>
          </div>
          <div class="el-upload__tip">支持上传打款截图、回单等凭证</div>
        </el-upload>
        <el-table
          v-if="voucherItems.length > 0"
          :data="voucherItems"
          size="small"
          style="margin-top: 8px"
        >
          <el-table-column prop="file_name" label="文件名" min-width="220" />
          <el-table-column prop="file_size" label="大小" width="120" />
          <el-table-column label="操作" width="90">
            <template #default="{ $index }">
              <el-button link type="danger" @click="removeVoucher($index)"
                >移除</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="payDialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="actionLoading"
        @click="submitMarkPaid"
      >
        提交
      </el-button>
    </template>
  </el-drawer>

  <el-drawer
    v-model="envelopeDetailDrawerVisible"
    title="报销详情"
    size="82%"
    destroy-on-close
    append-to-body
    class="reimbursement-detail-drawer"
    @closed="onEnvelopeDetailClosed"
  >
    <ReimbursementDetail
      v-if="activeEnvelopeDetailId !== null"
      :envelope-id="activeEnvelopeDetailId"
      drawer-mode
      @close="closeEnvelopeDetail"
      @changed="onEnvelopeDetailChanged"
    />
  </el-drawer>
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

.summary {
  margin-top: 6px;
  font-size: 13px;
  color: #c4872b;
}
</style>
