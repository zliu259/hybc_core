<script setup lang="ts">
import { computed } from "vue";
import { requiredLevelLabelMap, toDraftLabel } from "../draft-labels";

export interface MissingHint {
  section_key: string;
  title: string;
  level: string;
  reason: string;
}

const props = defineProps<{
  visible: boolean;
  missing: MissingHint[];
  ignored: string[];
}>();
const emit = defineEmits<{
  (e: "update:visible", v: boolean): void;
  (e: "add", sectionKey: string): void;
  (e: "ignore", sectionKey: string): void;
}>();

const pending = computed(() =>
  props.missing.filter(m => !props.ignored.includes(m.section_key))
);
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="完整性检查提示（仅提示，不阻塞）"
    width="560px"
    @update:model-value="v => emit('update:visible', v)"
  >
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
  </el-dialog>
</template>

<style scoped>
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

.hint-reason {
  margin: 4px 0;
  color: var(--el-text-color-secondary);
}

.hint-actions {
  text-align: right;
}
</style>
