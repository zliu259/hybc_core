<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
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
  status: "",
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

type WorkflowView = "submission" | "office" | "finance";
const workflowView = ref<WorkflowView>("submission");
const workflowReady = ref(false);

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const statusTagType: Record<string, TagType> = {
  unregistered: "info",
  draft: "info",
  submitted: "warning",
  received: "success",
  batched: "primary",
  pending_approval: "warning",
  approved: "success",
  paid: "primary",
  rejected: "danger"
};

const pdfTagType: Record<string, TagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};

const quickScanDialogVisible = ref(false);
const quickScanUuid = ref("");

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
      status: filters.value.status || undefined,
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
  router.push(`/finance/reimbursement/detail/${id}`);
};

const goBatchCenter = () => {
  router.push("/finance/reimbursement/batch");
};

const goPayoutCenter = () => {
  router.push("/finance/reimbursement/payout");
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
  message("已触发异常检测", { type: "success" });
  await loadData();
};

const onPrecheck = async (
  id: number,
  action: "approved" | "supplement" | "rejected"
) => {
  try {
    await precheckEnvelope(id, { action });
    message(`预审已处理：${action}`, {
      type: action === "approved" ? "success" : "warning"
    });
    await loadData();
  } catch (error) {
    const err = error as {
      response?: { status?: number; data?: { data?: { wait_for_audit?: boolean } } };
    };
    const waitForAudit =
      err.response?.status === 409 && err.response?.data?.data?.wait_for_audit === true;
    if (!waitForAudit) throw error;
    message("审计尚未完成，系统已自动触发审计，请稍后再执行预审通过", {
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
    filters.value.status = "";
    filters.value.channel = "";
    return;
  }

  if (mode === "office") {
    filters.value.applicant_userid = "";
    filters.value.status = "submitted";
    filters.value.channel = "";
    return;
  }

  filters.value.applicant_userid = "";
  filters.value.status = "";
  filters.value.channel = "";
};

const onWorkflowChange = async (mode: WorkflowView) => {
  applyWorkflowPreset(mode);
  page.value = 1;
  await loadData();
};

onMounted(async () => {
  workflowView.value = "submission";

  applyWorkflowPreset(workflowView.value);

  await Promise.all([loadProjects(), loadWecomUsers()]);
  await loadData();
  workflowReady.value = true;
});

watch(workflowView, mode => {
  if (!workflowReady.value) return;
  onWorkflowChange(mode);
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <el-tabs v-model="workflowView">
      <el-tab-pane label="报销提交" name="submission" />
      <el-tab-pane
        v-if="canOfficeOps && !isWorkspaceRoute"
        label="办公室处理与审查"
        name="office"
      />
      <el-tab-pane
        v-if="canFinanceCenter && !isWorkspaceRoute"
        label="财务集中审批与历史"
        name="finance"
      />
    </el-tabs>

    <el-alert
      v-if="workflowView === 'submission'"
      type="info"
      :closable="false"
      :title="
        isWorkspaceRoute
          ? '在这里查看我的报销提交，并可继续发起报销。'
          : '在这里查看全部报销提交；办公室/领导可在此代员工发起报销。'
      "
      style="margin-bottom: 12px"
    />
    <el-alert
      v-if="workflowView === 'office'"
      type="warning"
      :closable="false"
      title="办公室处理台：重点处理 submitted/received 单据，执行收件核查、异常审查和预审动作。"
      style="margin-bottom: 12px"
    />
    <el-alert
      v-if="workflowView === 'finance'"
      type="success"
      :closable="false"
      title="财务集中审批台：按项目+申请人进入集中送审与打款，并查看历史完成批次。"
      style="margin-bottom: 12px"
    />

    <el-form inline>
      <el-form-item label="所属项目">
        <el-select
          v-model="filters.project_id"
          clearable
          filterable
          style="width: 220px"
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
        <el-select v-model="filters.status" clearable style="width: 170px">
          <el-option label="草稿" value="draft" />
          <el-option label="未登记" value="unregistered" />
          <el-option label="已填报" value="submitted" />
          <el-option label="已收件" value="received" />
          <el-option label="已成批" value="batched" />
          <el-option label="待审批" value="pending_approval" />
          <el-option label="已审批" value="approved" />
          <el-option label="已放款" value="paid" />
          <el-option label="已拒绝" value="rejected" />
        </el-select>
      </el-form-item>
      <el-form-item label="通道">
        <el-select v-model="filters.channel" clearable style="width: 160px">
          <el-option label="实物信封" value="physical" />
          <el-option label="电子发票" value="electronic" />
        </el-select>
      </el-form-item>
      <el-form-item label="申请人">
        <el-select
          v-model="filters.applicant_userid"
          clearable
          filterable
          style="width: 220px"
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
      <el-button type="primary" @click="loadData">查询</el-button>
      <el-button
        v-if="workflowView === 'submission'"
        type="success"
        @click="goCreate"
      >
        {{ !isWorkspaceRoute && canOfficeOps ? "代员工发起报销" : "发起报销" }}
      </el-button>

      <el-button v-if="workflowView === 'office'" @click="openQuickScan"
        >扫码/输入UUID打开信封</el-button
      >

      <el-button v-if="workflowView === 'finance'" @click="goBatchCenter"
        >进入集中审批台</el-button
      >
      <el-button v-if="workflowView === 'finance'" @click="goPayoutCenter"
        >进入集中打款台</el-button
      >
      <el-button v-if="!isWorkspaceRoute && canFinanceCenter" type="primary" plain @click="goEnvelopeGenerator"
        >信封生成器</el-button
      >
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="envelope_no" label="信封编号" width="150" />
      <el-table-column prop="envelope_uuid" label="UUID" min-width="240" />
      <el-table-column label="项目" width="180">
        <template #default="scope">{{
          projectMap[scope.row.project_id] || scope.row.project_id
        }}</template>
      </el-table-column>
      <el-table-column prop="applicant_userid" label="填报人" width="140" />
      <el-table-column prop="amount" label="金额" width="100" />
      <el-table-column prop="duplicate_count" label="查重线索" width="100" />
      <el-table-column prop="precheck_status" label="预审" width="100" />
      <el-table-column label="状态" width="110">
        <template #default="scope">
          <el-tag :type="statusTagType[scope.row.status] || 'info'">{{
            scope.row.status
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="PDF" width="110">
        <template #default="scope">
          <el-tag :type="pdfTagType[scope.row.pdf_status] || 'info'">{{
            scope.row.pdf_status
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
              >异常检测</el-button
            >
            <el-button
              v-if="scope.row.status === 'received'"
              link
              type="success"
              @click="onPrecheck(scope.row.id, 'approved')"
              >预审通过</el-button
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
              >预审驳回</el-button
            >
          </template>
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
</template>
