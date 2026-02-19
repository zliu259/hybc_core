<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { listContracts, type Contract } from "@/api/contract";
import { listProjects, type Project } from "@/api/project";

defineOptions({ name: "InboundContractList" });

const router = useRouter();
const loading = ref(false);
const list = ref<Contract[]>([]);
const projects = ref<Project[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

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
  router.push(`/finance/contract/detail/${id}`);
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
      <el-table-column prop="total_amount" label="合同总额" width="120" />
      <el-table-column prop="invoiced_amount" label="已开票" width="120" />
      <el-table-column prop="received_amount" label="已收款" width="120" />
      <el-table-column prop="status" label="状态" width="120" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="goDetail(scope.row.id)"
            >详情</el-button
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
