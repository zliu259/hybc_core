<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import dayjs from "dayjs";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import {
  confirmPendingAction,
  getPendingByToken,
  rejectPendingAction,
  type PendingPublicView,
  type PendingStatus
} from "@/api/agent";

defineOptions({ name: "AgentConfirm" });

// 人在环的唯一人类界面：智能体发起的高危动作被服务端 park 住，只有本人在这里
// 确认后才会真正落库，且【以本人名义】记入审批记录。因此本页的职责是——在给出
// 那两个不可逆按钮之前，把「将要执行什么、智能体写了什么意见」摊开给人看。

const route = useRoute();

const pending = ref<PendingPublicView | null>(null);
const loading = ref(true);
const acting = ref(false);
/** 链接无效 / 非本人 / 请求失败：只提示，不渲染任何操作按钮 */
const loadFailed = ref(false);

const STATUS_LABELS: Record<PendingStatus, string> = {
  pending: "待确认",
  confirmed: "处理中",
  executing: "处理中",
  done: "已执行",
  failed: "执行失败",
  rejected: "已拒绝",
  expired: "已过期"
};

type ResultIcon = "primary" | "success" | "warning" | "info" | "error";

const STATUS_ICONS: Record<PendingStatus, ResultIcon> = {
  pending: "info",
  confirmed: "info",
  executing: "info",
  done: "success",
  failed: "error",
  rejected: "info",
  expired: "warning"
};

const detail = computed(() => pending.value?.detail ?? null);
const approval = computed(() => detail.value?.approval ?? null);

const statusLabel = computed(() =>
  pending.value ? STATUS_LABELS[pending.value.status] : ""
);

const statusIcon = computed<ResultIcon>(() =>
  pending.value ? STATUS_ICONS[pending.value.status] : "info"
);

/** 只在 status === "pending" 时才给出不可逆的两个按钮 */
const canAct = computed(() => pending.value?.status === "pending");

/**
 * 一句话描述「将要执行什么」。
 * verb 为 null 说明该 action_kind 未在服务端登记 —— 绝不兜底成「批准」，
 * 而是如实告诉员工动作类型未知，让他自己判断要不要放行。
 */
const actionText = computed(() => {
  const d = detail.value;
  if (!d) return pending.value?.summary ?? "";
  if (!d.verb) {
    return `动作类型未登记（${d.action_kind}），目标：${d.target}`;
  }
  return `${d.verb}${d.target}`;
});

const expiresAtText = computed(() =>
  pending.value
    ? dayjs(pending.value.expires_at).format("YYYY-MM-DD HH:mm")
    : ""
);

const httpStatusOf = (error: unknown): number | undefined =>
  (error as { response?: { status?: number } } | null)?.response?.status;

const errorMessageOf = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  return "操作失败，请稍后重试";
};

/**
 * 动作类错误统一在这里落地：一律【保持当前状态】，不本地臆测终态。
 * 尤其 503（服务端重放密钥暂不可用）——服务端并未认领这个动作，行仍是可重试的，
 * 所以不能让员工以为它永久失败了。
 */
const handleActionError = (error: unknown) => {
  if (httpStatusOf(error) === 503) {
    message("系统尚未完成配置，请稍后重试或联系管理员", { type: "warning" });
    return;
  }
  message(errorMessageOf(error), { type: "error" });
};

/**
 * 每次加载递增。用于丢弃过期请求的结果——token 变化后，上一个 token 的响应
 * 若姗姗来迟，绝不能覆盖新动作的画面。
 */
let loadSeq = 0;

/** 换 token 就是换动作：把上一个动作的一切状态清干净再拉新的。 */
const resetForNewLoad = () => {
  pending.value = null;
  loadFailed.value = false;
  acting.value = false;
  return ++loadSeq;
};

const loadByToken = async (token: string) => {
  const seq = resetForNewLoad();
  loading.value = true;
  try {
    const res = await getPendingByToken(token);
    if (seq !== loadSeq) return;
    pending.value = res.data;
  } catch {
    if (seq !== loadSeq) return;
    loadFailed.value = true;
  } finally {
    if (seq === loadSeq) loading.value = false;
  }
};

const markLinkUnusable = () => {
  resetForNewLoad();
  loadFailed.value = true;
  loading.value = false;
};

/**
 * 用 watch + immediate 而不是 onMounted：同一条路由下换 token 时组件会被复用，
 * onMounted 不会重跑，页面就会停留在【上一个动作】上，而两个不可逆按钮还在旁边。
 * （authorize.vue 的 ?user_code= 也是同样的处理方式。）
 */
watch(
  () => route.query.token,
  token => {
    if (typeof token === "string" && token) {
      void loadByToken(token);
    } else {
      markLinkUnusable();
    }
  },
  { immediate: true }
);

const onConfirm = async () => {
  const current = pending.value;
  if (!current || acting.value) return;
  // 二次确认弹窗复述的是【当下这个】动作。若期间页面切到了别的 token，
  // 那句复述就对不上了，宁可作废本次操作，也不能拿旧确认去执行。
  const seq = loadSeq;
  try {
    await ElMessageBox.confirm(
      `即将以你的名义执行：${actionText.value}。该操作不可撤销，确认继续？`,
      "确认执行高危操作",
      {
        type: "warning",
        confirmButtonText: "确认执行",
        cancelButtonText: "再想想"
      }
    );
  } catch {
    // 用户取消二次确认，什么都不做
    return;
  }
  if (seq !== loadSeq) return;
  acting.value = true;
  try {
    const res = await confirmPendingAction(current.id);
    // 以服务端返回的视图为准，不本地猜测结果
    if (seq === loadSeq) pending.value = res.data;
  } catch (error: unknown) {
    if (seq === loadSeq) handleActionError(error);
  } finally {
    if (seq === loadSeq) acting.value = false;
  }
};

const onReject = async () => {
  const current = pending.value;
  if (!current || acting.value) return;
  const seq = loadSeq;
  acting.value = true;
  try {
    const res = await rejectPendingAction(current.id);
    if (seq !== loadSeq) return;
    // rejected:false 表示这个动作已被他路结算（比如已执行）——
    // 依然以服务端返回的真实状态覆盖，绝不谎报「已拒绝」。
    pending.value = res.data;
    if (!res.data.rejected) {
      message("该动作已被处理，无法再拒绝，请查看当前状态", {
        type: "warning"
      });
    }
  } catch (error: unknown) {
    if (seq === loadSeq) handleActionError(error);
  } finally {
    if (seq === loadSeq) acting.value = false;
  }
};
</script>

<template>
  <div class="p-4" style="max-width: 640px">
    <el-card v-loading="loading" shadow="never">
      <template #header>
        <span style="font-weight: 600">高危操作确认</span>
      </template>

      <el-alert v-if="loadFailed" type="error" :closable="false" show-icon>
        <div style="font-weight: 600">无法打开此确认链接</div>
        <div style="margin-top: 4px">
          链接可能已失效、已被处理，或不属于当前登录账号。请回到企业微信卡片重新打开。
        </div>
      </el-alert>

      <template v-else-if="pending">
        <el-alert
          type="warning"
          :closable="false"
          show-icon
          title="下面这个操作由智能体发起，尚未生效。经你确认后，系统会以你的名义执行并记入审批记录。"
          style="margin-bottom: 12px"
        />

        <el-descriptions :column="1" border>
          <el-descriptions-item label="动作">
            {{ actionText }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            {{ statusLabel }}
          </el-descriptions-item>
          <el-descriptions-item label="有效期至">
            {{ expiresAtText }}
          </el-descriptions-item>
        </el-descriptions>

        <el-descriptions
          v-if="approval"
          :column="1"
          border
          title="业务上下文"
          style="margin-top: 12px"
        >
          <el-descriptions-item label="单号">
            {{ approval.instance_no }}
          </el-descriptions-item>
          <el-descriptions-item label="业务类型">
            {{ approval.biz_type }}
          </el-descriptions-item>
          <el-descriptions-item label="业务摘要">
            {{ approval.biz_summary }}
          </el-descriptions-item>
          <el-descriptions-item label="发起人">
            {{ approval.initiator_userid }}
          </el-descriptions-item>
        </el-descriptions>

        <div v-if="detail" class="agent-comment" style="margin-top: 12px">
          <div style="font-weight: 600; margin-bottom: 4px">智能体意见</div>
          <el-alert type="info" :closable="false" show-icon>
            <div>
              以下意见由智能体填写，确认后将以你的名义记入审批意见。请先核对再决定。
            </div>
            <div style="margin-top: 6px">
              {{ detail.agent_comment || "智能体未填写意见" }}
            </div>
          </el-alert>
        </div>

        <div v-if="canAct" style="margin-top: 16px">
          <el-button
            class="confirm-btn"
            type="primary"
            :loading="acting"
            @click="onConfirm"
          >
            确认执行
          </el-button>
          <el-button
            class="reject-btn"
            type="danger"
            plain
            :loading="acting"
            @click="onReject"
          >
            拒绝
          </el-button>
        </div>

        <el-result
          v-else
          :icon="statusIcon"
          :title="statusLabel"
          sub-title="本次确认已结束，可关闭本页。"
          style="margin-top: 8px"
        />
      </template>
    </el-card>
  </div>
</template>
