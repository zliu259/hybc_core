<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  listPaymentRequests,
  markPaymentPaid,
  type PaymentRequest
} from "@/api/payment";
import { listContracts, type Contract } from "@/api/contract";
import { listProjects, type Project } from "@/api/project";

defineOptions({ name: "PaymentList" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const router = useRouter();
const loading = ref(false);
const list = ref<PaymentRequest[]>([]);
const contracts = ref<Contract[]>([]);
const projects = ref<Project[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  project_id: undefined as number | undefined,
  contract_id: undefined as number | undefined,
  status: "",
  keyword: ""
});

const statusTagType: Record<string, TagType> = {
  draft: "info",
  pending_approval: "warning",
  approved: "success",
  paid: "primary",
  rejected: "danger",
  cancelled: "info"
};

const aiTagType: Record<string, TagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const contractMap = computed(() => {
  const map: Record<number, string> = {};
  contracts.value.forEach(item => {
    map[item.id] = item.contract_no;
  });
  return map;
});

const loadRefs = async () => {
  const [projectRes, contractRes] = await Promise.all([
    listProjects({ page: 1, pageSize: 300 }),
    listContracts({ page: 1, pageSize: 300, direction: "outbound" })
  ]);
  projects.value = projectRes.data;
  contracts.value = contractRes.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listPaymentRequests({
      page: page.value,
      pageSize: pageSize.value,
      project_id: filters.value.project_id,
      contract_id: filters.value.contract_id,
      status: filters.value.status || undefined,
      keyword: filters.value.keyword || undefined
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const goCreate = () => {
  router.push("/finance/payment/detail/create");
};

const goDetail = (id: number) => {
  router.push(`/finance/payment/detail/${id}`);
};

const onMarkPaid = async (id: number) => {
  await markPaymentPaid(id);
  message("已标记为已付款", { type: "success" });
  await loadData();
};

onMounted(async () => {
  await loadRefs();
  await loadData();
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <el-form inline>
      <el-form-item label="所属项目">
        <el-select
          v-model="filters.project_id"
          clearable
          filterable
          style="width: 220px"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="关联合同">
        <el-select
          v-model="filters.contract_id"
          clearable
          filterable
          style="width: 220px"
        >
          <el-option
            v-for="item in contracts"
            :key="item.id"
            :label="item.contract_no"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 150px">
          <el-option label="草稿" value="draft" />
          <el-option label="待审批" value="pending_approval" />
          <el-option label="已审批" value="approved" />
          <el-option label="已付款" value="paid" />
          <el-option label="已拒绝" value="rejected" />
          <el-option label="已取消" value="cancelled" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="流水号/付款内容"
        />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
      <el-button @click="goCreate">新建申请</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="serial_no" label="流水号" width="150" />
      <el-table-column label="合同号" width="150">
        <template #default="scope">{{
          contractMap[scope.row.contract_id] || scope.row.contract_id
        }}</template>
      </el-table-column>
      <el-table-column label="所属项目" width="180">
        <template #default="scope">{{
          projectMap[scope.row.project_id] || scope.row.project_id
        }}</template>
      </el-table-column>
      <el-table-column prop="amount" label="金额" width="120" />
      <el-table-column prop="amount_cn" label="金额大写" min-width="160" />
      <el-table-column prop="payment_method" label="付款方式" width="120" />
      <el-table-column label="状态" width="110">
        <template #default="scope">
          <el-tag :type="statusTagType[scope.row.status] || 'info'">{{
            scope.row.status
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="AI风险" width="110">
        <template #default="scope">
          <el-tag :type="aiTagType[scope.row.ai_risk_status] || 'info'">{{
            scope.row.ai_risk_status
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="created_at" label="申请时间" width="180" />
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="goDetail(scope.row.id)"
            >详情</el-button
          >
          <el-button
            v-if="scope.row.status === 'approved'"
            link
            type="success"
            @click="onMarkPaid(scope.row.id)"
          >
            标记付款
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      background
      layout="prev, pager, next, total"
      :current-page="page"
      :page-size="pageSize"
      :total="total"
      @current-change="
        (val: number) => {
          page = val;
          loadData();
        }
      "
    />
  </el-card>
</template>
