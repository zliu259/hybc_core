<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  channelLabel,
  precheckStatusLabel,
  statusLabel
} from "@/utils/enum-labels";
import { listProjects, type Project } from "@/api/project";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import {
  listReimbursementEnvelopes,
  precheckEnvelope,
  resolveReimbursementEnvelopeByUuid,
  triggerEnvelopeAnomalyCheck,
  type ReimbursementEnvelope
} from "@/api/reimbursement";
import ReimbursementBatchCenter from "./batch.vue";
import ReimbursementDetail from "./detail.vue";
import ReimbursementPayoutCenter from "./payout.vue";

defineOptions({ name: "ReimbursementList" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const router = useRouter();
const route = useRoute();
const userStore = useUserStoreHook();
const loading = ref(false);
const list = ref<ReimbursementEnvelope[]>([]);
const projects = ref<Project[]>([]);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  status: [] as string[],
  channel: "",
  keyword: ""
});

const roleSet = computed(() => new Set(userStore.roles ?? []));
const currentUserid = computed(() => userStore.username || "");
const canOfficeOps = computed(() =>
  ["super_admin", "manager", "site_manager", "finance"].some(role =>
    roleSet.value.has(role)
  )
);
const canFinanceCenter = computed(() =>
  ["super_admin", "manager", "site_manager", "finance"].some(role =>
    roleSet.value.has(role)
  )
);
const isWorkspaceRoute = computed(() => route.path.startsWith("/workspace/"));

type WorkflowView = "submission" | "office" | "approval" | "payout";
const workflowView = ref<WorkflowView>("submission");
const workflowReady = ref(false);
const submissionStatuses = ["unregistered", "draft", "submitted"];

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const userNameMap = computed(() => {
  const map = new Map<string, string>();
  wecomUsers.value.forEach(item => {
    map.set(item.userid, item.name || item.userid);
  });
  return map;
});

const toApplicantLabel = (userid: string | null | undefined) => {
  if (!userid) return "-";
  return userNameMap.value.get(userid) ?? userid;
};

const statusTagType: Record<string, TagType> = {
  unregistered: "info",
  draft: "info",
  submitted: "warning",
  received: "success",
  batched: "primary",
  pending_approval: "warning",
  approved: "success",
  paid: "primary",
  rejected: "danger",
  cancelled: "info"
};

const riskTagTypeMap: Record<string, TagType> = {
  high: "danger",
  medium: "warning",
  low: "success"
};

const toDuplicateCount = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
};

const duplicateRiskLabel = (level: unknown) => {
  if (level === "high") return "高风险重复";
  if (level === "medium") return "中风险重复";
  if (level === "low") return "低风险重复";
  return "重复风险";
};

const toDuplicateRiskTagType = (level: unknown): TagType => {
  if (typeof level !== "string") return "warning";
  return riskTagTypeMap[level] ?? "warning";
};

const rowAnomalyTags = (row: ReimbursementEnvelope) => {
  const tags: Array<{ label: string; type: TagType }> = [];
  const duplicateCount = toDuplicateCount(row.duplicate_count);
  if (duplicateCount > 0) {
    tags.push({
      label: `${duplicateRiskLabel(row.duplicate_risk_level)} x${duplicateCount}`,
      type: toDuplicateRiskTagType(row.duplicate_risk_level)
    });
  }
  if (row.verification_status === "mismatch") {
    tags.push({ label: "收件核对异常", type: "danger" });
  }
  if (row.precheck_status === "supplement") {
    tags.push({ label: "待补充材料", type: "warning" });
  }
  if (row.precheck_status === "rejected") {
    tags.push({ label: "复核驳回", type: "danger" });
  }
  return tags;
};

const isHighRiskRow = (row: ReimbursementEnvelope) => {
  const duplicateCount = toDuplicateCount(row.duplicate_count);
  return (
    (duplicateCount > 0 && row.duplicate_risk_level === "high") ||
    row.verification_status === "mismatch" ||
    row.precheck_status === "rejected"
  );
};

const tableRowClassName = ({ row }: { row: ReimbursementEnvelope }) => {
  return isHighRiskRow(row) ? "reimbursement-row-high-risk" : "";
};

const currentViewTitle = computed(() => {
  if (workflowView.value === "office") return "核对签收与复核";
  if (workflowView.value === "approval") return "报销提交审批";
  if (workflowView.value === "payout") return "付款标记";
  return "报销提交";
});

const currentViewHint = computed(() => {
  if (workflowView.value === "office") {
    return "办公室在这里完成信封核对签收、异常标记、二次静默审查和复核处理。";
  }
  if (workflowView.value === "approval") {
    return "把已签收且复核通过的报销按项目和被报销人汇总，创建批次并提交审批。";
  }
  if (workflowView.value === "payout") {
    return "审批通过后的报销批次在这里登记付款日期、流水号、付款账户和凭证。";
  }
  return isWorkspaceRoute.value
    ? "查看我的报销提交，并可继续发起报销。"
    : "只展示未登记、草稿和已提交条目；后续审批和付款状态请在右侧流程页签处理。";
});

const isEnvelopeWorkflow = computed(() =>
  ["submission", "office"].includes(workflowView.value)
);

const workflowStepItems = computed(() => {
  const items: Array<{
    name: WorkflowView;
    title: string;
    subtitle: string;
  }> = [
    {
      name: "submission",
      title: "1. 报销提交",
      subtitle: "新建、草稿、已提交"
    }
  ];

  if (!isWorkspaceRoute.value && canOfficeOps.value) {
    items.push({
      name: "office",
      title: "2. 核对签收与复核",
      subtitle: "签收、异常、复核"
    });
  }

  if (!isWorkspaceRoute.value && canFinanceCenter.value) {
    items.push(
      {
        name: "approval",
        title: "3. 提交审批",
        subtitle: "汇总批次并送审"
      },
      {
        name: "payout",
        title: "4. 付款标记",
        subtitle: "登记流水和凭证"
      }
    );
  }

  return items;
});

const switchWorkflow = (name: WorkflowView) => {
  workflowView.value = name;
};

const workflowFromQuery = (): WorkflowView | null => {
  if (isWorkspaceRoute.value) return null;
  const step = String(route.query.step || "");
  if (["submission", "office", "approval", "payout"].includes(step)) {
    return step as WorkflowView;
  }
  return null;
};

const listedAmountTotal = computed(() =>
  list.value.reduce((sum, item) => sum + Number(item.amount || 0), 0)
);

const highRiskCount = computed(() => list.value.filter(isHighRiskRow).length);

const quickScanDialogVisible = ref(false);
const quickScanUuid = ref("");
const detailDrawerVisible = ref(false);
const activeDetailId = ref<number | null>(null);
const createIdempotencyKey = (scope: string) =>
  `${scope}-${crypto.randomUUID()}`;

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 300 });
  projects.value = result.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listReimbursementEnvelopes({
      page: page.value,
      pageSize: pageSize.value,
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid || undefined,
      status: filters.value.status.length
        ? filters.value.status.join(",")
        : undefined,
      exclude_cancelled: filters.value.status.length === 0,
      channel: filters.value.channel || undefined,
      keyword: filters.value.keyword || undefined
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const goCreate = () => {
  if (isWorkspaceRoute.value) {
    router.push("/workspace/my-reimbursement/detail/create");
    return;
  }
  router.push("/finance/reimbursement/detail/create");
};

const goDetail = (id: number) => {
  if (isWorkspaceRoute.value) {
    router.push(`/workspace/my-reimbursement/detail/${id}`);
    return;
  }
  activeDetailId.value = id;
  detailDrawerVisible.value = true;
};

const closeDetailDrawer = () => {
  detailDrawerVisible.value = false;
};

const onDetailDrawerClosed = () => {
  activeDetailId.value = null;
};

const onDetailChanged = async () => {
  await loadData();
};

const goEnvelopeGenerator = () => {
  router.push("/finance/reimbursement/envelope-generator");
};

const openQuickScan = () => {
  quickScanUuid.value = "";
  quickScanDialogVisible.value = true;
};

const submitQuickScan = async () => {
  if (!quickScanUuid.value.trim()) {
    message("请填写信封UUID", { type: "warning" });
    return;
  }
  const result = await resolveReimbursementEnvelopeByUuid(
    quickScanUuid.value.trim()
  );
  message("已打开对应报销信封", { type: "success" });
  quickScanDialogVisible.value = false;
  goDetail(result.data.id);
};

const onTriggerAnomaly = async (id: number) => {
  await triggerEnvelopeAnomalyCheck(id);
  message("已触发智能核查", { type: "success" });
  await loadData();
};

const onRerunSilentReview = async (id: number) => {
  await triggerEnvelopeAnomalyCheck(
    id,
    {
      rerun_full: true,
      reason: "office_manual_second_silent_review"
    },
    {
      idempotencyKey: createIdempotencyKey("reimbursement-rerun-silent-review")
    }
  );
  message("已触发二次静默审查", { type: "success" });
  await loadData();
};

const onPrecheck = async (
  id: number,
  action: "approved" | "supplement" | "rejected"
) => {
  try {
    await precheckEnvelope(id, { action });
    message(`复核已处理：${action}`, {
      type: action === "approved" ? "success" : "warning"
    });
    await loadData();
  } catch (error) {
    const err = error as {
      response?: {
        status?: number;
        data?: { data?: { wait_for_audit?: boolean } };
      };
    };
    const waitForAudit =
      err.response?.status === 409 &&
      err.response?.data?.data?.wait_for_audit === true;
    if (!waitForAudit) throw error;
    message("后台静默审查尚未完成，系统已自动触发处理，请稍后再执行复核通过", {
      type: "warning"
    });
    await loadData();
  }
};

const applyWorkflowPreset = (mode: WorkflowView) => {
  if (mode === "submission") {
    filters.value.applicant_userid = isWorkspaceRoute.value
      ? currentUserid.value
      : "";
    filters.value.status = [...submissionStatuses];
    filters.value.channel = "";
    return;
  }

  if (mode === "office") {
    filters.value.applicant_userid = "";
    filters.value.status = ["submitted", "received"];
    filters.value.channel = "";
    return;
  }

  filters.value.applicant_userid = "";
  filters.value.status = [];
  filters.value.channel = "";
};

const onWorkflowChange = async (mode: WorkflowView) => {
  applyWorkflowPreset(mode);
  page.value = 1;
  if (isEnvelopeWorkflow.value) {
    await loadData();
  }
};

onMounted(async () => {
  workflowView.value =
    workflowFromQuery() ||
    (!isWorkspaceRoute.value && canOfficeOps.value ? "office" : "submission");

  applyWorkflowPreset(workflowView.value);

  await Promise.all([loadProjects(), loadWecomUsers()]);
  if (isEnvelopeWorkflow.value) {
    await loadData();
  }
  workflowReady.value = true;
});

watch(workflowView, mode => {
  if (!workflowReady.value) return;
  onWorkflowChange(mode);
});

watch(
  () => route.query.step,
  () => {
    const target = workflowFromQuery();
    if (!target || target === workflowView.value) return;
    workflowView.value = target;
  }
);
</script>

<template>
  <div class="reimbursement-list-page">
    <div class="page-header">
      <div>
        <div class="page-title">{{ currentViewTitle }}</div>
        <div class="page-subtitle">{{ currentViewHint }}</div>
      </div>
      <el-space wrap>
        <el-button
          v-if="workflowView === 'submission'"
          type="success"
          @click="goCreate"
        >
          {{
            !isWorkspaceRoute && canOfficeOps ? "代员工发起报销" : "发起报销"
          }}
        </el-button>
        <el-button v-if="workflowView === 'office'" @click="openQuickScan">
          扫码/输入UUID
        </el-button>
        <el-button
          v-if="!isWorkspaceRoute && canFinanceCenter"
          type="primary"
          plain
          @click="goEnvelopeGenerator"
        >
          信封生成器
        </el-button>
      </el-space>
    </div>

    <nav v-if="!isWorkspaceRoute" class="workflow-steps">
      <button
        v-for="item in workflowStepItems"
        :key="item.name"
        class="workflow-step"
        :class="{ 'workflow-step--active': workflowView === item.name }"
        type="button"
        @click="switchWorkflow(item.name)"
      >
        <span>{{ item.title }}</span>
        <small>{{ item.subtitle }}</small>
      </button>
    </nav>

    <div v-if="isEnvelopeWorkflow" class="summary-grid">
      <div class="summary-tile">
        <span>当前列表</span>
        <strong>{{ total }}</strong>
      </div>
      <div class="summary-tile">
        <span>本页金额</span>
        <strong>¥{{ listedAmountTotal.toFixed(2) }}</strong>
      </div>
      <div class="summary-tile">
        <span>风险提示</span>
        <strong>{{ highRiskCount }}</strong>
      </div>
    </div>

    <section class="filter-panel">
      <el-tabs v-model="workflowView">
        <el-tab-pane label="报销提交" name="submission" />
        <el-tab-pane
          v-if="canOfficeOps && !isWorkspaceRoute"
          label="核对签收与复核"
          name="office"
        />
        <el-tab-pane
          v-if="canFinanceCenter && !isWorkspaceRoute"
          label="提交审批"
          name="approval"
        />
        <el-tab-pane
          v-if="canFinanceCenter && !isWorkspaceRoute"
          label="付款标记"
          name="payout"
        />
      </el-tabs>

      <el-form v-if="isEnvelopeWorkflow" class="filter-form" label-width="72px">
        <div class="filter-grid">
          <el-form-item label="所属项目">
            <el-select
              v-model="filters.project_id"
              clearable
              filterable
              placeholder="全部项目"
            >
              <el-option
                v-for="item in projects"
                :key="item.id"
                :label="item.project_name"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select
              v-model="filters.status"
              multiple
              collapse-tags
              collapse-tags-tooltip
              clearable
              placeholder="可多选状态"
            >
              <el-option label="草稿" value="draft" />
              <el-option label="未登记" value="unregistered" />
              <el-option label="已填报" value="submitted" />
              <el-option label="已收件" value="received" />
              <el-option label="已成批" value="batched" />
              <el-option label="待审批" value="pending_approval" />
              <el-option label="已审批" value="approved" />
              <el-option label="已放款" value="paid" />
              <el-option label="已拒绝" value="rejected" />
              <el-option label="已废止" value="cancelled" />
            </el-select>
          </el-form-item>
          <el-form-item label="通道">
            <el-select
              v-model="filters.channel"
              clearable
              placeholder="全部通道"
            >
              <el-option label="实物信封" value="physical" />
              <el-option label="电子发票" value="electronic" />
            </el-select>
          </el-form-item>
          <el-form-item label="申请人">
            <el-select
              v-model="filters.applicant_userid"
              clearable
              filterable
              :disabled="isWorkspaceRoute && workflowView === 'submission'"
              :placeholder="
                isWorkspaceRoute && workflowView === 'submission'
                  ? '我的提交'
                  : '全部申请人'
              "
            >
              <el-option
                v-for="item in wecomUsers"
                :key="item.userid"
                :label="`${item.name} (${item.userid})`"
                :value="item.userid"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="关键字">
            <el-input
              v-model="filters.keyword"
              clearable
              placeholder="编号/UUID/发票号"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="loadData">查询</el-button>
          </el-form-item>
        </div>
      </el-form>
    </section>

    <section v-if="isEnvelopeWorkflow" class="table-panel">
      <el-table
        :data="list"
        :loading="loading"
        :row-class-name="tableRowClassName"
      >
        <el-table-column prop="envelope_no" label="信封编号" width="150" />
        <el-table-column label="项目" width="180">
          <template #default="scope">{{
            projectMap[scope.row.project_id] || scope.row.project_id
          }}</template>
        </el-table-column>
        <el-table-column label="填报人" width="140">
          <template #default="scope">{{
            toApplicantLabel(scope.row.applicant_userid)
          }}</template>
        </el-table-column>
        <el-table-column label="通道类型" width="120">
          <template #default="scope">
            <el-tag
              :type="scope.row.channel === 'physical' ? 'info' : 'success'"
              effect="light"
            >
              {{ channelLabel(scope.row.channel) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="amount" label="金额" width="100" />
        <el-table-column label="报销内容" min-width="180" show-overflow-tooltip>
          <template #default="scope">{{
            scope.row.description || "-"
          }}</template>
        </el-table-column>
        <el-table-column label="异常提示" min-width="220">
          <template #default="scope">
            <el-space wrap>
              <el-tag
                v-for="tag in rowAnomalyTags(scope.row)"
                :key="tag.label"
                :type="tag.type"
                size="small"
                effect="light"
              >
                {{ tag.label }}
              </el-tag>
              <span v-if="rowAnomalyTags(scope.row).length === 0">-</span>
            </el-space>
          </template>
        </el-table-column>
        <el-table-column label="复核" width="100">
          <template #default="scope">{{
            precheckStatusLabel(scope.row.precheck_status)
          }}</template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="scope">
            <el-tag :type="statusTagType[scope.row.status] || 'info'">{{
              statusLabel(scope.row.status)
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180" />
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="goDetail(scope.row.id)"
              >详情</el-button
            >
            <template v-if="workflowView !== 'submission' && canOfficeOps">
              <el-button link @click="onTriggerAnomaly(scope.row.id)"
                >智能核查</el-button
              >
              <el-button
                v-if="['submitted', 'received'].includes(scope.row.status)"
                link
                type="info"
                @click="onRerunSilentReview(scope.row.id)"
                >二次静默审查</el-button
              >
              <el-button
                v-if="scope.row.status === 'received'"
                link
                type="success"
                @click="onPrecheck(scope.row.id, 'approved')"
                >复核通过</el-button
              >
              <el-button
                v-if="scope.row.status === 'received'"
                link
                type="warning"
                @click="onPrecheck(scope.row.id, 'supplement')"
                >补充材料</el-button
              >
              <el-button
                v-if="scope.row.status === 'received'"
                link
                type="danger"
                @click="onPrecheck(scope.row.id, 'rejected')"
                >复核驳回</el-button
              >
            </template>
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
    </section>

    <section v-else-if="workflowView === 'approval'" class="embedded-workflow">
      <ReimbursementBatchCenter />
    </section>

    <section v-else-if="workflowView === 'payout'" class="embedded-workflow">
      <ReimbursementPayoutCenter />
    </section>
  </div>

  <el-dialog
    v-model="quickScanDialogVisible"
    title="扫码/输入UUID打开信封"
    width="500px"
  >
    <el-form label-width="90px">
      <el-form-item label="信封UUID" required>
        <el-input
          v-model="quickScanUuid"
          placeholder="请粘贴或扫码录入信封UUID"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="quickScanDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submitQuickScan">打开信封</el-button>
    </template>
  </el-dialog>

  <el-drawer
    v-model="detailDrawerVisible"
    title="报销详情"
    size="82%"
    destroy-on-close
    append-to-body
    class="reimbursement-detail-drawer"
    @closed="onDetailDrawerClosed"
  >
    <ReimbursementDetail
      v-if="activeDetailId !== null"
      :envelope-id="activeDetailId"
      drawer-mode
      :workspace-view="isWorkspaceRoute"
      @close="closeDetailDrawer"
      @changed="onDetailChanged"
    />
  </el-drawer>
</template>

<style scoped>
.reimbursement-list-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header,
.filter-panel,
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

.page-subtitle {
  margin-top: 4px;
  color: #6b7280;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.workflow-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.workflow-step {
  display: flex;
  min-height: 72px;
  padding: 12px 14px;
  text-align: left;
  cursor: pointer;
  background: #ffffff;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  flex-direction: column;
  justify-content: center;
}

.workflow-step span {
  font-weight: 600;
  color: #1f2937;
}

.workflow-step small {
  margin-top: 6px;
  color: #6b7280;
}

.workflow-step--active {
  background: #ecf5ff;
  border-color: #409eff;
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

.filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(220px, 1fr));
  gap: 0 20px;
}

.filter-grid :deep(.el-select),
.filter-grid :deep(.el-input) {
  width: 100%;
}

.pagination {
  justify-content: flex-end;
  margin-top: 12px;
}

.embedded-workflow :deep(.page-header) {
  margin-top: 0;
}

:deep(.el-table .reimbursement-row-high-risk > td) {
  background: #fff2f0 !important;
}

@media (max-width: 960px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .summary-grid,
  .workflow-steps,
  .filter-grid {
    grid-template-columns: 1fr;
  }
}
</style>
