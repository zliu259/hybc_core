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
  type ApprovalInstance
} from "@/api/approval";
import { toBizTypeLabel, toStatusLabel } from "@/views/approval/labels";

defineOptions({ name: "WorkspaceMyApplications" });

const router = useRouter();
const loading = ref(false);
const paymentList = ref<PaymentRequest[]>([]);
const reimbursementList = ref<ReimbursementEnvelope[]>([]);
const fuelList = ref<FuelQuotaApplication[]>([]);
const approvalList = ref<ApprovalInstance[]>([]);

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
    const [paymentResult, reimbursementResult, fuelResult, approvalResult] =
      await Promise.all([
      listPaymentRequests({ mine: true, page: 1, pageSize: 8 }),
      listReimbursementEnvelopes({ creator_id: "me", page: 1, pageSize: 8 }),
      listFuelQuotaApplications({ mine: true }),
      listApprovalInstances({ initiator: "me", page: 1, pageSize: 8 })
    ]);
    paymentList.value = paymentResult.data;
    reimbursementList.value = reimbursementResult.data;
    fuelList.value = fuelResult.data.slice(0, 8);
    approvalList.value = approvalResult.data;
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
        ><el-card shadow="never"
          >对外付款申请：{{ paymentList.length }}</el-card
        ></el-col
      >
      <el-col :md="6" :xs="24"
        ><el-card shadow="never"
          >报销申请：{{ reimbursementList.length }}</el-card
        ></el-col
      >
      <el-col :md="6" :xs="24"
        ><el-card shadow="never"
          >油卡额度申请：{{ fuelList.length }}</el-card
        ></el-col
      >
      <el-col :md="6" :xs="24"
        ><el-card shadow="never"
          >我发起的审批：{{ approvalList.length }}</el-card
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
      </el-tab-pane>

      <el-tab-pane label="我发起的审批">
        <el-table :data="approvalList" stripe>
          <el-table-column prop="instance_no" label="审批单号" min-width="170" />
          <el-table-column label="业务类型" width="140">
            <template #default="scope">{{ toBizTypeLabel(scope.row.biz_type) }}</template>
          </el-table-column>
          <el-table-column prop="biz_summary" label="摘要" min-width="220" />
          <el-table-column label="状态" width="120">
            <template #default="scope">{{ toStatusLabel(scope.row.status) }}</template>
          </el-table-column>
          <el-table-column prop="submitted_at" label="提交时间" width="180" />
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="scope">
              <el-button
                link
                type="primary"
                @click="router.push(`/approval/detail/${scope.row.id}`)"
                >查看</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>
