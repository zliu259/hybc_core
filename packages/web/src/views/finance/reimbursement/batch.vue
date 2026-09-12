<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessageBox, type MessageBoxInputData } from "element-plus";
import { message } from "@/utils/message";
import { aiAuditStatusLabel, channelLabel } from "@/utils/enum-labels";
import { listProjects, type Project } from "@/api/project";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import {
  createReimbursementBatch,
  listReimbursementBatchCandidates,
  listReimbursementBatches,
  submitBatchApproval,
  type ReimbursementEnvelope,
  type ReimbursementBatch
} from "@/api/reimbursement";
import {
  reimbursementPrecheckStatusLabel,
  reimbursementStatusLabel
} from "./reimbursement-labels";
import {
  describeTitleCounts,
  invoiceTitleDisplay,
  summarizeTitles
} from "./reimbursement-title";
import { listPayees, createPayee, type Payee } from "@/api/payment";
import ReimbursementBatchDetail from "./batch-detail.vue";
import ReimbursementDetail from "./detail.vue";
import AiBatchProposalsDrawer from "./components/AiBatchProposalsDrawer.vue";

defineOptions({ name: "ReimbursementBatchList" });

const loading = ref(false);
const list = ref<ReimbursementBatch[]>([]);
const projects = ref<Project[]>([]);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const candidateLoading = ref(false);
const historyLoading = ref(false);
const candidates = ref<ReimbursementEnvelope[]>([]);
const candidateSelectedIds = ref<number[]>([]);
const historyRows = ref<ReimbursementBatch[]>([]);
const entities = ref<Entity[]>([]);
const bankAccounts = ref<EntityBankAccount[]>([]);
const envelopeDetailDrawerVisible = ref(false);
const activeEnvelopeDetailId = ref<number | null>(null);
const batchDetailDrawerVisible = ref(false);
const activeBatchDetailId = ref<number | null>(null);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  status: "",
  payment_method: "",
  payment_entity_id: undefined as number | undefined,
  payment_entity_bank_account_id: undefined as number | undefined,
  payment_account: "",
  payee_id: undefined as number | undefined,
  invoice_title_entity_id: undefined as number | "none" | undefined
});

const internalPayees = ref<Payee[]>([]);
const internalPayeesLoading = ref(false);
const newPayeeVisible = ref(false);
const newPayeeSubmitting = ref(false);
const newPayeeForm = ref({
  name: "",
  bank_name: "",
  bank_account: "",
  phone: ""
});

const loadInternalPayees = async () => {
  const userid = filters.value.applicant_userid.trim();
  if (!userid) {
    internalPayees.value = [];
    return;
  }
  internalPayeesLoading.value = true;
  try {
    const res = await listPayees({ type: "internal", linked_userid: userid });
    internalPayees.value = res.data;
    if (
      filters.value.payee_id &&
      !res.data.some(p => p.id === filters.value.payee_id)
    ) {
      filters.value.payee_id = undefined;
    }
  } finally {
    internalPayeesLoading.value = false;
  }
};

const openNewPayee = () => {
  if (!filters.value.applicant_userid.trim()) {
    message("请先选择被报销人", { type: "warning" });
    return;
  }
  newPayeeForm.value = { name: "", bank_name: "", bank_account: "", phone: "" };
  newPayeeVisible.value = true;
};

const submitNewPayee = async () => {
  const userid = filters.value.applicant_userid.trim();
  if (!userid) return;
  if (
    !newPayeeForm.value.name.trim() ||
    !newPayeeForm.value.bank_name.trim() ||
    !newPayeeForm.value.bank_account.trim()
  ) {
    message("请填写姓名/开户行/银行卡号", { type: "warning" });
    return;
  }
  newPayeeSubmitting.value = true;
  try {
    const res = await createPayee({
      name: newPayeeForm.value.name.trim(),
      bank_name: newPayeeForm.value.bank_name.trim(),
      bank_account: newPayeeForm.value.bank_account.trim(),
      phone: newPayeeForm.value.phone.trim() || undefined,
      type: "internal",
      linked_userid: userid
    });
    await loadInternalPayees();
    filters.value.payee_id = res.data.id;
    newPayeeVisible.value = false;
    message("内部收款人已创建并选中", { type: "success" });
  } catch {
    message("创建失败", { type: "error" });
  } finally {
    newPayeeSubmitting.value = false;
  }
};

const paymentMethodLabelMap: Record<string, string> = {
  transfer: "对公转账",
  bank_transfer: "对公转账",
  对公转账: "对公转账",
  personal_transfer: "转账",
  转账: "转账",
  cash: "现金",
  现金: "现金",
  bill: "票据",
  票据: "票据",
  other: "其他",
  其他: "其他"
};

const toPaymentMethodLabel = (value: string | null | undefined) => {
  if (!value) return "-";
  return paymentMethodLabelMap[value] ?? value;
};

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const entityNameMap = computed(() => {
  const map = new Map<number, string>();
  for (const item of entities.value) {
    map.set(item.id, item.entity_name);
  }
  return map;
});

const activeEntities = computed(() =>
  entities.value.filter(item => item.status === "active")
);

const activeBankAccounts = computed(() =>
  bankAccounts.value.filter(item => item.status === "active")
);

const creatingAndSubmitting = ref(false);
const activeBatchTab = ref("active");

const selectedCandidateTotal = computed(() => {
  return candidates.value
    .filter(item => candidateSelectedIds.value.includes(item.id))
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
});

const selectedCandidateRows = computed(() =>
  candidates.value.filter(item => candidateSelectedIds.value.includes(item.id))
);

const selectedTitleSummary = computed(() =>
  summarizeTitles(selectedCandidateRows.value)
);

const selectedTitleLabel = computed(() => {
  const summary = selectedTitleSummary.value;
  if (summary.kind === "uniform" && summary.entityId) {
    return (
      entityNameMap.value.get(summary.entityId) ?? `主体#${summary.entityId}`
    );
  }
  if (summary.kind === "mixed") return "混合抬头";
  if (summary.kind === "unknown") return "未识别";
  return "-";
});

const titleCellFor = (row: ReimbursementEnvelope) =>
  invoiceTitleDisplay(
    row,
    row.invoice_title_entity_id
      ? entityNameMap.value.get(row.invoice_title_entity_id)
      : null
  );

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 300 });
  projects.value = result.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listReimbursementBatches({
      page: page.value,
      pageSize: pageSize.value,
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid || undefined,
      status: filters.value.status || undefined
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const loadHistory = async () => {
  historyLoading.value = true;
  try {
    const [paid, rejected] = await Promise.all([
      listReimbursementBatches({ status: "paid", page: 1, pageSize: 200 }),
      listReimbursementBatches({ status: "rejected", page: 1, pageSize: 200 })
    ]);
    historyRows.value = [...paid.data, ...rejected.data].sort(
      (a, b) => b.id - a.id
    );
  } finally {
    historyLoading.value = false;
  }
};

const loadCandidates = async () => {
  if (!filters.value.project_id || !filters.value.applicant_userid.trim()) {
    candidates.value = [];
    candidateSelectedIds.value = [];
    return;
  }

  candidateLoading.value = true;
  try {
    const result = await listReimbursementBatchCandidates({
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid.trim(),
      invoice_title_entity_id: filters.value.invoice_title_entity_id
    });
    candidates.value = result.data;
    candidateSelectedIds.value = [];
  } finally {
    candidateLoading.value = false;
  }
};

const loadEntities = async () => {
  const result = await listEntities();
  entities.value = result.data;
};

const toBankAccountLabel = (item: EntityBankAccount) => {
  const branch = item.bank_branch_no?.trim();
  return `${item.bank_name}${branch ? `-${branch}` : ""} / ${item.account_no}`;
};

const onPaymentEntityChange = async () => {
  filters.value.payment_entity_bank_account_id = undefined;
  filters.value.payment_account = "";
  if (!filters.value.payment_entity_id) {
    bankAccounts.value = [];
    return;
  }
  const result = await listEntityBankAccounts(filters.value.payment_entity_id);
  bankAccounts.value = result.data;
};

const onPaymentBankAccountChange = () => {
  if (!filters.value.payment_entity_bank_account_id) {
    filters.value.payment_account = "";
    return;
  }
  const target = activeBankAccounts.value.find(
    item => item.id === filters.value.payment_entity_bank_account_id
  );
  filters.value.payment_account = target ? toBankAccountLabel(target) : "";
};

const matchesTitleFilter = (item: ReimbursementEnvelope) => {
  const titleFilter = filters.value.invoice_title_entity_id;
  if (titleFilter === undefined) return true;
  if (titleFilter === "none") return !item.invoice_title_entity_id;
  return item.invoice_title_entity_id === titleFilter;
};

const autoSelectSubmittable = () => {
  candidateSelectedIds.value = candidates.value
    .filter(
      item =>
        item.status === "received" &&
        item.precheck_status === "approved" &&
        !item.batch_id &&
        matchesTitleFilter(item)
    )
    .map(item => item.id);
  if (
    filters.value.invoice_title_entity_id === undefined &&
    selectedTitleSummary.value.kind === "mixed"
  ) {
    message("已勾选条目发票抬头不一致，建议先按抬头筛选后再成批", {
      type: "warning"
    });
  }
};

type CreateBatchErrorShape = {
  response?: {
    data?: {
      error?: {
        code?: string;
        title_counts?: Array<{
          entity_id: number | null;
          name: string | null;
          count: number;
        }>;
      };
    };
  };
};

const promptMixedTitleReason = async (
  counts: Array<{
    entity_id: number | null;
    name: string | null;
    count: number;
  }>
): Promise<string | null> => {
  try {
    // ElMessageBox.prompt 声明返回类型为 MessageBoxInputData | Action，其中
    // Action 没有 value；实际运行时 prompt 只会以 MessageBoxInputData resolve
    // （取消时走 reject），故此处窄化断言安全，做法与 precheck.vue /
    // detail.vue 一致。
    const { value } = (await ElMessageBox.prompt(
      `所选条目发票抬头不一致：${describeTitleCounts(counts, id => entityNameMap.value.get(id))}。\n按规定应按抬头分批（付款主体须与发票抬头一致）。如确需混批，请填写理由（2–200 字）。`,
      "发票抬头不一致",
      {
        type: "warning",
        confirmButtonText: "仍要混批",
        cancelButtonText: "取消",
        inputPlaceholder: "混批理由",
        inputValidator: (value: string) => {
          const trimmed = value.trim();
          return trimmed.length >= 2 && trimmed.length <= 200
            ? true
            : "理由需 2–200 字";
        }
      }
    )) as MessageBoxInputData;
    return value.trim();
  } catch {
    return null;
  }
};

const submitCreateAndApproval = async () => {
  const projectId = filters.value.project_id;
  if (!projectId || !filters.value.applicant_userid.trim()) {
    message("请填写项目和申报人", { type: "warning" });
    return;
  }

  if (!filters.value.payment_method) {
    message("请选择收款方式", { type: "warning" });
    return;
  }
  if (candidateSelectedIds.value.length === 0) {
    message("请先从候选条目中勾选要送审的报销单", { type: "warning" });
    return;
  }

  const selectedRows = candidates.value.filter(item =>
    candidateSelectedIds.value.includes(item.id)
  );

  const titleSummary = summarizeTitles(selectedRows);
  let mixedTitleReason: string | undefined;
  if (titleSummary.kind === "mixed") {
    const reason = await promptMixedTitleReason(titleSummary.counts);
    if (!reason) return;
    mixedTitleReason = reason;
  }
  if (
    titleSummary.kind === "uniform" &&
    titleSummary.entityId &&
    !filters.value.payment_entity_id
  ) {
    filters.value.payment_entity_id = titleSummary.entityId;
    await onPaymentEntityChange();
    message(
      `已按发票抬头预填付款实体：${entityNameMap.value.get(titleSummary.entityId) ?? titleSummary.entityId}`,
      { type: "info" }
    );
  }

  const selectedTotalAmount = selectedRows.reduce(
    (sum, item) => sum + Number(item.amount || 0),
    0
  );
  const paymentEntityLabel =
    entityNameMap.value.get(filters.value.payment_entity_id) || "-";
  const paymentAccountLabel =
    activeBankAccounts.value.find(
      item => item.id === filters.value.payment_entity_bank_account_id
    )?.account_no || "-";
  const selectedPayee = internalPayees.value.find(
    item => item.id === filters.value.payee_id
  );
  const payeeAccountLabel = selectedPayee
    ? `${selectedPayee.name} / ${selectedPayee.bank_name} / ${selectedPayee.bank_account}`
    : "-";

  try {
    await ElMessageBox.confirm(
      `即将创建并送审：${selectedRows.length} 条报销，合计 ¥${selectedTotalAmount.toFixed(
        2
      )}。\n付款方式：${toPaymentMethodLabel(filters.value.payment_method)}\n收款账户：${payeeAccountLabel}\n付款实体：${paymentEntityLabel}\n付款账号：${paymentAccountLabel}\n\n付款实体与付款账号可由审批人员在审批时补充。\n请确认信息无误后继续。`,
      "二次确认：创建并送审",
      {
        type: "warning",
        confirmButtonText: "确认送审",
        cancelButtonText: "取消"
      }
    );
  } catch {
    return;
  }

  creatingAndSubmitting.value = true;
  try {
    const buildCreatePayload = (reason?: string) => ({
      project_id: projectId,
      applicant_userid: filters.value.applicant_userid.trim(),
      payment_method: filters.value.payment_method || undefined,
      payment_entity_id: filters.value.payment_entity_id,
      payment_entity_bank_account_id:
        filters.value.payment_entity_bank_account_id,
      payment_account: filters.value.payment_account.trim(),
      payee_id: filters.value.payee_id,
      envelope_ids:
        candidateSelectedIds.value.length > 0
          ? candidateSelectedIds.value
          : undefined,
      mixed_title_reason: reason
    });

    let result: Awaited<ReturnType<typeof createReimbursementBatch>>;
    try {
      result = await createReimbursementBatch(
        buildCreatePayload(mixedTitleReason),
        { idempotencyKey: `reimbursement-batch-create-${crypto.randomUUID()}` }
      );
    } catch (error) {
      // 并发下候选抬头已变化：服务端二次判定为混合，补一次理由后重试一次
      const shape = error as CreateBatchErrorShape;
      if (shape.response?.data?.error?.code !== "MIXED_INVOICE_TITLE")
        throw error;
      const reason = await promptMixedTitleReason(
        shape.response?.data?.error?.title_counts ?? []
      );
      if (!reason) return;
      result = await createReimbursementBatch(buildCreatePayload(reason), {
        idempotencyKey: `reimbursement-batch-create-${crypto.randomUUID()}`
      });
    }

    await submitBatchApproval(
      result.data.id,
      {
        payment_method: filters.value.payment_method || undefined,
        payment_entity_id: filters.value.payment_entity_id,
        payment_entity_bank_account_id:
          filters.value.payment_entity_bank_account_id,
        payment_account: filters.value.payment_account.trim(),
        payee_id: filters.value.payee_id
      },
      {
        idempotencyKey: `reimbursement-batch-submit-${crypto.randomUUID()}`
      }
    );
    message(`批次已创建并送审：${result.data.batch_no}`, { type: "success" });

    await Promise.all([loadData(), loadCandidates(), loadHistory()]);
    openDetail(result.data.id);
  } catch {
    message("提交失败", { type: "error" });
  } finally {
    creatingAndSubmitting.value = false;
  }
};

const onCandidateSelectionChange = (selection: ReimbursementEnvelope[]) => {
  candidateSelectedIds.value = selection.map(item => item.id);
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
  await loadCandidates();
};

const openDetail = (id: number) => {
  activeBatchDetailId.value = id;
  batchDetailDrawerVisible.value = true;
};

const closeBatchDetail = () => {
  batchDetailDrawerVisible.value = false;
};

const onBatchDetailClosed = () => {
  activeBatchDetailId.value = null;
};

const onBatchDetailChanged = async () => {
  await Promise.all([loadData(), loadHistory(), loadCandidates()]);
};

const aiProposalsVisible = ref(false);
const userNameMap = computed(() => {
  const map = new Map<string, string>();
  wecomUsers.value.forEach(item =>
    map.set(item.userid, item.name || item.userid)
  );
  return map;
});
const onAiProposalsDone = async () => {
  await Promise.all([loadData(), loadHistory(), loadCandidates()]);
};

onMounted(async () => {
  await Promise.all([loadProjects(), loadWecomUsers(), loadEntities()]);
  await Promise.all([loadData(), loadHistory()]);
});

watch(
  () => [filters.value.project_id, filters.value.applicant_userid],
  () => {
    loadCandidates();
    loadInternalPayees();
  }
);

watch(
  () => filters.value.invoice_title_entity_id,
  () => {
    loadCandidates();
  }
);
</script>

<template>
  <div class="batch-center-page">
    <div class="page-header">
      <div>
        <div class="page-title">报销集中审批与历史中心</div>
        <div class="page-subtitle">
          按项目、被报销人和发票抬头汇总候选报销，确认后创建批次并送审；抬头不一致需填写混批理由。
        </div>
      </div>
      <el-space wrap>
        <el-button type="success" @click="aiProposalsVisible = true">
          AI 一键成批
        </el-button>
        <el-button @click="loadCandidates">刷新候选</el-button>
        <el-button
          type="primary"
          :loading="creatingAndSubmitting"
          @click="submitCreateAndApproval"
        >
          创建并送审
        </el-button>
      </el-space>
    </div>

    <div class="summary-grid">
      <div class="summary-tile">
        <span>候选条目</span>
        <strong>{{ candidates.length }}</strong>
      </div>
      <div class="summary-tile">
        <span>已勾选</span>
        <strong>{{ candidateSelectedIds.length }}</strong>
      </div>
      <div class="summary-tile">
        <span>勾选合计</span>
        <strong>¥{{ selectedCandidateTotal.toFixed(2) }}</strong>
      </div>
      <div class="summary-tile">
        <span>勾选抬头</span>
        <strong>{{ selectedTitleLabel }}</strong>
      </div>
      <div class="summary-tile">
        <span>进行中批次</span>
        <strong>{{ total }}</strong>
      </div>
    </div>

    <section class="work-panel">
      <div class="section-heading">
        <div>
          <div class="section-title">创建集中审批批次</div>
          <div class="section-subtitle">
            必填项目、被报销人和付款方式；付款实体与付款账户可在审批时补充。
          </div>
        </div>
        <el-button @click="autoSelectSubmittable">自动勾选可送审</el-button>
      </div>

      <el-form class="compact-form" label-width="86px">
        <div class="form-grid">
          <el-form-item label="所属项目">
            <el-select
              v-model="filters.project_id"
              clearable
              filterable
              placeholder="选择项目"
            >
              <el-option
                v-for="item in projects"
                :key="item.id"
                :label="item.project_name"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="被报销人">
            <el-select
              v-model="filters.applicant_userid"
              clearable
              filterable
              placeholder="选择被报销人"
            >
              <el-option
                v-for="item in wecomUsers"
                :key="item.userid"
                :label="`${item.name} (${item.userid})`"
                :value="item.userid"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="发票抬头">
            <el-select
              v-model="filters.invoice_title_entity_id"
              clearable
              filterable
              placeholder="全部抬头"
            >
              <el-option label="未识别抬头" value="none" />
              <el-option
                v-for="item in activeEntities"
                :key="item.id"
                :label="item.entity_name"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="付款方式">
            <el-select
              v-model="filters.payment_method"
              clearable
              placeholder="选择付款方式"
            >
              <el-option label="对公转账" value="transfer" />
              <el-option label="转账" value="personal_transfer" />
              <el-option label="现金" value="cash" />
              <el-option label="票据" value="bill" />
              <el-option label="其他" value="other" />
            </el-select>
          </el-form-item>
          <el-form-item label="收款账户">
            <div class="payee-row">
              <el-select
                v-model="filters.payee_id"
                filterable
                clearable
                :loading="internalPayeesLoading"
                :disabled="!filters.applicant_userid"
                placeholder="按被报销人匹配"
              >
                <el-option
                  v-for="p in internalPayees"
                  :key="p.id"
                  :label="`${p.name} | ${p.bank_name} | ${p.bank_account}`"
                  :value="p.id"
                />
              </el-select>
              <el-button
                type="primary"
                link
                :disabled="!filters.applicant_userid"
                @click="openNewPayee"
              >
                新建
              </el-button>
            </div>
          </el-form-item>
        </div>

        <el-collapse class="optional-collapse">
          <el-collapse-item title="可选付款信息" name="payout">
            <div class="form-grid">
              <el-form-item label="付款实体">
                <el-select
                  v-model="filters.payment_entity_id"
                  filterable
                  clearable
                  placeholder="可选，审批时可补充"
                  @change="onPaymentEntityChange"
                >
                  <el-option
                    v-for="item in activeEntities"
                    :key="item.id"
                    :label="item.entity_name"
                    :value="item.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="付款账户">
                <el-select
                  v-model="filters.payment_entity_bank_account_id"
                  filterable
                  clearable
                  placeholder="可选，审批时可补充"
                  @change="onPaymentBankAccountChange"
                >
                  <el-option
                    v-for="item in activeBankAccounts"
                    :key="item.id"
                    :label="toBankAccountLabel(item)"
                    :value="item.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="账户显示">
                <el-input
                  v-model="filters.payment_account"
                  placeholder="可选，审批时可补充"
                />
              </el-form-item>
            </div>
          </el-collapse-item>
        </el-collapse>
      </el-form>
    </section>

    <section class="table-panel">
      <div class="section-heading">
        <div>
          <div class="section-title">候选报销条目</div>
          <div class="section-subtitle">
            仅展示已收件、复核通过、未入批次的报销。
          </div>
        </div>
        <el-button @click="loadCandidates">查询候选报销</el-button>
      </div>

      <el-table
        :data="candidates"
        :loading="candidateLoading"
        stripe
        @selection-change="onCandidateSelectionChange"
      >
        <el-table-column type="selection" width="52" />
        <el-table-column prop="envelope_no" label="信封编号" width="160" />
        <el-table-column label="状态" width="130">
          <template #default="scope">{{
            reimbursementStatusLabel(scope.row.status)
          }}</template>
        </el-table-column>
        <el-table-column label="复核状态" width="130">
          <template #default="scope">{{
            reimbursementPrecheckStatusLabel(scope.row.precheck_status)
          }}</template>
        </el-table-column>
        <el-table-column label="通道" width="110">
          <template #default="scope">{{
            channelLabel(scope.row.channel)
          }}</template>
        </el-table-column>
        <el-table-column label="发票抬头" min-width="200">
          <template #default="scope">
            <el-tag
              v-if="titleCellFor(scope.row).tag === 'unknown'"
              size="small"
              type="warning"
              effect="plain"
              >未识别</el-tag
            >
            <template v-else>
              <span>{{ titleCellFor(scope.row).text }}</span>
              <el-tag
                v-if="titleCellFor(scope.row).tag === 'unmatched'"
                size="small"
                type="info"
                effect="plain"
                style="margin-left: 6px"
                >未匹配主体</el-tag
              >
            </template>
          </template>
        </el-table-column>
        <el-table-column prop="invoice_no" label="发票号" min-width="180" />
        <el-table-column prop="amount" label="金额" width="120" />
        <el-table-column prop="updated_at" label="最近更新时间" width="180" />
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              @click="openEnvelopeDetail(scope.row.id)"
              >查看</el-button
            >
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="table-panel">
      <div class="section-heading">
        <div>
          <div class="section-title">审批批次</div>
          <div class="section-subtitle">进行中与历史完成批次集中查看。</div>
        </div>
        <div class="batch-filter">
          <el-select
            v-model="filters.status"
            clearable
            placeholder="批次状态"
            style="width: 160px"
          >
            <el-option label="草稿" value="draft" />
            <el-option label="待审批" value="pending_approval" />
            <el-option label="已审批" value="approved" />
            <el-option label="已拒绝" value="rejected" />
            <el-option label="已付款" value="paid" />
          </el-select>
          <el-button type="primary" @click="loadData">查询批次</el-button>
        </div>
      </div>

      <el-tabs v-model="activeBatchTab">
        <el-tab-pane label="进行中" name="active">
          <el-table :data="list" :loading="loading">
            <el-table-column prop="batch_no" label="批次号" width="160" />
            <el-table-column label="项目" width="180">
              <template #default="scope">{{
                projectMap[scope.row.project_id] || scope.row.project_id
              }}</template>
            </el-table-column>
            <el-table-column
              prop="applicant_userid"
              label="被报销人"
              width="140"
            />
            <el-table-column label="付款方式" width="120">
              <template #default="scope">{{
                toPaymentMethodLabel(scope.row.payment_method)
              }}</template>
            </el-table-column>
            <el-table-column prop="item_count" label="信封数" width="100" />
            <el-table-column prop="total_amount" label="总金额" width="120" />
            <el-table-column label="智能审核" width="120">
              <template #default="scope">{{
                aiAuditStatusLabel(scope.row.ai_audit_status)
              }}</template>
            </el-table-column>
            <el-table-column label="审批状态" width="120">
              <template #default="scope">{{
                reimbursementStatusLabel(scope.row.status)
              }}</template>
            </el-table-column>
            <el-table-column prop="created_at" label="创建时间" width="180" />
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="scope">
                <el-button
                  link
                  type="primary"
                  @click="openDetail(scope.row.id)"
                >
                  详情
                </el-button>
              </template>
            </el-table-column>
          </el-table>

          <el-pagination
            class="pagination"
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
        </el-tab-pane>
        <el-tab-pane label="历史完成" name="history">
          <el-table :data="historyRows" :loading="historyLoading" stripe>
            <el-table-column prop="batch_no" label="批次号" width="170" />
            <el-table-column label="项目" width="180">
              <template #default="scope">{{
                projectMap[scope.row.project_id] || scope.row.project_id
              }}</template>
            </el-table-column>
            <el-table-column
              prop="applicant_userid"
              label="被报销人"
              width="140"
            />
            <el-table-column label="付款方式" width="120">
              <template #default="scope">{{
                toPaymentMethodLabel(scope.row.payment_method)
              }}</template>
            </el-table-column>
            <el-table-column prop="item_count" label="信封数" width="100" />
            <el-table-column prop="total_amount" label="总金额" width="120" />
            <el-table-column label="结果状态" width="120">
              <template #default="scope">{{
                reimbursementStatusLabel(scope.row.status)
              }}</template>
            </el-table-column>
            <el-table-column
              prop="updated_at"
              label="最近更新时间"
              width="180"
            />
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="scope">
                <el-button
                  link
                  type="primary"
                  @click="openDetail(scope.row.id)"
                >
                  详情
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </section>

    <el-drawer
      v-model="batchDetailDrawerVisible"
      title="报销批次详情"
      size="86%"
      destroy-on-close
      append-to-body
      class="reimbursement-batch-detail-drawer"
      @closed="onBatchDetailClosed"
    >
      <ReimbursementBatchDetail
        v-if="activeBatchDetailId !== null"
        :batch-id="activeBatchDetailId"
        drawer-mode
        @close="closeBatchDetail"
        @changed="onBatchDetailChanged"
      />
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

    <el-dialog
      v-model="newPayeeVisible"
      title="新建内部收款人"
      width="480px"
      append-to-body
    >
      <el-form label-width="100px">
        <el-form-item label="姓名" required>
          <el-input v-model="newPayeeForm.name" />
        </el-form-item>
        <el-form-item label="开户行" required>
          <el-input v-model="newPayeeForm.bank_name" />
        </el-form-item>
        <el-form-item label="银行卡号" required>
          <el-input v-model="newPayeeForm.bank_account" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="newPayeeForm.phone" />
        </el-form-item>
        <el-form-item label="关联 userid">
          <span style="color: #555">{{ filters.applicant_userid || "—" }}</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="newPayeeVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="newPayeeSubmitting"
          @click="submitNewPayee"
          >保存</el-button
        >
      </template>
    </el-dialog>

    <AiBatchProposalsDrawer
      v-model:visible="aiProposalsVisible"
      :project-name-map="projectMap"
      :user-name-map="userNameMap"
      @done="onAiProposalsDone"
      @open-batch="openDetail"
    />
  </div>
</template>

<style scoped>
.batch-center-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header,
.work-panel,
.table-panel {
  padding: 16px;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.page-subtitle,
.section-subtitle {
  margin-top: 4px;
  color: #6b7280;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.summary-tile {
  min-height: 78px;
  padding: 14px 16px;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.summary-tile span {
  font-size: 13px;
  color: #6b7280;
}

.summary-tile strong {
  display: block;
  margin-top: 8px;
  overflow: hidden;
  font-size: 20px;
  color: #111827;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
}

.compact-form {
  max-width: 1180px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(280px, 1fr));
  gap: 0 20px;
}

.form-grid :deep(.el-select),
.form-grid :deep(.el-input) {
  width: 100%;
}

.payee-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  width: 100%;
  gap: 8px;
}

.optional-collapse {
  margin-top: 2px;
  border-top: 0;
  border-bottom: 0;
}

.batch-filter {
  display: flex;
  gap: 8px;
}

.pagination {
  justify-content: flex-end;
  margin-top: 12px;
}

@media (max-width: 960px) {
  .page-header,
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .summary-grid,
  .form-grid {
    grid-template-columns: 1fr;
  }

  .batch-filter {
    width: 100%;
  }
}
</style>
