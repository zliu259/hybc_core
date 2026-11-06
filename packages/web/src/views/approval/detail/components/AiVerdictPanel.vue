<script setup lang="ts">
/**
 * AI 审查结论。先给判定和一句话理由，再列需要人关注的项；通过的项和完整报告折叠，
 * 审批人想深究时再展开。每次结论都说明 AI 实际读了多少附件。
 */
import { computed, ref, watch } from "vue";
import type { AiGateReview } from "@/api/approval";
import AiReviewReport from "@/components/AiReviewReport/index.vue";
import CoverageNote from "@/components/AiReviewReport/CoverageNote.vue";
import {
  humanizeAiText,
  toFindingDimensionLabel,
  toFindingStatusLabel,
  toFindingStatusTagType
} from "@/utils/ai-review";
import { formatBeijingDateTime } from "@/utils/datetime";
import { toStatusLabel } from "../../labels";
import { toAiVerdict } from "../ai-verdict";
import type { AiReport } from "../useApprovalDetail";
import ApprovalPanel from "./ApprovalPanel.vue";

defineOptions({ name: "AiVerdictPanel" });

const props = defineProps<{
  /** 按 created_at 倒序，首条是最新结论 */
  reviews: AiGateReview[];
  bizType: string;
  report: AiReport;
  contractResult?: string | null;
  contractStatus?: string | null;
  paymentResult?: string | null;
}>();

const latest = computed<AiGateReview | null>(() => props.reviews[0] ?? null);
const earlier = computed(() => props.reviews.slice(1));
const verdict = computed(() =>
  latest.value ? toAiVerdict(latest.value) : null
);

const RUNNING = ["pending", "assigned", "running"];
const isRunning = computed(
  () => !!latest.value && RUNNING.includes(latest.value.status)
);
const isFailed = computed(
  () => !!latest.value && ["failed", "timeout"].includes(latest.value.status)
);

const findings = computed(() => latest.value?.findings ?? []);
const concerns = computed(() =>
  findings.value.filter(item => item.status !== "pass")
);
const passed = computed(() =>
  findings.value.filter(item => item.status === "pass")
);
const recommendations = computed(() =>
  (latest.value?.recommendations ?? []).map(humanizeAiText)
);

const showPassed = ref(false);
// 有关卡结论时报告折叠；没有时报告就是唯一内容，直接展开
const openReports = ref<string[]>(latest.value ? [] : ["report"]);
watch(latest, review => {
  showPassed.value = false;
  openReports.value = review ? [] : ["report"];
});

/** 还没跑过审查的业务不显示报告入口：点开只有一张空状态图。 */
const reportTitle = computed(() => {
  const ran = (status: string | null | undefined) =>
    !!status && status !== "none";
  if (props.bizType === "payment_request") {
    return ran(props.report.status) ||
      props.report.result ||
      props.paymentResult
      ? "付款风控报告"
      : "";
  }
  if (props.bizType === "reimbursement_batch") {
    return ran(props.report.status) || props.report.result
      ? "报销批次审计报告"
      : "";
  }
  return ran(props.contractStatus) || props.contractResult
    ? "合同审查报告"
    : "";
});

const reimbursementAudit = computed(() =>
  typeof props.report.result === "string"
    ? props.report.result
    : JSON.stringify(props.report.result ?? "-", null, 2)
);
</script>

<template>
  <ApprovalPanel title="AI 审查">
    <template v-if="latest" #extra>
      <el-tag v-if="isRunning" type="warning">审查中</el-tag>
      <el-tag v-else-if="isFailed" type="danger">审查失败</el-tag>
      <el-tag v-else-if="verdict" :type="verdict.tagType">
        {{ verdict.label }}
      </el-tag>
    </template>

    <template v-if="latest">
      <p v-if="isRunning" class="ai-verdict__summary">
        AI 正在读取附件并审查，不影响你现在审批。
      </p>
      <p v-else-if="isFailed" class="ai-verdict__summary">
        AI 这次没有得出结论，请人工审核。{{ latest.error_message }}
      </p>
      <p v-else-if="verdict" class="ai-verdict__summary">
        {{ verdict.summary }}
      </p>

      <CoverageNote
        v-if="latest.evidence_coverage"
        :coverage="latest.evidence_coverage"
      />

      <ul v-if="concerns.length > 0" class="ai-verdict__findings">
        <li v-for="item in concerns" :key="item.dimension">
          <el-tag :type="toFindingStatusTagType(item.status)" size="small">
            {{ toFindingStatusLabel(item.status) }}
          </el-tag>
          <div>
            <strong>{{ toFindingDimensionLabel(item.dimension) }}</strong>
            <span>{{ humanizeAiText(item.detail) }}</span>
            <p v-if="item.evidence">{{ humanizeAiText(item.evidence) }}</p>
          </div>
        </li>
      </ul>

      <div v-if="recommendations.length > 0" class="ai-verdict__block">
        <div class="ai-verdict__label">建议</div>
        <ul class="ai-verdict__list">
          <li v-for="(item, index) in recommendations" :key="index">
            {{ item }}
          </li>
        </ul>
      </div>

      <el-button
        v-if="passed.length > 0"
        link
        size="small"
        class="ai-verdict__toggle"
        @click="showPassed = !showPassed"
      >
        {{ showPassed ? "收起" : `另有 ${passed.length} 项未见异常` }}
      </el-button>
      <ul v-if="showPassed" class="ai-verdict__findings">
        <li v-for="item in passed" :key="item.dimension">
          <el-tag type="success" size="small">
            {{ toFindingStatusLabel(item.status) }}
          </el-tag>
          <div>
            <strong>{{ toFindingDimensionLabel(item.dimension) }}</strong>
            <span>{{ humanizeAiText(item.detail) }}</span>
          </div>
        </li>
      </ul>
    </template>

    <p v-if="!latest && !reportTitle" class="ai-verdict__none">
      这笔审批没有经过 AI 审查，请人工核对。
    </p>

    <el-collapse
      v-if="reportTitle || earlier.length > 0"
      v-model="openReports"
      class="ai-verdict__collapse"
    >
      <el-collapse-item v-if="reportTitle" :title="reportTitle" name="report">
        <AiReviewReport
          v-if="bizType === 'payment_request'"
          kind="payment"
          :source="report.result ?? paymentResult"
          :status="report.status"
        />
        <template v-else-if="bizType === 'reimbursement_batch'">
          <el-tag size="small">{{ toStatusLabel(report.status) }}</el-tag>
          <pre class="ai-verdict__raw">{{ reimbursementAudit }}</pre>
        </template>
        <AiReviewReport
          v-else
          kind="contract"
          :source="contractResult"
          :status="contractStatus"
        />
      </el-collapse-item>
      <el-collapse-item
        v-if="earlier.length > 0"
        :title="`此前 ${earlier.length} 次审查结论`"
        name="earlier"
      >
        <ul class="ai-verdict__earlier">
          <li v-for="item in earlier" :key="item.task_id">
            <el-tag :type="toAiVerdict(item).tagType" size="small">
              {{ toAiVerdict(item).label }}
            </el-tag>
            <span>{{ toAiVerdict(item).summary }}</span>
            <time>{{ formatBeijingDateTime(item.completed_at) }}</time>
          </li>
        </ul>
      </el-collapse-item>
    </el-collapse>
  </ApprovalPanel>
</template>

<style scoped>
.ai-verdict__summary {
  margin: 0 0 12px;
  font-size: 15px;
  line-height: 1.6;
  color: var(--el-text-color-primary);
  word-break: break-word;
}

.ai-verdict__none {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.ai-verdict__findings {
  padding: 0;
  margin: 0;
  list-style: none;
}

.ai-verdict__findings li {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 8px 0;
  font-size: 13px;
  line-height: 1.6;
  border-top: 1px solid var(--el-border-color-extra-light);
}

.ai-verdict__findings li > .el-tag {
  flex: none;
  margin-top: 1px;
}

.ai-verdict__findings strong {
  margin-right: 8px;
  font-weight: 600;
}

.ai-verdict__findings p {
  margin: 2px 0 0;
  color: var(--el-text-color-secondary);
}

.ai-verdict__block {
  margin-top: 10px;
}

.ai-verdict__label {
  margin-bottom: 2px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.ai-verdict__list {
  padding-left: 18px;
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
}

.ai-verdict__toggle {
  margin-top: 8px;
}

.ai-verdict__collapse {
  margin-top: 12px;
  border-bottom: none;
}

.ai-verdict__earlier {
  padding: 0;
  margin: 0;
  list-style: none;
}

.ai-verdict__earlier li {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  padding: 6px 0;
  font-size: 13px;
  line-height: 1.6;
}

.ai-verdict__earlier time {
  color: var(--el-text-color-secondary);
}

.ai-verdict__raw {
  padding: 8px;
  margin: 8px 0 0;
  overflow-x: auto;
  font-size: 12px;
  word-break: break-word;
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}
</style>
