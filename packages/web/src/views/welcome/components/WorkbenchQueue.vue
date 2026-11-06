<script setup lang="ts">
/** 待处理清单：退回、油卡、审批合在一起，等得越久越显眼。 */
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import ChevronRight from "~icons/lucide/chevron-right";
import {
  queueMoreLink,
  type QueueItem,
  type QueueKind
} from "../workbench-view";

defineOptions({ name: "WorkbenchQueue" });

const DISPLAY_LIMIT = 8;

const props = defineProps<{
  items: readonly QueueItem[];
  /** 接口给的总数，可能比 items 多 */
  counts: Readonly<Record<QueueKind, number>>;
  loading: boolean;
  failed: boolean;
}>();

const router = useRouter();
const filter = ref<QueueKind | "all">("all");

const TAB_LABELS: Record<QueueKind, string> = {
  approval: "待我审批",
  returned: "被退回",
  fuel: "油卡待办"
};

const totalCount = computed(
  () => props.counts.approval + props.counts.returned + props.counts.fuel
);

const tabs = computed(() => [
  { value: "all" as const, label: "全部", count: totalCount.value },
  ...(["approval", "returned", "fuel"] as const)
    .filter(kind => props.counts[kind] > 0 || kind === "approval")
    .map(kind => ({
      value: kind,
      label: TAB_LABELS[kind],
      count: props.counts[kind]
    }))
]);

const filtered = computed(() =>
  filter.value === "all"
    ? props.items
    : props.items.filter(item => item.kind === filter.value)
);

const visible = computed(() => filtered.value.slice(0, DISPLAY_LIMIT));

const moreLink = computed(() =>
  queueMoreLink(filter.value, props.counts, visible.value.length)
);
</script>

<template>
  <section v-loading="loading" class="queue">
    <header class="queue__head">
      <h2 class="queue__title">待处理</h2>
      <div class="queue__tabs" role="group" aria-label="按类型筛选待处理">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          class="queue__tab"
          :class="{ 'queue__tab--active': filter === tab.value }"
          :aria-pressed="filter === tab.value"
          @click="filter = tab.value"
        >
          {{ tab.label }} <span>{{ tab.count }}</span>
        </button>
      </div>
    </header>

    <div v-if="visible.length" class="queue__list">
      <button
        v-for="item in visible"
        :key="item.key"
        type="button"
        class="queue-row"
        @click="router.push(item.to)"
      >
        <span class="queue-row__kind" :class="`queue-row__kind--${item.kind}`">
          {{ item.kindLabel }}
        </span>
        <span class="queue-row__main">
          <span class="queue-row__title">{{ item.title }}</span>
          <span v-if="item.metaText" class="queue-row__meta">{{
            item.metaText
          }}</span>
        </span>
        <span v-if="item.amountText" class="queue-row__amount">{{
          item.amountText
        }}</span>
        <span
          v-if="item.waitText"
          class="queue-row__wait"
          :class="`queue-row__wait--${item.waitTone}`"
        >
          {{ item.waitText }}
        </span>
        <span class="queue-row__action">
          {{ item.actionText }}<ChevronRight class="queue-row__chevron" />
        </span>
      </button>
    </div>

    <div v-else-if="!loading" class="queue__empty">
      <template v-if="failed">待办没有取到，刷新页面重试</template>
      <template v-else>这里没有要处理的事</template>
    </div>

    <p v-if="failed && visible.length" class="queue__hint" role="alert">
      有些待办没有取到，刷新页面重试
    </p>

    <footer v-if="moreLink" class="queue__foot">
      <el-button link type="primary" @click="router.push(moreLink.path)">
        {{ moreLink.text }}
      </el-button>
    </footer>
  </section>
</template>

<style scoped>
.queue {
  min-width: 0;
  background: #fff;
  border: 1px solid #e7ebf0;
  border-radius: 10px;
}

.queue__head {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 20px;
  align-items: center;
  padding: 12px 18px 8px;
  border-bottom: 1px solid #edf0f4;
}

.queue__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 28px;
  color: #1f2329;
}

.queue__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 4px;
}

.queue__tab {
  padding: 4px 10px;
  font-size: 13px;
  line-height: 20px;
  color: #5c667a;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 4px;
}

.queue__tab span {
  font-variant-numeric: tabular-nums;
  color: #8a94a6;
}

.queue__tab:hover {
  color: #1f2329;
  background: #f2f5f9;
}

.queue__tab--active {
  font-weight: 600;
  color: #1f2329;
  background: #eaf1fb;
}

.queue__tab:focus-visible,
.queue-row:focus-visible {
  outline: 2px solid #2f7bf6;
  outline-offset: -2px;
}

.queue-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr) auto 76px 72px;
  gap: 14px;
  align-items: center;
  width: 100%;
  padding: 12px 18px;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-bottom: 1px solid #f1f3f7;
}

.queue-row:hover {
  background: #f6f9fd;
}

.queue-row__kind {
  padding: 2px 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  border-radius: 4px;
}

.queue-row__kind--approval {
  color: #1361d8;
  background: #e6f0ff;
}

.queue-row__kind--returned {
  color: #b4470c;
  background: #fff0e3;
}

.queue-row__kind--fuel {
  color: #47566e;
  background: #eaeef4;
}

.queue-row__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.queue-row__title,
.queue-row__meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-row__title {
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: #1f2329;
}

.queue-row__meta {
  font-size: 12px;
  line-height: 18px;
  color: #8a94a6;
  white-space: pre;
}

.queue-row__amount {
  grid-column: 3;
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: #1f2329;
  text-align: right;
}

/* 这一列是页面的重点：等得越久越显眼 */
.queue-row__wait {
  grid-column: 4;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: #5c667a;
  text-align: right;
  white-space: nowrap;
}

.queue-row__wait--warn {
  font-weight: 600;
  color: #c2570c;
}

.queue-row__wait--late {
  font-weight: 700;
  color: #c42b1c;
}

.queue-row__action {
  display: inline-flex;
  grid-column: 5;
  gap: 2px;
  align-items: center;
  justify-content: flex-end;
  font-size: 13px;
  color: #1361d8;
  white-space: nowrap;
}

.queue-row__chevron {
  width: 14px;
  height: 14px;
}

.queue__empty {
  padding: 48px 18px;
  font-size: 14px;
  color: #5c667a;
  text-align: center;
}

.queue__hint {
  padding: 10px 18px;
  margin: 0;
  font-size: 13px;
  color: #b4470c;
}

.queue__foot {
  padding: 8px 18px 10px;
  text-align: center;
}

@media (width <= 720px) {
  .queue__head {
    padding: 10px 12px 6px;
  }

  .queue-row {
    grid-template-columns: 40px minmax(0, 1fr) auto;
    gap: 4px 10px;
    padding: 10px 12px;
  }

  .queue-row__main {
    grid-column: 2 / 4;
  }

  .queue-row__amount {
    grid-column: 2;
    text-align: left;
  }

  .queue-row__wait {
    grid-column: 3;
  }

  .queue-row__action {
    display: none;
  }
}
</style>
