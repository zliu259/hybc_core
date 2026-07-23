<script setup lang="ts">
import { computed } from "vue";
import { ElMessageBox } from "element-plus";
import type {
  CheckVersion,
  CompletenessReport,
  CompletenessResult,
  CompletenessSectionIssue
} from "@/api/contract-draft";
import { completenessModelShortName } from "../lib/completeness-report";
import {
  requiredLevelLabelMap,
  toDraftLabel,
  type DraftTagType
} from "../draft-labels";

const props = defineProps<{
  visible: boolean;
  /** 当前查看版本的递进结果（initial 初版 + audit 复核） */
  report: CompletenessReport | null;
  /** 历史检查版本（倒序，最新在前） */
  versions: CheckVersion[];
  /** 当前查看的版本 id（版本切换器选中值，也是一键修正的 checkId） */
  currentVersionId: number | null;
  /** 本次弹窗内已一键采纳修正稿的节 key（按钮变「已采纳」禁用） */
  appliedKeys: string[];
  /** 需从缺失列表隐藏的 key（已忽略 + 已添加处理） */
  ignored: string[];
}>();
const emit = defineEmits<{
  (e: "update:visible", v: boolean): void;
  (e: "switch-version", checkId: number): void;
  (e: "add", sectionKey: string): void;
  (e: "ignore", sectionKey: string): void;
  (e: "locate", sectionKey: string): void;
  (e: "apply-revision", sectionKey: string): void;
}>();

const initialResult = computed<CompletenessResult | null>(
  () => props.report?.initial.result ?? null
);
const auditResult = computed<CompletenessResult | null>(
  () => props.report?.audit.result ?? null
);
const initialModel = computed(() =>
  completenessModelShortName(props.report?.initial.model ?? "")
);
const auditModel = computed(() =>
  completenessModelShortName(props.report?.audit.model ?? "")
);
const initialReady = computed(
  () => initialResult.value?.ready_to_finalize === true
);
const auditReady = computed(
  () => auditResult.value?.ready_to_finalize === true
);
const isTruncated = computed(
  () =>
    initialResult.value?._truncated === true ||
    auditResult.value?._truncated === true
);

// 缺失节以复核（audit）结论为准；隐藏已忽略/已添加处理的 key，被驳回的仍展示（灰显）
const missingItems = computed(() =>
  (auditResult.value?.missing ?? []).filter(
    m => !props.ignored.includes(m.section_key)
  )
);
const issueGroups = computed<CompletenessSectionIssue[]>(
  () => auditResult.value?.section_issues ?? []
);

const summaryText = (r: CompletenessResult | null): string => {
  if (!r) return "";
  if (r.overall_summary) return r.overall_summary;
  return typeof r.raw === "string" ? "模型输出未能解析为结构化结果" : "";
};

const VERDICT_LABEL: Record<string, string> = {
  confirmed: "复核确认",
  rejected: "复核驳回",
  added: "复核新增"
};
const VERDICT_TAG: Record<string, DraftTagType> = {
  confirmed: "success",
  rejected: "info",
  added: "warning"
};
const verdictLabel = (v: string): string => VERDICT_LABEL[v] ?? v;
const verdictTagType = (v: string): DraftTagType => VERDICT_TAG[v] ?? "info";
const isRejected = (verdict?: string): boolean => verdict === "rejected";

const pad = (n: number): string => String(n).padStart(2, "0");
const formatVersionTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
};
// 倒序列表：index 0 是最新 = 第 N 次（N=总数）
const versionOptions = computed(() =>
  props.versions.map((v, i) => ({
    value: v.id,
    label: `第${props.versions.length - i}次检查 · ${formatVersionTime(v.created_at)}`
  }))
);

const canApply = (g: CompletenessSectionIssue): boolean =>
  g.revision_approved === true && (g.revised_content ?? "").trim().length > 0;
const isApplied = (sectionKey: string): boolean =>
  props.appliedKeys.includes(sectionKey);

const onApplyRevision = async (g: CompletenessSectionIssue) => {
  if (!canApply(g) || isApplied(g.section_key)) return;
  const revised = g.revised_content ?? "";
  const preview = revised.slice(0, 100);
  try {
    await ElMessageBox.confirm(
      `修正稿预览：${preview}${revised.length > 100 ? "…" : ""}　采纳后将覆盖「${g.title}」当前正文，且需重新完整检查才能定稿。`,
      "采纳修正稿",
      {
        type: "warning",
        confirmButtonText: "采纳修正稿",
        cancelButtonText: "取消"
      }
    );
  } catch {
    return;
  }
  emit("apply-revision", g.section_key);
};
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="完整检查结果（定稿门禁）"
    width="660px"
    @update:model-value="v => emit('update:visible', v)"
  >
    <div v-if="versions.length" class="version-switch">
      <span class="version-switch-label">检查版本</span>
      <el-select
        :model-value="currentVersionId"
        size="small"
        class="version-select"
        @change="(v: number) => emit('switch-version', v)"
      >
        <el-option
          v-for="opt in versionOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
    </div>

    <el-alert
      v-if="isTruncated"
      type="warning"
      :closable="false"
      show-icon
      title="本次检查结果因输出过长被截断，仅展示已完成部分；建议补齐关键信息后重新检查。"
      class="truncated-alert"
    />

    <div v-if="report" class="summary">
      <div class="summary-row">
        <span class="summary-label">初版（{{ initialModel }}）</span>
        <el-tag size="small" :type="initialReady ? 'success' : 'warning'">
          {{ initialReady ? "可定稿" : "建议先修改" }}
        </el-tag>
        <span class="summary-text">{{ summaryText(initialResult) }}</span>
      </div>
      <div class="summary-row summary-audit">
        <span class="summary-label">复核结论（{{ auditModel }}）</span>
        <el-tag size="small" :type="auditReady ? 'success' : 'warning'">
          {{ auditReady ? "可定稿" : "建议先修改" }}
        </el-tag>
        <span class="summary-text">{{ summaryText(auditResult) }}</span>
      </div>
    </div>

    <div class="area-title">缺失的节</div>
    <el-empty
      v-if="!missingItems.length"
      description="复核未指出缺失的节"
      :image-size="48"
    />
    <ul v-else class="hint-list">
      <li
        v-for="m in missingItems"
        :key="m.section_key"
        :class="{ 'is-rejected': isRejected(m.verdict) }"
      >
        <div class="hint-head">
          <el-tag
            size="small"
            :type="m.level === 'core' ? 'danger' : 'warning'"
          >
            {{ toDraftLabel(requiredLevelLabelMap, m.level) }}
          </el-tag>
          <b class="hint-title">{{ m.title }}</b>
          <el-tag
            v-if="m.verdict"
            size="small"
            :type="verdictTagType(m.verdict)"
            class="verdict-tag"
          >
            {{ verdictLabel(m.verdict) }}
          </el-tag>
        </div>
        <div class="hint-reason">{{ m.reason }}</div>
        <div v-if="m.audit_note" class="audit-note">
          复核意见：{{ m.audit_note }}
        </div>
        <div v-if="isRejected(m.verdict)" class="rejected-hint">
          复核已驳回，可不处理
        </div>
        <div v-else class="hint-actions">
          <el-button
            size="small"
            type="primary"
            plain
            @click="emit('add', m.section_key)"
            >添加该节</el-button
          >
          <el-button size="small" @click="emit('ignore', m.section_key)"
            >忽略（留痕）</el-button
          >
        </div>
      </li>
    </ul>

    <template v-if="issueGroups.length">
      <div class="area-title">逐节问题</div>
      <div v-for="g in issueGroups" :key="g.section_key" class="issue-group">
        <div
          class="group-title"
          :title="`定位到「${g.title}」`"
          @click="emit('locate', g.section_key)"
        >
          {{ g.title }}
          <span class="locate-hint">点击定位到该节</span>
        </div>
        <ul class="issue-list">
          <li
            v-for="(issue, i) in g.issues"
            :key="i"
            :class="{ 'is-rejected': isRejected(issue.verdict) }"
          >
            <div class="issue-head">
              <el-tag
                size="small"
                :type="issue.severity === 'red' ? 'danger' : 'warning'"
              >
                {{ issue.severity === "red" ? "红" : "黄" }}
              </el-tag>
              <span class="issue-text"
                >「{{ issue.text }}」{{ issue.reason }}</span
              >
              <el-tag
                v-if="issue.verdict"
                size="small"
                :type="verdictTagType(issue.verdict)"
                class="verdict-tag"
              >
                {{ verdictLabel(issue.verdict) }}
              </el-tag>
            </div>
            <div v-if="issue.suggestion" class="issue-suggestion">
              建议：{{ issue.suggestion }}
            </div>
            <div v-if="issue.audit_note" class="audit-note">
              复核意见：{{ issue.audit_note }}
            </div>
          </li>
        </ul>
        <div class="group-footer">
          <template v-if="canApply(g)">
            <el-button
              v-if="!isApplied(g.section_key)"
              size="small"
              type="warning"
              @click="onApplyRevision(g)"
            >
              一键采纳修正稿
            </el-button>
            <el-button v-else size="small" type="success" plain disabled>
              已采纳
            </el-button>
          </template>
          <span v-else class="no-revision-hint">
            复核未通过修正稿，请手动修改
          </span>
        </div>
      </div>
    </template>

    <div class="dialog-note">
      完整检查通过后即可定稿；再次修改任何内容需重新检查。修正稿已经复核模型把关，可放心一键采纳。
    </div>
  </el-dialog>
</template>

<style scoped>
.version-switch {
  display: flex;
  gap: 8px;
  align-items: center;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.version-switch-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.version-select {
  width: 240px;
}

.summary {
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--el-fill-color-lighter);
  border-radius: 6px;
}

.summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: baseline;
  margin-bottom: 6px;
}

.summary-row:last-child {
  margin-bottom: 0;
}

.summary-label {
  flex: none;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.summary-text {
  flex: 1;
  min-width: 0;
  color: var(--el-text-color-regular);
}

/* 复核为最终结论，加重强调 */
.summary-audit {
  padding-top: 6px;
  border-top: 1px dashed var(--el-border-color);
}

.summary-audit .summary-label {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.summary-audit .summary-text {
  font-weight: 500;
  color: var(--el-text-color-primary);
}

.area-title {
  margin: 10px 0 4px;
  font-weight: 600;
}

.hint-list {
  padding: 0;
  margin: 0;
  list-style: none;
}

.hint-list li {
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.hint-head {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.hint-title {
  margin-left: 2px;
}

.verdict-tag {
  margin-left: 2px;
}

.hint-reason {
  margin: 4px 0;
  color: var(--el-text-color-secondary);
}

.audit-note {
  margin: 2px 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.rejected-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

/* 复核驳回项：整体灰显 + 删除线，弱化存在感 */
.is-rejected {
  color: var(--el-text-color-placeholder);
  text-decoration: line-through;
  opacity: 0.7;
}

.is-rejected .audit-note,
.is-rejected .rejected-hint {
  text-decoration: none;
}

.hint-actions {
  margin-top: 4px;
  text-align: right;
}

.issue-group {
  padding-bottom: 6px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.group-title {
  font-weight: 600;
  cursor: pointer;
}

.group-title:hover {
  color: var(--el-color-primary);
}

.locate-hint {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.issue-list {
  padding-left: 8px;
  margin: 4px 0 0;
  list-style: none;
}

.issue-list li {
  margin-bottom: 6px;
}

.issue-head {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.issue-text {
  margin-left: 2px;
}

.issue-suggestion {
  margin-left: 8px;
  color: var(--el-text-color-secondary);
}

.group-footer {
  margin-top: 6px;
  text-align: right;
}

.no-revision-hint {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}

.dialog-note {
  margin-top: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
