<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  listContracts,
  createAmountChange,
  submitAmountChangeApproval,
  type AmountChangeAttachment,
  type Contract
} from "@/api/contract";
import { uploadAttachmentFile } from "@/api/upload";

defineOptions({ name: "ContractMonitor" });

const loading = ref(false);
const rows = ref<Contract[]>([]);
const filters = ref({ keyword: "", status: "" });

const drawerVisible = ref(false);
const submitting = ref(false);
const activeRow = ref<Contract | null>(null);
// 多选上传会并发进行，用计数而不是布尔值，避免第一个完成就把「上传中」清掉
const pendingUploads = ref(0);
const uploadingAttachment = computed(() => pendingUploads.value > 0);
const amountForm = ref<{
  new_amount: number;
  reason: string;
  attachments: AmountChangeAttachment[];
}>({ new_amount: 0, reason: "", attachments: [] });

/** 与后端 MAX_AMOUNT_CHANGE_ATTACHMENTS 保持一致 */
const MAX_ATTACHMENTS = 20;

const apiErrorMessage = (error: unknown, fallback: string): string => {
  const shape = error as {
    response?: { data?: { error?: { message?: string } } };
  } | null;
  return shape?.response?.data?.error?.message || fallback;
};

const formatFileSize = (size: number | null): string => {
  if (!size) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const statusMap: Record<string, { label: string; type: TagType }> = {
  draft: { label: "草稿", type: "info" },
  pending_approval: { label: "审批中", type: "warning" },
  active: { label: "生效", type: "success" },
  completed: { label: "已完成", type: "primary" }
};

const progressColor = (ratio: number) => {
  if (ratio >= 100) return "#3f9c5c";
  if (ratio > 95) return "#bd3f3f";
  if (ratio >= 80) return "#c4872b";
  return "#2d5f9a";
};

const paidRatio = (row: Contract) => {
  if (!row.total_amount || row.total_amount <= 0) return 0;
  return Number(((row.paid_amount / row.total_amount) * 100).toFixed(2));
};

const riskTag = (ratio: number): { type: TagType; label: string } => {
  if (ratio >= 100) return { type: "success", label: "合同执行完成" };
  if (ratio > 95) return { type: "danger", label: "超高风险" };
  if (ratio >= 80) return { type: "warning", label: "阈值预警" };
  return { type: "success", label: "正常" };
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listContracts({
      direction: "outbound",
      page: 1,
      pageSize: 200,
      keyword: filters.value.keyword || undefined,
      status: filters.value.status || undefined
    });
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openAmountDrawer = (row: Contract) => {
  activeRow.value = row;
  amountForm.value = {
    new_amount: Number(row.total_amount),
    reason: "",
    attachments: []
  };
  drawerVisible.value = true;
};

const uploadAmountChangeAttachment = async (options: UploadRequestOptions) => {
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

const removeAmountChangeAttachment = (fileKey: string) => {
  amountForm.value = {
    ...amountForm.value,
    attachments: amountForm.value.attachments.filter(
      item => item.file_key !== fileKey
    )
  };
};

const submitAmountChange = async () => {
  if (!activeRow.value || !amountForm.value.reason.trim()) {
    message("请填写变更原因", { type: "warning" });
    return;
  }

  if (uploadingAttachment.value) {
    message("附件还在上传，请稍候", { type: "warning" });
    return;
  }

  const contractId = activeRow.value.id;
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
      message(apiErrorMessage(error, "发起金额变更失败，请重试"), {
        type: "error"
      });
      return;
    }

    try {
      await submitAmountChangeApproval(contractId, changeId, {
        instance_config: {
          note: "合同金额变更发起自合同执行监控大屏"
        }
      });
    } catch (error) {
      // 变更单已落库为待提交，避免用户重复发起；引导去合同详情补提交
      drawerVisible.value = false;
      message(
        `${apiErrorMessage(error, "提交审批失败")}。变更申请已保存，可在合同详情的「金额变更记录」里重新提交审批`,
        { type: "warning", duration: 8000 }
      );
      await loadData();
      return;
    }

    message("已提交变更审批", { type: "success" });
    drawerVisible.value = false;
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const tableRows = computed(() => rows.value);

const tableRowClassName = ({ row }: { row: Contract }) => {
  const ratio = paidRatio(row);
  return ratio > 90 && ratio < 100 ? "danger-row" : "";
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" class="contract-monitor">
    <template #header>
      <div class="head">
        <div>
          <div class="head__title">合同执行与监控大屏</div>
          <div class="head__sub">重点监控付款进度接近阈值的合同</div>
        </div>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="合同号/对方单位"
        />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 160px">
          <el-option label="草稿" value="draft" />
          <el-option label="审批中" value="pending_approval" />
          <el-option label="生效" value="active" />
          <el-option label="已完成" value="completed" />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table
      :data="tableRows"
      :loading="loading"
      :row-class-name="tableRowClassName"
      style="margin-top: 14px"
      stripe
      size="small"
    >
      <el-table-column prop="contract_no" label="合同号" width="170" />
      <el-table-column prop="counterparty" label="对方单位" min-width="180" />
      <el-table-column prop="total_amount" label="合同总额" width="140" />
      <el-table-column prop="paid_amount" label="已打款" width="120" />
      <el-table-column label="打款进度" min-width="260">
        <template #default="{ row }">
          <el-progress
            :percentage="paidRatio(row)"
            :stroke-width="16"
            :color="progressColor(paidRatio(row))"
          />
        </template>
      </el-table-column>
      <el-table-column label="风险等级" width="120">
        <template #default="{ row }">
          <el-tag :type="riskTag(paidRatio(row)).type">
            {{ riskTag(paidRatio(row)).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag :type="statusMap[row.status]?.type || 'info'">
            {{ statusMap[row.status]?.label || row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openAmountDrawer(row)"
            >变更金额</el-button
          >
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-drawer
    v-model="drawerVisible"
    title="发起金额变更"
    size="480px"
    destroy-on-close
  >
    <el-form label-width="110px">
      <el-form-item label="合同号">
        <el-input :model-value="activeRow?.contract_no" disabled />
      </el-form-item>
      <el-form-item label="原合同金额">
        <el-input
          :model-value="String(activeRow?.total_amount ?? '')"
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
            :http-request="uploadAmountChangeAttachment"
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
                @click="removeAmountChangeAttachment(item.file_key)"
              >
                移除
              </el-button>
            </li>
          </ul>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="drawerVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        :disabled="uploadingAttachment"
        @click="submitAmountChange"
      >
        提交审批
      </el-button>
    </template>
  </el-drawer>
</template>

<style scoped>
.contract-monitor {
  background: #fffaf2;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.head__title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.head__sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}

:deep(.danger-row > td) {
  background: #fff1f1 !important;
}

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
