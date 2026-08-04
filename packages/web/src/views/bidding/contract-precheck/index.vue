<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  adoptPrecheckIssue,
  confirmPrecheckSigned,
  createPrecheck,
  deletePrecheck,
  getPrecheck,
  listPrechecks,
  reviewPrecheck,
  transferPrecheck,
  type CreatePrecheckPayload,
  type PrecheckDetail,
  type PrecheckListRow,
  type PrecheckResult,
  type TransferPrecheckPayload
} from "@/api/contract-precheck";
import { formatBeijingDateTime } from "@/utils/datetime";
import PrecheckCreateDialog from "./components/PrecheckCreateDialog.vue";
import TransferDialog from "./components/TransferDialog.vue";
import { buildOpinionList } from "./lib/opinion-list";
import {
  dimensionLabelMap,
  directionLabelMap,
  overallLabelMap,
  overallTagTypeMap,
  severityLabelMap,
  severityTagTypeMap,
  statusLabelMap,
  statusTagTypeMap,
  toLabel,
  toTagType
} from "./labels";

defineOptions({ name: "ContractPrecheck" });

const route = useRoute();
const router = useRouter();

// ─── 列表态 ──────────
const rows = ref<PrecheckListRow[]>([]);
const listLoading = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const loadList = async () => {
  listLoading.value = true;
  try {
    const res = await listPrechecks(page.value, pageSize.value);
    rows.value = res.data ?? [];
    total.value = res.pagination?.total ?? 0;
  } catch {
    ElMessage.error("加载预审列表失败");
  } finally {
    listLoading.value = false;
  }
};

// ─── 详情态 ──────────
const detail = ref<PrecheckDetail | null>(null);
const detailLoading = ref(false);
const reviewStartedAt = ref<number | null>(null);
const elapsedSeconds = ref(0);
let elapsedTimer: ReturnType<typeof setInterval> | null = null;
let pollGeneration = 0;

const currentId = computed(() => {
  const raw = route.query.id;
  const id = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(id) && id > 0 ? id : null;
});

const result = computed<PrecheckResult | null>(() => {
  if (!detail.value?.review_result_json) return null;
  try {
    const parsed = JSON.parse(
      detail.value.review_result_json
    ) as PrecheckResult;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
});

const adoptedIndexes = computed<Set<number>>(() => {
  const set = new Set<number>();
  if (!detail.value?.adopted_json) return set;
  try {
    const parsed = JSON.parse(detail.value.adopted_json) as unknown;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const index = (item as { issue_index?: unknown })?.issue_index;
        if (typeof index === "number") set.add(index);
      }
    }
  } catch {
    // 忽略损坏的采纳记录
  }
  return set;
});

const startElapsedTimer = (startedAtMs: number) => {
  reviewStartedAt.value = startedAtMs;
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    if (reviewStartedAt.value) {
      elapsedSeconds.value = Math.max(
        0,
        Math.round((Date.now() - reviewStartedAt.value) / 1000)
      );
    }
  }, 1000);
};

const stopElapsedTimer = () => {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
  reviewStartedAt.value = null;
  elapsedSeconds.value = 0;
};

onBeforeUnmount(() => {
  stopElapsedTimer();
  pollGeneration += 1;
});

const loadDetail = async (id: number) => {
  // 抢占代数：快速切换 A→B 时，迟到的 A 响应不得覆盖 B 的详情/轮询
  const generation = ++pollGeneration;
  detailLoading.value = true;
  try {
    const fresh = await getPrecheck(id);
    if (generation !== pollGeneration || currentId.value !== id) return;
    detail.value = fresh;
    if (fresh.status === "reviewing") {
      const startedMs = Date.parse(fresh.updated_at) || Date.now();
      startElapsedTimer(startedMs);
      void pollUntilDone(id, generation);
    }
  } catch {
    if (generation === pollGeneration) {
      ElMessage.error("加载预审单失败");
      detail.value = null;
    }
  } finally {
    if (generation === pollGeneration) detailLoading.value = false;
  }
};

/** 轮询业务行状态直到脱离 reviewing（2s × 180 ≈ 6 分钟上限；只轮询不重新入队） */
const pollUntilDone = async (id: number, generation: number) => {
  for (let i = 0; i < 180; i++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    if (generation !== pollGeneration || currentId.value !== id) return;
    try {
      const fresh = await getPrecheck(id);
      if (generation !== pollGeneration || currentId.value !== id) return;
      detail.value = fresh;
      if (fresh.status !== "reviewing") {
        stopElapsedTimer();
        if (fresh.status === "review_failed") {
          ElMessage.error("AI 预审失败，请重试");
        } else {
          ElMessage.success("AI 预审完成");
        }
        return;
      }
    } catch {
      // 单次轮询失败继续重试
    }
  }
  stopElapsedTimer();
  ElMessage.error("AI 预审超时，请稍后刷新查看");
};

const openDetail = (id: number) => {
  void router.replace({ query: { id: String(id) } });
  void loadDetail(id);
};

const backToList = () => {
  pollGeneration += 1;
  stopElapsedTimer();
  detail.value = null;
  void router.replace({ query: {} });
  void loadList();
};

// ─── 新建 / 复审 ──────────
const createDialogVisible = ref(false);
const reviewDialogVisible = ref(false);
const submitting = ref(false);

const onCreateSubmit = async (payload: CreatePrecheckPayload) => {
  submitting.value = true;
  try {
    const created = await createPrecheck(payload);
    createDialogVisible.value = false;
    ElMessage.success(`预审单 ${created.precheck_no} 已创建，AI 审计中`);
    openDetail(created.id);
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, "创建失败"));
  } finally {
    submitting.value = false;
  }
};

const onReviewResubmit = async (payload: CreatePrecheckPayload) => {
  if (!detail.value) return;
  submitting.value = true;
  try {
    await reviewPrecheck(detail.value.id, {
      file_key: payload.file_key,
      file_name: payload.file_name,
      file_size: payload.file_size,
      contract_text: payload.contract_text
    });
    reviewDialogVisible.value = false;
    ElMessage.success("已发起复审");
    void loadDetail(detail.value.id);
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, "复审发起失败"));
  } finally {
    submitting.value = false;
  }
};

const onRerunSameFile = async () => {
  if (!detail.value) return;
  try {
    await ElMessageBox.confirm(
      "用当前文件重新执行 AI 预审（约 1-2 分钟），是否继续？",
      "重新预审",
      { type: "info" }
    );
  } catch {
    return;
  }
  try {
    await reviewPrecheck(detail.value.id);
    ElMessage.success("已发起复审");
    void loadDetail(detail.value.id);
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, "复审发起失败"));
  }
};

// ─── 采纳 / 意见清单 ──────────
const opinionOnlyAdopted = ref(false);

const opinionText = computed(() => {
  if (!detail.value || !result.value) return "";
  return buildOpinionList(
    detail.value.title,
    result.value.issues ?? [],
    opinionOnlyAdopted.value ? adoptedIndexes.value : null,
    result.value.rule_findings ?? []
  );
});

const adoptPending = ref(false);

const onToggleAdopt = async (index: number) => {
  // 在途防重：服务端是读改写，快速连点会丢采纳状态
  if (!detail.value || adoptPending.value) return;
  adoptPending.value = true;
  const next = !adoptedIndexes.value.has(index);
  try {
    await adoptPrecheckIssue(detail.value.id, index, next);
    detail.value = await getPrecheck(detail.value.id);
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, "操作失败"));
  } finally {
    adoptPending.value = false;
  }
};

const onCopyOpinions = async () => {
  try {
    await navigator.clipboard.writeText(opinionText.value);
    ElMessage.success("修改意见清单已复制，可粘贴发送给对方");
  } catch {
    ElMessage.error("复制失败，请手动选择文本复制");
  }
};

// ─── 确认签署 / 转入合同 ──────────
const transferDialogVisible = ref(false);

const onConfirmSigned = async () => {
  if (!detail.value) return;
  let comment = "";
  try {
    const input = await ElMessageBox.prompt(
      "确认已与对方就修改意见完成沟通，并完成合同签署？确认后即可转入合同台账发起我方审批。",
      "确认签署",
      {
        inputPlaceholder: "备注（选填）：如签署日期、沟通结论",
        inputType: "textarea"
      }
    );
    comment =
      typeof input === "object" && typeof input.value === "string"
        ? input.value
        : "";
  } catch {
    return;
  }
  try {
    await confirmPrecheckSigned(detail.value.id, comment || undefined);
    ElMessage.success("已确认签署");
    detail.value = await getPrecheck(detail.value.id);
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, "确认失败"));
  }
};

const onTransferSubmit = async (payload: TransferPrecheckPayload) => {
  if (!detail.value) return;
  submitting.value = true;
  try {
    const res = await transferPrecheck(detail.value.id, payload);
    transferDialogVisible.value = false;
    ElMessage.success(
      `已创建草稿合同 ${res.contract_no}，请补全信息后提交审批`
    );
    void router.push(`/finance/contract/detail/${res.contract_id}`);
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, "转入失败"));
  } finally {
    submitting.value = false;
  }
};

const onDelete = async (row: PrecheckListRow) => {
  try {
    await ElMessageBox.confirm(`删除预审单 ${row.precheck_no}？`, "删除", {
      type: "warning"
    });
  } catch {
    return;
  }
  try {
    await deletePrecheck(row.id);
    ElMessage.success("已删除");
    void loadList();
  } catch (e) {
    ElMessage.error(apiErrorMessage(e, "删除失败"));
  }
};

const goContract = () => {
  if (detail.value?.contract_id) {
    void router.push(`/finance/contract/detail/${detail.value.contract_id}`);
  }
};

const apiErrorMessage = (e: unknown, fallback: string): string => {
  if (e && typeof e === "object" && "response" in e) {
    const response = (
      e as { response?: { data?: { error?: { message?: string } } } }
    ).response;
    const message = response?.data?.error?.message;
    if (typeof message === "string" && message) return message;
  }
  if (e instanceof Error && e.message) return e.message;
  return fallback;
};

onMounted(() => {
  if (currentId.value) {
    void loadDetail(currentId.value);
  }
  void loadList();
});
</script>

<template>
  <div v-loading="detailLoading" class="precheck-page">
    <!-- ─── 详情态 ─── -->
    <template v-if="currentId && detail">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <div>
              <span class="title">{{ detail.title }}</span>
              <el-tag
                :type="toTagType(statusTagTypeMap, detail.status)"
                style="margin-left: 8px"
              >
                {{ toLabel(statusLabelMap, detail.status) }}
              </el-tag>
            </div>
            <div class="actions">
              <el-button size="small" @click="backToList">返回列表</el-button>
            </div>
          </div>
        </template>

        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="预审单号">{{
            detail.precheck_no
          }}</el-descriptions-item>
          <el-descriptions-item label="我方立场">
            {{ toLabel(directionLabelMap, detail.direction) }}
          </el-descriptions-item>
          <el-descriptions-item label="对方主体">{{
            detail.counterparty || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="合同文件">{{
            detail.file_name || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="审计轮次"
            >第 {{ detail.current_round }} 轮</el-descriptions-item
          >
          <el-descriptions-item label="更新时间">
            {{ formatBeijingDateTime(detail.updated_at) }}
          </el-descriptions-item>
        </el-descriptions>

        <!-- 流程动作 -->
        <div class="action-row">
          <el-button
            v-if="
              ['passed', 'reviewed', 'review_failed'].includes(detail.status)
            "
            @click="reviewDialogVisible = true"
          >
            上传新版本复审
          </el-button>
          <el-button
            v-if="
              ['passed', 'reviewed', 'review_failed'].includes(detail.status)
            "
            @click="onRerunSameFile"
          >
            重新预审当前文件
          </el-button>
          <el-tooltip
            :disabled="detail.status === 'passed'"
            content="需最新一轮预审无「明显错误」后才能确认签署"
            placement="top"
          >
            <el-button
              v-if="['passed', 'reviewed'].includes(detail.status)"
              type="primary"
              :disabled="detail.status !== 'passed'"
              @click="onConfirmSigned"
            >
              确认已与对方完成签署
            </el-button>
          </el-tooltip>
          <el-button
            v-if="detail.status === 'signed'"
            type="primary"
            @click="transferDialogVisible = true"
          >
            转入合同台账
          </el-button>
          <el-button
            v-if="detail.contract_id"
            type="success"
            plain
            @click="goContract"
          >
            查看已转入合同
          </el-button>
        </div>

        <!-- 审计中 -->
        <el-alert
          v-if="detail.status === 'reviewing'"
          type="warning"
          :closable="false"
          class="reviewing-alert"
        >
          <template #title>
            AI 预审进行中（约 1-2 分钟）… 已运行
            {{ elapsedSeconds }} 秒，可离开本页稍后回来查看
          </template>
        </el-alert>
        <el-alert
          v-else-if="detail.status === 'review_failed'"
          type="error"
          :closable="false"
          title="AI 预审失败，请点击「重新预审当前文件」重试"
          class="reviewing-alert"
        />

        <!-- 审计结果 -->
        <template v-if="result && detail.status !== 'reviewing'">
          <el-divider>预审结论</el-divider>
          <div class="summary-row">
            <el-tag
              :type="toTagType(overallTagTypeMap, result.overall)"
              size="large"
            >
              {{ toLabel(overallLabelMap, result.overall) }}
            </el-tag>
            <span class="summary-text">{{ result.summary }}</span>
          </div>
          <el-alert
            v-if="result.unparsed"
            type="error"
            :closable="false"
            title="AI 输出无法解析，以下为原始输出，请人工判断"
            style="margin-top: 8px"
          />
          <pre v-if="result.unparsed && result.raw_output" class="raw-output">{{
            result.raw_output
          }}</pre>

          <template v-if="result.issues.length > 0">
            <el-divider
              >AI 审计问题（{{ result.issues.length }} 条）</el-divider
            >
            <div
              v-for="(issue, index) in result.issues"
              :key="index"
              class="issue-card"
            >
              <div class="issue-head">
                <el-tag
                  size="small"
                  :type="toTagType(severityTagTypeMap, issue.severity)"
                >
                  {{ toLabel(severityLabelMap, issue.severity) }}
                </el-tag>
                <el-tag size="small" type="info" effect="plain">
                  {{ toLabel(dimensionLabelMap, issue.dimension) }}
                </el-tag>
                <span class="issue-problem">{{ issue.problem }}</span>
                <el-button
                  size="small"
                  :type="adoptedIndexes.has(index) ? 'success' : 'default'"
                  :plain="!adoptedIndexes.has(index)"
                  class="adopt-btn"
                  :loading="adoptPending"
                  :disabled="
                    !['passed', 'reviewed', 'signed'].includes(detail.status)
                  "
                  @click="onToggleAdopt(index)"
                >
                  {{ adoptedIndexes.has(index) ? "已采纳 ✓" : "采纳建议" }}
                </el-button>
              </div>
              <div v-if="issue.quote" class="issue-quote">
                原文：{{ issue.quote }}
              </div>
              <div v-if="issue.suggestion" class="issue-suggestion">
                建议修改为：{{ issue.suggestion }}
              </div>
            </div>
          </template>

          <template v-if="result.rule_findings.length > 0">
            <el-divider
              >规则红线命中（{{ result.rule_findings.length }} 条）</el-divider
            >
            <div
              v-for="(finding, index) in result.rule_findings"
              :key="`rule-${index}`"
              class="issue-card"
              :class="finding.level === 'red' ? 'rule-red' : 'rule-yellow'"
            >
              <div class="issue-head">
                <el-tag
                  size="small"
                  :type="finding.level === 'red' ? 'danger' : 'warning'"
                >
                  {{ finding.level === "red" ? "明显错误" : "关注" }}
                </el-tag>
                <span class="issue-problem">{{ finding.reason }}</span>
              </div>
              <div class="issue-quote">原文：{{ finding.text }}</div>
              <div v-if="finding.legal_basis" class="issue-basis">
                依据:{{ finding.legal_basis }}
              </div>
            </div>
          </template>

          <template
            v-if="result.issues.length > 0 || result.rule_findings.length > 0"
          >
            <el-divider>修改意见清单</el-divider>
            <div class="opinion-toolbar">
              <el-switch
                v-model="opinionOnlyAdopted"
                active-text="仅含已采纳"
                inactive-text="全部意见"
              />
              <el-button type="primary" size="small" @click="onCopyOpinions">
                一键复制清单
              </el-button>
            </div>
            <pre class="opinion-preview">{{ opinionText }}</pre>
          </template>
        </template>
      </el-card>
    </template>

    <!-- ─── 列表态 ─── -->
    <template v-else>
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <div>
              <span class="title">合同预审</span>
              <span class="subtitle">
                上传对方提供的合同，AI 多维合规审计 +
                硬性红线规则；无明显错误并完成签署后可转入合同台账发起审批
              </span>
            </div>
            <el-button type="primary" @click="createDialogVisible = true"
              >新建预审</el-button
            >
          </div>
        </template>
        <el-table v-loading="listLoading" :data="rows" size="small">
          <el-table-column prop="precheck_no" label="单号" width="170" />
          <el-table-column prop="title" label="合同标题" min-width="200" />
          <el-table-column label="方向" width="150">
            <template #default="scope">
              {{ toLabel(directionLabelMap, scope.row.direction) }}
            </template>
          </el-table-column>
          <el-table-column label="状态" width="130">
            <template #default="scope">
              <el-tag
                size="small"
                :type="toTagType(statusTagTypeMap, scope.row.status)"
              >
                {{ toLabel(statusLabelMap, scope.row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="current_round" label="轮次" width="70" />
          <el-table-column label="更新时间" width="170">
            <template #default="scope">
              {{ formatBeijingDateTime(scope.row.updated_at) }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="140" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="openDetail(scope.row.id)"
                >打开</el-button
              >
              <el-button
                v-if="scope.row.status !== 'transferred'"
                link
                type="danger"
                @click="onDelete(scope.row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="pager">
          <el-pagination
            v-model:current-page="page"
            v-model:page-size="pageSize"
            layout="prev, pager, next, total"
            :total="total"
            @current-change="loadList"
          />
        </div>
      </el-card>
    </template>

    <PrecheckCreateDialog
      v-model:visible="createDialogVisible"
      :submitting="submitting"
      @submit="onCreateSubmit"
    />
    <PrecheckCreateDialog
      v-model:visible="reviewDialogVisible"
      review-only
      :submitting="submitting"
      @submit="onReviewResubmit"
    />
    <TransferDialog
      v-if="detail"
      v-model:visible="transferDialogVisible"
      :submitting="submitting"
      :counterparty="detail.counterparty"
      :direction-label="toLabel(directionLabelMap, detail.direction)"
      @submit="onTransferSubmit"
    />
  </div>
</template>

<style scoped>
.precheck-page {
  padding: 12px;
}
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
.subtitle {
  margin-left: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.reviewing-alert {
  margin-top: 12px;
}
.summary-row {
  display: flex;
  gap: 12px;
  align-items: center;
}
.summary-text {
  font-size: 14px;
}
.raw-output {
  max-height: 240px;
  padding: 8px;
  margin-top: 8px;
  overflow: auto;
  font-size: 12px;
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}
.issue-card {
  padding: 10px 12px;
  margin-bottom: 8px;
  background: var(--el-fill-color-blank);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
}
.issue-card.rule-red {
  border-color: var(--el-color-danger-light-5);
  background: var(--el-color-danger-light-9);
}
.issue-card.rule-yellow {
  border-color: var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
}
.issue-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.issue-problem {
  font-weight: 600;
}
.adopt-btn {
  margin-left: auto;
}
.issue-quote {
  margin-top: 6px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.issue-suggestion {
  margin-top: 4px;
  font-size: 13px;
  color: var(--el-color-success-dark-2);
}
.issue-basis {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.opinion-toolbar {
  display: flex;
  gap: 16px;
  align-items: center;
  margin-bottom: 8px;
}
.opinion-preview {
  max-height: 320px;
  padding: 12px;
  overflow: auto;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
  border-radius: 6px;
}
.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
