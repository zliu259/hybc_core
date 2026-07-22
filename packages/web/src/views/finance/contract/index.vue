<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import { contractTypeLabel } from "@/utils/enum-labels";
import { listContracts, deleteContract, type Contract } from "@/api/contract";
import { listProjects, type Project } from "@/api/project";

defineOptions({ name: "ContractList" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const router = useRouter();
const loading = ref(false);
const list = ref<Contract[]>([]);
const projects = ref<Project[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  direction: "outbound",
  project_id: undefined as number | undefined,
  status: "",
  keyword: ""
});

const statusTagType: Record<string, TagType> = {
  draft: "info",
  pending_review: "warning",
  pending_approval: "warning",
  active: "success",
  completed: "primary",
  terminated: "danger"
};

const aiStatusTagType: Record<string, TagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};

const statusLabelMap: Record<string, string> = {
  draft: "草稿",
  pending_review: "待审查",
  pending_approval: "待审批",
  active: "生效中",
  completed: "已完成",
  terminated: "已终止"
};

const aiLabelMap: Record<string, string> = {
  none: "未触发",
  pending: "审查中",
  completed: "已完成",
  failed: "失败"
};

const projectNameMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 200 });
  projects.value = result.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listContracts({
      page: page.value,
      pageSize: pageSize.value,
      direction: filters.value.direction || undefined,
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
  router.push("/finance/contract/detail/create");
};

const goDraft = () => {
  router.push("/finance/contract/draft");
};

const goDetail = (id: number) => {
  router.push(`/finance/contract/detail/${id}`);
};

const onDelete = async (row: Contract) => {
  try {
    await ElMessageBox.confirm(`确认删除合同 ${row.contract_no} 吗？`, "提示", {
      type: "warning"
    });
    await deleteContract(row.id);
    message("删除成功", { type: "success" });
    await loadData();
  } catch {
    // cancelled
  }
};

onMounted(async () => {
  await loadProjects();
  await loadData();
});
</script>

<template>
  <el-card shadow="never" style="background: #fffaf2">
    <el-form inline>
      <el-form-item label="合同方向">
        <el-select v-model="filters.direction" clearable style="width: 140px">
          <el-option label="对外付款" value="outbound" />
          <el-option label="收款" value="inbound" />
        </el-select>
      </el-form-item>
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
          <el-option label="待审查" value="pending_review" />
          <el-option label="待审批" value="pending_approval" />
          <el-option label="生效中" value="active" />
          <el-option label="已完成" value="completed" />
          <el-option label="已终止" value="terminated" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          placeholder="合同号/对方单位/备注"
          clearable
        />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
      <el-button @click="goCreate">新建合同</el-button>
      <el-button type="success" plain @click="goDraft">合同生成</el-button>
    </el-form>

    <el-table
      :data="list"
      :loading="loading"
      style="margin-top: 12px"
      @row-click="(row: Contract) => goDetail(row.id)"
    >
      <el-table-column prop="contract_no" label="合同号" width="170" />
      <el-table-column label="方向" width="110">
        <template #default="scope">
          <el-tag
            :type="scope.row.direction === 'outbound' ? 'warning' : 'success'"
          >
            {{ scope.row.direction === "outbound" ? "对外付款" : "收款" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="所属项目" min-width="160">
        <template #default="scope">
          {{
            projectNameMap[scope.row.project_id] ||
            `项目#${scope.row.project_id}`
          }}
        </template>
      </el-table-column>
      <el-table-column prop="counterparty" label="对方单位" min-width="180" />
      <el-table-column label="合同类型" width="110">
        <template #default="scope">{{
          contractTypeLabel(scope.row.contract_type)
        }}</template>
      </el-table-column>
      <el-table-column label="合同金额" width="130">
        <template #default="scope">{{
          scope.row.total_amount.toFixed(2)
        }}</template>
      </el-table-column>
      <el-table-column label="已付金额" width="130">
        <template #default="scope">{{
          scope.row.paid_amount.toFixed(2)
        }}</template>
      </el-table-column>
      <el-table-column label="剩余额度" width="130">
        <template #default="scope">
          {{ (scope.row.total_amount - scope.row.paid_amount).toFixed(2) }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="scope">
          <el-tag :type="statusTagType[scope.row.status] || 'info'">
            {{ statusLabelMap[scope.row.status] || scope.row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="AI审查" width="110">
        <template #default="scope">
          <el-tag :type="aiStatusTagType[scope.row.ai_review_status] || 'info'">
            {{
              aiLabelMap[scope.row.ai_review_status] ||
              scope.row.ai_review_status
            }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click.stop="goDetail(scope.row.id)"
            >详情</el-button
          >
          <el-button link type="danger" @click.stop="onDelete(scope.row)"
            >删除</el-button
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
</template>
