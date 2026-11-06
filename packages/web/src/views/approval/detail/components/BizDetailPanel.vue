<script setup lang="ts">
import { useRouter } from "vue-router";
import { formatBeijingDateTime } from "@/utils/datetime";
import type { DetailRow, RemarkEdit } from "../types";
import ApprovalPanel from "./ApprovalPanel.vue";

defineOptions({ name: "BizDetailPanel" });

defineProps<{
  title: string;
  rows: DetailRow[];
  loading: boolean;
  /** 备注里拆出来的系统修改记录 */
  edits: RemarkEdit[];
  toUserLabel: (userid: string) => string;
}>();

const router = useRouter();
</script>

<template>
  <ApprovalPanel :title="title">
    <el-skeleton v-if="loading && rows.length === 0" :rows="3" animated />
    <dl v-else class="biz-detail">
      <div
        v-for="row in rows"
        :key="row.label"
        class="biz-detail__row"
        :class="{ 'biz-detail__row--wide': row.wide }"
      >
        <dt>{{ row.label }}</dt>
        <dd :class="{ 'biz-detail__multiline': row.multiline }">
          <el-link v-if="row.to" type="primary" @click="router.push(row.to)">
            {{ row.value }}
          </el-link>
          <el-tag v-else-if="row.tag" :type="row.tag.type" size="small">
            {{ row.tag.text }}
          </el-tag>
          <template v-else>{{ row.value ?? "-" }}</template>
        </dd>
      </div>
    </dl>

    <el-collapse v-if="edits.length > 0" class="biz-detail__edits">
      <el-collapse-item :title="`支付信息修改记录（${edits.length} 条）`">
        <ul>
          <li v-for="(edit, index) in edits" :key="index">
            <time>{{ formatBeijingDateTime(edit.at) }}</time>
            <span>{{ toUserLabel(edit.by) }}</span>
            <span>{{ edit.note }}</span>
          </li>
        </ul>
      </el-collapse-item>
    </el-collapse>

    <slot />
  </ApprovalPanel>
</template>

<style scoped>
.biz-detail {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 24px;
  margin: 0;
}

.biz-detail__row {
  display: flex;
  gap: 12px;
  min-width: 0;
  font-size: 14px;
  line-height: 1.6;
}

.biz-detail__row--wide {
  grid-column: 1 / -1;
}

.biz-detail__row dt {
  flex: none;
  width: 84px;
  color: var(--el-text-color-secondary);
}

.biz-detail__row dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  color: var(--el-text-color-primary);
  word-break: break-word;
}

.biz-detail__multiline {
  white-space: pre-wrap;
}

.biz-detail__edits {
  margin-top: 12px;
  border-bottom: none;
}

.biz-detail__edits ul {
  padding: 0;
  margin: 0;
  list-style: none;
}

.biz-detail__edits li {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 2px 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.biz-detail__edits time {
  color: var(--el-text-color-secondary);
}

@media (width <= 640px) {
  .biz-detail {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
