<script setup lang="ts">
import { computed } from "vue";

import type { DocTree } from "@/api/wh/doc-library-types";
import { buildTreeNodes, type DocTreeNode } from "../doc-view";

const props = defineProps<{
  tree: DocTree | null;
  /** 当前选中那一项的 key */
  current: string;
}>();
const emit = defineEmits<{ select: [node: DocTreeNode] }>();

const nodes = computed(() => buildTreeNodes(props.tree));
</script>

<template>
  <el-tree
    :data="nodes"
    node-key="key"
    :current-node-key="props.current"
    :expand-on-click-node="false"
    default-expand-all
    highlight-current
    class="doc-tree"
    @node-click="(node: DocTreeNode) => emit('select', node)"
  >
    <template #default="{ data }">
      <span class="node">
        <span class="label" :title="data.label">{{ data.label }}</span>
        <span v-if="data.count > 0" class="count">{{ data.count }}</span>
      </span>
    </template>
  </el-tree>
</template>

<style scoped>
.doc-tree {
  background: transparent;
}

.node {
  display: flex;
  flex: 1;
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding-right: 8px;
}

.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
