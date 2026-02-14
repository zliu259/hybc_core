<script setup lang="ts">
import type { NodeType } from "./types";

const props = withDefaults(
  defineProps<{
    readonly?: boolean;
  }>(),
  {
    readonly: false
  }
);

const emit = defineEmits<{
  dragstart: [NodeType];
}>();

const paletteItems: Array<{
  type: NodeType;
  label: string;
  icon: string;
  color: string;
}> = [
  { type: "sequential", label: "顺序签", icon: "ep:sort", color: "#3B82F6" },
  { type: "countersign", label: "会签", icon: "ep:check", color: "#10B981" },
  { type: "or_sign", label: "或签", icon: "ep:semi-select", color: "#F59E0B" },
  { type: "auto", label: "自动", icon: "ep:cpu", color: "#6B7280" },
  { type: "cc", label: "抄送", icon: "ep:message", color: "#8B5CF6" },
  { type: "ai_gate", label: "AI关卡", icon: "ep:monitor", color: "#EF4444" }
];

const onDragStart = (event: DragEvent, type: NodeType) => {
  if (props.readonly || !event.dataTransfer) {
    return;
  }

  event.dataTransfer.setData("application/approval-node", type);
  event.dataTransfer.effectAllowed = "copy";
  emit("dragstart", type);
};
</script>

<template>
  <div class="node-palette">
    <div class="palette-title">节点库</div>
    <div class="palette-grid">
      <div
        v-for="item in paletteItems"
        :key="item.type"
        class="palette-item"
        :class="{ 'is-readonly': readonly }"
        :draggable="!readonly"
        @dragstart="onDragStart($event, item.type)"
      >
        <span class="palette-item__icon" :style="{ backgroundColor: item.color }">
          <IconifyIconOffline :icon="item.icon" />
        </span>
        <span class="palette-item__label">{{ item.label }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.node-palette {
  padding: 14px 12px;
}

.palette-title {
  margin-bottom: 10px;
  color: #2a241d;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
}

.palette-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 42px;
  padding: 8px;
  color: #2a241d;
  cursor: grab;
  user-select: none;
  background: #fffaf2;
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.palette-item:hover {
  box-shadow: 0 8px 14px rgb(47 108 95 / 16%);
  transform: translateY(-1px);
}

.palette-item.is-readonly {
  cursor: not-allowed;
  opacity: 0.58;
}

.palette-item__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: #fff;
  border-radius: 6px;
}

.palette-item__label {
  color: #2a241d;
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
}
</style>
