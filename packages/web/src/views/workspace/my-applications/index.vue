<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { channelLabel } from "@/utils/enum-labels";
import { listPaymentRequests, type PaymentRequest } from "@/api/payment";
import {
  listReimbursementEnvelopes,
  type ReimbursementEnvelope
} from "@/api/reimbursement";
import {
  listFuelQuotaApplications,
  type FuelQuotaApplication
} from "@/api/fleet";
import {
  listApprovalInstances,
  getInitiatedApprovalSummary,
  type ApprovalInstance,
  type InitiatedApprovalSummary,
  type InitiatedBucket
} from "@/api/approval";
import { toBizTypeLabel, toStatusLabel } from "@/views/approval/labels";
import { resolveBizEditRoute } from "@/views/approval/biz-edit-routes";

defineOptions({ name: "WorkspaceMyApplications" });

const router = useRouter();
const loading = ref(false);
const PAGE_SIZE = 8;
const paymentList = ref<PaymentRequest[]>([]);
const paymentPage = ref(1);
const paymentTotal = ref(0);
const reimbursementList = ref<ReimbursementEnvelope[]>([]);
const reimbursementPage = ref(1);
const reimbursementTotal = ref(0);
const fuelList = ref<FuelQuotaApplication[]>([]);
const fuelPage = ref(1);
const fuelTotal = ref(0);
const approvalList = ref<ApprovalInstance[]>([]);
const approvalBucket = ref<InitiatedBucket>("returned_needs_action");
const approvalPage = ref(1);
const approvalTotal = ref(0);
const approvalSummary = ref<InitiatedApprovalSummary>({
  total: 0,
  returned_needs_action: 0,
  in_progress: 0,
  done: 0,
  remindable: 0
});

const initiatedBucketLabel = (bucket: InitiatedBucket) => {
  if (bucket === "returned_needs_action") return "被退回（待处理）";
  if (bucket === "done") return "已完成";
  return "审批中";
};

const initiatedBucketTagType = (bucket: InitiatedBucket) => {
  if (bucket === "returned_needs_action") return "danger" as const;
  if (bucket === "done") return "success" as const;
  return "warning" as const;
};

const loadPayments = async () => {
  const paymentResult = await listPaymentRequests({
    mine: true,
    page: paymentPage.value,
    pageSize: PAGE_SIZE
  });
  paymentList.value = paymentResult.data;
  paymentTotal.value = paymentResult.pagination.total;
};

const changePaymentPage = async (page: number) => {
  paymentPage.value = page;
  await loadPayments();
};

const loadReimbursements = async () => {
  const reimbursementResult = await listReimbursementEnvelopes({
    creator_id: "me",
    exclude_cancelled: true,
    page: reimbursementPage.value,
    pageSize: PAGE_SIZE
  });
  reimbursementList.value = reimbursementResult.data;
  reimbursementTotal.value = reimbursementResult.pagination.total;
};

const changeReimbursementPage = async (page: number) => {
  reimbursementPage.value = page;
  await loadReimbursements();
};

const loadFuelApplications = async () => {
  const fuelResult = await listFuelQuotaApplications({
    mine: true,
    page: fuelPage.value,
    pageSize: PAGE_SIZE
  });
  fuelList.value = fuelResult.data;
  fuelTotal.value = fuelResult.pagination?.total ?? fuelResult.data.length;
};

const changeFuelPage = async (page: number) => {
  fuelPage.value = page;
  await loadFuelApplications();
};

const loadInitiatedApprovals = async () => {
  const approvalResult = await listApprovalInstances({
    initiator: "me",
    initiatedBucket: approvalBucket.value,
    page: approvalPage.value,
    pageSize: PAGE_SIZE
  });
  approvalList.value = approvalResult.data;
  approvalTotal.value = approvalResult.pagination.total;
};

const refreshInitiatedApprovalList = async (bucket: InitiatedBucket) => {
  approvalBucket.value = bucket;
  approvalPage.value = 1;
  await loadInitiatedApprovals();
};

const changeApprovalPage = async (page: number) => {
  approvalPage.value = page;
  await loadInitiatedApprovals();
};

const canEditBiz = (item: ApprovalInstance) =>
  resolveBizEditRoute(item.biz_type, item.biz_id, item.biz_summary) !== null;

const goEditBiz = (item: ApprovalInstance) => {
  const route = resolveBizEditRoute(
    item.biz_type,
    item.biz_id,
    item.biz_summary
  );
  if (route) {
    router.push(route);
  }
};

const paymentStatusLabel = (status: string) => {
  if (status === "draft") return "草稿";
  if (status === "pending_approval") return "审批中";
  if (status === "approved") return "已审批";
  if (status === "paid") return "已付款";
  if (status === "rejected") return "已驳回";
  return status;
};

const reimbursementStatusLabel = (status: string) => {
  if (status === "unregistered") return "未登记";
  if (status === "draft") return "草稿";
  if (status === "submitted") return "已填报";
  if (status === "received") return "已收件";
  if (status === "batched") return "已成批";
  if (status === "pending_approval") return "待审批";
  if (status === "approved") return "已审批";
  if (status === "paid") return "已打款";
  if (status === "rejected") return "已拒绝";
  if (status === "cancelled") return "已废止";
  return status;
};

const fuelStatusLabel = (status: string) => {
  if (status === "pending") return "待处理";
  if (status === "processed") return "已处理";
  if (status === "rejected") return "已拒绝";
  return status;
};

const fuelProcessResult = (item: FuelQuotaApplication) => {
  if (item.status === "processed") {
    const resultParts: string[] = [];
    if (typeof item.latest_card_balance === "number") {
      resultParts.push(`余额 ${item.latest_card_balance}`);
    }
    if (item.office_remark?.trim()) {
      resultParts.push(item.office_remark.trim());
    }
    return resultParts.length > 0 ? resultParts.join("；") : "已处理";
  }
  if (item.status === "rejected") {
    return item.office_remark?.trim() || "已拒绝";
  }
  return "-";
};

const loadData = async () => {
  loading.value = true;
  try {
    const [approvalSummaryResult] = await Promise.all([
      getInitiatedApprovalSummary({ initiator: "me" }),
      loadPayments(),
      loadReimbursements(),
      loadFuelApplications(),
      loadInitiatedApprovals()
    ]);
    approvalSummary.value = approvalSummaryResult.data;
  } finally {
    loading.value = false;
  }
};

onMounted(loadData);
</script>

<template>
  <el-card v-loading="loading" shadow="never" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>我的申请</span>
        <el-space>
          <el-button @click="router.push('/workspace/home')"
            >返回工作台</el-button
          >
          <el-button type="primary" @click="loadData">刷新</el-button>
        </el-space>
      </div>
    </template>

    <el-row :gutter="12" style="margin-bottom: 12px">
      <el-col :md="6" :xs="24"
        ><el-card shadow="never">对外付款申请：{{ paymentTotal }}</el-card
        ></el-col
      >
      <el-col :md="6" :xs="24"
        ><el-card shadow="never">报销申请：{{ reimbursementTotal }}</el-card
        ></el-col
      >
      <el-col :md="6" :xs="24"
        ><el-card shadow="never">油卡额度申请：{{ fuelTotal }}</el-card
        ></el-col
      >
      <el-col :md="6" :xs="24"
        ><el-card shadow="never"
          >我发起的审批：{{ approvalSummary.total }}</el-card
        ></el-col
      >
    </el-row>

    <el-tabs>
      <el-tab-pane label="对外付款申请">
        <div style="margin-bottom: 8px">
          <el-button
            type="success"
            @click="router.push('/workspace/payment/wizard')"
            >发起对外付款</el-button
          >
        </div>
        <el-table :data="paymentList" stripe>
          <el-table-column prop="serial_no" label="申请单号" min-width="170" />
          <el-table-column prop="amount" label="金额" width="120" />
          <el-table-column
            prop="expected_payment_date"
            label="计划付款日期"
            width="130"
          />
          <el-table-column label="状态" width="120">
            <template #default="scope">{{
              paymentStatusLabel(scope.row.status)
            }}</template>
          </el-table-column>
          <el-table-column prop="updated_at" label="更新时间" width="180" />
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="scope">
              <el-button
                link
                type="primary"
                @click="
                  router.push(`/workspace/payment/detail/${scope.row.id}`)
                "
                >查看</el-button
              >
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          style="margin-top: 12px; justify-content: flex-end"
          background
          layout="prev, pager, next, total"
          :current-page="paymentPage"
          :page-size="PAGE_SIZE"
          :total="paymentTotal"
          @current-change="changePaymentPage"
        />
      </el-tab-pane>

      <el-tab-pane label="报销申请">
        <div style="margin-bottom: 8px">
          <el-button
            type="success"
            @click="router.push('/workspace/my-reimbursement/detail/create')"
            >发起报销</el-button
          >
        </div>
        <el-table :data="reimbursementList" stripe>
          <el-table-column
            prop="envelope_no"
            label="报销识别号"
            min-width="160"
          />
          <el-table-column prop="amount" label="金额" width="120" />
          <el-table-column label="通道" width="100">
            <template #default="scope">{{
              channelLabel(scope.row.channel)
            }}</template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="scope">{{
              reimbursementStatusLabel(scope.row.status)
            }}</template>
          </el-table-column>
          <el-table-column prop="updated_at" label="更新时间" width="180" />
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="scope">
              <el-button
                link
                type="primary"
                @click="
                  router.push(
                    `/workspace/my-reimbursement/detail/${scope.row.id}`
                  )
                "
                >查看</el-button
              >
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          style="margin-top: 12px; justify-content: flex-end"
          background
          layout="prev, pager, next, total"
          :current-page="reimbursementPage"
          :page-size="PAGE_SIZE"
          :total="reimbursementTotal"
          @current-change="changeReimbursementPage"
        />
      </el-tab-pane>

      <el-tab-pane label="油卡额度申请">
        <div style="margin-bottom: 8px">
          <el-button
            type="success"
            @click="router.push('/workspace/fuel-application')"
            >发起油卡额度申请</el-button
          >
        </div>
        <el-table :data="fuelList" stripe>
          <el-table-column
            prop="application_no"
            label="申请单号"
            min-width="170"
          />
          <el-table-column prop="current_plate_no" label="车辆" width="120" />
          <el-table-column prop="vehicle_mileage_km" label="里程" width="100" />
          <el-table-column prop="requested_amount" label="额度" width="120" />
          <el-table-column label="状态" width="120">
            <template #default="scope">{{
              fuelStatusLabel(scope.row.status)
            }}</template>
          </el-table-column>
          <el-table-column label="处理结果" min-width="220">
            <template #default="scope">{{
              fuelProcessResult(scope.row)
            }}</template>
          </el-table-column>
          <el-table-column prop="processed_at" label="处理时间" width="180" />
          <el-table-column
            prop="processed_by_userid"
            label="处理人"
            width="140"
          />
          <el-table-column prop="requested_at" label="申请时间" width="180" />
        </el-table>

        <el-pagination
          style="margin-top: 12px; justify-content: flex-end"
          background
          layout="prev, pager, next, total"
          :current-page="fuelPage"
          :page-size="PAGE_SIZE"
          :total="fuelTotal"
          @current-change="changeFuelPage"
        />
      </el-tab-pane>

      <el-tab-pane label="我发起的审批">
        <el-row :gutter="12" style="margin-bottom: 12px">
          <el-col :md="8" :xs="24">
            <el-card shadow="never">
              <div style="font-size: 13px; color: #f56c6c">
                被退回（待处理）
              </div>
              <div style="font-size: 24px; font-weight: 700">
                {{ approvalSummary.returned_needs_action }}
              </div>
            </el-card>
          </el-col>
          <el-col :md="8" :xs="24">
            <el-card shadow="never">
              <div style="font-size: 13px; color: #e6a23c">审批中</div>
              <div style="font-size: 24px; font-weight: 700">
                {{ approvalSummary.in_progress }}
              </div>
            </el-card>
          </el-col>
          <el-col :md="8" :xs="24">
            <el-card shadow="never">
              <div style="font-size: 13px; color: #67c23a">已完成</div>
              <div style="font-size: 24px; font-weight: 700">
                {{ approvalSummary.done }}
              </div>
            </el-card>
          </el-col>
        </el-row>

        <el-space style="margin-bottom: 12px" wrap>
          <el-button
            :type="
              approvalBucket === 'returned_needs_action' ? 'danger' : 'default'
            "
            @click="refreshInitiatedApprovalList('returned_needs_action')"
            >被退回（待处理）</el-button
          >
          <el-button
            :type="approvalBucket === 'in_progress' ? 'warning' : 'default'"
            @click="refreshInitiatedApprovalList('in_progress')"
            >审批中</el-button
          >
          <el-button
            :type="approvalBucket === 'done' ? 'success' : 'default'"
            @click="refreshInitiatedApprovalList('done')"
            >已完成</el-button
          >
        </el-space>

        <el-table :data="approvalList" stripe>
          <el-table-column
            prop="instance_no"
            label="审批单号"
            min-width="170"
          />
          <el-table-column label="业务类型" width="140">
            <template #default="scope">{{
              toBizTypeLabel(scope.row.biz_type)
            }}</template>
          </el-table-column>
          <el-table-column prop="biz_summary" label="摘要" min-width="220" />
          <el-table-column label="监管分组" width="150">
            <template #default="scope">
              <el-tag
                :type="
                  initiatedBucketTagType(
                    scope.row.initiated_bucket || 'in_progress'
                  )
                "
              >
                {{
                  initiatedBucketLabel(
                    scope.row.initiated_bucket || "in_progress"
                  )
                }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="120">
            <template #default="scope">{{
              toStatusLabel(scope.row.status)
            }}</template>
          </el-table-column>
          <el-table-column
            prop="last_updated_at"
            label="更新时间"
            width="180"
          />
          <el-table-column label="操作" width="160" fixed="right">
            <template #default="scope">
              <el-button
                v-if="
                  scope.row.initiated_bucket === 'returned_needs_action' &&
                  canEditBiz(scope.row)
                "
                link
                type="danger"
                @click="goEditBiz(scope.row)"
                >去修改</el-button
              >
              <el-button
                link
                type="primary"
                @click="router.push(`/approval/detail/${scope.row.id}`)"
                >查看</el-button
              >
            </template>
          </el-table-column>
        </el-table>

        <el-pagination
          style="margin-top: 12px; justify-content: flex-end"
          background
          layout="prev, pager, next, total"
          :current-page="approvalPage"
          :page-size="PAGE_SIZE"
          :total="approvalTotal"
          @current-change="changeApprovalPage"
        />
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>
