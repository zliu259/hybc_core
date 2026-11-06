<script setup lang="ts">
/** 总览头部：一句话结论、合计金额、进度分布带。分布带下面的档位同时是筛选。 */
import { computed } from "vue";
import type { ContractOverview, ExecutionBand } from "@/api/contract";
import {
  buildBandSegments,
  buildOverviewFigures,
  buildOverviewHeadline
} from "../contract-overview-view";

defineOptions({ name: "ContractOverviewHead" });

const props = defineProps<{
  overview: ContractOverview | null;
  /** 当前选中的档位，空串表示没选 */
  band: ExecutionBand | "";
  /** 有项目或关键字筛选时，结论要说明是筛选范围内的 */
  scoped: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (e: "select-band", band: ExecutionBand): void;
  (e: "retry"): void;
}>();

const segments = computed(() =>
  props.overview ? buildBandSegments(props.overview) : []
);
const ribbonSegments = computed(() =>
  segments.value.filter(item => item.count > 0)
);
const headline = computed(() =>
  props.overview ? buildOverviewHeadline(props.overview, props.scoped) : ""
);
const figures = computed(() =>
  props.overview ? buildOverviewFigures(props.overview) : []
);
const groupLabel = computed(() =>
  props.overview?.direction === "inbound" ? "按回款进度筛选" : "按付款进度筛选"
);
</script>

<template>
  <div class="overview-head">
    <template v-if="overview">
      <h2 class="overview-head__headline">{{ headline }}</h2>
      <p class="overview-head__figures">
        <span v-for="item in figures" :key="item.label">
          {{ item.label }} <b>{{ item.value }}</b>
        </span>
      </p>

      <div class="overview-head__ribbon" aria-hidden="true">
        <span
          v-for="item in ribbonSegments"
          :key="item.band"
          class="overview-head__segment"
          :class="{
            'overview-head__segment--dim': band !== '' && band !== item.band
          }"
          :style="{ flexGrow: item.count, background: item.color }"
          :title="`${item.label} ${item.count} 份`"
          @click="emit('select-band', item.band)"
        />
      </div>

      <div class="overview-head__bands" role="group" :aria-label="groupLabel">
        <button
          v-for="item in segments"
          :key="item.band"
          type="button"
          class="overview-head__band"
          :class="{ 'overview-head__band--active': band === item.band }"
          :style="{ '--band-color': item.color }"
          :aria-pressed="band === item.band"
          :disabled="item.count === 0 && band !== item.band"
          @click="emit('select-band', item.band)"
        >
          <span class="overview-head__band-name">
            <i class="overview-head__swatch" />{{ item.label }}
          </span>
          <span class="overview-head__band-count">{{ item.count }} 份</span>
          <span class="overview-head__band-hint">{{ item.hint }}</span>
        </button>
      </div>
    </template>

    <div v-else-if="error" class="overview-head__error" role="alert">
      <span>{{ error }}</span>
      <el-button link type="primary" @click="emit('retry')">重试</el-button>
    </div>

    <template v-else>
      <h2 class="overview-head__headline overview-head__headline--loading">
        正在统计合同
      </h2>
      <div
        class="overview-head__ribbon overview-head__ribbon--empty"
        aria-hidden="true"
      />
    </template>
  </div>
</template>

<style scoped>
@keyframes overview-ribbon-in {
  from {
    transform: scaleX(0);
  }

  to {
    transform: scaleX(1);
  }
}

.overview-head__headline {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  line-height: 34px;
  color: #3f3527;
  overflow-wrap: anywhere;
}

.overview-head__headline--loading {
  color: #a89a84;
}

.overview-head__figures {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 28px;
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: #6e6458;
}

.overview-head__figures b {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #3f3527;
}

/* 页面上唯一的大胆之处：全部在执行合同按份数铺开 */
.overview-head__ribbon {
  display: flex;
  gap: 2px;
  height: 22px;
  margin-top: 16px;
  overflow: hidden;
  border-radius: 4px;
  transform-origin: left center;
  animation: overview-ribbon-in 600ms cubic-bezier(0.22, 1, 0.36, 1);
}

.overview-head__ribbon--empty {
  background: #f1e8d6;
  animation: none;
}

.overview-head__segment {
  flex-basis: 0;
  min-width: 6px;
  cursor: pointer;
  transition:
    flex-grow 300ms ease,
    opacity 160ms ease;
}

.overview-head__segment--dim {
  opacity: 0.25;
}

.overview-head__bands {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
  gap: 4px;
  margin-top: 8px;
}

.overview-head__band {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  color: #3f3527;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 6px;
  transition: background-color 120ms ease;
}

.overview-head__band:hover:not(:disabled) {
  background: #f7eedb;
}

.overview-head__band:focus-visible {
  outline: 2px solid var(--band-color);
  outline-offset: 1px;
}

.overview-head__band:disabled {
  cursor: default;
  opacity: 0.55;
}

.overview-head__band--active,
.overview-head__band--active:hover:not(:disabled) {
  background: #f3e6c9;
  box-shadow: inset 0 -2px 0 var(--band-color);
}

.overview-head__band-name {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 13px;
  line-height: 20px;
}

.overview-head__swatch {
  flex: none;
  width: 9px;
  height: 9px;
  background: var(--band-color);
  border-radius: 2px;
}

.overview-head__band-count {
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 28px;
}

.overview-head__band-hint {
  font-size: 12px;
  line-height: 18px;
  color: #6e6458;
}

.overview-head__error {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 14px;
  color: #b8322a;
}

@media (prefers-reduced-motion: reduce) {
  .overview-head__ribbon {
    animation: none;
  }

  .overview-head__segment,
  .overview-head__band {
    transition: none;
  }
}

@media (width <= 720px) {
  .overview-head__headline {
    font-size: 20px;
    line-height: 28px;
  }

  .overview-head__bands {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
