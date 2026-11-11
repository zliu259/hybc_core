<script setup lang="ts">
/** 金额变更记录。没有记录时整段不占位。 */
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import {
  submitAmountChangeApproval,
  type ContractAmountChange
} from "@/api/contract";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { formatBeijingDateTime } from "@/utils/datetime";
import { message } from "@/utils/message";
import AttachmentPreviewDrawer from "@/views/approval/detail/components/AttachmentPreviewDrawer.vue";
import { useAttachmentPreview } from "@/views/approval/detail/useAttachmentPreview";
import FinSection from "../../shared/components/FinSection.vue";
import { formatMoney } from "../../shared/format";
import {
  canSubmitAmountChange,
  toAmountChangeStatus,
  toAmountChangeTypeLabel
} from "../contract-detail-view";

defineOptions({ name: "ContractAmountChanges" });

const props = defineProps<{
  contractId: number;
  rows: ContractAmountChange[];
  roles: readonly string[];
  toUserLabel: (userid: string | null | undefined) => string;
}>();

const emit = defineEmits<{
  (e: "refresh"): void;
  /** 跳到了别的页面，宿主抽屉要关闭 */
  (e: "nav"): void;
}>();

const router = useRouter();
const preview = useAttachmentPreview();
const submittingId = ref<number | null>(null);
const visible = computed(() => props.rows.length > 0);

const submit = async (row: ContractAmountChange) => {
  submittingId.value = row.id;
  try {
    await submitAmountChangeApproval(props.contractId, row.id);
    message("金额变更已提交审批", { type: "success" });
    emit("refresh");
  } catch (error) {
    message(resolveApiErrorMessage(error, "提交审批失败"), { type: "error" });
  } finally {
    submittingId.value = null;
  }
};

const openApproval = (row: ContractAmountChange) => {
  router.push(`/approval/detail/${row.approval_instance_id}`);
  emit("nav");
};
</script>

<template>
  <FinSection v-if="visible" title="金额变更记录">
    <el-table :data="rows" size="small">
      <el-table-column label="发起时间" width="170">
        <template #default="scope">
          {{ formatBeijingDateTime(scope.row.created_at) }}
        </template>
      </el-table-column>
      <el-table-column label="发起人" width="100">
        <template #default="scope">
          {{ toUserLabel(scope.row.applicant_userid) }}
        </template>
      </el-table-column>
      <el-table-column label="类型" width="70">
        <template #default="scope">
          {{ toAmountChangeTypeLabel(scope.row.change_type) }}
        </template>
      </el-table-column>
      <el-table-column label="原金额" width="130" align="right">
        <template #default="scope">
          {{ formatMoney(scope.row.old_amount) }}
        </template>
      </el-table-column>
      <el-table-column label="新金额" width="130" align="right">
        <template #default="scope">
          {{ formatMoney(scope.row.new_amount) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="scope">
          <el-tag :type="toAmountChangeStatus(scope.row).type">
            {{ toAmountChangeStatus(scope.row).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="reason" label="原因" min-width="200" />
      <el-table-column label="附件" min-width="160">
        <template #default="scope">
          <template v-if="scope.row.attachments?.length">
            <div v-for="item in scope.row.attachments" :key="item.file_key">
              <el-link
                type="primary"
                :title="item.file_name"
                @click="preview.open(scope.row.attachments, item)"
              >
                {{ item.file_name }}
              </el-link>
            </div>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="scope">
          <el-button
            v-if="canSubmitAmountChange(scope.row, roles)"
            link
            type="primary"
            :loading="submittingId === scope.row.id"
            @click="submit(scope.row)"
          >
            提交审批
          </el-button>
          <el-button
            v-else-if="scope.row.approval_instance_id"
            link
            @click="openApproval(scope.row)"
          >
            查看审批
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <AttachmentPreviewDrawer
      v-model:visible="preview.visible.value"
      :url="preview.url.value"
      :file-name="preview.fileName.value"
      :index="preview.index.value"
      :total="preview.list.value.length"
      @step="preview.step"
    />
  </FinSection>
</template>
