<script setup lang="ts">
import type { RewriteParagraph } from "../lib/rewrite";

const props = defineProps<{
  status: string;
  error: string;
  originals: RewriteParagraph[];
  rewrites: ReadonlyMap<string, string>;
  accepted: ReadonlyMap<string, string>;
}>();
const emit = defineEmits<{
  (e: "accept", id: string): void;
  (e: "skip", id: string): void;
  (e: "accept-all"): void;
}>();
</script>

<template>
  <div class="rewrite-panel">
    <div v-if="props.status === 'pending' || props.status === 'running'" class="hint">
      AI 改写中…
    </div>
    <div v-else-if="props.status === 'failed' || props.status === 'timeout'" class="hint err">
      {{ props.error }}
    </div>
    <template v-else-if="props.status === 'completed'">
      <el-button size="small" type="primary" @click="emit('accept-all')">全部采纳</el-button>
      <div v-for="o in props.originals" :key="o.id" class="row">
        <div class="orig">原文：{{ o.text }}</div>
        <div class="new">改写：{{ props.rewrites.get(o.id) ?? "（无建议）" }}</div>
        <div class="ops">
          <el-tag v-if="props.accepted.has(o.id)" type="success">已采纳</el-tag>
          <template v-else>
            <el-button size="small" :disabled="!props.rewrites.has(o.id)" @click="emit('accept', o.id)">采纳</el-button>
            <el-button size="small" @click="emit('skip', o.id)">跳过</el-button>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.row { border-top: 0.5px solid var(--el-border-color); padding: 8px 0; }
.new { color: var(--el-color-success); }
.hint { color: var(--el-text-color-secondary); }
.hint.err { color: var(--el-color-danger); }
</style>
