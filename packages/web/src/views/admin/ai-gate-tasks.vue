<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  getApprovalAiGateSettings,
  handleApprovalAiGateTask,
  listApprovalAiGateTasks,
  updateApprovalAiGateSettings,
  type ApprovalAiGateSettings,
  type ApprovalAiGateTaskItem
} from "@/api/admin";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import {
  buildFallbackReviewerNotice,
  filterSuperAdminContacts
} from "./ai-gate-settings";
import { toStatusLabel } from "@/views/approval/labels";
import { formatBeijingDateTime } from "@/utils/datetime";

defineOptions({ name: "AdminAiGateTasks" });

const router = useRouter();
const loading = ref(false);
const submitting = ref(false);
const rows = ref<ApprovalAiGateTaskItem[]>([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const statusFilter = ref("");
const keyword = ref("");

const statusTagType = (status: string) => {
  if (status === "completed") return "success";
  if (status === "failed" || status === "timeout") return "danger";
  if (status === "running" || status === "assigned") return "warning";
  return "info";
};

const actionDialogVisible = ref(false);
const actionTaskId = ref<number | null>(null);
const actionType = ref<"approve" | "reject" | "comment">("comment");
const actionComment = ref("");

const loadRows = async () => {
  loading.value = true;
  try {
    const result = await listApprovalAiGateTasks({
      status: statusFilter.value || undefined,
      keyword: keyword.value.trim() || undefined,
      page: page.value,
      pageSize: pageSize.value
    });
    rows.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const resetAndSearch = async () => {
  page.value = 1;
  await loadRows();
};

const openActionDialog = (
  task: ApprovalAiGateTaskItem,
  type: "approve" | "reject" | "comment"
) => {
  actionTaskId.value = task.task_id;
  actionType.value = type;
  actionComment.value = "";
  actionDialogVisible.value = true;
};

const submitAction = async () => {
  if (!actionTaskId.value) return;
  if (!actionComment.value.trim()) {
    message("请填写处理说明", { type: "warning" });
    return;
  }
  submitting.value = true;
  try {
    await handleApprovalAiGateTask(actionTaskId.value, {
      action: actionType.value,
      comment: actionComment.value.trim()
    });
    message("处理成功", { type: "success" });
    actionDialogVisible.value = false;
    await loadRows();
  } finally {
    submitting.value = false;
  }
};

// 放行/驳回只对审批中的实例有意义：AI 拦截已退回发起人、或实例已终态时，后端会 409 拒绝
const canPushFlow = (row: ApprovalAiGateTaskItem) =>
  !row.instance || row.instance.status === "in_progress";

const goApprovalDetail = (row: ApprovalAiGateTaskItem) => {
  if (!row.instance?.id) return;
  router.push(`/approval/detail/${row.instance.id}`);
};

const settings = ref<ApprovalAiGateSettings | null>(null);
const settingsLoading = ref(false);
const settingsSaving = ref(false);
const reviewerDraft = ref("");
const contactsLoading = ref(false);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const superAdminOptions = computed(() =>
  filterSuperAdminContacts(wecomUsers.value)
);
const reviewerNotice = computed(() =>
  settings.value ? buildFallbackReviewerNotice(settings.value) : null
);

// 审计行里的 updated_by 是企微 userid，通讯录在手时换成姓名更可读
const toContactName = (userid: string) =>
  wecomUsers.value.find(user => user.userid === userid)?.name || userid;

const loadSettings = async () => {
  settingsLoading.value = true;
  try {
    const result = await getApprovalAiGateSettings();
    settings.value = result.data;
    reviewerDraft.value = result.data.fallback_reviewer_userid;
  } catch (error) {
    message(resolveApiErrorMessage(error, "兜底审核人配置加载失败"), {
      type: "error"
    });
  } finally {
    settingsLoading.value = false;
  }
};

const saveSettings = async () => {
  // el-select 的 clearable 会把值清成 undefined，这里统一收敛成空串再送后端
  const nextReviewer = (reviewerDraft.value || "").trim();
  // 清空等于把兜底关掉，后果（拦截直接退回发起人）必须让超管确认一次
  if (!nextReviewer && settings.value?.fallback_reviewer_userid) {
    try {
      await ElMessageBox.confirm(
        "清除后 AI 拦截将直接退回发起人修改重提，确认清除兜底审核人？",
        "确认清除",
        { type: "warning" }
      );
    } catch {
      // 取消即放弃保存，不打扰用户
      return;
    }
  }
  settingsSaving.value = true;
  try {
    await updateApprovalAiGateSettings({
      fallback_reviewer_userid: nextReviewer
    });
    message("兜底审核人已保存", { type: "success" });
    await loadSettings();
  } catch (error) {
    message(resolveApiErrorMessage(error, "兜底审核人保存失败"), {
      type: "error"
    });
  } finally {
    settingsSaving.value = false;
  }
};

const loadContacts = async () => {
  contactsLoading.value = true;
  try {
    await loadWecomUsers();
  } catch {
    // 通讯录拿不到时仍可用本地缓存人选，只提示不阻断设置卡
    message("企业微信通讯录加载失败，下拉人选可能不完整", {
      type: "warning"
    });
  } finally {
    contactsLoading.value = false;
  }
};

onMounted(async () => {
  await Promise.all([loadSettings(), loadContacts()]);
});

onMounted(loadRows);
</script>

<template>
  <el-card shadow="never" style="margin-bottom: 12px">
    <template #header>
      <div style="font-size: 16px; font-weight: 700">AI 关卡兜底审核人</div>
      <div style="margin-top: 4px; font-size: 13px; color: #6e6458">
        AI 判定拦截时不再自动退回，转给此人以普通审批任务处理（放行 / 退回发起人
        / 驳回）
      </div>
    </template>
    <el-alert
      v-if="reviewerNotice"
      :type="reviewerNotice.type"
      :title="reviewerNotice.text"
      :closable="false"
      show-icon
      style="margin-bottom: 12px"
    />
    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
      <el-select
        v-model="reviewerDraft"
        clearable
        filterable
        placeholder="选择超级管理员"
        style="width: 280px"
        :loading="contactsLoading"
        :disabled="settingsSaving"
      >
        <el-option
          v-for="user in superAdminOptions"
          :key="user.userid"
          :label="`${user.name}（${user.userid}）`"
          :value="user.userid"
        />
        <template #empty>
          <div style="padding: 8px; font-size: 12px; color: #999">
            未解析到超级管理员，可能是企业微信标签同步异常，请稍后重试
          </div>
        </template>
      </el-select>
      <el-button type="primary" :loading="settingsSaving" @click="saveSettings">
        保存
      </el-button>
      <span v-if="settings?.updated_at" style="font-size: 12px; color: #999">
        最近更新：{{
          settings.updated_by ? toContactName(settings.updated_by) : "-"
        }}
        ·
        {{ formatBeijingDateTime(settings.updated_at) }}
      </span>
    </div>
  </el-card>

  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        "
      >
        <div>
          <div style="font-size: 18px; font-weight: 700; color: #2a241d">
            AI关卡任务总览
          </div>
          <div style="margin-top: 4px; font-size: 13px; color: #6e6458">
            超级管理员可处理AI关卡卡点：放行、驳回、补充意见
          </div>
        </div>
        <div
          style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap"
        >
          <el-select
            v-model="statusFilter"
            clearable
            placeholder="任务状态"
            style="width: 160px"
          >
            <el-option label="pending" value="pending" />
            <el-option label="assigned" value="assigned" />
            <el-option label="running" value="running" />
            <el-option label="completed" value="completed" />
            <el-option label="failed" value="failed" />
            <el-option label="timeout" value="timeout" />
          </el-select>
          <el-input
            v-model="keyword"
            clearable
            placeholder="审批编号/摘要/发起人/节点"
            style="width: 260px"
          />
          <el-button type="primary" @click="resetAndSearch">查询</el-button>
        </div>
      </div>
    </template>

    <el-table :data="rows" :loading="loading" size="small" stripe>
      <el-table-column prop="task_id" label="任务ID" width="90" />
      <el-table-column label="任务状态" width="110">
        <template #default="scope">
          <el-tag size="small" :type="statusTagType(scope.row.task_status)">
            {{ toStatusLabel(scope.row.task_status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="节点" width="130">
        <template #default="scope">{{ scope.row.node_key || "-" }}</template>
      </el-table-column>
      <el-table-column label="AI Slot" min-width="160">
        <template #default="scope">{{
          scope.row.ai_slot_id || scope.row.task_biz_type
        }}</template>
      </el-table-column>
      <el-table-column label="审批实例" width="180">
        <template #default="scope">{{
          scope.row.instance?.instance_no || "-"
        }}</template>
      </el-table-column>
      <el-table-column label="审批状态" width="110">
        <template #default="scope">{{
          toStatusLabel(scope.row.instance?.status || "-")
        }}</template>
      </el-table-column>
      <el-table-column label="当前节点" min-width="120">
        <template #default="scope">{{
          scope.row.instance?.current_node_key || "-"
        }}</template>
      </el-table-column>
      <el-table-column label="摘要" min-width="220" show-overflow-tooltip>
        <template #default="scope">{{
          scope.row.instance?.biz_summary || "-"
        }}</template>
      </el-table-column>
      <el-table-column label="错误信息" min-width="180" show-overflow-tooltip>
        <template #default="scope">{{
          scope.row.error_message || "-"
        }}</template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="scope">{{
          formatBeijingDateTime(scope.row.task_created_at)
        }}</template>
      </el-table-column>
      <el-table-column label="完成时间" width="170">
        <template #default="scope">{{
          formatBeijingDateTime(scope.row.task_completed_at)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="300" fixed="right">
        <template #default="scope">
          <el-space>
            <el-button link type="primary" @click="goApprovalDetail(scope.row)"
              >审批详情</el-button
            >
            <el-button
              link
              type="success"
              :disabled="!canPushFlow(scope.row)"
              @click="openActionDialog(scope.row, 'approve')"
              >放行</el-button
            >
            <el-button
              link
              type="danger"
              :disabled="!canPushFlow(scope.row)"
              @click="openActionDialog(scope.row, 'reject')"
              >驳回</el-button
            >
            <el-button
              link
              type="warning"
              @click="openActionDialog(scope.row, 'comment')"
              >补充意见</el-button
            >
          </el-space>
        </template>
      </el-table-column>
    </el-table>

    <div style="display: flex; justify-content: flex-end; margin-top: 12px">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @change="loadRows"
      />
    </div>
  </el-card>

  <el-dialog v-model="actionDialogVisible" title="处理AI关卡任务" width="520px">
    <el-form label-width="110px">
      <el-form-item label="处理动作">
        <el-tag
          :type="
            actionType === 'approve'
              ? 'success'
              : actionType === 'reject'
                ? 'danger'
                : 'warning'
          "
        >
          {{
            actionType === "approve"
              ? "建议通过"
              : actionType === "reject"
                ? "建议拒绝"
                : "建议补充材料"
          }}
        </el-tag>
      </el-form-item>
      <el-form-item label="处理说明">
        <el-input
          v-model="actionComment"
          type="textarea"
          :rows="4"
          maxlength="1000"
          show-word-limit
          placeholder="请填写处理意见（必填）"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="actionDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submitAction"
        >确认提交</el-button
      >
    </template>
  </el-dialog>
</template>
