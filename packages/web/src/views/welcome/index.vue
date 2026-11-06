<script setup lang="ts">
/**
 * 个人工作台：先看等我处理的事，等得越久越显眼；再是发起和常用入口。
 * 各块数据分别取，一块取不到不影响其他块。
 */
import { computed, onMounted, ref, type Component } from "vue";
import { useRouter } from "vue-router";
import BadgeYen from "~icons/lucide/badge-japanese-yen";
import Fuel from "~icons/lucide/fuel";
import ReceiptText from "~icons/lucide/receipt-text";
import {
  listApprovalInstances,
  listPendingApprovals,
  type ApprovalInstance,
  type PendingApprovalItem
} from "@/api/approval";
import { getFuelQuotaPendingSummary } from "@/api/fleet";
import {
  listReimbursementEnvelopes,
  type ReimbursementEnvelope
} from "@/api/reimbursement";
import { getCurrentUser } from "@/api/user";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { resolveBizEditRoute } from "@/views/approval/biz-edit-routes";
import WorkbenchEntries from "./components/WorkbenchEntries.vue";
import WorkbenchQueue from "./components/WorkbenchQueue.vue";
import WorkbenchReimbursements from "./components/WorkbenchReimbursements.vue";
import {
  ACTIVE_REIMBURSEMENT_STATUSES,
  buildApprovalItem,
  buildCommonEntries,
  buildFuelItem,
  buildGreeting,
  buildHeadline,
  buildReimbursementRow,
  buildReturnedItem,
  buildStartActions,
  fuelDeskPath,
  mergeQueue,
  toRoleLabel
} from "./workbench-view";

defineOptions({ name: "Welcome" });

/** 待审批取够多才算得出“最久等了多久”；接口按新到旧排，只取一页会漏掉最久的 */
const PENDING_FETCH_SIZE = 100;
const RETURNED_FETCH_SIZE = 50;
const REIMBURSEMENT_PREVIEW_SIZE = 5;

const START_ICONS: Record<string, Component> = {
  reimbursement: ReceiptText,
  payment: BadgeYen,
  fuel: Fuel
};

const router = useRouter();
const { loadUserNames, userNameOf } = useWecomUserOptions();

const now = new Date();
const greeting = buildGreeting(now);
const startActions = buildStartActions();

const loading = ref(true);
const username = ref("");
const nickname = ref("");
const roles = ref<string[]>([]);
const pending = ref<PendingApprovalItem[]>([]);
const pendingTotal = ref(0);
const returned = ref<ApprovalInstance[]>([]);
const returnedTotal = ref(0);
const fuelCount = ref(0);
const reimbursements = ref<ReimbursementEnvelope[]>([]);
const reimbursementTotal = ref(0);
const queueFailed = ref(false);
const reimbursementFailed = ref(false);

const CHINESE = /[一-鿿]/;

/** 昵称缺失时后端回落成账号，这种情况查通讯录 */
const displayName = computed(() =>
  CHINESE.test(nickname.value)
    ? nickname.value
    : userNameOf(username.value, "同事")
);

const roleLabel = computed(() => toRoleLabel(roles.value));
const entries = computed(() => buildCommonEntries(roles.value));

const toName = (userid: string) => userNameOf(userid);

const queueItems = computed(() => {
  const fuelPath = fuelDeskPath(roles.value);
  return mergeQueue(
    pending.value.map(item => buildApprovalItem(item, { toName, now })),
    returned.value.map(item =>
      buildReturnedItem(item, {
        now,
        resolveEditRoute: row =>
          resolveBizEditRoute(row.biz_type, row.biz_id, row.biz_summary)
      })
    ),
    fuelPath && fuelCount.value > 0
      ? buildFuelItem(fuelCount.value, fuelPath)
      : null
  );
});

const queueCounts = computed(() => ({
  approval: pendingTotal.value,
  returned: returnedTotal.value,
  fuel: fuelCount.value
}));

const headline = computed(() => {
  if (loading.value) return "正在看有什么要处理的";
  return buildHeadline({
    total: pendingTotal.value + returnedTotal.value + fuelCount.value,
    oldestDays: Math.max(0, ...queueItems.value.map(item => item.waitDays)),
    failed: queueFailed.value
  });
});

const reimbursementRows = computed(() =>
  reimbursements.value.map(buildReimbursementRow)
);

const settled = <T,>(promise: Promise<T>): Promise<T | null> =>
  promise.catch(error => {
    console.error("[workbench] 数据加载失败", error);
    return null;
  });

const loadAll = async () => {
  loading.value = true;
  const me = await settled(getCurrentUser());
  if (me) {
    username.value = me.data.username;
    nickname.value = me.data.nickname || "";
    roles.value = me.data.roles || [];
  }
  const [pendingResult, returnedResult, reimbursementResult, fuelResult] =
    await Promise.all([
      settled(listPendingApprovals({ page: 1, pageSize: PENDING_FETCH_SIZE })),
      settled(
        listApprovalInstances({
          initiator: "me",
          initiatedBucket: "returned_needs_action",
          page: 1,
          pageSize: RETURNED_FETCH_SIZE
        })
      ),
      settled(
        listReimbursementEnvelopes({
          creator_id: "me",
          status: ACTIVE_REIMBURSEMENT_STATUSES.join(","),
          page: 1,
          pageSize: REIMBURSEMENT_PREVIEW_SIZE
        })
      ),
      fuelDeskPath(roles.value)
        ? settled(getFuelQuotaPendingSummary())
        : Promise.resolve(undefined)
    ]);

  if (pendingResult) {
    pending.value = pendingResult.data || [];
    pendingTotal.value =
      pendingResult.pagination?.total ?? pending.value.length;
  }
  if (returnedResult) {
    returned.value = returnedResult.data || [];
    returnedTotal.value =
      returnedResult.pagination?.total ?? returned.value.length;
  }
  if (fuelResult) fuelCount.value = fuelResult.data.pending_count;
  queueFailed.value =
    !me || !pendingResult || !returnedResult || fuelResult === null;

  if (reimbursementResult) {
    reimbursements.value = reimbursementResult.data || [];
    reimbursementTotal.value =
      reimbursementResult.pagination?.total ?? reimbursements.value.length;
  }
  reimbursementFailed.value = !reimbursementResult;
  loading.value = false;
};

onMounted(() => {
  loadUserNames();
  loadAll();
});
</script>

<template>
  <div class="workbench">
    <header class="workbench__top">
      <div class="workbench__intro">
        <p class="workbench__greeting">
          {{ greeting.text }}，{{ displayName }}
          <span v-if="roleLabel" class="workbench__role">{{ roleLabel }}</span>
          <span class="workbench__date">{{ greeting.dateText }}</span>
        </p>
        <h1 class="workbench__headline">{{ headline }}</h1>
      </div>
      <div class="workbench__actions">
        <el-button
          v-for="(action, index) in startActions"
          :key="action.key"
          :type="index === 0 ? 'primary' : 'default'"
          :icon="START_ICONS[action.key]"
          @click="router.push(action.path)"
        >
          {{ action.label }}
        </el-button>
      </div>
    </header>

    <div class="workbench__body">
      <WorkbenchQueue
        :items="queueItems"
        :counts="queueCounts"
        :loading="loading"
        :failed="queueFailed"
      />
      <aside class="workbench__side">
        <WorkbenchEntries :entries="entries" />
        <WorkbenchReimbursements
          :rows="reimbursementRows"
          :total="reimbursementTotal"
          :failed="reimbursementFailed"
        />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.workbench {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.workbench__top {
  display: flex;
  flex-wrap: wrap;
  gap: 12px 24px;
  align-items: flex-end;
  justify-content: space-between;
}

.workbench__intro {
  min-width: 0;
}

.workbench__greeting {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  color: #3d4757;
}

.workbench__role,
.workbench__date {
  color: #6b7686;
}

.workbench__headline {
  margin: 2px 0 0;
  font-size: 26px;
  font-weight: 600;
  line-height: 36px;
  color: #1f2329;
}

.workbench__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.workbench__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.workbench__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 16px;
  align-items: start;
}

.workbench__side {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

@media (width <= 1080px) {
  .workbench__body {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (width <= 720px) {
  .workbench__headline {
    font-size: 21px;
    line-height: 30px;
  }
}
</style>
