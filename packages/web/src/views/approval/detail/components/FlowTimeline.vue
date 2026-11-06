<script setup lang="ts">
/** 审批流程。已完成的节点只显示结论，待处理的节点才显示待办人。 */
import { computed, ref, watch } from "vue";
import type { ApprovalNodeInstance, ApprovalTask } from "@/api/approval";
import { formatBeijingDateTime } from "@/utils/datetime";
import {
  humanReviewStatusText,
  isAiGateHumanReviewTask
} from "../../human-review";
import { toTaskComment, toTaskDecision } from "../ai-verdict";
import {
  buildRoundNotes,
  isCurrentNode,
  resolveNodeDisplay,
  shouldShowTaskComment,
  taskIdleText
} from "../flow-view";
import ApprovalPanel from "./ApprovalPanel.vue";

defineOptions({ name: "FlowTimeline" });

const props = defineProps<{
  nodes: ApprovalNodeInstance[];
  tasks: ApprovalTask[];
  currentNodeKey: string | null;
  currentRound: number;
  instanceStatus: string;
  isSuperAdmin: boolean;
  toUserLabel: (userid: string | null | undefined) => string;
}>();

const emit = defineEmits<{ forceTransfer: [task: ApprovalTask] }>();

const NODE_TYPE_LABELS: Record<string, string> = {
  countersign: "会签",
  or_sign: "或签",
  auto: "自动",
  cc: "抄送"
};

const selectedRound = ref(props.currentRound);
watch(
  () => props.currentRound,
  round => {
    selectedRound.value = round;
  }
);

const rounds = computed(() =>
  Array.from({ length: props.currentRound }, (_, index) => index + 1)
);

const roundNodes = computed(() =>
  props.nodes
    .filter(node => node.round === selectedRound.value)
    .sort((a, b) => a.sort_order - b.sort_order)
);

const nodeTasks = (nodeId: number) =>
  props.tasks.filter(task => task.node_instance_id === nodeId);

const instanceState = computed(() => ({
  status: props.instanceStatus,
  current_round: props.currentRound
}));

const nodeDisplay = (node: ApprovalNodeInstance) =>
  resolveNodeDisplay(node, nodeTasks(node.id), instanceState.value);

const roundNotes = computed(() =>
  buildRoundNotes(
    {
      instance: instanceState.value,
      nodes: props.nodes,
      tasks: props.tasks
    },
    userid => props.toUserLabel(userid)
  )
);

/** 选中当前轮时说上一轮为什么结束，选中旧轮次时说这一轮怎么结束的。 */
const roundNote = computed(() => {
  if (selectedRound.value < props.currentRound) {
    const note = roundNotes.value[selectedRound.value];
    return note ? `这一轮：${note}` : "";
  }
  const previous = roundNotes.value[props.currentRound - 1];
  return previous ? `上一轮：${previous}` : "";
});

const assigneeLabels = (raw: string | null): string => {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return "";
    return parsed
      .filter((item): item is string => typeof item === "string")
      .map(item => props.toUserLabel(item))
      .join("、");
  } catch {
    return "";
  }
};

const taskName = (task: ApprovalTask) =>
  task.assignee_userid === "AI_GATE"
    ? "AI 审查"
    : props.toUserLabel(task.assignee_userid);
</script>

<template>
  <ApprovalPanel title="审批流程">
    <template v-if="rounds.length > 1" #extra>
      <el-radio-group v-model="selectedRound" size="small">
        <el-radio-button v-for="round in rounds" :key="round" :value="round">
          第 {{ round }} 轮
        </el-radio-button>
      </el-radio-group>
    </template>

    <p v-if="roundNote" class="flow__round-note">{{ roundNote }}</p>

    <ol class="flow">
      <li
        v-for="node in roundNodes"
        :key="node.id"
        class="flow__node"
        :class="[
          `flow__node--${nodeDisplay(node).tone}`,
          {
            'flow__node--current': isCurrentNode(
              node,
              instanceState,
              currentNodeKey
            )
          }
        ]"
      >
        <span class="flow__dot" aria-hidden="true" />
        <div class="flow__body">
          <div class="flow__title">
            <strong>{{ node.node_name }}</strong>
            <span v-if="NODE_TYPE_LABELS[node.node_type]" class="flow__type">
              {{ NODE_TYPE_LABELS[node.node_type] }}
            </span>
            <span class="flow__status">{{ nodeDisplay(node).label }}</span>
          </div>

          <p
            v-if="
              nodeTasks(node.id).length === 0 &&
              assigneeLabels(node.assignee_userids)
            "
            class="flow__assignees"
          >
            {{ assigneeLabels(node.assignee_userids) }}
          </p>

          <ul v-else class="flow__tasks">
            <li v-for="task in nodeTasks(node.id)" :key="task.id">
              <div class="flow__task-line">
                <span class="flow__task-name">{{ taskName(task) }}</span>
                <el-tag
                  v-if="isAiGateHumanReviewTask(node.node_type, task)"
                  type="warning"
                  size="small"
                >
                  人工复核
                </el-tag>
                <el-tag
                  v-if="toTaskDecision(task)"
                  :type="toTaskDecision(task)?.tagType"
                  size="small"
                >
                  {{ toTaskDecision(task)?.label }}
                </el-tag>
                <span
                  v-else-if="task.status === 'pending'"
                  class="flow__waiting"
                >
                  {{ humanReviewStatusText(node.node_type, task) || "待处理" }}
                </span>
                <span
                  v-else-if="humanReviewStatusText(node.node_type, task)"
                  class="flow__waiting"
                >
                  {{ humanReviewStatusText(node.node_type, task) }}
                </span>
                <span v-else-if="taskIdleText(task)" class="flow__idle">
                  {{ taskIdleText(task) }}
                </span>
                <el-button
                  v-if="
                    isSuperAdmin &&
                    task.status === 'pending' &&
                    task.assignee_userid !== 'AI_GATE'
                  "
                  link
                  type="warning"
                  size="small"
                  @click="emit('forceTransfer', task)"
                >
                  强制改派
                </el-button>
              </div>
              <p
                v-if="shouldShowTaskComment(task)"
                class="flow__comment"
                :class="{
                  'flow__comment--ai': task.assignee_userid === 'AI_GATE'
                }"
              >
                {{ toTaskComment(task) }}
              </p>
              <time v-if="task.acted_at" class="flow__time">
                {{ formatBeijingDateTime(task.acted_at) }}
              </time>
            </li>
          </ul>
        </div>
      </li>
    </ol>
  </ApprovalPanel>
</template>

<style scoped>
.flow {
  padding: 0;
  margin: 0;
  list-style: none;
}

.flow__node {
  position: relative;
  padding: 0 0 14px 20px;
}

.flow__node:last-child {
  padding-bottom: 0;
}

.flow__node::before {
  position: absolute;
  top: 12px;
  bottom: -4px;
  left: 4px;
  width: 1px;
  content: "";
  background: var(--el-border-color);
}

.flow__node:last-child::before {
  display: none;
}

.flow__dot {
  position: absolute;
  top: 6px;
  left: 0;
  box-sizing: border-box;
  width: 9px;
  height: 9px;
  background: var(--el-bg-color);
  border: 2px solid var(--el-border-color-darker);
  border-radius: 50%;
}

.flow__node--success .flow__dot {
  background: var(--el-color-success);
  border-color: var(--el-color-success);
}

.flow__node--active .flow__dot {
  background: var(--el-color-primary);
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 3px var(--el-color-primary-light-8);
}

.flow__node--warning .flow__dot {
  background: var(--el-color-warning);
  border-color: var(--el-color-warning);
}

.flow__node--danger .flow__dot {
  background: var(--el-color-danger);
  border-color: var(--el-color-danger);
}

.flow__node--danger .flow__status {
  color: var(--el-color-danger);
}

.flow__body {
  min-width: 0;
  padding: 0;
}

.flow__node--current .flow__body {
  padding: 6px 8px;
  margin: -6px -8px 0;
  background: var(--el-color-primary-light-9);
  border-radius: 6px;
}

.flow__title {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 14px;
  line-height: 1.5;
}

.flow__title strong {
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.flow__node--pending .flow__title strong,
.flow__node--muted .flow__title strong {
  font-weight: 400;
  color: var(--el-text-color-regular);
}

.flow__round-note {
  padding: 6px 8px;
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-text-color-regular);
  word-break: break-word;
  background: var(--el-fill-color-light);
  border-radius: 4px;
}

.flow__idle {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.flow__type {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.flow__status {
  margin-left: auto;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}

.flow__assignees {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.flow__tasks {
  padding: 0;
  margin: 4px 0 0;
  list-style: none;
}

.flow__tasks li {
  padding: 3px 0;
  font-size: 13px;
  line-height: 1.5;
}

.flow__task-line {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  align-items: center;
}

.flow__task-name {
  color: var(--el-text-color-regular);
}

.flow__waiting {
  font-size: 12px;
  color: var(--el-color-warning-dark-2);
}

.flow__comment {
  margin: 2px 0 0;
  color: var(--el-text-color-primary);
  word-break: break-word;
}

.flow__comment--ai {
  display: -webkit-box;
  overflow: hidden;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  color: var(--el-text-color-secondary);
  -webkit-box-orient: vertical;
}

.flow__time {
  display: block;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
