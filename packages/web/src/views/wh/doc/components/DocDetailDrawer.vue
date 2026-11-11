<script setup lang="ts">
import { ElMessageBox } from "element-plus";
import { ref, watch } from "vue";

import { getWhDoc, reverseWhDoc } from "@/api/wh/doc";
import type { WhDocLineRow, WhDocRow } from "@/api/wh/types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { formatTime, newClientRequestId } from "../../shared/ids";
import { DOC_TYPE_LABELS } from "../../shared/labels";
import { useWhAction } from "../../shared/useWhAction";

const props = defineProps<{ docId: number | null; canReverse: boolean }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ changed: [] }>();

const REVERSIBLE = ["opening", "inbound", "out", "back", "transfer"];
const { busy, run } = useWhAction();
const { userNameOf, loadUserNames } = useWecomUserOptions();
const doc = ref<(WhDocRow & { lines: WhDocLineRow[] }) | null>(null);

const load = async () => {
  if (!props.docId) return;
  const result = await run(() => getWhDoc(props.docId!));
  if (result) doc.value = result.data;
};

watch(visible, open => {
  if (open) {
    doc.value = null;
    void loadUserNames();
    void load();
  }
});

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);
const outcomeText = (line: WhDocLineRow) =>
  line.outcome === "lost"
    ? "丢失损坏"
    : line.outcome === "returned"
      ? "退回"
      : "";

const reverse = async () => {
  if (!doc.value) return;
  try {
    await ElMessageBox.confirm(
      `冲销会生成一张数量相反的单据，原单 ${doc.value.doc_no} 保留。确定冲销吗？`,
      "冲销",
      {
        type: "warning",
        confirmButtonText: "冲销",
        cancelButtonText: "取消"
      }
    );
  } catch {
    return;
  }
  const result = await run(
    () => reverseWhDoc(doc.value!.id, newClientRequestId()),
    { success: "已冲销" }
  );
  if (result) {
    emit("changed");
    await load();
  }
};
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="doc ? `${doc.doc_no} ${DOC_TYPE_LABELS[doc.doc_type]}` : '单据'"
    size="760px"
  >
    <div v-if="doc" v-loading="busy">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="项目">{{
          doc.project_name ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="目的项目">{{
          doc.to_project_name ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="供应商">{{
          doc.counterparty ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="领料人">{{
          doc.handover_name ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="操作人">{{
          userNameOf(doc.operator_userid)
        }}</el-descriptions-item>
        <el-descriptions-item label="时间">{{
          formatTime(doc.occurred_at)
        }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">{{
          doc.remark ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item v-if="doc.kit_no" label="配套清单" :span="2">{{
          doc.kit_no
        }}</el-descriptions-item>
        <el-descriptions-item
          v-if="doc.reversed_by_doc_no"
          label="已冲销"
          :span="2"
          >冲销单 {{ doc.reversed_by_doc_no }}</el-descriptions-item
        >
      </el-descriptions>
      <el-table :data="doc.lines" size="small" style="margin-top: 12px">
        <el-table-column label="设备或物资" min-width="200">
          <template #default="{ row }">
            {{
              row.device_id
                ? `${row.device_code} ${row.device_name}`
                : `${row.material_name} ${row.material_spec ?? ""}`
            }}
          </template>
        </el-table-column>
        <el-table-column label="数量" width="90" align="right">
          <template #default="{ row }"
            >{{ row.device_id ? 1 : row.quantity }}
            {{ row.unit ?? "台" }}</template
          >
        </el-table-column>
        <el-table-column label="退回/报损" width="90">
          <template #default="{ row }">{{ outcomeText(row) }}</template>
        </el-table-column>
        <el-table-column label="在库变化" width="90" align="right">
          <template #default="{ row }">{{
            row.stock_delta === 0 ? "-" : signed(row.stock_delta)
          }}</template>
        </el-table-column>
        <el-table-column label="顶进(米)" width="90">
          <template #default="{ row }">{{ row.usage_meters ?? "-" }}</template>
        </el-table-column>
      </el-table>
      <div
        v-if="
          props.canReverse &&
          !doc.reversed_by_doc_no &&
          !doc.reverses_doc_id &&
          REVERSIBLE.includes(doc.doc_type)
        "
        class="actions"
      >
        <el-button type="danger" plain @click="reverse">冲销</el-button>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.actions {
  margin-top: 16px;
  text-align: right;
}
</style>
