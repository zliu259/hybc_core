<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { listProjects, type Project } from "@/api/project";
import {
  listReimbursementEnvelopes,
  type ReimbursementEnvelope
} from "@/api/reimbursement";
import { useUserStoreHook } from "@/store/modules/user";

defineOptions({ name: "WorkspaceReimbursementList" });

const router = useRouter();
const userStore = useUserStoreHook();

const loading = ref(false);
const list = ref<ReimbursementEnvelope[]>([]);
const projects = ref<Project[]>([]);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  status: "",
  channel: "",
  keyword: ""
});

const currentUserid = computed(() => userStore.username || "");

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const statusTagType = (status: string) => {
  if (["approved", "paid", "received"].includes(status)) return "success";
  if (["rejected"].includes(status)) return "danger";
  if (["submitted", "pending_approval", "batched"].includes(status))
    return "warning";
  return "info";
};

const statusLabel = (status: string) => {
  const map: Record<string, string> = {
    unregistered: "未登记",
    draft: "草稿",
    submitted: "已填报",
    received: "已收件",
    batched: "已成批",
    pending_approval: "待审批",
    approved: "已审批",
    paid: "已打款",
    rejected: "已拒绝"
  };
  return map[status] || status;
};

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 300 });
  projects.value = result.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listReimbursementEnvelopes({
      page: page.value,
      pageSize: pageSize.value,
      applicant_userid: currentUserid.value,
      status: filters.value.status || undefined,
      channel: filters.value.channel || undefined,
      keyword: filters.value.keyword || undefined
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const goCreate = () => {
  router.push("/workspace/home");
};

const goDetail = (id: number) => {
  router.push(`/workspace/my-reimbursement/detail/${id}`);
};

onMounted(async () => {
  await Promise.all([loadProjects(), loadData()]);
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
        <span>我的报销提交</span>
        <el-space>
          <el-button @click="router.push('/workspace/home')"
            >返回工作台</el-button
          >
          <el-button type="success" @click="goCreate">发起报销</el-button>
        </el-space>
      </div>
    </template>

    <el-alert
      type="info"
      :closable="false"
      title="这里只展示你的报销申请记录；如需新建，请使用工作台首页“发起报销”按钮。"
      style="margin-bottom: 12px"
    />

    <el-form inline>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 170px">
          <el-option label="草稿" value="draft" />
          <el-option label="未登记" value="unregistered" />
          <el-option label="已填报" value="submitted" />
          <el-option label="已收件" value="received" />
          <el-option label="已成批" value="batched" />
          <el-option label="待审批" value="pending_approval" />
          <el-option label="已审批" value="approved" />
          <el-option label="已打款" value="paid" />
          <el-option label="已拒绝" value="rejected" />
        </el-select>
      </el-form-item>
      <el-form-item label="通道">
        <el-select v-model="filters.channel" clearable style="width: 160px">
          <el-option label="实物信封" value="physical" />
          <el-option label="电子发票" value="electronic" />
        </el-select>
      </el-form-item>
      <el-form-item label="关键字">
        <el-input
          v-model="filters.keyword"
          clearable
          placeholder="编号/UUID/发票号"
        />
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="envelope_no" label="报销识别号" width="180" />
      <el-table-column prop="envelope_uuid" label="UUID" min-width="230" />
      <el-table-column label="项目" min-width="160">
        <template #default="scope">{{
          projectMap[scope.row.project_id] || scope.row.project_id
        }}</template>
      </el-table-column>
      <el-table-column prop="amount" label="金额" width="120" />
      <el-table-column label="状态" width="120">
        <template #default="scope">
          <el-tag :type="statusTagType(scope.row.status)">{{
            statusLabel(scope.row.status)
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="updated_at" label="更新时间" width="180" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="goDetail(scope.row.id)"
            >查看</el-button
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
