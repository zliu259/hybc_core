<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { statusLabel } from "@/utils/enum-labels";
import { listProjects, updateProjectStatus, type Project } from "@/api/project";

defineOptions({
  name: "ProjectList"
});

const router = useRouter();
const loading = ref(false);
const list = ref<Project[]>([]);
const page = ref(1);
const pageSize = ref(10);
const total = ref(0);
const filters = ref({
  keyword: "",
  status: ""
});

const statusOptions = [
  "planning",
  "preparing",
  "active",
  "completing",
  "archived"
];

const loadProjects = async () => {
  loading.value = true;
  try {
    const result = await listProjects({
      page: page.value,
      pageSize: pageSize.value,
      status: filters.value.status || undefined,
      keyword: filters.value.keyword || undefined
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const gotoDetail = (id: number) => {
  router.push(`/field/project/${id}`);
};

const gotoWorkspace = (id: number) => {
  router.push(`/field/project/${id}?tab=project`);
};

const gotoSectionOverview = (id: number) => {
  router.push(`/field/project/${id}?tab=sections`);
};

const changeStatus = async (id: number, status: string) => {
  await updateProjectStatus(id, status);
  await loadProjects();
};

onMounted(loadProjects);
</script>

<template>
  <el-card shadow="never" header="项目列表">
    <el-form inline>
      <el-form-item label="关键字">
        <el-input v-model="filters.keyword" placeholder="项目编码/名称" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable>
          <el-option
            v-for="status in statusOptions"
            :key="status"
            :label="status"
            :value="status"
          />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadProjects">查询</el-button>
      <el-button @click="router.push('/field/project/create')"
        >新建立项</el-button
      >
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="project_code" label="项目编号" width="170" />
      <el-table-column prop="project_name" label="项目名称" min-width="220" />
      <el-table-column label="状态" width="120">
        <template #default="scope">{{
          statusLabel(scope.row.status)
        }}</template>
      </el-table-column>
      <el-table-column prop="manager_userid" label="项目经理" width="140" />
      <el-table-column prop="updated_at" label="更新时间" width="200" />
      <el-table-column label="操作" width="390" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="gotoDetail(scope.row.id)">
            详情
          </el-button>
          <el-button link type="primary" @click="gotoWorkspace(scope.row.id)">
            工作区
          </el-button>
          <el-button
            link
            type="primary"
            @click="gotoSectionOverview(scope.row.id)"
          >
            标段总览
          </el-button>
          <el-dropdown
            @command="(value: string) => changeStatus(scope.row.id, value)"
          >
            <el-button link type="primary">状态流转</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-for="status in statusOptions"
                  :key="status"
                  :command="status"
                >
                  {{ status }}
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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
          loadProjects();
        }
      "
    />
  </el-card>
</template>
