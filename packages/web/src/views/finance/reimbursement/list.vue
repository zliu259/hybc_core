<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
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
  type ReimbursementEnvelope
} from "@/api/reimbursement";
import ReimbursementDetail from "./detail.vue";
import {
  isHighRiskRow,
  reimbursementStatusTagType,
  rowAnomalyTags,
  tableRowClassName
} from "./reimbursement-labels";

defineOptions({ name: "ReimbursementList" });

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

type WorkflowView = "submission";
const workflowView = ref<WorkflowView>("submission");
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

const currentViewTitle = "报销提交";

const currentViewHint = computed(() =>
  isWorkspaceRoute.value
    ? "查看我的报销提交，并可继续发起报销。"
    : "只展示未登记、草稿和已提交条目；后续审批和付款状态请在右侧流程页签处理。"
);

const listedAmountTotal = computed(() =>
  list.value.reduce((sum, item) => sum + Number(item.amount || 0), 0)
);

const highRiskCount = computed(() => list.value.filter(isHighRiskRow).length);

const detailDrawerVisible = ref(false);
const activeDetailId = ref<number | null>(null);

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

const applyWorkflowPreset = () => {
  filters.value.applicant_userid = isWorkspaceRoute.value
    ? currentUserid.value
    : "";
  filters.value.status = [...submissionStatuses];
  filters.value.channel = "";
};

onMounted(async () => {
  applyWorkflowPreset();
  await Promise.all([loadProjects(), loadWecomUsers()]);
  await loadData();
});
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

    <div class="summary-grid">
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
      </el-tabs>

      <el-form class="filter-form" label-width="72px">
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

    <section class="table-panel">
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
            <el-tag
              :type="reimbursementStatusTagType[scope.row.status] || 'info'"
              >{{ statusLabel(scope.row.status) }}</el-tag
            >
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="创建时间" width="180" />
        <el-table-column label="操作" width="320" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="goDetail(scope.row.id)"
              >详情</el-button
            >
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
  </div>

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

:deep(.el-table .reimbursement-row-high-risk > td) {
  background: #fff2f0 !important;
}

@media (max-width: 960px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .summary-grid,
  .filter-grid {
    grid-template-columns: 1fr;
  }
}
</style>
