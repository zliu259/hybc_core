<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import type {
  ClauseTemplate,
  ContractDraftSection
} from "@/api/contract-draft";
import {
  buildRenderSegments,
  parseRiskAnnotations,
  type RenderSegment
} from "../lib/segments";
import { instructionPlaceholder } from "../lib/instruction-placeholders";
import type { SectionAiState } from "../composables/useContractDraftAI";
import { sectionSourceLabelMap, toDraftLabel } from "../draft-labels";

const props = defineProps<{
  section: ContractDraftSection;
  keywordValues: Record<string, string>;
  aiState: SectionAiState;
  readonly?: boolean;
  variants?: ClauseTemplate[];
}>();
const emit = defineEmits<{
  (e: "generate", payload: { sectionId: number; instruction: string }): void;
  (e: "review", sectionId: number): void;
  (e: "save", payload: { sectionId: number; content: string }): void;
  (
    e: "apply-variant",
    payload: { sectionId: number; variantKey: string }
  ): void;
  (e: "update-keyword", payload: { key: string; value: string }): void;
}>();

const instruction = ref(props.section.instruction ?? "");
const editing = ref(false);
const editContent = ref("");

// 生成完成后清空指令输入框（指令已随任务入库到 section.instruction，不丢历史）
// 注意：props.aiState 不可解构，watch 必须用 getter 保持响应
watch(
  () => props.aiState.phase,
  (phase, prev) => {
    if (prev === "generating" && phase === "done") instruction.value = "";
  }
);

// 关键字点选编辑：同一时刻仅一个 popover 打开（受控 visible）
const kwEditIndex = ref<number | null>(null);
const kwEditKey = ref("");
const kwEditValue = ref("");
const openKwEdit = (i: number, seg: RenderSegment) => {
  if (props.readonly || !seg.key) return;
  if (kwEditIndex.value === i && kwEditKey.value === seg.key) {
    kwEditIndex.value = null;
    return;
  }
  kwEditKey.value = seg.key;
  kwEditValue.value = seg.text === `{{${seg.key}}}` ? "" : seg.text;
  kwEditIndex.value = i;
};
const confirmKwEdit = () => {
  if (!kwEditKey.value) return;
  emit("update-keyword", {
    key: kwEditKey.value,
    value: kwEditValue.value.trim()
  });
  kwEditIndex.value = null;
};

const busy = computed(
  () =>
    props.aiState.phase === "generating" || props.aiState.phase === "reviewing"
);
const hasVariants = computed(() => (props.variants?.length ?? 0) > 1);
const currentVariantLabel = computed(
  () =>
    props.variants?.find(v => v.variant_key === props.section.variant_key)
      ?.variant_label ?? "默认"
);
const onVariantCommand = async (variantKey: string) => {
  if (variantKey === props.section.variant_key) return;
  const target = props.variants?.find(v => v.variant_key === variantKey);
  try {
    await ElMessageBox.confirm(
      `切换为「${target?.variant_label ?? variantKey}」模版将覆盖本节当前正文（原文已自动快照，可追溯），是否继续？`,
      "切换模版",
      { type: "warning", confirmButtonText: "切换", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  emit("apply-variant", { sectionId: props.section.id, variantKey });
};
const segments = computed(() =>
  buildRenderSegments(
    props.section.content,
    parseRiskAnnotations(props.section.risk_annotations_json),
    props.keywordValues
  )
);
const reviewIssues = computed(() => {
  if (!props.section.review_result_json) return [];
  try {
    const parsed = JSON.parse(props.section.review_result_json) as {
      issues?: Array<{
        text: string;
        severity: string;
        reason: string;
        suggestion?: string;
      }>;
    };
    return parsed.issues ?? [];
  } catch {
    return [];
  }
});

const startEdit = () => {
  editContent.value = props.section.content;
  editing.value = true;
};
const saveEdit = () => {
  emit("save", { sectionId: props.section.id, content: editContent.value });
  editing.value = false;
};
</script>

<template>
  <el-card :id="`section-${section.id}`" class="section-card">
    <template #header>
      <div class="card-header">
        <span>
          {{ section.title }}
          <el-tag size="small" type="info">{{
            toDraftLabel(sectionSourceLabelMap, section.source)
          }}</el-tag>
          <el-dropdown
            v-if="hasVariants"
            size="small"
            :disabled="readonly || busy"
            @command="(k: string) => onVariantCommand(k)"
          >
            <el-button link size="small" type="primary">
              模版：{{ currentVariantLabel }} ▾
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="v in variants"
                  :key="v.variant_key"
                  :command="v.variant_key"
                  :disabled="v.variant_key === section.variant_key"
                >
                  {{ v.variant_label }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </span>
        <span class="actions">
          <el-button
            size="small"
            :loading="busy"
            :disabled="readonly"
            @click="
              emit('generate', { sectionId: section.id, instruction: '' })
            "
          >
            默认生成
          </el-button>
          <el-button
            size="small"
            :loading="busy"
            :disabled="!instruction.trim() || readonly"
            @click="emit('generate', { sectionId: section.id, instruction })"
          >
            按指令生成
          </el-button>
          <el-button
            size="small"
            :loading="busy"
            :disabled="!section.content || readonly"
            @click="emit('review', section.id)"
          >
            AI 交叉审查
          </el-button>
          <el-button
            v-if="!editing && !readonly"
            size="small"
            @click="startEdit"
            >编辑</el-button
          >
        </span>
      </div>
    </template>

    <el-input
      v-model="instruction"
      maxlength="500"
      show-word-limit
      :placeholder="instructionPlaceholder(section.section_key)"
      class="instruction-input"
    />

    <el-alert
      v-if="aiState.phase === 'error'"
      type="error"
      :title="aiState.error"
      :closable="false"
    />

    <div v-if="!editing" class="content-view">
      <template v-for="(seg, i) in segments" :key="i">
        <span v-if="seg.kind === 'plain'">{{ seg.text }}</span>
        <el-popover
          v-else-if="seg.kind === 'keyword'"
          :visible="kwEditIndex === i && kwEditKey === seg.key"
          :disabled="readonly"
          placement="top"
          :width="280"
        >
          <template #reference>
            <span
              class="seg-keyword"
              :class="{ editable: !readonly }"
              :title="
                readonly
                  ? `关键字：${seg.key}`
                  : `关键字：${seg.key}（点击修改）`
              "
              @click="openKwEdit(i, seg)"
              >{{ seg.text }}</span
            >
          </template>
          <div class="kw-edit">
            <div class="kw-edit-key">关键字：{{ seg.key }}</div>
            <el-input
              v-model="kwEditValue"
              size="small"
              maxlength="200"
              @keyup.enter="confirmKwEdit"
            />
            <div class="kw-edit-actions">
              <el-button size="small" @click="kwEditIndex = null"
                >取消</el-button
              >
              <el-button size="small" type="primary" @click="confirmKwEdit"
                >确认</el-button
              >
            </div>
          </div>
        </el-popover>
        <el-tooltip
          v-else
          :content="`${seg.reason}${seg.legalBasis ? '（' + seg.legalBasis + '）' : ''}`"
          placement="top"
        >
          <span
            :class="
              seg.kind === 'risk-red' ? 'seg-risk-red' : 'seg-risk-yellow'
            "
            >{{ seg.text }}</span
          >
        </el-tooltip>
      </template>
      <el-empty
        v-if="!section.content"
        description="尚无正文，点击生成或编辑"
        :image-size="48"
      />
    </div>
    <div v-else>
      <el-input
        v-model="editContent"
        type="textarea"
        :autosize="{ minRows: 6, maxRows: 24 }"
      />
      <div class="edit-actions">
        <el-button size="small" @click="editing = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveEdit"
          >保存</el-button
        >
      </div>
    </div>

    <el-collapse v-if="reviewIssues.length">
      <el-collapse-item :title="`交叉审查发现 ${reviewIssues.length} 个问题`">
        <ul class="review-list">
          <li v-for="(issue, i) in reviewIssues" :key="i">
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
          </li>
        </ul>
      </el-collapse-item>
    </el-collapse>
  </el-card>
</template>

<style scoped>
.card-header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
}

.instruction-input {
  margin-bottom: 8px;
}

.content-view {
  line-height: 1.9;
  white-space: pre-wrap;
}

.seg-keyword {
  padding: 0 3px;
  background: var(--el-color-primary-light-8);
  border-radius: 3px;
}

.seg-keyword.editable {
  cursor: pointer;
}

.seg-keyword.editable:hover {
  background: var(--el-color-primary-light-6);
}

.kw-edit-key {
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.kw-edit-actions {
  margin-top: 8px;
  text-align: right;
}

.seg-risk-red {
  cursor: help;
  background: var(--el-color-danger-light-7);
  border-bottom: 2px solid var(--el-color-danger);
}

.seg-risk-yellow {
  cursor: help;
  background: var(--el-color-warning-light-7);
  border-bottom: 2px solid var(--el-color-warning);
}

.edit-actions {
  margin-top: 8px;
  text-align: right;
}

.review-list {
  padding-left: 8px;
  margin: 0;
  list-style: none;
}

.review-list li {
  margin-bottom: 6px;
}

.issue-text {
  margin-left: 6px;
}

.issue-suggestion {
  margin-left: 6px;
  color: var(--el-text-color-secondary);
}
</style>
