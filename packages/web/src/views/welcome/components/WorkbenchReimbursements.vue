<script setup lang="ts">
/** 我还没走完的报销。 */
import { useRouter } from "vue-router";
import type { ReimbursementRow } from "../workbench-view";

defineOptions({ name: "WorkbenchReimbursements" });

defineProps<{
  rows: readonly ReimbursementRow[];
  total: number;
  failed: boolean;
}>();

const router = useRouter();
</script>

<template>
  <section class="reimb">
    <header class="reimb__head">
      <h2 class="reimb__title">我的报销</h2>
      <el-button
        link
        type="primary"
        @click="router.push('/workspace/my-reimbursement')"
      >
        全部{{ total > rows.length ? ` ${total} 条` : "" }}
      </el-button>
    </header>

    <button
      v-for="row in rows"
      :key="row.id"
      type="button"
      class="reimb-row"
      @click="router.push(`/workspace/my-reimbursement/detail/${row.id}`)"
    >
      <span class="reimb-row__main">
        <span class="reimb-row__project">{{ row.projectText }}</span>
        <span class="reimb-row__date">{{ row.dateText }}</span>
      </span>
      <span class="reimb-row__side">
        <span class="reimb-row__amount">{{ row.amountText }}</span>
        <el-tag :type="row.statusType" size="small">{{
          row.statusText
        }}</el-tag>
      </span>
    </button>

    <p v-if="!rows.length" class="reimb__empty">
      {{ failed ? "报销没有取到，刷新页面重试" : "没有进行中的报销" }}
    </p>
  </section>
</template>

<style scoped>
.reimb {
  padding: 12px 0 6px;
  background: #fff;
  border: 1px solid #e7ebf0;
  border-radius: 10px;
}

.reimb__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 6px;
}

.reimb__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 28px;
  color: #1f2329;
}

.reimb-row {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 9px 16px;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-top: 1px solid #f1f3f7;
}

.reimb-row:hover {
  background: #f6f9fd;
}

.reimb-row:focus-visible {
  outline: 2px solid #2f7bf6;
  outline-offset: -2px;
}

.reimb-row__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.reimb-row__project {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  line-height: 20px;
  color: #1f2329;
  white-space: nowrap;
}

.reimb-row__date {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  color: #8a94a6;
}

.reimb-row__side {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 2px;
  align-items: flex-end;
}

.reimb-row__amount {
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
  color: #1f2329;
}

.reimb__empty {
  padding: 18px 16px 14px;
  margin: 0;
  font-size: 13px;
  color: #5c667a;
  border-top: 1px solid #f1f3f7;
}
</style>
