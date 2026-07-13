<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessageBox, type MessageBoxInputData } from "element-plus";
import { message } from "@/utils/message";
import {
  precheckActionLabel,
  reimbursementPrecheckStatusLabel
} from "./reimbursement-labels";
import { listProjects, type Project } from "@/api/project";
import {
  listPrecheckPendingEnvelopes,
  precheckEnvelope,
  triggerEnvelopeAnomalyCheck,
  type ReimbursementEnvelope
} from "@/api/reimbursement";

defineOptions({ name: "ReimbursementPrecheckWorkbench" });

const router = useRouter();
const loading = ref(false);
const list = ref<ReimbursementEnvelope[]>([]);
const projects = ref<Project[]>([]);

const page = ref(1);
const pageSize = ref(20);
const total = ref(0);

const filters = ref({
  project_id: undefined as number | undefined
});

const projectMap = computed(() => {
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
    const result = await listPrecheckPendingEnvelopes({
      project_id: filters.value.project_id,
      page: page.value,
      pageSize: pageSize.value
    });
    list.value = result.data;
    total.value = result.pagination.total;
  } finally {
    loading.value = false;
  }
};

const openDetail = (id: number) => {
  router.push(`/finance/reimbursement/detail/${id}`);
};

const triggerAnomaly = async (id: number) => {
  await triggerEnvelopeAnomalyCheck(id);
  message("已触发智能核查", { type: "success" });
};

// 重复风险拦截时向财务/超管收集放行理由后重试；是否有放行权限由后端
// 在拦截响应里通过 can_override_duplicate 告知，前端无需自行判断角色。
const promptDuplicateOverride = async (id: number) => {
  try {
    const { value } = (await ElMessageBox.prompt(
      "查重发现疑似重复报销，且申请人未坚持提交。如已人工核实并确认非重复报销，可填写理由放行（将记录审计日志）。",
      "重复风险拦截",
      {
        confirmButtonText: "确认放行",
        cancelButtonText: "取消",
        inputPlaceholder: "放行理由（必填）",
        inputValidator: (input: string) =>
          input.trim() ? true : "理由不能为空",
        type: "warning"
      }
    )) as MessageBoxInputData;
    await doPrecheck(id, "approved", value.trim());
  } catch {
    // 用户取消
  }
};

const doPrecheck = async (
  id: number,
  action: "approved" | "supplement" | "rejected",
  overrideDuplicateReason?: string
) => {
  try {
    await precheckEnvelope(id, {
      action,
      override_duplicate_reason: overrideDuplicateReason
    });
    message(`复核完成：${precheckActionLabel(action)}`, {
      type: action === "approved" ? "success" : "warning"
    });
    await loadData();
  } catch (error) {
    const err = error as {
      response?: {
        status?: number;
        data?: {
          data?: {
            wait_for_audit?: boolean;
            duplicate_risk_unconfirmed?: boolean;
            can_override_duplicate?: boolean;
          };
        };
      };
    };
    const waitForAudit =
      err.response?.status === 409 &&
      err.response?.data?.data?.wait_for_audit === true;
    const duplicateBlocked =
      err.response?.status === 400 &&
      err.response?.data?.data?.duplicate_risk_unconfirmed === true;
    if (duplicateBlocked) {
      if (err.response?.data?.data?.can_override_duplicate === true) {
        await promptDuplicateOverride(id);
      } else {
        message(
          "查重发现疑似重复报销，且申请人未坚持提交，复核通过被拦截。请等待申请人坚持提交，或转交办公室财务处理。",
          { type: "error" }
        );
      }
      return;
    }
    if (!waitForAudit) throw error;
    message("后台静默审查尚未完成，系统已自动触发处理，请稍后再执行复核通过", {
      type: "warning"
    });
    await loadData();
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
        <span>复核工作台</span>
        <el-button @click="router.push('/finance/reimbursement')"
          >返回信封列表</el-button
        >
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
      <el-button type="primary" @click="loadData">查询</el-button>
    </el-form>

    <el-table :data="list" :loading="loading" style="margin-top: 12px">
      <el-table-column prop="envelope_no" label="信封编号" width="160" />
      <el-table-column label="项目" width="180">
        <template #default="scope">{{
          projectMap[scope.row.project_id] || scope.row.project_id
        }}</template>
      </el-table-column>
      <el-table-column prop="applicant_userid" label="填报人" width="140" />
      <el-table-column prop="amount" label="金额" width="110" />
      <el-table-column prop="duplicate_count" label="复核提示" width="110" />
      <el-table-column label="复核状态" width="120">
        <template #default="scope">{{
          reimbursementPrecheckStatusLabel(scope.row.precheck_status)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" min-width="380" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openDetail(scope.row.id)"
            >详情</el-button
          >
          <el-button link @click="triggerAnomaly(scope.row.id)"
            >智能核查</el-button
          >
          <el-button
            link
            type="success"
            @click="doPrecheck(scope.row.id, 'approved')"
            >通过</el-button
          >
          <el-button
            link
            type="warning"
            @click="doPrecheck(scope.row.id, 'supplement')"
            >补充</el-button
          >
          <el-button
            link
            type="danger"
            @click="doPrecheck(scope.row.id, 'rejected')"
            >驳回</el-button
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
