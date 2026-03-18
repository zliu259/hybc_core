<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { helpdeskCategoryLabel } from "@/utils/enum-labels";
import {
  getSupportTicket,
  listSupportTickets,
  resolveSupportTicket,
  type SupportTicket,
  type SupportTicketStatus
} from "@/api/support";

const loading = ref(false);
const resolving = ref(false);
const rows = ref<SupportTicket[]>([]);
const statusFilter = ref<SupportTicketStatus | "">("");

const detailDrawerVisible = ref(false);
const activeTicketId = ref<number | null>(null);
const activeDescription = ref("");
const activeCategory = ref("");
const activeStatus = ref<SupportTicketStatus>("pending");
const activeReply = ref("");
const activeAttachments = ref<string[]>([]);
const replyInput = ref("");

const statusTagType = computed(() => {
  return (status: SupportTicketStatus) => {
    if (status === "resolved") return "success";
    return "warning";
  };
});

const statusLabel = computed(() => {
  return (status: SupportTicketStatus) => {
    if (status === "resolved") return "已解决";
    return "待处理";
  };
});

const loadRows = async () => {
  loading.value = true;
  try {
    const result = await listSupportTickets({
      status: statusFilter.value || undefined
    });
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const openDetail = async (id: number) => {
  const detail = await getSupportTicket(id);
  activeTicketId.value = detail.data.id;
  activeDescription.value = detail.data.description;
  activeCategory.value = detail.data.category;
  activeStatus.value = detail.data.status;
  activeReply.value = detail.data.reply || "";
  activeAttachments.value = detail.data.attachments || [];
  replyInput.value = detail.data.reply || "";
  detailDrawerVisible.value = true;
};

const submitResolve = async () => {
  if (!activeTicketId.value) return;
  const content = replyInput.value.trim();
  if (!content) {
    message("请填写处理说明", { type: "warning" });
    return;
  }

  resolving.value = true;
  try {
    await resolveSupportTicket(activeTicketId.value, {
      reply: content,
      status: "resolved"
    });
    message("工单已处理", { type: "success" });
    detailDrawerVisible.value = false;
    await loadRows();
  } finally {
    resolving.value = false;
  }
};

onMounted(loadRows);
</script>

<template>
  <el-card shadow="never" class="helpdesk">
    <template #header>
      <div class="head">
        <div>
          <div class="title">IT 支持与工单处理台</div>
          <div class="sub">超管统一处理全员工单并填写解决方案</div>
        </div>
        <div class="head__ops">
          <el-select v-model="statusFilter" clearable style="width: 140px">
            <el-option label="待处理" value="pending" />
            <el-option label="已解决" value="resolved" />
          </el-select>
          <el-button type="primary" @click="loadRows">查询</el-button>
        </div>
      </div>
    </template>

    <el-table :data="rows" :loading="loading" stripe size="small">
      <el-table-column prop="id" label="工单ID" width="90" />
      <el-table-column label="分类" width="140">
        <template #default="scope">{{
          helpdeskCategoryLabel(scope.row.category)
        }}</template>
      </el-table-column>
      <el-table-column
        prop="description"
        label="问题描述"
        min-width="280"
        show-overflow-tooltip
      />
      <el-table-column label="状态" width="100">
        <template #default="scope">
          <el-tag :type="statusTagType(scope.row.status)">
            {{ statusLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="提交时间" width="180" />
      <el-table-column label="操作" width="90" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openDetail(scope.row.id)"
            >详情</el-button
          >
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-drawer
    v-model="detailDrawerVisible"
    title="工单详情"
    size="520px"
    destroy-on-close
  >
    <el-descriptions :column="1" border>
      <el-descriptions-item label="工单ID">{{
        activeTicketId
      }}</el-descriptions-item>
      <el-descriptions-item label="分类">{{
        activeCategory
      }}</el-descriptions-item>
      <el-descriptions-item label="状态">{{
        statusLabel(activeStatus)
      }}</el-descriptions-item>
      <el-descriptions-item label="问题描述">{{
        activeDescription
      }}</el-descriptions-item>
      <el-descriptions-item label="附件">
        <el-space wrap>
          <span v-if="!activeAttachments.length">-</span>
          <el-link
            v-for="item in activeAttachments"
            :key="item"
            :href="item.startsWith('http') ? item : undefined"
            :underline="false"
            type="primary"
            target="_blank"
          >
            {{ item }}
          </el-link>
        </el-space>
      </el-descriptions-item>
      <el-descriptions-item label="历史回复">{{
        activeReply || "-"
      }}</el-descriptions-item>
    </el-descriptions>

    <el-form label-position="top" class="mt-3">
      <el-form-item label="处理说明/解决方案">
        <el-input
          v-model="replyInput"
          type="textarea"
          :rows="5"
          maxlength="1000"
          show-word-limit
        />
      </el-form-item>
      <el-button type="primary" :loading="resolving" @click="submitResolve">
        标记已解决
      </el-button>
    </el-form>
  </el-drawer>
</template>

<style scoped>
.helpdesk {
  background: #fffaf2;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.head__ops {
  display: flex;
  gap: 8px;
}

.title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}

.mt-3 {
  margin-top: 12px;
}

@media (max-width: 768px) {
  .head {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
