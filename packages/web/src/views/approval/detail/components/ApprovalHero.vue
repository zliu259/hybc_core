<script setup lang="ts">
/**
 * 页面头部，版式取自付款凭证：金额小写在上、大写在下。审批人最先要确认的就是
 * 「多少钱、付给谁、干什么用」，这部分要一眼读完，流程信息退到次要位置。
 */
import { computed } from "vue";
import { useRouter } from "vue-router";
import { formatAmount, toChineseAmount } from "../formatters";
import { toStatusLabel } from "../../labels";
import type { HeroModel, TagType } from "../types";

defineOptions({ name: "ApprovalHero" });

const props = defineProps<{
  hero: HeroModel;
  bizTypeLabel: string;
  status: string;
  currentNodeName: string | null;
}>();

const router = useRouter();

const STATUS_TAGS: Record<string, TagType> = {
  in_progress: "primary",
  approved: "success",
  rejected: "danger",
  returned: "warning",
  withdrawn: "info",
  cancelled: "info"
};

const statusTag = computed<TagType>(() => STATUS_TAGS[props.status] ?? "info");

const openBizDetail = () => {
  if (props.hero.bizNoTo) router.push(props.hero.bizNoTo);
};
</script>

<template>
  <section class="approval-hero">
    <div class="approval-hero__meta">
      <el-tag :type="statusTag" effect="light">
        {{ toStatusLabel(status) }}
      </el-tag>
      <span v-if="status === 'in_progress' && currentNodeName">
        等待{{ currentNodeName }}
      </span>
      <span class="approval-hero__biz">
        {{ bizTypeLabel }}
        <el-link v-if="hero.bizNoTo" type="primary" @click="openBizDetail">
          {{ hero.bizNo }}
        </el-link>
        <template v-else>{{ hero.bizNo }}</template>
      </span>
    </div>

    <div v-if="hero.amount !== null" class="approval-hero__voucher">
      <div class="approval-hero__amount-label">{{ hero.amountLabel }}</div>
      <div class="approval-hero__amount">
        {{ formatAmount(hero.amount) }}<span>元</span>
      </div>
      <div class="approval-hero__amount-upper">
        {{ toChineseAmount(hero.amount) }}
      </div>
    </div>

    <h1 class="approval-hero__title">{{ hero.title }}</h1>

    <dl class="approval-hero__facts">
      <div v-for="fact in hero.facts" :key="fact.label">
        <dt>{{ fact.label }}</dt>
        <dd>{{ fact.value }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.approval-hero {
  padding: 20px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.approval-hero__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.approval-hero__biz {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  margin-left: auto;
  color: var(--el-text-color-secondary);
}

.approval-hero__voucher {
  padding-bottom: 14px;
  margin-top: 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.approval-hero__amount-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.approval-hero__amount {
  margin-top: 2px;
  font-size: 34px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
  color: var(--el-text-color-primary);
  letter-spacing: 0.01em;
}

.approval-hero__amount span {
  margin-left: 4px;
  font-size: 15px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}

.approval-hero__amount-upper {
  margin-top: 4px;
  font-size: 13px;
  color: var(--el-text-color-regular);
  letter-spacing: 0.04em;
}

.approval-hero__title {
  margin: 14px 0 0;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--el-text-color-primary);
  word-break: break-word;
}

.approval-hero__facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 28px;
  margin: 10px 0 0;
  font-size: 13px;
}

.approval-hero__facts div {
  display: flex;
  gap: 6px;
  min-width: 0;
}

.approval-hero__facts dt {
  flex: none;
  color: var(--el-text-color-secondary);
}

.approval-hero__facts dd {
  min-width: 0;
  margin: 0;
  color: var(--el-text-color-primary);
  word-break: break-word;
}
</style>
