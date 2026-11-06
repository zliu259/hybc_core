<script setup lang="ts">
/** 明细区里的行项目表：报销单据、开票项目。没有行项目的业务不渲染。 */
import { computed } from "vue";
import type { ReimbursementBatchDetail } from "@/api/reimbursement";
import {
  formatAmount,
  toInvoiceRiskLabel,
  toInvoiceRiskTagType,
  type InvoiceItemRow
} from "../formatters";

defineOptions({ name: "BizItemTables" });

const props = defineProps<{
  reimbursementItems?: ReimbursementBatchDetail["items"];
  invoiceItems?: InvoiceItemRow[];
}>();

const emit = defineEmits<{
  preview: [fileKey: string, fileName: string];
  download: [fileKey: string];
}>();

const hasReimbursement = computed(
  () => (props.reimbursementItems?.length ?? 0) > 0
);
const hasInvoice = computed(() => (props.invoiceItems?.length ?? 0) > 0);
</script>

<template>
  <el-table
    v-if="hasReimbursement"
    :data="reimbursementItems"
    size="small"
    class="biz-item-table"
  >
    <el-table-column prop="envelope_no" label="报销单号" min-width="150" />
    <el-table-column prop="invoice_no" label="发票号" min-width="150" />
    <el-table-column label="金额" width="110" align="right">
      <template #default="{ row }">{{ formatAmount(row.amount) }}</template>
    </el-table-column>
    <el-table-column prop="category" label="类别" width="100" />
    <el-table-column prop="description" label="说明" min-width="180" />
    <el-table-column label="单项 AI 结论" min-width="220">
      <template #default="{ row }">
        {{ row.ai_reasonability_summary || "-" }}
      </template>
    </el-table-column>
    <el-table-column label="票据风险" width="96">
      <template #default="{ row }">
        <el-tag
          v-if="row.invoice_review_highest_risk"
          :type="toInvoiceRiskTagType(row.invoice_review_highest_risk)"
          size="small"
        >
          {{ toInvoiceRiskLabel(row.invoice_review_highest_risk) }}
        </el-tag>
        <template v-else>-</template>
      </template>
    </el-table-column>
    <el-table-column label="抽查附件" min-width="240">
      <template #default="{ row }">
        <div
          v-for="attachment in row.attachments ?? []"
          :key="attachment.id"
          class="biz-item-table__attachment"
        >
          <el-link
            type="primary"
            @click="
              emit(
                'preview',
                attachment.file_key,
                attachment.file_name || attachment.file_key
              )
            "
          >
            <span class="biz-item-table__name">
              {{ attachment.file_name || attachment.file_key }}
            </span>
          </el-link>
          <el-button
            link
            size="small"
            @click="emit('download', attachment.file_key)"
          >
            下载
          </el-button>
        </div>
        <template v-if="!row.attachments?.length">-</template>
      </template>
    </el-table-column>
  </el-table>

  <el-table
    v-if="hasInvoice"
    :data="invoiceItems"
    size="small"
    class="biz-item-table"
  >
    <el-table-column label="名称" min-width="180">
      <template #default="{ row }">{{ row.name || "-" }}</template>
    </el-table-column>
    <el-table-column label="规格" min-width="140">
      <template #default="{ row }">{{ row.specification || "-" }}</template>
    </el-table-column>
    <el-table-column label="单位" width="80">
      <template #default="{ row }">{{ row.unit || "-" }}</template>
    </el-table-column>
    <el-table-column label="数量" width="90" align="right">
      <template #default="{ row }">{{ row.quantity ?? "-" }}</template>
    </el-table-column>
    <el-table-column label="单价" width="120" align="right">
      <template #default="{ row }">{{ formatAmount(row.unit_price) }}</template>
    </el-table-column>
    <el-table-column label="金额" width="130" align="right">
      <template #default="{ row }">{{ formatAmount(row.amount) }}</template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
.biz-item-table {
  margin-top: 14px;
}

.biz-item-table__attachment {
  display: flex;
  gap: 8px;
  align-items: center;
}

.biz-item-table__name {
  display: inline-block;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  white-space: nowrap;
}
</style>
