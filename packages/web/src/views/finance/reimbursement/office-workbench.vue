<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  channelLabel,
  precheckStatusLabel,
  statusLabel
} from "@/utils/enum-labels";
import { listProjects, type Project } from "@/api/project";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import {
  getReimbursementWorkbenchSummary,
  listReimbursementEnvelopes,
  precheckEnvelope,
  resolveReimbursementEnvelopeByUuid,
  triggerEnvelopeAnomalyCheck,
  type ReimbursementEnvelope,
  type ReimbursementWorkbenchSummary
} from "@/api/reimbursement";
import {
  reimbursementStatusTagType,
  rowAnomalyTags,
  tableRowClassName
} from "./reimbursement-labels";
import ReimbursementBatchCenter from "./batch.vue";
import ReimbursementPayoutCenter from "./payout.vue";
import ReimbursementDetail from "./detail.vue";
import { resolveStation } from "./reimbursement-station";

defineOptions({ name: "ReimbursementOfficeWorkbench" });

type Step = "intake" | "batch" | "payout";
type IntakeTab = "to_receive" | "to_precheck" | "to_batch";

const INTAKE_QUERY: Record<
  IntakeTab,
  { status: string[]; precheck?: string[] }
> = {
  to_receive: { status: ["submitted"] },
  to_precheck: {
    status: ["received"],
    precheck: ["none", "pending", "supplement"]
  },
  to_batch: { status: ["received"], precheck: ["approved"] }
};

const router = useRouter();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const step = ref<Step>("intake");
const intakeTab = ref<IntakeTab>("to_receive");
const loading = ref(false);
const list = ref<ReimbursementEnvelope[]>([]);
const projects = ref<Project[]>([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const summary = ref<ReimbursementWorkbenchSummary | null>(null);

const quickScanVisible = ref(false);
const quickScanUuid = ref("");
const detailDrawerVisible = ref(false);
const activeDetailId = ref<number | null>(null);

const createIdempotencyKey = (scope: string) =>
  `${scope}-${crypto.randomUUID()}`;

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const userNameMap = computed(() => {
  const map = new Map<string, string>();
  wecomUsers.value.forEach(item =>
    map.set(item.userid, item.name || item.userid)
  );
  return map;
});

const toApplicantLabel = (userid: string | null | undefined) =>
  userid ? (userNameMap.value.get(userid) ?? userid) : "-";

const steps = computed(() => [
  {
    key: "intake" as Step,
    label: "① 签收与复核",
    count: (summary.value?.to_receive ?? 0) + (summary.value?.to_precheck ?? 0)
  },
  {
    key: "batch" as Step,
    label: "② 成批送审",
    count:
      (summary.value?.to_batch ?? 0) + (summary.value?.batches_to_submit ?? 0)
  },
  {
    key: "payout" as Step,
    label: "③ 付款",
    count: summary.value?.batches_to_pay ?? 0
  }
]);

const intakeTabs = computed(() => [
  {
    key: "to_receive" as IntakeTab,
    label: "待签收",
    count: summary.value?.to_receive
  },
  {
    key: "to_precheck" as IntakeTab,
    label: "待复核",
    count: summary.value?.to_precheck
  },
  {
    key: "to_batch" as IntakeTab,
    label: "待成批",
    count: summary.value?.to_batch
  }
]);

const loadSummary = async () => {
  try {
    const result = await getReimbursementWorkbenchSummary();
    summary.value = result.data;
  } catch {
    summary.value = null;
  }
};

let loadSeq = 0;

const loadData = async () => {
  if (step.value !== "intake") return;
  const seq = ++loadSeq;
  loading.value = true;
  try {
    const preset = INTAKE_QUERY[intakeTab.value];
    const result = await listReimbursementEnvelopes({
      page: page.value,
      pageSize: pageSize.value,
      status: preset.status.join(","),
      precheck_status: preset.precheck?.join(","),
      exclude_cancelled: false
    });
    // 竞态防护:快速切换子页签时,丢弃过期响应
    if (seq !== loadSeq) return;
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
};

const queryMode = ref(false);
const queryKeyword = ref("");
const queryList = ref<ReimbursementEnvelope[]>([]);
const queryTotal = ref(0);
const queryLoading = ref(false);

let querySeq = 0;

const runQuery = async () => {
  const kw = queryKeyword.value.trim();
  if (!kw) {
    message("请输入信封号 / UUID / 发票号 / 事由关键字", { type: "warning" });
    return;
  }
  const seq = ++querySeq;
  queryMode.value = true;
  queryLoading.value = true;
  try {
    const result = await listReimbursementEnvelopes({
      page: 1,
      pageSize: 50,
      keyword: kw,
      exclude_cancelled: false
    });
    // 竞态防护:快速连查慢响应,丢弃过期结果
    if (seq !== querySeq) return;
    queryList.value = result.data;
    queryTotal.value = result.pagination.total;
  } catch {
    if (seq === querySeq) {
      message("查询失败,请稍后重试", { type: "error" });
    }
  } finally {
    if (seq === querySeq) queryLoading.value = false;
  }
};

const exitQuery = () => {
  queryMode.value = false;
  queryKeyword.value = "";
  queryList.value = [];
  queryTotal.value = 0;
};

const stationLabel = (row: ReimbursementEnvelope) => resolveStation(row).label;

const goBatchDetail = (row: ReimbursementEnvelope) => {
  const station = resolveStation(row);
  if (station.batchId) {
    router.push(`/finance/reimbursement/batch/${station.batchId}`);
  } else {
    openDetail(row.id);
  }
};

const switchStep = (next: Step) => {
  step.value = next;
  // 从成批/付款步骤操作后回来,徽标需刷新
  loadSummary();
  if (next === "intake") {
    page.value = 1;
    loadData();
  }
};

const switchIntakeTab = (tab: IntakeTab) => {
  intakeTab.value = tab;
  page.value = 1;
  loadData();
};

const refreshAll = async () => {
  await Promise.all([loadData(), loadSummary()]);
};

const goCreate = () => router.push("/finance/reimbursement/detail/create");
const goEnvelopeGenerator = () =>
  router.push("/finance/reimbursement/envelope-generator");

const openDetail = (id: number) => {
  activeDetailId.value = id;
  detailDrawerVisible.value = true;
};
const onDetailDrawerClosed = () => {
  activeDetailId.value = null;
};
const onDetailChanged = async () => {
  if (queryMode.value) {
    // 查询模式下抽屉里签收/复核后,重查以刷新「当前站点」
    await Promise.all([runQuery(), loadSummary()]);
  } else {
    await refreshAll();
  }
};

const openQuickScan = () => {
  quickScanUuid.value = "";
  quickScanVisible.value = true;
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
  quickScanVisible.value = false;
  openDetail(result.data.id);
};

const onTriggerAnomaly = async (id: number) => {
  await triggerEnvelopeAnomalyCheck(id);
  message("已触发智能核查", { type: "success" });
  await refreshAll();
};

const onRerunSilentReview = async (id: number) => {
  await triggerEnvelopeAnomalyCheck(
    id,
    { rerun_full: true, reason: "office_manual_second_silent_review" },
    {
      idempotencyKey: createIdempotencyKey("reimbursement-rerun-silent-review")
    }
  );
  message("已触发二次静默审查", { type: "success" });
  await refreshAll();
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
    await refreshAll();
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
    await refreshAll();
  }
};

const goToBatchStep = () => switchStep("batch");

onMounted(async () => {
  await Promise.all([
    listProjects({ page: 1, pageSize: 300 }).then(res => {
      projects.value = res.data;
    }),
    loadWecomUsers(),
    loadSummary()
  ]);
  await loadData();
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <!-- 顶部动作区 -->
    <div class="office-toolbar">
      <el-space wrap>
        <el-input
          v-model="queryKeyword"
          placeholder="全流程查询:信封号 / UUID / 发票号 / 事由"
          clearable
          style="width: 320px; margin-right: 12px"
          @keyup.enter="runQuery"
          @clear="exitQuery"
        >
          <template #append>
            <el-button @click="runQuery">查询</el-button>
          </template>
        </el-input>
        <el-button type="success" @click="goCreate">代员工发起</el-button>
        <el-button @click="openQuickScan">UUID 快速签收</el-button>
        <el-button @click="goEnvelopeGenerator">信封生成器</el-button>
      </el-space>
    </div>

    <template v-if="!queryMode">
      <!-- 步骤条 -->
      <div class="office-steps">
        <button
          v-for="s in steps"
          :key="s.key"
          type="button"
          class="office-step"
          :class="{ 'office-step--active': step === s.key }"
          @click="switchStep(s.key)"
        >
          <span>{{ s.label }}</span>
          <el-badge
            v-if="s.count > 0"
            :value="s.count"
            :max="99"
            class="office-step__badge"
          />
        </button>
      </div>

      <!-- 第①步:签收与复核 -->
      <section v-if="step === 'intake'">
        <el-tabs
          :model-value="intakeTab"
          @tab-change="key => switchIntakeTab(key as IntakeTab)"
        >
          <el-tab-pane v-for="tab in intakeTabs" :key="tab.key" :name="tab.key">
            <template #label>
              {{ tab.label
              }}<el-badge
                v-if="tab.count"
                :value="tab.count"
                :max="99"
                class="tab-badge"
              />
            </template>
          </el-tab-pane>
        </el-tabs>

        <el-table
          v-loading="loading"
          :data="list"
          :row-class-name="tableRowClassName"
        >
          <el-table-column prop="envelope_no" label="信封编号" width="150" />
          <el-table-column label="项目" width="160">
            <template #default="scope">{{
              projectMap[scope.row.project_id] || scope.row.project_id
            }}</template>
          </el-table-column>
          <el-table-column label="填报人" width="130">
            <template #default="scope">{{
              toApplicantLabel(scope.row.applicant_userid)
            }}</template>
          </el-table-column>
          <el-table-column label="通道" width="90">
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
          <el-table-column
            label="报销内容"
            min-width="160"
            show-overflow-tooltip
          >
            <template #default="scope">{{
              scope.row.description || "-"
            }}</template>
          </el-table-column>
          <el-table-column label="异常提示" min-width="200">
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
          <el-table-column label="复核" width="90">
            <template #default="scope">{{
              precheckStatusLabel(scope.row.precheck_status)
            }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="scope">
              <el-tag
                :type="reimbursementStatusTagType[scope.row.status] || 'info'"
                >{{ statusLabel(scope.row.status) }}</el-tag
              >
            </template>
          </el-table-column>
          <el-table-column label="操作" width="300" fixed="right">
            <template #default="scope">
              <el-button
                v-if="intakeTab === 'to_receive'"
                link
                type="success"
                @click="openDetail(scope.row.id)"
                >签收</el-button
              >
              <template v-if="intakeTab === 'to_precheck'">
                <el-button
                  link
                  type="success"
                  @click="onPrecheck(scope.row.id, 'approved')"
                  >复核通过</el-button
                >
                <el-button
                  link
                  type="warning"
                  @click="onPrecheck(scope.row.id, 'supplement')"
                  >补充材料</el-button
                >
                <el-button
                  link
                  type="danger"
                  @click="onPrecheck(scope.row.id, 'rejected')"
                  >复核驳回</el-button
                >
                <el-button link @click="onTriggerAnomaly(scope.row.id)"
                  >智能核查</el-button
                >
                <el-button
                  link
                  type="info"
                  @click="onRerunSilentReview(scope.row.id)"
                  >二次静默审查</el-button
                >
              </template>
              <el-button
                v-if="intakeTab === 'to_batch'"
                link
                type="primary"
                @click="goToBatchStep"
                >去成批 →</el-button
              >
              <el-button link type="primary" @click="openDetail(scope.row.id)"
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

      <!-- 第②步:成批送审 -->
      <section v-else-if="step === 'batch'" class="embedded-workflow">
        <ReimbursementBatchCenter />
      </section>

      <!-- 第③步:付款 -->
      <section v-else-if="step === 'payout'" class="embedded-workflow">
        <ReimbursementPayoutCenter />
      </section>
    </template>

    <!-- 全流程查询结果 -->
    <section v-else class="query-panel">
      <div class="query-panel__head">
        <span
          >全流程查询结果（显示 {{ queryList.length }} / 共
          {{ queryTotal }} 条）</span
        >
        <el-button link type="primary" @click="exitQuery">返回工作台</el-button>
      </div>
      <el-table v-loading="queryLoading" :data="queryList">
        <el-table-column prop="envelope_no" label="信封编号" width="150" />
        <el-table-column label="填报人" width="130">
          <template #default="scope">{{
            toApplicantLabel(scope.row.applicant_userid)
          }}</template>
        </el-table-column>
        <el-table-column label="项目" width="160">
          <template #default="scope">{{
            projectMap[scope.row.project_id] || scope.row.project_id
          }}</template>
        </el-table-column>
        <el-table-column prop="amount" label="金额" width="100" />
        <el-table-column label="状态" width="110">
          <template #default="scope">
            <el-tag
              :type="reimbursementStatusTagType[scope.row.status] || 'info'"
              >{{ statusLabel(scope.row.status) }}</el-tag
            >
          </template>
        </el-table-column>
        <el-table-column label="当前站点" min-width="150">
          <template #default="scope">
            <strong>{{ stationLabel(scope.row) }}</strong>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="openDetail(scope.row.id)"
              >详情</el-button
            >
            <el-button
              v-if="scope.row.batch_id"
              link
              type="warning"
              @click="goBatchDetail(scope.row)"
              >批次详情</el-button
            >
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="quickScanVisible" title="UUID 快速签收" width="420px">
      <el-input v-model="quickScanUuid" placeholder="粘贴信封UUID" clearable />
      <template #footer>
        <el-button @click="quickScanVisible = false">取消</el-button>
        <el-button type="primary" @click="submitQuickScan">打开信封</el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="detailDrawerVisible"
      title="报销信封详情"
      size="70%"
      @closed="onDetailDrawerClosed"
    >
      <ReimbursementDetail
        v-if="activeDetailId !== null"
        :envelope-id="activeDetailId"
        drawer-mode
        @close="detailDrawerVisible = false"
        @changed="onDetailChanged"
      />
    </el-drawer>
  </el-card>
</template>

<style scoped>
.office-toolbar {
  margin-bottom: 12px;
}
.office-steps {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
.office-step {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 12px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
}
.office-step--active {
  border-color: #2563eb;
  color: #2563eb;
  box-shadow: 0 2px 10px rgb(37 99 235 / 12%);
}
.office-step__badge,
.tab-badge {
  margin-left: 2px;
}
.pagination {
  margin-top: 12px;
  justify-content: flex-end;
}
.embedded-workflow {
  margin-top: 8px;
}
.query-panel__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-weight: 600;
}
:deep(.reimbursement-row-high-risk) {
  background: #fef2f2;
}
</style>
