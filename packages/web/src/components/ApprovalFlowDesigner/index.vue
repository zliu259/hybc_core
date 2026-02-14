<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Handle,
  Position,
  VueFlow,
  useVueFlow,
  type Connection,
  type Edge,
  type Node
} from "@vue-flow/core";
import { Background } from "@vue-flow/background";
import { Controls } from "@vue-flow/controls";
import { MiniMap } from "@vue-flow/minimap";
import NodePalette from "./NodePalette.vue";
import NodeConfigPanel from "./NodeConfigPanel.vue";
import { graphToTemplate, templateToGraph } from "./serializer";
import type { FlowNodeData, NodeType, TemplateConfig } from "./types";

import "@vue-flow/core/dist/style.css";
import "@vue-flow/core/dist/theme-default.css";
import "@vue-flow/background/dist/style.css";
import "@vue-flow/controls/dist/style.css";
import "@vue-flow/minimap/dist/style.css";

const props = withDefaults(
  defineProps<{
    config?: string;
    readonly?: boolean;
  }>(),
  {
    config: "",
    readonly: false
  }
);

const emit = defineEmits<{
  "update:config": [string];
}>();

const flowId = "approval-flow-designer";
const { screenToFlowCoordinate, fitView } = useVueFlow({ id: flowId });

const nodes = ref<Node<FlowNodeData>[]>([]);
const edges = ref<Edge[]>([]);

const selectedNodeId = ref<string>("");
const selectedEdgeId = ref<string>("");
const syncingFromProps = ref(false);
const lastEmittedConfig = ref("");

const NODE_COLORS: Record<NodeType, string> = {
  sequential: "#3B82F6",
  countersign: "#10B981",
  or_sign: "#F59E0B",
  auto: "#6B7280",
  cc: "#8B5CF6",
  ai_gate: "#EF4444",
  start: "#2f7a53",
  end: "#bd3f3f"
};

const NODE_LABELS: Record<NodeType, string> = {
  sequential: "顺序签",
  countersign: "会签",
  or_sign: "或签",
  auto: "自动",
  cc: "抄送",
  ai_gate: "AI关卡",
  start: "开始",
  end: "结束"
};

const selectedNode = computed(() => {
  return nodes.value.find(item => item.id === selectedNodeId.value) ?? null;
});

const parseConfigString = (config: string): TemplateConfig | null => {
  if (!config.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(config) as TemplateConfig;
    if (!Array.isArray(parsed.nodes)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const edgeId = (source: string, target: string) => `edge-${source}-${target}`;

const createNodeId = (type: NodeType) => {
  const random = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0");
  return `${type}_${Date.now()}_${random}`;
};

const createNodeData = (type: NodeType, key: string): FlowNodeData => {
  return {
    key,
    type,
    name: NODE_LABELS[type],
    assignees: [],
    autoAction: type === "auto" ? "approve" : undefined,
    aiSlotId: type === "ai_gate" ? "" : undefined,
    timeoutHours: undefined
  };
};

const applyConfigToGraph = (config: string) => {
  const parsed = parseConfigString(config);
  const graph = parsed
    ? templateToGraph(parsed)
    : templateToGraph({ version: 1, start_key: "start", nodes: [] });

  syncingFromProps.value = true;
  nodes.value = graph.nodes;
  edges.value = graph.edges;

  if (!nodes.value.some(item => item.id === selectedNodeId.value)) {
    selectedNodeId.value = "";
  }

  nextTick(() => {
    syncingFromProps.value = false;
    fitView({ padding: 0.2, duration: 200 });
  });
};

const syncConfigToParent = () => {
  if (syncingFromProps.value) {
    return;
  }

  const template = graphToTemplate(nodes.value, edges.value);
  const serialized = JSON.stringify(template);

  if (serialized === lastEmittedConfig.value) {
    return;
  }

  lastEmittedConfig.value = serialized;
  emit("update:config", serialized);
};

const onDragStartFromPalette = (_type: NodeType) => {
  selectedEdgeId.value = "";
};

const onDragOver = (event: DragEvent) => {
  if (props.readonly) {
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
};

const onDrop = (event: DragEvent) => {
  if (props.readonly || !event.dataTransfer) {
    return;
  }

  const nodeType = event.dataTransfer.getData(
    "application/approval-node"
  ) as NodeType;
  if (!nodeType) {
    return;
  }

  event.preventDefault();

  const position = screenToFlowCoordinate({
    x: event.clientX,
    y: event.clientY
  });

  const id = createNodeId(nodeType);
  nodes.value = [
    ...nodes.value,
    {
      id,
      type: nodeType,
      position,
      data: createNodeData(nodeType, id)
    }
  ];
};

const onConnect = (connection: Connection) => {
  if (props.readonly || !connection.source || !connection.target) {
    return;
  }

  const duplicated = edges.value.some(item => {
    return item.source === connection.source && item.target === connection.target;
  });

  if (duplicated) {
    return;
  }

  edges.value = [
    ...edges.value,
    {
      id: edgeId(connection.source, connection.target),
      source: connection.source,
      target: connection.target,
      type: "smoothstep"
    }
  ];
};

const onNodeClick = ({ node }: { node: Node<FlowNodeData> }) => {
  selectedNodeId.value = node.id;
  selectedEdgeId.value = "";
};

const onEdgeClick = ({ edge }: { edge: Edge }) => {
  selectedEdgeId.value = edge.id;
  selectedNodeId.value = "";
};

const onPaneClick = () => {
  selectedNodeId.value = "";
  selectedEdgeId.value = "";
};

const onUpdateSelectedNode = (payload: FlowNodeData) => {
  if (!selectedNodeId.value || props.readonly) {
    return;
  }

  nodes.value = nodes.value.map(node => {
    if (node.id !== selectedNodeId.value) {
      return node;
    }

    return {
      ...node,
      data: {
        ...payload,
        key: node.id,
        type: node.data.type
      }
    };
  });
};

const removeSelection = () => {
  if (props.readonly) {
    return;
  }

  if (selectedNodeId.value) {
    const removedNodeId = selectedNodeId.value;
    nodes.value = nodes.value.filter(item => item.id !== removedNodeId);
    edges.value = edges.value.filter(item => {
      return item.source !== removedNodeId && item.target !== removedNodeId;
    });
    selectedNodeId.value = "";
    return;
  }

  if (selectedEdgeId.value) {
    edges.value = edges.value.filter(item => item.id !== selectedEdgeId.value);
    selectedEdgeId.value = "";
  }
};

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key !== "Delete") {
    return;
  }

  removeSelection();
};

const miniMapNodeColor = (node: Node<FlowNodeData>) => {
  return NODE_COLORS[node.data.type] ?? "#6B7280";
};

watch(
  () => props.config,
  value => {
    const normalized = value ?? "";
    if (normalized === lastEmittedConfig.value) {
      return;
    }
    applyConfigToGraph(normalized);
  },
  { immediate: true }
);

watch(
  [nodes, edges],
  () => {
    syncConfigToParent();
  },
  { deep: true }
);

onMounted(() => {
  window.addEventListener("keydown", onKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
});
</script>

<template>
  <div class="approval-flow-designer">
    <aside class="designer-sidebar">
      <NodePalette :readonly="readonly" @dragstart="onDragStartFromPalette" />
    </aside>

    <section class="designer-canvas" @dragover="onDragOver" @drop="onDrop">
      <VueFlow
        :id="flowId"
        v-model:nodes="nodes"
        v-model:edges="edges"
        class="approval-vue-flow"
        :nodes-draggable="!readonly"
        :nodes-connectable="!readonly"
        :elements-selectable="true"
        :delete-key-code="readonly ? null : 'Delete'"
        :zoom-on-double-click="false"
        fit-view-on-init
        @connect="onConnect"
        @node-click="onNodeClick"
        @edge-click="onEdgeClick"
        @pane-click="onPaneClick"
      >
        <Background :gap="18" :size="1.2" pattern-color="#d9ceb9" />
        <MiniMap :node-color="miniMapNodeColor" pannable zoomable />
        <Controls :show-interactive="false" />

        <template #node-sequential="slotProps">
          <div class="flow-card" :class="{ selected: slotProps.selected }">
            <Handle type="target" :position="Position.Top" />
            <div class="flow-card__head" :style="{ backgroundColor: NODE_COLORS.sequential }">
              <span class="flow-card__badge">顺序签</span>
            </div>
            <div class="flow-card__body">
              <div class="flow-card__name">{{ slotProps.data.name || "顺序签" }}</div>
              <div class="flow-card__meta">审批人 {{ slotProps.data.assignees.length }} 人</div>
            </div>
            <Handle type="source" :position="Position.Bottom" />
          </div>
        </template>

        <template #node-countersign="slotProps">
          <div class="flow-card" :class="{ selected: slotProps.selected }">
            <Handle type="target" :position="Position.Top" />
            <div class="flow-card__head" :style="{ backgroundColor: NODE_COLORS.countersign }">
              <span class="flow-card__badge">会签</span>
            </div>
            <div class="flow-card__body">
              <div class="flow-card__name">{{ slotProps.data.name || "会签" }}</div>
              <div class="flow-card__meta">审批人 {{ slotProps.data.assignees.length }} 人</div>
            </div>
            <Handle type="source" :position="Position.Bottom" />
          </div>
        </template>

        <template #node-or_sign="slotProps">
          <div class="flow-card" :class="{ selected: slotProps.selected }">
            <Handle type="target" :position="Position.Top" />
            <div class="flow-card__head" :style="{ backgroundColor: NODE_COLORS.or_sign }">
              <span class="flow-card__badge">或签</span>
            </div>
            <div class="flow-card__body">
              <div class="flow-card__name">{{ slotProps.data.name || "或签" }}</div>
              <div class="flow-card__meta">审批人 {{ slotProps.data.assignees.length }} 人</div>
            </div>
            <Handle type="source" :position="Position.Bottom" />
          </div>
        </template>

        <template #node-auto="slotProps">
          <div class="flow-card" :class="{ selected: slotProps.selected }">
            <Handle type="target" :position="Position.Top" />
            <div class="flow-card__head" :style="{ backgroundColor: NODE_COLORS.auto }">
              <span class="flow-card__badge">自动</span>
            </div>
            <div class="flow-card__body">
              <div class="flow-card__name">{{ slotProps.data.name || "自动" }}</div>
              <div class="flow-card__meta">动作 {{ slotProps.data.autoAction || "approve" }}</div>
            </div>
            <Handle type="source" :position="Position.Bottom" />
          </div>
        </template>

        <template #node-cc="slotProps">
          <div class="flow-card" :class="{ selected: slotProps.selected }">
            <Handle type="target" :position="Position.Top" />
            <div class="flow-card__head" :style="{ backgroundColor: NODE_COLORS.cc }">
              <span class="flow-card__badge">抄送</span>
            </div>
            <div class="flow-card__body">
              <div class="flow-card__name">{{ slotProps.data.name || "抄送" }}</div>
              <div class="flow-card__meta">接收人 {{ slotProps.data.assignees.length }} 人</div>
            </div>
            <Handle type="source" :position="Position.Bottom" />
          </div>
        </template>

        <template #node-ai_gate="slotProps">
          <div class="flow-card" :class="{ selected: slotProps.selected }">
            <Handle type="target" :position="Position.Top" />
            <div class="flow-card__head" :style="{ backgroundColor: NODE_COLORS.ai_gate }">
              <span class="flow-card__badge">AI关卡</span>
            </div>
            <div class="flow-card__body">
              <div class="flow-card__name">{{ slotProps.data.name || "AI关卡" }}</div>
              <div class="flow-card__meta">Slot {{ slotProps.data.aiSlotId || "未配置" }}</div>
            </div>
            <Handle type="source" :position="Position.Bottom" />
          </div>
        </template>

        <template #node-start="slotProps">
          <div class="flow-point start" :class="{ selected: slotProps.selected }">
            <div class="flow-point__label">开始</div>
            <Handle type="source" :position="Position.Bottom" />
          </div>
        </template>

        <template #node-end="slotProps">
          <div class="flow-point end" :class="{ selected: slotProps.selected }">
            <Handle type="target" :position="Position.Top" />
            <div class="flow-point__label">结束</div>
          </div>
        </template>
      </VueFlow>
    </section>

    <aside v-if="selectedNode" class="designer-config-panel">
      <NodeConfigPanel
        :node="selectedNode.data"
        :readonly="readonly"
        @update="onUpdateSelectedNode"
      />
    </aside>
  </div>
</template>

<style scoped>
.approval-flow-designer {
  --flow-bg: #f4f1ea;
  --flow-card-bg: #fffaf2;
  --flow-text: #2a241d;
  --flow-muted: #6e6458;
  --flow-accent: #2f6c5f;
  --flow-border: #d9ceb9;

  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  height: 620px;
  overflow: hidden;
  color: var(--flow-text);
  font-family: "Noto Sans SC", "PingFang SC", sans-serif;
  background: radial-gradient(circle at 12% 10%, #fff8ee 0%, var(--flow-bg) 48%);
  border: 1px solid var(--flow-border);
  border-radius: 14px;
}

.approval-flow-designer:has(.designer-config-panel) {
  grid-template-columns: 200px minmax(0, 1fr) 280px;
}

.designer-sidebar {
  border-right: 1px solid var(--flow-border);
  background: rgb(255 250 242 / 70%);
}

.designer-canvas {
  position: relative;
}

.approval-vue-flow {
  width: 100%;
  height: 100%;
  background: transparent;
}

.designer-config-panel {
  border-left: 1px solid var(--flow-border);
  background: #fffaf2;
}

.flow-card {
  position: relative;
  width: 172px;
  overflow: hidden;
  background: var(--flow-card-bg);
  border: 1px solid var(--flow-border);
  border-radius: 12px;
  box-shadow: 0 8px 16px rgb(42 36 29 / 10%);
}

.flow-card.selected {
  border-color: var(--flow-accent);
  box-shadow: 0 0 0 2px rgb(47 108 95 / 22%);
}

.flow-card__head {
  display: flex;
  align-items: center;
  min-height: 26px;
  padding: 0 10px;
}

.flow-card__badge {
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 16px;
  letter-spacing: 0.5px;
}

.flow-card__body {
  padding: 10px;
}

.flow-card__name {
  margin-bottom: 4px;
  color: var(--flow-text);
  font-size: 13px;
  font-weight: 600;
  line-height: 18px;
}

.flow-card__meta {
  color: var(--flow-muted);
  font-size: 12px;
  line-height: 16px;
}

.flow-point {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 82px;
  height: 82px;
  color: #fff;
  border: 4px solid #fff;
  border-radius: 999px;
  box-shadow: 0 12px 24px rgb(42 36 29 / 16%);
}

.flow-point.start {
  background: #2f7a53;
}

.flow-point.end {
  background: #bd3f3f;
}

.flow-point.selected {
  box-shadow: 0 0 0 2px rgb(47 108 95 / 24%), 0 12px 24px rgb(42 36 29 / 16%);
}

.flow-point__label {
  font-size: 14px;
  font-weight: 600;
}

@media (width <= 1024px) {
  .approval-flow-designer,
  .approval-flow-designer:has(.designer-config-panel) {
    grid-template-columns: 180px minmax(0, 1fr);
  }

  .designer-config-panel {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 10;
    width: min(280px, calc(100% - 16px));
    max-height: calc(100% - 16px);
    overflow-y: auto;
    border: 1px solid var(--flow-border);
    border-radius: 10px;
    box-shadow: 0 12px 24px rgb(42 36 29 / 16%);
  }
}
</style>
