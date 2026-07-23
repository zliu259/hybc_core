<script setup lang="ts">
import { computed } from "vue";
import type { CompletenessRun } from "@/api/contract-draft";
import {
  completenessModelShortName,
  mergeSectionIssueGroups,
  type MissingHint
} from "../lib/completeness-merge";
import { requiredLevelLabelMap, toDraftLabel } from "../draft-labels";

const props = defineProps<{
  visible: boolean;
  runs: CompletenessRun[];
  missing: MissingHint[];
  ignored: string[];
}>();
const emit = defineEmits<{
  (e: "update:visible", v: boolean): void;
  (e: "add", sectionKey: string): void;
  (e: "ignore", sectionKey: string): void;
  (e: "locate", sectionKey: string): void;
}>();

const pending = computed(() =>
  props.missing.filter(m => !props.ignored.includes(m.section_key))
);

// 每个 run 一行摘要：模型简名 + 结论 + 总体评估文本
const runSummaries = computed(() =>
  props.runs.map(run => ({
    model: completenessModelShortName(run.model),
    ready: run.result.ready_to_finalize === true,
    summary:
      run.result.overall_summary ??
      (typeof run.result.raw === "string" ? "模型输出未能解析为结构化结果" : "")
  }))
);

const issueGroups = computed(() => mergeSectionIssueGroups(props.runs));
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="完整性检查结果（定稿门禁）"
    width="640px"
    @update:model-value="v => emit('update:visible', v)"
  >
    <div v-if="runSummaries.length" class="run-rows">
      <div v-for="(r, i) in runSummaries" :key="i" class="run-row">
        <el-tag size="small" type="info">{{ r.model }}</el-tag>
        <el-tag size="small" :type="r.ready ? 'success' : 'warning'">
          {{ r.ready ? "可定稿" : "建议先修改" }}
        </el-tag>
        <span class="run-summary">{{ r.summary }}</span>
      </div>
    </div>

    <div class="area-title">缺失的节</div>
    <el-empty
      v-if="!pending.length"
      description="没有待处理的遗漏提示"
      :image-size="48"
    />
    <ul v-else class="hint-list">
      <li v-for="m in pending" :key="m.section_key">
        <div>
          <el-tag
            size="small"
            :type="m.level === 'core' ? 'danger' : 'warning'"
          >
            {{ toDraftLabel(requiredLevelLabelMap, m.level) }}
          </el-tag>
          <b class="hint-title">{{ m.title }}</b>
          <el-tag
            v-for="mod in m.models"
            :key="mod"
            size="small"
            type="info"
            class="model-tag"
            >{{ mod }}</el-tag
          >
        </div>
        <div class="hint-reason">{{ m.reason }}</div>
        <div class="hint-actions">
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
          <li v-for="(issue, i) in g.issues" :key="i">
            <el-tag
              size="small"
              :type="issue.severity === 'red' ? 'danger' : 'warning'"
            >
              {{ issue.severity === "red" ? "红" : "黄" }}
            </el-tag>
            <span class="issue-text"
              >「{{ issue.text }}」{{ issue.reason }}</span
            >
            <span v-if="issue.suggestion" class="issue-suggestion"
              >建议：{{ issue.suggestion }}</span
            >
            <el-tag size="small" type="info" class="model-tag">{{
              issue.model
            }}</el-tag>
          </li>
        </ul>
      </div>
    </template>

    <div class="dialog-note">
      完整性检查通过后即可定稿；再次修改任何内容需重新检查
    </div>
  </el-dialog>
</template>

<style scoped>
.run-rows {
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.run-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  margin-bottom: 6px;
}

.run-summary {
  color: var(--el-text-color-regular);
}

.area-title {
  margin: 8px 0 4px;
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

.hint-title {
  margin-left: 6px;
}

.model-tag {
  margin-left: 6px;
}

.hint-reason {
  margin: 4px 0;
  color: var(--el-text-color-secondary);
}

.hint-actions {
  text-align: right;
}

.issue-group {
  margin-bottom: 8px;
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

.issue-text {
  margin-left: 6px;
}

.issue-suggestion {
  margin-left: 6px;
  color: var(--el-text-color-secondary);
}

.dialog-note {
  margin-top: 12px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
