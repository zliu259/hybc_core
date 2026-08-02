<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import {
  listContracts,
  createAmountChange,
  submitAmountChangeApproval,
  type Contract
} from "@/api/contract";
import { listProjects, type Project } from "@/api/project";
import ContractDetailDrawer from "@/views/finance/contract/components/ContractDetailDrawer.vue";
import { formatMoney } from "../shared/format";

defineOptions({ name: "InboundContractList" });

const router = useRouter();
const loading = ref(false);
const list = ref<Contract[]>([]);
const projects = ref<Project[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const drawerVisible = ref(false);
const submitting = ref(false);
const activeRow = ref<Contract | null>(null);
const amountForm = ref({ new_amount: 0, reason: "" });

const detailDrawerVisible = ref(false);
const activeContractId = ref<number | null>(null);

const filters = ref({
  project_id: undefined as number | undefined,
  status: "",
  keyword: ""
});

const projectNameMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 300 });
  projects.value = result.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listContracts({
      page: page.value,
      pageSize: pageSize.value,
      direction: "inbound",
      project_id: filters.value.project_id,
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
  router.push("/finance/contract/detail/create?direction=inbound");
};

const goDetail = (id: number) => {
  activeContractId.value = id;
  detailDrawerVisible.value = true;
};

// 迷你进度百分比：相对合同总额，封顶 100（超额由 exception 状态提示）
const progressPercent = (amount: number, totalAmount: number) => {
  if (!(totalAmount > 0)) return 0;
  return Math.min(100, Math.round((amount / totalAmount) * 100));
};

const openAmountDrawer = (row: Contract) => {
  activeRow.value = row;
  amountForm.value = {
    new_amount: Number(row.total_amount),
    reason: ""
  };
  drawerVisible.value = true;
};

const submitAmountChange = async () => {
  if (!activeRow.value || !amountForm.value.reason.trim()) {
    message("请填写变更原因", { type: "warning" });
    return;
  }

  submitting.value = true;
  try {
    const change = await createAmountChange(activeRow.value.id, {
      change_type: "adjust",
      new_amount: amountForm.value.new_amount,
      reason: amountForm.value.reason.trim()
    });

    await submitAmountChangeApproval(activeRow.value.id, change.data.id, {
      instance_config: {
        note: "收款合同金额变更发起自收款合同管理"
      }
    });

    message("已提交变更审批", { type: "success" });
    drawerVisible.value = false;
    await loadData();
  } finally {
    submitting.value = false;
  }
};

onMounted(async () => {
  await loadProjects();
  await loadData();
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>收款合同管理</span>
        <el-button type="primary" @click="goCreate">新建收款合同</el-button>
      </div>
    </template>

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
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 160px">
          <el-option label="草稿" value="draft" />
          <el-option label="待审批" value="pending_approval" />
          <el-option label="生效中" value="active" />
          <el-option label="已完成" value="completed" />
          <el-option label="已终止" value="terminated" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="合同号/对方单位"
        />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="contract_no" label="合同号" width="170" />
      <el-table-column label="项目" min-width="160">
        <template #default="scope">{{
          projectNameMap[scope.row.project_id] || scope.row.project_id
        }}</template>
      </el-table-column>
      <el-table-column prop="counterparty" label="对方单位" min-width="180" />
      <el-table-column label="合同总额" width="130" align="right">
        <template #default="scope">{{
          formatMoney(scope.row.total_amount)
        }}</template>
      </el-table-column>
      <el-table-column label="收款进度" min-width="220">
        <template #default="scope">
          <div class="mini-progress">
            <span class="mini-progress__label">开票</span>
            <el-progress
              class="mini-progress__bar"
              :stroke-width="6"
              :show-text="false"
              :percentage="
                progressPercent(
                  scope.row.invoiced_amount,
                  scope.row.total_amount
                )
              "
              :color="
                scope.row.invoiced_amount > scope.row.total_amount
                  ? ''
                  : '#c9a35c'
              "
              :status="
                scope.row.invoiced_amount > scope.row.total_amount
                  ? 'exception'
                  : ''
              "
            />
            <span class="mini-progress__amount">{{
              formatMoney(scope.row.invoiced_amount)
            }}</span>
          </div>
          <div class="mini-progress">
            <span class="mini-progress__label">到账</span>
            <el-progress
              class="mini-progress__bar"
              :stroke-width="6"
              :show-text="false"
              :percentage="
                progressPercent(
                  scope.row.received_amount,
                  scope.row.total_amount
                )
              "
              :color="
                scope.row.received_amount > scope.row.total_amount
                  ? ''
                  : '#c9a35c'
              "
              :status="
                scope.row.received_amount > scope.row.total_amount
                  ? 'exception'
                  : ''
              "
            />
            <span class="mini-progress__amount">{{
              formatMoney(scope.row.received_amount)
            }}</span>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="scope">{{
          statusLabel(scope.row.status)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="goDetail(scope.row.id)"
            >详情</el-button
          >
          <el-button
            v-if="scope.row.status === 'active'"
            link
            type="primary"
            @click="openAmountDrawer(scope.row)"
            >变更金额</el-button
          >
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

  <el-drawer
    v-model="drawerVisible"
    title="发起收款合同金额变更"
    size="480px"
    destroy-on-close
  >
    <el-form label-width="110px">
      <el-form-item label="合同号">
        <el-input :model-value="activeRow?.contract_no" disabled />
      </el-form-item>
      <el-form-item label="原合同金额">
        <el-input
          :model-value="String(activeRow?.total_amount ?? '')"
          disabled
        />
      </el-form-item>
      <el-form-item label="已收款">
        <el-input
          :model-value="String(activeRow?.received_amount ?? '')"
          disabled
        />
      </el-form-item>
      <el-form-item label="新合同金额" required>
        <el-input-number
          v-model="amountForm.new_amount"
          :min="Number(activeRow?.received_amount ?? 0)"
          :precision="2"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="变更缘由" required>
        <el-input v-model="amountForm.reason" type="textarea" :rows="4" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="drawerVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        @click="submitAmountChange"
      >
        提交审批
      </el-button>
    </template>
  </el-drawer>

  <ContractDetailDrawer
    v-model:visible="detailDrawerVisible"
    :contract-id="activeContractId"
    @closed="loadData"
  />
</template>

<style scoped>
.mini-progress {
  display: flex;
  gap: 8px;
  align-items: center;
}

.mini-progress + .mini-progress {
  margin-top: 4px;
}

.mini-progress__label {
  flex-shrink: 0;
  font-size: 12px;
  color: #6e6458;
}

.mini-progress__bar {
  flex: 1;
}

.mini-progress__amount {
  flex-shrink: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #3f3527;
}
</style>
