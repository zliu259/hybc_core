<script setup lang="ts">
/**
 * 业务级 AI 审查报告的统一渲染（合同审查 / 付款风控）——区别于 AI 关卡的
 * 放行/拦截判定，这里展示模型给出的完整事实结论供审批人决策。
 *
 * 存量数据同时存在两代形状：0076 提示词重写前模型自行编分数的旧结构，
 * 与重写后「分数由 postprocess 依 findings/clause_analysis 确定性计算」的
 * 新结构（postprocess 对旧结果原样透传）。所有字段按可选处理，旧结构降级
 * 成同样的表格呈现，不做假定、不吞内容。
 */
import { computed } from "vue";
import {
  normalizeAiFindings,
  toFindingDimensionLabel,
  toFindingStatusLabel,
  toFindingStatusTagType,
  toRiskScoreBandLabel,
  toRiskScoreBandTagType,
  type AiRiskFinding,
  type AiTagType
} from "@/utils/ai-review";

defineOptions({ name: "AiReviewReport" });

const props = defineProps<{
  /**
   * 报告来源：既接落库的原始 JSON 文本（contract.ai_review_result /
   * payment_request.ai_risk_result），也接服务端已解析好的对象
   * （/contract/:id/ai-review、/payment/:id/risk-report 的 result）。
   */
  source?: string | Record<string, unknown> | null;
  kind: "contract" | "payment";
  /** ai_review_status / ai_risk_status：none|pending|completed|failed */
  status?: string | null;
}>();

interface ClauseRow {
  clause: string;
  risk_level: string;
  issue: string;
  suggestion: string;
}

const RISK_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高"
};

const RISK_TAGS: Record<string, AiTagType> = {
  low: "success",
  medium: "warning",
  high: "danger"
};

/**
 * amount_assessment.reasonableness 是「合理程度」而非风险等级——模型按字面
 * 输出（生产 CT-20260805-0001：reasonableness=low 同时列了 4 条 risk_points，
 * 指金额依据不足），所以此处色板必须与风险轴相反：低=红、高=绿。
 */
const REASONABLENESS_TAGS: Record<string, AiTagType> = {
  low: "danger",
  medium: "warning",
  high: "success"
};

const toRiskLabel = (value: unknown): string =>
  typeof value === "string" ? (RISK_LABELS[value] ?? value) : "-";

const toRiskTagType = (value: unknown): AiTagType =>
  typeof value === "string" ? (RISK_TAGS[value] ?? "info") : "info";

const toReasonablenessTagType = (value: unknown): AiTagType =>
  typeof value === "string" ? (REASONABLENESS_TAGS[value] ?? "info") : "info";

const asString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const asStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string" && !!item.trim()
      )
    : [];

/** 容错解析：剥 markdown 围栏、截取首尾花括号，失败返回 null 而不抛 */
const report = computed<Record<string, unknown> | null>(() => {
  const raw = props.source;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, "")
    .trim();
  const candidates = [stripped];
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start)
    candidates.push(stripped.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // 尝试下一个候选
    }
  }
  return null;
});

const score = computed<number | null>(() => {
  const value = report.value?.score;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
});

/**
 * 只有确定性计分的结果（带 score_basis 键）才展示分档签：旧结果的分数是模型
 * 自己编的，跨单不可比，打上「高风险（≥50）」会让人误以为同一把尺子量出来的。
 */
const scoreIsDeterministic = computed(() =>
  Array.isArray(report.value?.score_basis)
);

const overallRisk = computed(() => asString(report.value?.overall_risk));
const summary = computed(() => asString(report.value?.summary));
const scoreBasis = computed(() => asStringList(report.value?.score_basis));
const recommendations = computed(() =>
  asStringList(report.value?.recommendations)
);

/** 合同条款：新结构 issue/suggestion，旧结构只有 comment，一并归一 */
const clauses = computed<ClauseRow[]>(() => {
  const raw = report.value?.clause_analysis;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object"
    )
    .map(item => ({
      clause: asString(item.clause) || "未命名条款",
      risk_level: asString(item.risk_level) || "medium",
      issue: asString(item.issue) || asString(item.comment),
      suggestion: asString(item.suggestion)
    }));
});

/** 付款风控发现项；旧结构没有 findings，用三段 *_check 合成等价行 */
const findings = computed<AiRiskFinding[]>(() => {
  const normalized = normalizeAiFindings(report.value?.findings);
  if (normalized.length > 0) return normalized;

  const legacy: AiRiskFinding[] = [];
  const pushLegacy = (
    dimension: string,
    node: unknown,
    abnormalKey: "is_abnormal" | "found_duplicates"
  ) => {
    if (!node || typeof node !== "object") return;
    const row = node as Record<string, unknown>;
    const comment = asString(row.comment);
    if (!comment) return;
    legacy.push({
      dimension,
      status: row[abnormalKey] === true ? "warn" : "pass",
      detail: comment,
      evidence: ""
    });
  };
  pushLegacy("frequency_anomaly", report.value?.frequency_check, "is_abnormal");
  pushLegacy("overpayment", report.value?.amount_check, "is_abnormal");
  pushLegacy(
    "duplicate_payment",
    report.value?.duplicate_check,
    "found_duplicates"
  );
  return legacy;
});

/** 金额评估：新结构 reasonableness/basis/risk_points，旧结构 reasonable/comment */
const amountAssessment = computed(() => {
  const node = report.value?.amount_assessment;
  if (!node || typeof node !== "object") return null;
  const row = node as Record<string, unknown>;
  // 旧结构 reasonable 是布尔的「是否合理」，与新结构同轴：合理→high
  const reasonableness =
    asString(row.reasonableness) ||
    (row.reasonable === true ? "high" : row.reasonable === false ? "low" : "");
  const basis = asString(row.basis) || asString(row.comment);
  const riskPoints = asStringList(row.risk_points);
  if (!reasonableness && !basis && riskPoints.length === 0) return null;
  return { reasonableness, basis, riskPoints };
});

/** 必须与模板实际渲染的内容一一对应：两张表按 kind 门禁，这里也要按 kind 算，
 * 否则「合同形状的载荷传成 payment」会判定有内容却渲染出一张空白卡片 */
const hasBody = computed(
  () =>
    !!summary.value ||
    !!overallRisk.value ||
    score.value !== null ||
    scoreBasis.value.length > 0 ||
    recommendations.value.length > 0 ||
    !!amountAssessment.value ||
    (props.kind === "contract"
      ? clauses.value.length > 0
      : findings.value.length > 0)
);

/**
 * 兜底展示原始内容，避免"有结果却显示空白"。触发条件是「没有可渲染的内容」而不是
 * 「解析失败」——模型未按 schema 输出时（如只给 conclusion 字段）JSON 能解析成功，
 * 但结论会被整段吞掉；服务端对这类结果是原样透传的，此处是最后一道防线。
 * 已解析对象同样兜底：四个调用点里有三个传的是服务端解析好的对象。
 */
const rawFallback = computed(() => {
  if (hasBody.value) return "";
  const raw = props.source;
  if (!raw) return "";
  const text =
    typeof raw === "string" ? raw.trim() : JSON.stringify(raw, null, 2);
  return text ? text.slice(0, 1000) : "";
});

/** 状态不得压过已有内容：重新触发审查时 status=pending，但上一轮报告仍应可见 */
const placeholder = computed(() => {
  if (hasBody.value || rawFallback.value) return "";
  if (props.status === "pending") return "AI 审查进行中，稍后刷新查看";
  if (props.status === "failed") return "AI 审查失败，可在业务详情页重新触发";
  if (!props.source) return "暂无 AI 审查报告";
  return "AI 审查已完成，但未返回可展示的内容";
});

const pendingHint = computed(() =>
  props.status === "pending" && (hasBody.value || rawFallback.value)
    ? "AI 正在重新审查，以下为上一次的结果"
    : ""
);
</script>

<template>
  <div class="ai-review-report">
    <el-empty v-if="placeholder" :description="placeholder" :image-size="60" />
    <template v-else>
      <el-alert
        v-if="pendingHint"
        type="info"
        :title="pendingHint"
        :closable="false"
        show-icon
        style="margin-bottom: 8px"
      />
      <div class="ai-review-report__head">
        <el-tag
          v-if="overallRisk"
          :type="toRiskTagType(overallRisk)"
          size="small"
        >
          整体风险：{{ toRiskLabel(overallRisk) }}
        </el-tag>
        <el-tag
          v-if="score !== null"
          :type="scoreIsDeterministic ? toRiskScoreBandTagType(score) : 'info'"
          size="small"
        >
          风险分 {{ score
          }}<template v-if="scoreIsDeterministic">
            · {{ toRiskScoreBandLabel(score) }}</template
          >
        </el-tag>
      </div>

      <p v-if="summary" class="ai-review-report__summary">{{ summary }}</p>

      <div v-if="scoreBasis.length > 0" class="ai-review-report__block">
        <div class="ai-review-report__label">分数构成</div>
        <ul class="ai-review-report__list">
          <li v-for="(item, index) in scoreBasis" :key="index">{{ item }}</li>
        </ul>
      </div>

      <el-table
        v-if="kind === 'contract' && clauses.length > 0"
        :data="clauses"
        size="small"
        border
        class="ai-review-report__table"
      >
        <el-table-column prop="clause" label="条款" min-width="120" />
        <el-table-column label="风险" width="80">
          <template #default="{ row }">
            <el-tag :type="toRiskTagType(row.risk_level)" size="small">
              {{ toRiskLabel(row.risk_level) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="issue" label="问题" min-width="180" />
        <el-table-column prop="suggestion" label="修改建议" min-width="160" />
      </el-table>

      <el-table
        v-if="kind === 'payment' && findings.length > 0"
        :data="findings"
        size="small"
        border
        class="ai-review-report__table"
      >
        <el-table-column label="维度" width="110">
          <template #default="{ row }">
            {{ toFindingDimensionLabel(row.dimension) }}
          </template>
        </el-table-column>
        <el-table-column label="结论" width="80">
          <template #default="{ row }">
            <el-tag :type="toFindingStatusTagType(row.status)" size="small">
              {{ toFindingStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="detail" label="说明" min-width="180" />
        <el-table-column prop="evidence" label="依据" min-width="160" />
      </el-table>

      <div v-if="amountAssessment" class="ai-review-report__block">
        <div class="ai-review-report__label">
          金额合理性
          <el-tag
            v-if="amountAssessment.reasonableness"
            :type="toReasonablenessTagType(amountAssessment.reasonableness)"
            size="small"
          >
            {{ toRiskLabel(amountAssessment.reasonableness) }}
          </el-tag>
        </div>
        <p v-if="amountAssessment.basis" class="ai-review-report__text">
          {{ amountAssessment.basis }}
        </p>
        <ul
          v-if="amountAssessment.riskPoints.length > 0"
          class="ai-review-report__list"
        >
          <li v-for="(item, index) in amountAssessment.riskPoints" :key="index">
            {{ item }}
          </li>
        </ul>
      </div>

      <div v-if="recommendations.length > 0" class="ai-review-report__block">
        <div class="ai-review-report__label">处理建议</div>
        <ul class="ai-review-report__list">
          <li v-for="(item, index) in recommendations" :key="index">
            {{ item }}
          </li>
        </ul>
      </div>

      <template v-if="rawFallback">
        <div class="ai-review-report__label">
          AI 返回了非标准结构，以下为原始结果
        </div>
        <pre class="ai-review-report__raw">{{ rawFallback }}</pre>
      </template>
    </template>
  </div>
</template>

<style scoped>
.ai-review-report__head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.ai-review-report__summary {
  margin: 0 0 10px;
  font-weight: 500;
  line-height: 1.6;
  color: var(--el-text-color-primary);
}
.ai-review-report__block {
  margin-top: 12px;
}
.ai-review-report__label {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 4px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.ai-review-report__text {
  margin: 0;
  line-height: 1.6;
}
.ai-review-report__list {
  padding-left: 18px;
  margin: 0;
  line-height: 1.7;
}
.ai-review-report__table {
  margin-top: 12px;
}
.ai-review-report__raw {
  padding: 8px;
  margin: 8px 0 0;
  overflow-x: auto;
  font-size: 12px;
  white-space: pre-wrap;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}
</style>
