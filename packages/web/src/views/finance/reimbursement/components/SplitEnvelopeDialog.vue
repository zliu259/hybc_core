<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import { useProjectOptions } from "@/composables/useProjectOptions";
import {
  splitReimbursementEnvelope,
  type EnvelopeAttachment,
  type ReimbursementEnvelopeDetail,
  type SplitEnvelopeResult
} from "@/api/reimbursement";
import { printSingleEnvelope } from "../envelope-print";
import { attachmentTypeLabel } from "../reimbursement-labels";

defineOptions({ name: "SplitEnvelopeDialog" });

const props = defineProps<{
  visible: boolean;
  detail: ReimbursementEnvelopeDetail;
}>();

const emit = defineEmits<{
  (event: "update:visible", value: boolean): void;
  (event: "done"): void;
  (event: "open-envelope", id: number): void;
}>();

const { projects, loadProjects } = useProjectOptions();

const submitting = ref(false);
const result = ref<SplitEnvelopeResult | null>(null);
const selectedAttachmentIds = ref<number[]>([]);
// Snapshotted once when the dialog opens (see resetForm). The parent's
// background audit-status polling replaces `detail` with a brand-new object
// every few seconds; if the table were bound to a computed derived straight
// from props.detail, Element Plus would see a new data-array reference on
// every poll tick and silently clear the user's checkbox selection
// (store/index.mjs: dataInstanceChanged -> clearSelection()). Binding to a
// stable local snapshot keeps the table's data reference constant for the
// lifetime of the dialog regardless of how often the parent refreshes.
const attachmentSnapshot = ref<EnvelopeAttachment[]>([]);
const form = ref({
  project_id: undefined as number | undefined,
  amount: 0,
  category: "",
  description: "",
  expense_date: "",
  original_amount: 0,
  reason: ""
});

const amountSum = computed(
  () => Number(form.value.amount || 0) + Number(form.value.original_amount || 0)
);
const amountMismatch = computed(
  () => Math.abs(amountSum.value - Number(props.detail.amount || 0)) > 0.005
);

const resetForm = () => {
  result.value = null;
  selectedAttachmentIds.value = [];
  attachmentSnapshot.value = (props.detail.attachments || []).filter(
    item => item.status === "active"
  );
  form.value = {
    project_id: undefined,
    amount: 0,
    category: props.detail.category || "",
    description: "",
    expense_date: props.detail.expense_date || "",
    original_amount: Number(props.detail.amount || 0),
    reason: ""
  };
};

watch(
  () => props.visible,
  async value => {
    if (value) {
      resetForm();
      await loadProjects();
    }
  }
);

watch(
  () => form.value.amount,
  value => {
    const rest = Number(props.detail.amount || 0) - Number(value || 0);
    form.value.original_amount = Number(rest > 0 ? rest.toFixed(2) : 0);
  }
);

const onSelectionChange = (rows: { id: number }[]) => {
  selectedAttachmentIds.value = rows.map(row => row.id);
};

const close = () => emit("update:visible", false);

const submit = async () => {
  if (!form.value.project_id) {
    message("请选择拆出新单的所属项目", { type: "warning" });
    return;
  }
  if (
    !(Number(form.value.amount) > 0) ||
    !(Number(form.value.original_amount) > 0)
  ) {
    message("新单金额与原单调整后金额都必须大于 0", { type: "warning" });
    return;
  }
  if (selectedAttachmentIds.value.length === 0) {
    try {
      await ElMessageBox.confirm(
        "未勾选任何附件，拆出的新单将不带任何附件（原单附件保持不变）。若票据需要跟随新单，请返回勾选。确定继续？",
        "确认拆单",
        {
          confirmButtonText: "仍然继续",
          cancelButtonText: "返回勾选",
          type: "warning"
        }
      );
    } catch {
      return;
    }
  }
  submitting.value = true;
  try {
    const res = await splitReimbursementEnvelope(
      props.detail.id,
      {
        new_envelope: {
          project_id: form.value.project_id,
          amount: Number(form.value.amount),
          category: form.value.category || undefined,
          description: form.value.description || undefined,
          expense_date: form.value.expense_date || undefined
        },
        attachment_ids: selectedAttachmentIds.value,
        original_amount: Number(form.value.original_amount),
        reason: form.value.reason || undefined
      },
      { idempotencyKey: `reimbursement-split-${crypto.randomUUID()}` }
    );
    result.value = res.data;
    message("拆单成功，两张单据已自动触发智能核查", { type: "success" });
    emit("done");
  } catch (error) {
    const err = error as {
      response?: { data?: { error?: { message?: string } } };
    };
    message(err.response?.data?.error?.message || "拆单失败，请稍后重试", {
      type: "error"
    });
  } finally {
    submitting.value = false;
  }
};

const printNewEnvelope = async () => {
  if (!result.value) return;
  const opened = await printSingleEnvelope(
    result.value.new_envelope.envelope_uuid
  );
  if (!opened) {
    message("浏览器拦截了打印窗口，请允许弹窗后重试", { type: "warning" });
  }
};

const openNewEnvelope = () => {
  if (!result.value) return;
  emit("open-envelope", result.value.new_envelope.id);
  close();
};
</script>

<template>
  <el-dialog
    :model-value="props.visible"
    :title="result ? '拆单完成' : `拆单 - ${props.detail.envelope_no}`"
    width="720px"
    append-to-body
    :close-on-click-modal="false"
    @update:model-value="value => emit('update:visible', value)"
  >
    <template v-if="!result">
      <el-alert
        type="info"
        :closable="false"
        title="拆单用于纠正混报：勾选要拆走的附件，为其指定正确的项目与金额；拆单后两张单据都会重新进入复核并自动触发智能核查。"
        class="mb-3"
      />

      <div class="split-section-title">1. 选择要转移到新单的附件（可不选）</div>
      <el-table
        :data="attachmentSnapshot"
        row-key="id"
        size="small"
        max-height="220"
        @selection-change="onSelectionChange"
      >
        <el-table-column type="selection" width="48" reserve-selection />
        <el-table-column
          prop="file_name"
          label="文件名"
          min-width="220"
          show-overflow-tooltip
        />
        <el-table-column label="类型" width="100">
          <template #default="scope">
            {{ attachmentTypeLabel(scope.row.attachment_type) }}
          </template>
        </el-table-column>
      </el-table>

      <div class="split-section-title">2. 新单信息</div>
      <el-form label-width="120px">
        <el-form-item label="所属项目" required>
          <el-select
            v-model="form.project_id"
            filterable
            placeholder="选择正确的项目"
            style="width: 320px"
          >
            <el-option
              v-for="item in projects"
              :key="item.id"
              :label="item.project_name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="新单金额" required>
          <el-input-number
            v-model="form.amount"
            :min="0"
            :precision="2"
            :step="100"
          />
        </el-form-item>
        <el-form-item label="费用类别">
          <el-input v-model="form.category" style="width: 320px" />
        </el-form-item>
        <el-form-item label="费用日期">
          <el-date-picker
            v-model="form.expense_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item label="新单说明">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="原单调整后金额" required>
          <el-input-number
            v-model="form.original_amount"
            :min="0"
            :precision="2"
            :step="100"
          />
        </el-form-item>
        <el-form-item label="拆单原因">
          <el-input
            v-model="form.reason"
            placeholder="例如：员工混报两个项目"
          />
        </el-form-item>
      </el-form>

      <el-alert
        v-if="amountMismatch"
        type="warning"
        :closable="false"
        :title="`提示：新单 + 原单 = ¥${amountSum.toFixed(2)}，与原申报金额 ¥${Number(
          props.detail.amount || 0
        ).toFixed(2)} 不一致（允许提交，请确认无误）`"
      />
    </template>

    <template v-else>
      <el-result icon="success" title="拆单成功">
        <template #sub-title>
          <div>新单编号：{{ result.new_envelope.envelope_no }}</div>
          <div>请打印新信封并将对应票据移入</div>
        </template>
      </el-result>
    </template>

    <template #footer>
      <template v-if="!result">
        <el-button @click="close">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submit"
          >确认拆单</el-button
        >
      </template>
      <template v-else>
        <el-button @click="close">关闭</el-button>
        <el-button type="success" @click="printNewEnvelope"
          >打印新信封</el-button
        >
        <el-button type="primary" @click="openNewEnvelope"
          >打开新单详情</el-button
        >
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.split-section-title {
  margin: 12px 0 8px;
  font-weight: 600;
  color: #1f2937;
}
.mb-3 {
  margin-bottom: 12px;
}
</style>
