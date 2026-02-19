<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { listProjects, type Project } from "@/api/project";
import {
  createReimbursementBatch,
  listReimbursementBatches,
  type ReimbursementBatch
} from "@/api/reimbursement";

defineOptions({ name: "ReimbursementBatchList" });

const router = useRouter();
const loading = ref(false);
const list = ref<ReimbursementBatch[]>([]);
const projects = ref<Project[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  status: ""
});

const projectMap = computed(() => {
  const map: Record<number, string> = {};
  projects.value.forEach(item => {
    map[item.id] = item.project_name;
  });
  return map;
});

const createDialog = ref(false);
const creating = ref(false);
const createForm = ref({
  project_id: undefined as number | undefined,
  applicant_userid: "",
  envelope_ids_text: ""
});

const loadProjects = async () => {
  const result = await listProjects({ page: 1, pageSize: 300 });
  projects.value = result.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listReimbursementBatches({
      page: page.value,
      pageSize: pageSize.value,
      project_id: filters.value.project_id,
      applicant_userid: filters.value.applicant_userid || undefined,
      status: filters.value.status || undefined
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const openCreate = () => {
  createForm.value = {
    project_id: filters.value.project_id,
    applicant_userid: filters.value.applicant_userid,
    envelope_ids_text: ""
  };
  createDialog.value = true;
};

const submitCreate = async () => {
  if (
    !createForm.value.project_id ||
    !createForm.value.applicant_userid.trim()
  ) {
    message("请填写项目和申报人", { type: "warning" });
    return;
  }

  const rawIds = createForm.value.envelope_ids_text
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  const envelopeIds = rawIds.map(Number).filter(n => !Number.isNaN(n) && n > 0);

  creating.value = true;
  try {
    const result = await createReimbursementBatch({
      project_id: createForm.value.project_id,
      applicant_userid: createForm.value.applicant_userid.trim(),
      envelope_ids: envelopeIds.length > 0 ? envelopeIds : undefined
    });
    message(`批次创建成功：${result.data.batch_no}`, { type: "success" });
    createDialog.value = false;
    router.push(`/finance/reimbursement/batch/${result.data.id}`);
  } finally {
    creating.value = false;
  }
};

const openDetail = (id: number) => {
  router.push(`/finance/reimbursement/batch/${id}`);
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
        <span>报销集中审批批次</span>
        <el-button type="primary" @click="openCreate">新建审批批次</el-button>
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
      <el-form-item label="申报人">
        <el-input
          v-model="filters.applicant_userid"
          placeholder="userid"
          clearable
        />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="filters.status" clearable style="width: 160px">
          <el-option label="草稿" value="draft" />
          <el-option label="待审批" value="pending_approval" />
          <el-option label="已审批" value="approved" />
          <el-option label="已拒绝" value="rejected" />
          <el-option label="已付款" value="paid" />
        </el-select>
      </el-form-item>
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="batch_no" label="批次号" width="160" />
      <el-table-column label="项目" width="180">
        <template #default="scope">{{
          projectMap[scope.row.project_id] || scope.row.project_id
        }}</template>
      </el-table-column>
      <el-table-column prop="applicant_userid" label="申报人" width="140" />
      <el-table-column prop="item_count" label="信封数" width="100" />
      <el-table-column prop="total_amount" label="总金额" width="120" />
      <el-table-column prop="ai_audit_status" label="AI审计" width="120" />
      <el-table-column prop="status" label="审批状态" width="120" />
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openDetail(scope.row.id)"
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

  <el-dialog v-model="createDialog" title="新建报销审批批次" width="580px">
    <el-form label-width="120px">
      <el-form-item label="所属项目" required>
        <el-select
          v-model="createForm.project_id"
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="申报人" required>
        <el-input
          v-model="createForm.applicant_userid"
          placeholder="例如 operator"
        />
      </el-form-item>
      <el-form-item label="指定信封ID">
        <el-input
          v-model="createForm.envelope_ids_text"
          placeholder="可选，英文逗号分隔；留空自动汇总可用信封"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="createDialog = false">取消</el-button>
      <el-button type="primary" :loading="creating" @click="submitCreate"
        >创建</el-button
      >
    </template>
  </el-dialog>
</template>
