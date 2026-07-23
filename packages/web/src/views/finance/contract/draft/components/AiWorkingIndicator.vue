<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

type AiWorkingMode = "generate" | "review" | "completeness";

const props = defineProps<{
  mode: AiWorkingMode;
  /** 任务发起时刻（毫秒时间戳）；缺省按组件挂载时刻起算 */
  startedAt?: number;
}>();

// 各模式轮播提示语（顺序即播放顺序）
const HINTS: Record<AiWorkingMode, string[]> = {
  generate: [
    "AI 正在起草本节条款…",
    "正在核对民法典合规红线…",
    "可以先浏览或编辑其他章节，完成后会自动回填",
    "篇幅较长的条款可能需要 1-2 分钟"
  ],
  review: [
    "AI 正在逐句审查本节…",
    "正在生成修正稿…",
    "可以先处理其他章节，审查完成会自动显示",
    "通常需要 1-2 分钟"
  ],
  completeness: [
    "两个模型正在同时全量审查整份合同…",
    "正在核对缺失条款与节间矛盾…",
    "可以继续浏览各章节，完成后自动弹出结果",
    "整份合同全量审查通常需要 2-4 分钟"
  ]
};

const HINT_ROTATE_MS = 4000;

// startedAt 非法（非有限正数）时回退挂载时刻，保证耗时不出现 NaN/负数
const mountedAt = Date.now();
const startedAtMs = computed(() => {
  const v = props.startedAt;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : mountedAt;
});

const hints = computed(() => HINTS[props.mode]);
const hintIndex = ref(0);
const currentHint = computed(
  () => hints.value[hintIndex.value % hints.value.length]
);

const computeElapsed = () =>
  Math.max(0, Math.floor((Date.now() - startedAtMs.value) / 1000));

// setup 即按 startedAt 初始化，避免首帧闪现 0 秒
const elapsedSeconds = ref(computeElapsed());
const elapsedLabel = computed(() => {
  const minutes = Math.floor(elapsedSeconds.value / 60);
  const seconds = elapsedSeconds.value % 60;
  return minutes > 0
    ? `已运行 ${minutes}分${seconds}秒`
    : `已运行 ${seconds}秒`;
});

let hintTimer: number | null = null;
let elapsedTimer: number | null = null;

const syncElapsed = () => {
  elapsedSeconds.value = computeElapsed();
};

// mode 切换（组件被复用）时从头轮播
watch(
  () => props.mode,
  () => {
    hintIndex.value = 0;
  }
);

onMounted(() => {
  syncElapsed();
  elapsedTimer = window.setInterval(syncElapsed, 1000);
  hintTimer = window.setInterval(() => {
    hintIndex.value = (hintIndex.value + 1) % hints.value.length;
  }, HINT_ROTATE_MS);
});

onBeforeUnmount(() => {
  if (elapsedTimer !== null) window.clearInterval(elapsedTimer);
  if (hintTimer !== null) window.clearInterval(hintTimer);
  elapsedTimer = null;
  hintTimer = null;
});
</script>

<template>
  <div class="ai-working" role="status" aria-live="polite">
    <div class="ai-working-bar" aria-hidden="true">
      <div class="ai-working-bar-flow" />
    </div>
    <div class="ai-working-row">
      <span class="ai-working-dots" aria-hidden="true"><i /><i /><i /></span>
      <!-- key 换文案时重建节点触发 CSS fade-in：不走 JS Transition，后台
           标签页 rAF 被节流时也不会卡在透明态 -->
      <span :key="`${mode}-${hintIndex}`" class="ai-working-hint">{{
        currentHint
      }}</span>
      <span class="ai-working-elapsed">{{ elapsedLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
@keyframes ai-bar-flow {
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(350%);
  }
}

@keyframes ai-dot-bounce {
  0%,
  60%,
  100% {
    opacity: 0.45;
    transform: translateY(0);
  }

  30% {
    opacity: 1;
    transform: translateY(-3px);
  }
}

@keyframes ai-hint-fade-in {
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
}

.ai-working {
  padding: 10px 12px;
  background: var(--el-color-primary-light-9);
  border: 1px solid var(--el-color-primary-light-8);
  border-radius: 6px;
}

/* indeterminate 进度条：轨道裁剪，渐变亮带 transform 无限流动 */
.ai-working-bar {
  height: 3px;
  overflow: hidden;
  background: var(--el-color-primary-light-8);
  border-radius: 2px;
}

.ai-working-bar-flow {
  width: 40%;
  height: 100%;
  background: linear-gradient(
    90deg,
    transparent,
    var(--el-color-primary-light-3),
    var(--el-color-primary),
    var(--el-color-primary-light-3),
    transparent
  );
  border-radius: 2px;
  animation: ai-bar-flow 1.6s linear infinite;
}

.ai-working-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.ai-working-dots {
  display: inline-flex;
  flex: none;
  gap: 4px;
  align-items: center;
}

.ai-working-dots i {
  width: 6px;
  height: 6px;
  background: var(--el-color-primary);
  border-radius: 50%;
  animation: ai-dot-bounce 1.2s ease-in-out infinite;
}

.ai-working-dots i:nth-child(2) {
  animation-delay: 0.15s;
}

.ai-working-dots i:nth-child(3) {
  animation-delay: 0.3s;
}

.ai-working-hint {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--el-color-primary);
  animation: ai-hint-fade-in 0.4s ease;
}

.ai-working-elapsed {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary);
}
</style>
