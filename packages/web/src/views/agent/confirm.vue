<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import dayjs from "dayjs";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import {
  confirmPendingAction,
  getPendingAction,
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

/**
 * 「本次操作的结果未知」——请求发出去了，但没拿到服务端的确定答复。
 * 这是一个必须被单独表达的状态：它既不是「待确认」也不是「已执行」。
 * checking = 正在向服务端核对真实状态；unresolved = 核对也失败了。
 * 只要它非 null，页面就不得渲染任何确定状态，也不得给出可点的确认按钮。
 */
const outcome = ref<"checking" | "unresolved" | null>(null);

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

/**
 * 结果未知时【覆盖】状态文案。继续显示「待确认」是在替服务端做一个它没做过的
 * 承诺——而且是最危险的那个方向：员工会以为什么都没发生，然后再点一次。
 */
const statusLabel = computed(() => {
  if (outcome.value === "checking") return "结果未知，正在核对…";
  if (outcome.value === "unresolved") return "本次结果未知";
  return pending.value ? STATUS_LABELS[pending.value.status] : "";
});

const statusIcon = computed<ResultIcon>(() =>
  pending.value ? STATUS_ICONS[pending.value.status] : "info"
);

/** 只在结果确定、且确实是 pending 时，才给出不可逆的两个按钮 */
const canAct = computed(
  () => outcome.value === null && pending.value?.status === "pending"
);

/**
 * confirmed / executing 不是终态。503 路径下服务端已把行翻成 confirmed，然后
 * 刻意不 claim、不 finish，专门留出可恢复窗口——恢复方式就是再 POST 一次
 * confirm（claimForExecution 的 WHERE 是 status='confirmed'，且刻意不看
 * expires_at）。页面必须把这个恢复入口交给员工，否则行会被 sweep 成 failed。
 */
const canRetryExecution = computed(() => {
  if (outcome.value !== null) return false;
  const s = pending.value?.status;
  return s === "confirmed" || s === "executing";
});

const isTerminal = computed(() => {
  if (outcome.value !== null) return false;
  const s = pending.value?.status;
  return s === "done" || s === "failed" || s === "rejected" || s === "expired";
});

/** 服务端写进 result_snapshot 的说明（failed 时常带「写可能已经落库」的歧义警告） */
const resultMessage = computed(() => {
  const r = pending.value?.result;
  if (!r || typeof r !== "object") return "";
  const msg = (r as { error?: { message?: unknown } }).error?.message;
  return typeof msg === "string" ? msg : "";
});

const terminalHint = computed(() =>
  pending.value?.status === "failed"
    ? "执行未成功。请按下面的说明核对该动作是否已经生效。"
    : "本次确认已结束，可关闭本页。"
);

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

/**
 * 拦截器是原样 rethrow AxiosError 的，所以 error.message 只是 axios 生成的英文
 * （"Request failed with status code 404"）。服务端真正的中文说明在
 * response.data.error.message —— 在这一页，员工正是靠那句话判断「我刚才那一下
 * 到底生效没有」。取不到就用中文兜底，绝不把英文原文摔到员工脸上。
 */
const errorMessageOf = (error: unknown): string => {
  const msg = (
    error as {
      response?: { data?: { error?: { message?: unknown } } };
    } | null
  )?.response?.data?.error?.message;
  if (typeof msg === "string" && msg.trim()) return msg.trim();
  return "操作失败，请稍后重试";
};

/**
 * 报告错误，并回答一个关键问题：服务端是否【明确承诺】它什么都没做？
 * @returns true = 有承诺，可以安全地保留当前状态；false = 结果未知，必须去核对。
 */
const reportActionError = (error: unknown): boolean => {
  // 503 是这里唯一安全的分支：服务端明说了没有认领这个动作，行仍可重试。
  if (httpStatusOf(error) === 503) {
    message("系统尚未完成配置，请稍后重试或联系管理员", { type: "warning" });
    return true;
  }
  message(errorMessageOf(error), { type: "error" });
  return false;
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
  outcome.value = null;
  return ++loadSeq;
};

/**
 * 结果未知时的收尾：先把页面切进「正在核对」（同步生效，按钮立刻消失），
 * 再去问服务端这个动作到底怎么样了。核对成功就以服务端为准；核对也失败，
 * 就停在「本次结果未知」，明确要求员工别重复操作、去别处核对。
 */
const verifyOutcome = async (id: string, seq: number) => {
  outcome.value = "checking";
  try {
    const res = await getPendingAction(id);
    if (seq !== loadSeq) return;
    pending.value = res.data;
    outcome.value = null;
  } catch {
    if (seq !== loadSeq) return;
    outcome.value = "unresolved";
  }
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

/**
 * 二次确认。复述的是【当下这个】动作，所以要连带校验 loadSeq——若期间页面切到
 * 了别的 token，那句复述就对不上了，宁可作废本次操作。
 */
const askThenRun = async (
  prompt: string,
  title: string,
  confirmButtonText: string,
  run: (current: PendingPublicView, seq: number) => Promise<void>
) => {
  const current = pending.value;
  if (!current || acting.value) return;
  const seq = loadSeq;
  try {
    await ElMessageBox.confirm(prompt, title, {
      type: "warning",
      confirmButtonText,
      cancelButtonText: "再想想"
    });
  } catch {
    // 用户取消二次确认，什么都不做
    return;
  }
  if (seq !== loadSeq) return;
  acting.value = true;
  try {
    await run(current, seq);
  } finally {
    if (seq === loadSeq) acting.value = false;
  }
};

/** 确认与重试共用：两者都是 POST confirm，服务端据 status 决定是首次还是续跑。 */
const runConfirm = async (current: PendingPublicView, seq: number) => {
  try {
    const res = await confirmPendingAction(current.id);
    // 以服务端返回的视图为准，不本地猜测结果
    if (seq === loadSeq) pending.value = res.data;
  } catch (error: unknown) {
    if (seq !== loadSeq) return;
    // 服务端没有承诺「什么都没做」，就必须去核对真实状态——
    // 这期间页面停在「结果未知」，不给任何可点的确认按钮。
    if (!reportActionError(error)) await verifyOutcome(current.id, seq);
  }
};

const onConfirm = () =>
  askThenRun(
    `即将以你的名义执行：${actionText.value}。该操作不可撤销，确认继续？`,
    "确认执行高危操作",
    "确认执行",
    runConfirm
  );

const onRetry = () =>
  askThenRun(
    `这个动作你已经确认过，但服务端尚未完成执行。将再次尝试以你的名义执行：${actionText.value}。确认继续？`,
    "重试执行",
    "重试执行",
    runConfirm
  );

/** 只读地问一次服务端当前状态，不产生任何副作用，因此无需二次确认。 */
const onRefresh = async () => {
  const current = pending.value;
  if (!current || acting.value) return;
  const seq = loadSeq;
  acting.value = true;
  try {
    const res = await getPendingAction(current.id);
    if (seq === loadSeq) pending.value = res.data;
  } catch (error: unknown) {
    if (seq === loadSeq) message(errorMessageOf(error), { type: "error" });
  } finally {
    if (seq === loadSeq) acting.value = false;
  }
};

const runReject = async (current: PendingPublicView, seq: number) => {
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
    if (seq !== loadSeq) return;
    if (!reportActionError(error)) await verifyOutcome(current.id, seq);
  }
};

/**
 * 措辞必须指向【这个智能体动作】而不是业务结果：动作行本身可能就是
 * 「拒绝审批单 #42」，此时按钮上光写「拒绝」会被读成「驳回这张审批单」——
 * 恰好与它真正的效果（不驳回）相反。
 */
const onReject = () =>
  askThenRun(
    `将不执行这个智能体动作：${actionText.value}。该动作会被作废、不会生效，确认继续？`,
    "不执行此动作",
    "不执行",
    runReject
  );
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
        <!-- 「尚未生效」是一句关于服务端状态的断言，只有确实还待确认时才成立 -->
        <el-alert
          v-if="canAct"
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

        <!--
          省略必须是【可见的】省略。approval 为 null 同时覆盖「这单不存在」和
          「查询失败」，而动作行此时只有 verb+target，员工手上就只剩一个
          等同随机数字的编号——不能让这块凭空消失。
        -->
        <el-alert
          v-if="!approval"
          type="warning"
          :closable="false"
          show-icon
          style="margin-top: 12px"
        >
          <div>业务上下文暂不可用</div>
          <div style="margin-top: 4px">
            没能取到这个动作对应的单据信息（可能已被删除，或查询失败）。请回到企业微信卡片核对后再决定。
          </div>
        </el-alert>

        <el-descriptions
          v-else
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

        <!--
          结果未知：既不是「待确认」也不是「已执行」。这里【不给任何可点的
          确认按钮】，因为再点一次很可能是第二次以员工名义落库。
        -->
        <el-alert
          v-if="outcome"
          type="warning"
          :closable="false"
          show-icon
          style="margin-top: 16px"
        >
          <template v-if="outcome === 'checking'">
            <div>结果未知，正在向服务端核对这个动作的真实状态…</div>
          </template>
          <template v-else>
            <div style="font-weight: 600">
              本次结果未知：请求已发出，但没能拿到服务端的确定答复。
            </div>
            <div style="margin-top: 4px">
              请勿重复操作。请回到企业微信卡片，或到网页端核对该动作是否已经生效。
            </div>
          </template>
        </el-alert>

        <div v-else-if="canAct" style="margin-top: 16px">
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
            不执行此动作
          </el-button>
        </div>

        <!-- confirmed / executing：服务端专门留的可恢复窗口，必须给出恢复入口 -->
        <div v-else-if="canRetryExecution" style="margin-top: 16px">
          <el-alert type="info" :closable="false" show-icon>
            <div>
              你已经确认过这个动作，但服务端还没有完成执行。可以再试一次，或刷新查看最新状态。
            </div>
          </el-alert>
          <div style="margin-top: 12px">
            <el-button
              class="retry-btn"
              type="primary"
              :loading="acting"
              @click="onRetry"
            >
              重试执行
            </el-button>
            <el-button class="refresh-btn" :loading="acting" @click="onRefresh">
              刷新状态
            </el-button>
          </div>
        </div>

        <template v-else-if="isTerminal">
          <el-result
            :icon="statusIcon"
            :title="statusLabel"
            :sub-title="terminalHint"
            style="margin-top: 8px"
          />
          <!-- 服务端在 result 里写的说明（failed 常带「写可能已经落库」的警告） -->
          <div v-if="resultMessage" class="result-message">
            {{ resultMessage }}
          </div>
        </template>
      </template>
    </el-card>
  </div>
</template>
