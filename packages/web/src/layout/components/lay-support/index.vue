<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type { UploadFile } from "element-plus";
import { message } from "@/utils/message";
import { formatToken, getToken } from "@/utils/auth";
import { createUploadSignature } from "@/api/upload";
import {
  createSupportTicket,
  listMySupportTickets,
  type SupportTicket,
  type SupportTicketCategory
} from "@/api/support";

const visible = defineModel<boolean>("visible", { required: true });

const activeTab = ref("submit");
const submitLoading = ref(false);
const listLoading = ref(false);
const tickets = ref<SupportTicket[]>([]);

const submitForm = reactive<{ category: SupportTicketCategory; description: string }>(
  {
    category: "system_error",
    description: ""
  }
);
const attachmentFiles = ref<UploadFile[]>([]);

const categoryOptions: Array<{ label: string; value: SupportTicketCategory }> = [
  { label: "账号问题", value: "account_issue" },
  { label: "权限缺失", value: "permission_missing" },
  { label: "系统报错", value: "system_error" },
  { label: "功能建议", value: "feature_suggestion" },
  { label: "其他", value: "other" }
];

const statusTagType = computed(() => {
  return (status: SupportTicket["status"]) => {
    if (status === "resolved") return "success";
    return "warning";
  };
});

const statusLabel = computed(() => {
  return (status: SupportTicket["status"]) => {
    if (status === "resolved") return "已解决";
    return "待处理";
  };
});

const resetSubmitForm = () => {
  submitForm.category = "system_error";
  submitForm.description = "";
  attachmentFiles.value = [];
};

const onAttachmentChange = (file: UploadFile, files: UploadFile[]) => {
  const accepted = files
    .slice(-5)
    .filter(item => {
      const size = item.size || 0;
      if (size > 10 * 1024 * 1024) {
        message(`文件 ${item.name} 超过 10MB，已忽略`, { type: "warning" });
        return false;
      }
      return true;
    });
  attachmentFiles.value = accepted;
};

const uploadAttachments = async () => {
  const uploadedKeys: string[] = [];
  for (const item of attachmentFiles.value) {
    const raw = item.raw;
    if (!raw) continue;
    const signRes = await createUploadSignature({
      fileName: raw.name,
      contentType: raw.type,
      category: "support"
    });
    const sign = signRes.data;
    const uploadResp = await fetch(sign.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": raw.type || "application/octet-stream",
        Authorization: formatToken(getToken().accessToken)
      },
      body: raw
    });
    if (!uploadResp.ok) {
      throw new Error(`attachment_upload_failed_${uploadResp.status}`);
    }
    uploadedKeys.push(sign.key);
  }
  return uploadedKeys;
};

const loadMyTickets = async () => {
  listLoading.value = true;
  try {
    const result = await listMySupportTickets();
    tickets.value = result.data;
  } finally {
    listLoading.value = false;
  }
};

const submitTicket = async () => {
  const description = submitForm.description.trim();
  if (!description) {
    message("请填写问题描述", { type: "warning" });
    return;
  }

  submitLoading.value = true;
  try {
    const attachmentKeys = await uploadAttachments();
    await createSupportTicket({
      category: submitForm.category,
      description,
      attachments: attachmentKeys
    });
    message("提交成功", { type: "success" });
    resetSubmitForm();
    activeTab.value = "records";
    await loadMyTickets();
  } finally {
    submitLoading.value = false;
  }
};

onMounted(async () => {
  await loadMyTickets();
});
</script>

<template>
  <el-drawer v-model="visible" title="技术支持" size="460px" destroy-on-close>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="提交问题" name="submit">
        <el-form label-position="top">
          <el-form-item label="问题分类">
            <el-select v-model="submitForm.category" style="width: 100%">
              <el-option
                v-for="item in categoryOptions"
                :key="item.value"
                :label="item.label"
                :value="item.value"
              />
            </el-select>
          </el-form-item>

          <el-form-item label="问题描述">
            <el-input
              v-model="submitForm.description"
              type="textarea"
              :rows="6"
              maxlength="1000"
              show-word-limit
              placeholder="请描述你遇到的问题、影响范围和复现步骤"
            />
          </el-form-item>

          <el-form-item label="截图/附件">
            <el-upload
              drag
              :auto-upload="false"
              :file-list="attachmentFiles"
              :limit="5"
              multiple
              :on-change="onAttachmentChange"
            >
              <div>拖拽或点击上传（最多 5 个，每个不超过 10MB）</div>
            </el-upload>
          </el-form-item>

          <el-form-item>
            <el-button type="primary" :loading="submitLoading" @click="submitTicket"
              >提交</el-button
            >
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <el-tab-pane label="我的记录" name="records">
        <el-scrollbar max-height="calc(100vh - 180px)">
          <div class="ticket-list" v-loading="listLoading">
            <el-empty v-if="!tickets.length && !listLoading" description="暂无记录" />
            <el-card
              v-for="item in tickets"
              :key="item.id"
              shadow="never"
              class="ticket-item"
            >
              <template #header>
                <div class="ticket-item__head">
                  <span>#{{ item.id }}</span>
                  <el-tag :type="statusTagType(item.status)">
                    {{ statusLabel(item.status) }}
                  </el-tag>
                </div>
              </template>

              <p class="ticket-item__desc">{{ item.description }}</p>
              <p class="ticket-item__time">提交时间：{{ item.created_at }}</p>
              <el-alert
                v-if="item.reply"
                title="处理说明"
                type="success"
                :closable="false"
                show-icon
              >
                <template #default>
                  {{ item.reply }}
                </template>
              </el-alert>
            </el-card>
          </div>
        </el-scrollbar>
      </el-tab-pane>
    </el-tabs>
  </el-drawer>
</template>

<style scoped>
.ticket-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ticket-item {
  border-color: #d9ceb9;
}

.ticket-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ticket-item__desc {
  margin: 0 0 8px;
  white-space: pre-wrap;
  color: #2a241d;
}

.ticket-item__time {
  margin: 0 0 10px;
  font-size: 12px;
  color: #6e6458;
}
</style>
