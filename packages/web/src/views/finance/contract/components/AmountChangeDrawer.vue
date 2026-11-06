<script setup lang="ts">
/** 发起合同金额变更并提交审批。合同详情和合同执行监控共用。 */
import type { UploadRequestOptions } from "element-plus";
import { computed, ref, watch } from "vue";
import {
  createAmountChange,
  submitAmountChangeApproval,
  type AmountChangeAttachment
} from "@/api/contract";
import { uploadAttachmentFile } from "@/api/upload";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";

defineOptions({ name: "AmountChangeDrawer" });

const visible = defineModel<boolean>("visible", { required: true });

const props = defineProps<{
  contract: {
    id: number;
    contract_no: string;
    total_amount: number;
  } | null;
  /** 写进审批实例的来源说明 */
  note: string;
}>();

const emit = defineEmits<{ (e: "changed"): void }>();

/** 与后端 MAX_AMOUNT_CHANGE_ATTACHMENTS 保持一致 */
const MAX_ATTACHMENTS = 20;

const submitting = ref(false);
// 多选上传会并发进行，用计数而不是布尔值，避免第一个完成就把「上传中」清掉
const pendingUploads = ref(0);
const uploadingAttachment = computed(() => pendingUploads.value > 0);
const amountForm = ref<{
  new_amount: number;
  reason: string;
  attachments: AmountChangeAttachment[];
}>({ new_amount: 0, reason: "", attachments: [] });

const formatFileSize = (size: number | null): string => {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

watch(visible, open => {
  if (!open) return;
  amountForm.value = {
    new_amount: Number(props.contract?.total_amount ?? 0),
    reason: "",
    attachments: []
  };
});

const uploadAttachment = async (options: UploadRequestOptions) => {
  if (
    amountForm.value.attachments.length + pendingUploads.value >=
    MAX_ATTACHMENTS
  ) {
    message(`附件最多 ${MAX_ATTACHMENTS} 个`, { type: "warning" });
    options.onError?.(new Error("too_many_attachments") as never);
    return;
  }
  pendingUploads.value += 1;
  try {
    const attachment = await uploadAttachmentFile(options.file, "contract");
    amountForm.value = {
      ...amountForm.value,
      attachments: [...amountForm.value.attachments, attachment]
    };
    options.onSuccess?.({});
  } catch {
    message("附件上传失败，请重试", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    pendingUploads.value -= 1;
  }
};

const removeAttachment = (fileKey: string) => {
  amountForm.value = {
    ...amountForm.value,
    attachments: amountForm.value.attachments.filter(
      item => item.file_key !== fileKey
    )
  };
};

const submit = async () => {
  const contractId = props.contract?.id;
  if (!contractId || !amountForm.value.reason.trim()) {
    message("请填写变更原因", { type: "warning" });
    return;
  }
  if (uploadingAttachment.value) {
    message("附件还在上传，请稍候", { type: "warning" });
    return;
  }

  submitting.value = true;
  try {
    let changeId: number;
    try {
      const change = await createAmountChange(contractId, {
        change_type: "adjust",
        new_amount: amountForm.value.new_amount,
        reason: amountForm.value.reason.trim(),
        attachments: amountForm.value.attachments
      });
      changeId = change.data.id;
    } catch (error) {
      message(resolveApiErrorMessage(error, "发起金额变更失败，请重试"), {
        type: "error"
      });
      return;
    }

    try {
      await submitAmountChangeApproval(contractId, changeId, {
        instance_config: { note: props.note }
      });
      message("已提交变更审批", { type: "success" });
    } catch (error) {
      // 变更单已落库为待提交，避免用户重复发起；引导去合同详情补提交
      message(
        `${resolveApiErrorMessage(error, "提交审批失败")}。变更申请已保存，可在合同详情的「金额变更记录」里重新提交审批`,
        { type: "warning", duration: 8000 }
      );
    }
    visible.value = false;
    emit("changed");
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <el-drawer
    v-model="visible"
    title="发起金额变更"
    size="480px"
    destroy-on-close
    append-to-body
  >
    <el-form label-width="110px">
      <el-form-item label="合同号">
        <el-input :model-value="contract?.contract_no" disabled />
      </el-form-item>
      <el-form-item label="原合同金额">
        <el-input
          :model-value="String(contract?.total_amount ?? '')"
          disabled
        />
      </el-form-item>
      <el-form-item label="新合同金额" required>
        <el-input-number
          v-model="amountForm.new_amount"
          :min="0"
          :precision="2"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="变更缘由" required>
        <el-input
          v-model="amountForm.reason"
          type="textarea"
          :rows="4"
          maxlength="1000"
          show-word-limit
          placeholder="说明为什么要调整合同金额，审批人会在审批页看到"
        />
      </el-form-item>
      <el-form-item label="附件">
        <div class="attachment-field">
          <el-upload
            action="#"
            multiple
            :show-file-list="false"
            :disabled="submitting"
            :http-request="uploadAttachment"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
          >
            <el-button :loading="uploadingAttachment" :disabled="submitting">
              上传文件
            </el-button>
          </el-upload>
          <div class="attachment-field__tip">
            选填，可传补充协议、签证单等依据（最多 {{ MAX_ATTACHMENTS }}
            个），审批人可在审批页查看
          </div>
          <ul
            v-if="amountForm.attachments.length"
            class="attachment-field__list"
          >
            <li
              v-for="item in amountForm.attachments"
              :key="item.file_key"
              class="attachment-field__item"
            >
              <span class="attachment-field__name" :title="item.file_name">
                {{ item.file_name }}
              </span>
              <span class="attachment-field__size">
                {{ formatFileSize(item.file_size) }}
              </span>
              <el-button
                link
                type="danger"
                :disabled="submitting"
                @click="removeAttachment(item.file_key)"
              >
                移除
              </el-button>
            </li>
          </ul>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        :disabled="uploadingAttachment"
        @click="submit"
      >
        提交审批
      </el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.attachment-field {
  width: 100%;
}

.attachment-field__tip {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: #6e6458;
}

.attachment-field__list {
  padding: 0;
  margin: 8px 0 0;
  list-style: none;
}

.attachment-field__item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 4px 0;
  font-size: 13px;
  border-bottom: 1px dashed #e8dfd2;
}

.attachment-field__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-field__size {
  flex: none;
  color: #8a7f72;
}
</style>
