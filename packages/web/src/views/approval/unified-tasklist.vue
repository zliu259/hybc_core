<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  listPendingApprovals,
  getApprovalDetail,
  approveApproval,
  rejectApproval,
  transferApproval,
  type PendingApprovalItem,
  type ApprovalDetailResponse
} from "@/api/approval";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

defineOptions({ name: "ApprovalUnifiedTasklist" });

const loading = ref(false);
const detailLoading = ref(false);
const actionLoading = ref(false);

const pendingRows = ref<PendingApprovalItem[]>([]);
const selectedId = ref<number | null>(null);
const detail = ref<ApprovalDetailResponse | null>(null);

const comment = ref("");
const transferTo = ref("");
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const activePending = computed(() =>
  pendingRows.value.find(item => item.id === selectedId.value) || null
);

const bizTypeStyle = (bizType: string) => {
  if (bizType === "outbound_contract") return "biz-contract";
  if (bizType === "payment_request") return "biz-payment";
  if (bizType === "reimbursement_batch") return "biz-reimbursement";
  return "biz-default";
};

const loadPending = async () => {
  loading.value = true;
  try {
    const result = await listPendingApprovals({ page: 1, pageSize: 300 });
    pendingRows.value = result.data;
    if (!selectedId.value && result.data.length) {
      selectedId.value = result.data[0].id;
      await loadDetail(result.data[0].id);
    }
  } finally {
    loading.value = false;
  }
};

const loadDetail = async (id: number) => {
  detailLoading.value = true;
  try {
    const result = await getApprovalDetail(id);
    detail.value = result.data;
  } finally {
    detailLoading.value = false;
  }
};

const selectRow = async (row: PendingApprovalItem) => {
  selectedId.value = row.id;
  await loadDetail(row.id);
};

const handleApprove = async () => {
  if (!selectedId.value) return;
  if (!comment.value.trim()) {
    message("通过时请填写意见", { type: "warning" });
    return;
  }
  actionLoading.value = true;
  try {
    await approveApproval(selectedId.value, { comment: comment.value.trim() });
    message("已通过", { type: "success" });
    comment.value = "";
    await loadPending();
  } finally {
    actionLoading.value = false;
  }
};

const handleReject = async () => {
  if (!selectedId.value) return;
  if (!comment.value.trim()) {
    message("驳回时请填写意见", { type: "warning" });
    return;
  }
  actionLoading.value = true;
  try {
    await rejectApproval(selectedId.value, { comment: comment.value.trim() });
    message("已驳回", { type: "success" });
    comment.value = "";
    await loadPending();
  } finally {
    actionLoading.value = false;
  }
};

const handleTransfer = async () => {
  if (!selectedId.value) return;
  if (!transferTo.value.trim()) {
    message("请填写转签对象 userid", { type: "warning" });
    return;
  }
  if (!comment.value.trim()) {
    message("转签时请填写意见", { type: "warning" });
    return;
  }
  actionLoading.value = true;
  try {
    await transferApproval(selectedId.value, {
      to_userid: transferTo.value.trim(),
      reason: comment.value.trim()
    });
    message("已转签", { type: "success" });
    transferTo.value = "";
    comment.value = "";
    await loadPending();
  } finally {
    actionLoading.value = false;
  }
};

onMounted(async () => {
  await Promise.all([loadPending(), loadWecomUsers()]);
});
</script>

<template>
  <el-card shadow="never" class="tasklist" v-loading="loading">
    <template #header>
      <div class="tasklist__header">审批中心 - 统一工作台</div>
    </template>

    <div class="tasklist__layout">
      <div class="tasklist__left">
        <div class="tasklist__left-title">待办池 ({{ pendingRows.length }})</div>
        <div class="tasklist__list">
          <div
            v-for="row in pendingRows"
            :key="row.id"
            class="task-item"
            :class="[
              bizTypeStyle(row.biz_type),
              { 'task-item--active': row.id === selectedId }
            ]"
            @click="selectRow(row)"
          >
            <div class="task-item__biz">{{ row.biz_type }}</div>
            <div class="task-item__summary">{{ row.biz_summary }}</div>
            <div class="task-item__meta">{{ row.initiator_userid }} · {{ row.submitted_at }}</div>
          </div>
        </div>
      </div>

      <div class="tasklist__right" v-loading="detailLoading">
        <template v-if="activePending">
          <div class="preview-head">
            <div class="preview-head__title">{{ activePending.biz_summary }}</div>
            <el-tag type="warning">{{ activePending.current_node_name || "待处理" }}</el-tag>
          </div>

          <el-descriptions :column="2" border>
            <el-descriptions-item label="业务类型">{{ activePending.biz_type }}</el-descriptions-item>
            <el-descriptions-item label="发起人">{{ activePending.initiator_userid }}</el-descriptions-item>
            <el-descriptions-item label="实例编号">{{ activePending.instance_no }}</el-descriptions-item>
            <el-descriptions-item label="提交时间">{{ activePending.submitted_at }}</el-descriptions-item>
          </el-descriptions>

          <el-divider />

          <el-collapse>
            <el-collapse-item title="节点流转" name="nodes">
              <el-timeline>
                <el-timeline-item
                  v-for="node in detail?.nodes || []"
                  :key="node.id"
                  :timestamp="node.completed_at || node.started_at || node.created_at"
                >
                  {{ node.node_name }} · {{ node.status }}
                </el-timeline-item>
              </el-timeline>
            </el-collapse-item>
          </el-collapse>

          <div class="action-bar">
            <el-input
              v-model="comment"
              type="textarea"
              :rows="2"
              placeholder="审批意见（驳回时必填）"
            />
            <div class="action-bar__row">
              <el-select
                v-model="transferTo"
                clearable
                filterable
                placeholder="选择转签人员（可选）"
                style="width: 260px"
              >
                <el-option
                  v-for="item in wecomUsers"
                  :key="item.userid"
                  :label="`${item.name} (${item.userid})`"
                  :value="item.userid"
                />
              </el-select>
              <el-button type="success" :loading="actionLoading" @click="handleApprove">通过</el-button>
              <el-button type="danger" :loading="actionLoading" @click="handleReject">驳回</el-button>
              <el-button type="warning" :loading="actionLoading" @click="handleTransfer">转签</el-button>
            </div>
          </div>
        </template>

        <el-empty v-else description="暂无待办" />
      </div>
    </div>
  </el-card>
</template>

<style scoped>
.tasklist {
  background: #fffaf2;
}

.tasklist__header {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.tasklist__layout {
  display: grid;
  grid-template-columns: 30% 70%;
  gap: 12px;
  min-height: 620px;
}

.tasklist__left,
.tasklist__right {
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  background: #fff;
  padding: 12px;
}

.tasklist__left-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}

.tasklist__list {
  max-height: 560px;
  overflow: auto;
}

.task-item {
  padding: 10px;
  border-left: 4px solid #d9ceb9;
  border-radius: 6px;
  margin-bottom: 8px;
  background: #fffcf7;
  cursor: pointer;
}

.task-item--active {
  box-shadow: inset 0 0 0 1px #2f6c5f;
}

.biz-contract {
  border-left-color: #2d5f9a;
}

.biz-payment {
  border-left-color: #c4872b;
}

.biz-reimbursement {
  border-left-color: #2f7a53;
}

.biz-default {
  border-left-color: #6e6458;
}

.task-item__biz {
  font-size: 12px;
  color: #6e6458;
}

.task-item__summary {
  margin-top: 4px;
  font-size: 14px;
  color: #2a241d;
}

.task-item__meta {
  margin-top: 6px;
  font-size: 12px;
  color: #6e6458;
}

.preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.preview-head__title {
  font-size: 16px;
  font-weight: 600;
  color: #2a241d;
}

.action-bar {
  position: sticky;
  bottom: 0;
  margin-top: 14px;
  background: #fff;
  padding-top: 10px;
}

.action-bar__row {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  align-items: center;
}

@media (max-width: 960px) {
  .tasklist__layout {
    grid-template-columns: 1fr;
  }
}
</style>
