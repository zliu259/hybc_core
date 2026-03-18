<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { message } from "@/utils/message";
import { ElMessageBox } from "element-plus";
import { statusLabel } from "@/utils/enum-labels";
import { useUserStoreHook } from "@/store/modules/user";
import { formatToken, getToken } from "@/utils/auth";
import { createUploadSignature } from "@/api/upload";
import {
  getProjectById,
  listProjectSections,
  updateProjectSection,
  updateProject,
  updateProjectStatus,
  type Project,
  type ProjectSection
} from "@/api/project";
import {
  createManagerLog,
  createOperatorLog,
  getManagerLog,
  getOperatorLog,
  listManagerLogs,
  listOperatorLogs,
  triggerLogSummary,
  updateOperatorLog,
  type ManagerLog,
  type OperatorLog
} from "@/api/log";
import {
  createBreakthroughReport,
  listBreakthroughReports,
  updateBreakthroughReport,
  type BreakthroughReport
} from "@/api/survey";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

const props = defineProps<{ projectId: number }>();

const router = useRouter();
const userStore = useUserStoreHook();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const loading = ref(false);
const saving = ref(false);
const creatingManagerLog = ref(false);
const project = ref<Project | null>(null);
const sections = ref<ProjectSection[]>([]);
const operatorLogs = ref<OperatorLog[]>([]);
const managerLogs = ref<ManagerLog[]>([]);
const breakthroughReports = ref<BreakthroughReport[]>([]);

const sectionDrawerVisible = ref(false);
const sectionDrawerLoading = ref(false);
const currentSection = ref<ProjectSection | null>(null);
const sectionOperatorLogs = ref<OperatorLog[]>([]);
const sectionBreakthroughReports = ref<BreakthroughReport[]>([]);
const sectionStatusSaving = ref(false);
const sectionStatusValue = ref("");

const operatorLogDetailVisible = ref(false);
const operatorLogDetailLoading = ref(false);
const operatorLogDetail = ref<OperatorLog | null>(null);

const managerLogDialogVisible = ref(false);
const managerLogDetailVisible = ref(false);
const managerLogDetail = ref<
  (ManagerLog & { photos: Array<Record<string, unknown>> }) | null
>(null);
const managerLogDetailLoading = ref(false);
const managerLogUploading = ref(false);

const form = ref({
  project_name: "",
  manager_userid: "",
  location_text: "",
  project_briefing: "",
  project_start_at: ""
});

const managerLogForm = ref({
  log_date: "",
  title: "",
  detail_html: "",
  risk_note: ""
});

const managerLogPhotos = ref<
  Array<{ file_key: string; file_url: string; file_name: string }>
>([]);

const operatorLogDialogVisible = ref(false);
const operatorLogSubmitting = ref(false);
const editingOperatorLogId = ref<number | null>(null);
const operatorLogForm = ref({
  log_date: "",
  shift: "day",
  weather: "",
  completed_pipe_count: 0,
  cumulative_pipe_count: 0,
  footage_m: undefined as number | undefined,
  issue_summary: "",
  remark: ""
});

const breakthroughDialogVisible = ref(false);
const breakthroughSubmitting = ref(false);
const editingBreakthroughId = ref<number | null>(null);
const breakthroughForm = ref({
  report_date: "",
  breakthrough_m: undefined as number | undefined,
  summary: "",
  detail: ""
});

const canWriteProjectLog = computed(() => {
  const roles = userStore.roles ?? [];
  return roles.some(role =>
    ["super_admin", "manager", "site_manager", "finance"].includes(role)
  );
});

const statusLabelMap: Record<string, string> = {
  planning: "规划中",
  preparing: "筹备中",
  active: "施工中",
  completing: "收尾中",
  archived: "已归档"
};

const shiftLabelMap: Record<string, string> = {
  day: "白班",
  night: "夜班"
};

const sectionStatusLabelMap: Record<string, string> = {
  planning: "规划中",
  preparing: "筹备中",
  active: "施工中",
  completing: "收尾中",
  archived: "已归档",
  normal: "正常",
  paused: "暂停",
  blocked: "受阻",
  done: "完成"
};

const projectStatusLabel = computed(() => {
  const raw = project.value?.status || "";
  return statusLabelMap[raw] || raw || "-";
});

const shiftLabel = (shift: string | null | undefined) => {
  if (!shift) return "-";
  return shiftLabelMap[shift] || shift;
};

const sectionStatusLabel = (status: string | null | undefined) => {
  if (!status) return "-";
  return sectionStatusLabelMap[status] || status;
};

const sectionStatusOptions = computed(() => [
  { value: "planning", label: "规划中" },
  { value: "preparing", label: "筹备中" },
  { value: "active", label: "施工中" },
  { value: "completing", label: "收尾中" },
  { value: "archived", label: "已归档" },
  { value: "normal", label: "正常" },
  { value: "paused", label: "暂停" },
  { value: "blocked", label: "受阻" },
  { value: "done", label: "完成" }
]);

const sectionProgressMilestones = [0, 25, 50, 75, 100];

const sectionDrawerProgress = computed(() => {
  const sectionLength = currentSection.value?.section_length || 0;
  const advanced = sectionOperatorLogs.value.reduce(
    (sum, item) => sum + (item.footage_m || 0),
    0
  );
  const percent =
    sectionLength > 0 ? Math.min(100, (advanced / sectionLength) * 100) : 0;
  const remaining = Math.max(0, sectionLength - advanced);

  let phase = "待推进";
  if (percent >= 100) phase = "已贯通";
  else if (percent >= 75) phase = "冲刺阶段";
  else if (percent >= 40) phase = "稳定推进";
  else if (percent > 0) phase = "起步阶段";

  return {
    sectionLength,
    advanced,
    remaining,
    percent,
    phase
  };
});

const sectionMetrics = computed(() => {
  return sections.value.map(section => {
    const sectionLogs = operatorLogs.value.filter(
      item => item.section_id === section.id
    );
    const footage = sectionLogs.reduce(
      (sum, item) => sum + (item.footage_m || 0),
      0
    );
    const sectionLength = section.section_length || 0;
    const progress =
      sectionLength > 0 ? Math.min(100, (footage / sectionLength) * 100) : 0;
    const breakthroughCount = breakthroughReports.value.filter(
      item => item.section_id === section.id
    ).length;
    const latestLogDate = sectionLogs[0]?.log_date || "-";

    return {
      section,
      logCount: sectionLogs.length,
      breakthroughCount,
      footage,
      progress,
      latestLogDate
    };
  });
});

const loadProjectMain = async () => {
  const [detail, sectionData] = await Promise.all([
    getProjectById(props.projectId),
    listProjectSections(props.projectId)
  ]);
  project.value = detail.data;
  sections.value = sectionData.data;
  form.value.project_name = detail.data.project_name;
  form.value.manager_userid = detail.data.manager_userid || "";
  form.value.location_text = detail.data.location_text || "";
  form.value.project_briefing = detail.data.project_briefing || "";
  form.value.project_start_at = detail.data.project_start_at || "";
};

const loadProjectLogData = async () => {
  const [operatorRes, managerRes, breakthroughRes] = await Promise.all([
    listOperatorLogs({ project_id: props.projectId, page: 1, pageSize: 200 }),
    listManagerLogs({ project_id: props.projectId, page: 1, pageSize: 200 }),
    listBreakthroughReports({ project_id: props.projectId })
  ]);
  operatorLogs.value = operatorRes.data;
  managerLogs.value = managerRes.data;
  breakthroughReports.value = breakthroughRes.data;
};

const loadData = async () => {
  if (!props.projectId) return;
  loading.value = true;
  try {
    await Promise.all([loadProjectMain(), loadProjectLogData()]);
  } finally {
    loading.value = false;
  }
};

const saveBase = async () => {
  if (!project.value) return;
  saving.value = true;
  try {
    await updateProject(project.value.id, {
      project_name: form.value.project_name,
      manager_userid: form.value.manager_userid || null,
      location_text: form.value.location_text || null,
      project_briefing: form.value.project_briefing || null,
      project_start_at: form.value.project_start_at || null
    });
    message("项目信息已保存", { type: "success" });
    await loadProjectMain();
  } finally {
    saving.value = false;
  }
};

const setStatus = async (status: string) => {
  if (!project.value) return;
  try {
    const fromLabel =
      statusLabelMap[project.value.status] || project.value.status;
    const toLabel = statusLabelMap[status] || status;
    await ElMessageBox.confirm(
      `确认将项目状态从“${fromLabel}”调整为“${toLabel}”吗？`,
      "状态变更确认",
      {
        type: "warning",
        confirmButtonText: "确认变更",
        cancelButtonText: "取消"
      }
    );
    await updateProjectStatus(project.value.id, status);
    message("状态已更新", { type: "success" });
    await loadProjectMain();
  } catch {}
};

const openSectionDrawer = async (section: ProjectSection) => {
  currentSection.value = section;
  sectionStatusValue.value = section.status;
  sectionDrawerVisible.value = true;
  sectionDrawerLoading.value = true;
  try {
    await loadSectionDetailData(section.id);
  } finally {
    sectionDrawerLoading.value = false;
  }
};

const loadSectionDetailData = async (sectionId: number) => {
  const [sectionOperatorsRes, sectionBreakthroughRes] = await Promise.all([
    listOperatorLogs({
      project_id: props.projectId,
      section_id: sectionId,
      page: 1,
      pageSize: 200
    }),
    listBreakthroughReports({
      project_id: props.projectId,
      section_id: sectionId
    })
  ]);
  sectionOperatorLogs.value = sectionOperatorsRes.data;
  sectionBreakthroughReports.value = sectionBreakthroughRes.data;
};

const saveSectionStatus = async () => {
  if (!currentSection.value) return;
  if (
    !sectionStatusValue.value ||
    sectionStatusValue.value === currentSection.value.status
  ) {
    message("状态未变化", { type: "info" });
    return;
  }

  const fromLabel = sectionStatusLabel(currentSection.value.status);
  const toLabel = sectionStatusLabel(sectionStatusValue.value);
  try {
    await ElMessageBox.confirm(
      `确认将标段状态从“${fromLabel}”调整为“${toLabel}”吗？`,
      "标段状态变更确认",
      {
        type: "warning",
        confirmButtonText: "确认变更",
        cancelButtonText: "取消"
      }
    );

    sectionStatusSaving.value = true;
    await updateProjectSection(props.projectId, currentSection.value.id, {
      status: sectionStatusValue.value
    });
    currentSection.value = {
      ...currentSection.value,
      status: sectionStatusValue.value
    };
    const idx = sections.value.findIndex(
      item => item.id === currentSection.value?.id
    );
    if (idx >= 0) {
      sections.value[idx] = {
        ...sections.value[idx],
        status: sectionStatusValue.value
      };
    }
    message("标段状态已更新", { type: "success" });
  } finally {
    sectionStatusSaving.value = false;
  }
};

const openOperatorLogDetail = async (id: number) => {
  operatorLogDetailVisible.value = true;
  operatorLogDetailLoading.value = true;
  try {
    const result = await getOperatorLog(id);
    operatorLogDetail.value = result.data;
  } finally {
    operatorLogDetailLoading.value = false;
  }
};

const resetOperatorLogForm = () => {
  operatorLogForm.value = {
    log_date: "",
    shift: "day",
    weather: "",
    completed_pipe_count: 0,
    cumulative_pipe_count: 0,
    footage_m: undefined,
    issue_summary: "",
    remark: ""
  };
};

const openCreateOperatorLog = () => {
  editingOperatorLogId.value = null;
  resetOperatorLogForm();
  operatorLogDialogVisible.value = true;
};

const openEditOperatorLog = (row: OperatorLog) => {
  editingOperatorLogId.value = row.id;
  operatorLogForm.value = {
    log_date: row.log_date,
    shift: row.shift || "day",
    weather: row.weather || "",
    completed_pipe_count: row.completed_pipe_count,
    cumulative_pipe_count: row.cumulative_pipe_count,
    footage_m: row.footage_m === null ? undefined : row.footage_m,
    issue_summary: row.issue_summary || "",
    remark: row.remark || ""
  };
  operatorLogDialogVisible.value = true;
};

const submitOperatorLog = async () => {
  if (!currentSection.value) return;
  if (!operatorLogForm.value.log_date) {
    message("请填写日志日期", { type: "warning" });
    return;
  }
  operatorLogSubmitting.value = true;
  try {
    const payload = {
      project_id: props.projectId,
      section_id: currentSection.value.id,
      log_date: operatorLogForm.value.log_date,
      shift: operatorLogForm.value.shift,
      weather: operatorLogForm.value.weather || undefined,
      completed_pipe_count: operatorLogForm.value.completed_pipe_count,
      cumulative_pipe_count: operatorLogForm.value.cumulative_pipe_count,
      footage_m: operatorLogForm.value.footage_m,
      issue_summary: operatorLogForm.value.issue_summary || undefined,
      remark: operatorLogForm.value.remark || undefined,
      status: "submitted"
    };
    if (editingOperatorLogId.value) {
      await updateOperatorLog(editingOperatorLogId.value, payload);
      message("施工日志已更新", { type: "success" });
    } else {
      await createOperatorLog(payload);
      message("施工日志已创建", { type: "success" });
    }
    operatorLogDialogVisible.value = false;
    await Promise.all([
      loadSectionDetailData(currentSection.value.id),
      loadProjectLogData()
    ]);
  } finally {
    operatorLogSubmitting.value = false;
  }
};

const resetBreakthroughForm = () => {
  breakthroughForm.value = {
    report_date: "",
    breakthrough_m: undefined,
    summary: "",
    detail: ""
  };
};

const openCreateBreakthrough = () => {
  editingBreakthroughId.value = null;
  resetBreakthroughForm();
  breakthroughDialogVisible.value = true;
};

const openEditBreakthrough = (row: BreakthroughReport) => {
  editingBreakthroughId.value = row.id;
  breakthroughForm.value = {
    report_date: row.report_date,
    breakthrough_m:
      row.breakthrough_m === null ? undefined : row.breakthrough_m,
    summary: row.summary || "",
    detail: row.detail || ""
  };
  breakthroughDialogVisible.value = true;
};

const submitBreakthrough = async () => {
  if (!currentSection.value) return;
  if (!breakthroughForm.value.report_date) {
    message("请填写报告日期", { type: "warning" });
    return;
  }
  breakthroughSubmitting.value = true;
  try {
    const payload = {
      project_id: props.projectId,
      section_id: currentSection.value.id,
      report_date: breakthroughForm.value.report_date,
      breakthrough_m: breakthroughForm.value.breakthrough_m,
      summary: breakthroughForm.value.summary || undefined,
      detail: breakthroughForm.value.detail || undefined,
      status: "submitted"
    };
    if (editingBreakthroughId.value) {
      await updateBreakthroughReport(editingBreakthroughId.value, payload);
      message("贯通报告已更新", { type: "success" });
    } else {
      await createBreakthroughReport(payload);
      message("贯通报告已创建", { type: "success" });
    }
    breakthroughDialogVisible.value = false;
    await Promise.all([
      loadSectionDetailData(currentSection.value.id),
      loadProjectLogData()
    ]);
  } finally {
    breakthroughSubmitting.value = false;
  }
};

const openManagerLogDialog = () => {
  managerLogForm.value = {
    log_date: "",
    title: "",
    detail_html: "",
    risk_note: ""
  };
  managerLogPhotos.value = [];
  managerLogDialogVisible.value = true;
};

const uploadManagerLogPhoto = async (options: UploadRequestOptions) => {
  const rawFile = options.file;
  managerLogUploading.value = true;
  try {
    const signedRes = await createUploadSignature({
      fileName: rawFile.name,
      contentType: rawFile.type,
      category: `manager-log/${props.projectId}`
    });
    const signed = signedRes.data;

    const uploadResp = await fetch(signed.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": rawFile.type || "application/octet-stream",
        Authorization: formatToken(getToken().accessToken)
      },
      body: rawFile
    });

    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }

    managerLogPhotos.value.unshift({
      file_key: signed.key,
      file_url: signed.fileUrl,
      file_name: rawFile.name
    });
    message("日志照片上传成功", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("日志照片上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    managerLogUploading.value = false;
  }
};

const removeManagerLogPhoto = (index: number) => {
  managerLogPhotos.value.splice(index, 1);
};

const submitManagerLog = async () => {
  if (!managerLogForm.value.log_date) {
    message("请填写日志日期", { type: "warning" });
    return;
  }
  creatingManagerLog.value = true;
  try {
    const photos = managerLogPhotos.value.map(item => ({
      file_key: item.file_key
    }));

    await createManagerLog({
      project_id: props.projectId,
      log_date: managerLogForm.value.log_date,
      title: managerLogForm.value.title || undefined,
      detail_html: managerLogForm.value.detail_html || undefined,
      risk_note: managerLogForm.value.risk_note || undefined,
      status: "submitted",
      photos
    });
    message("项目日志创建成功", { type: "success" });
    managerLogDialogVisible.value = false;
    await loadProjectLogData();
  } finally {
    creatingManagerLog.value = false;
  }
};

const openManagerLogDetail = async (id: number) => {
  managerLogDetailVisible.value = true;
  managerLogDetailLoading.value = true;
  try {
    const result = await getManagerLog(id);
    managerLogDetail.value = result.data;
  } finally {
    managerLogDetailLoading.value = false;
  }
};

const quickTriggerSummary = async (reportType: "daily" | "weekly") => {
  const res = await triggerLogSummary({
    report_type: reportType,
    project_id: props.projectId
  });
  message(
    `已触发${reportType === "daily" ? "日报" : "周报"}汇总，任务ID ${res.data.task_id}`,
    {
      type: "success"
    }
  );
};

watch(
  () => props.projectId,
  () => {
    void loadData();
  }
);

onMounted(loadData);
onMounted(loadWecomUsers);
</script>

<template>
  <div v-loading="loading" class="project-panel-page">
    <el-card shadow="never" header="项目信息">
      <el-form label-width="90px">
        <el-form-item label="项目编码">
          <el-input :model-value="project?.project_code" disabled />
        </el-form-item>
        <el-form-item label="项目名称">
          <el-input v-model="form.project_name" />
        </el-form-item>
        <el-form-item label="项目经理">
          <el-select
            v-model="form.manager_userid"
            clearable
            filterable
            placeholder="选择公司人员"
            style="width: 320px"
          >
            <el-option
              v-for="item in wecomUsers"
              :key="item.userid"
              :label="`${item.name} (${item.userid})`"
              :value="item.userid"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="具体位置">
          <el-input
            v-model="form.location_text"
            type="textarea"
            :rows="2"
            placeholder="可填写省市区及详细地址"
          />
        </el-form-item>
        <el-form-item label="项目交底">
          <el-input
            v-model="form.project_briefing"
            type="textarea"
            :rows="3"
            placeholder="填写项目交底/背景说明"
          />
        </el-form-item>
        <el-form-item label="开始时间">
          <el-date-picker
            v-model="form.project_start_at"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择项目开始时间"
          />
        </el-form-item>
        <el-form-item label="项目状态">
          <el-space>
            <el-tag>{{ projectStatusLabel }}</el-tag>
            <el-button size="small" @click="setStatus('planning')"
              >规划中</el-button
            >
            <el-button size="small" @click="setStatus('preparing')"
              >筹备中</el-button
            >
            <el-button size="small" @click="setStatus('active')"
              >施工中</el-button
            >
            <el-button size="small" @click="setStatus('completing')"
              >收尾中</el-button
            >
            <el-button size="small" @click="setStatus('archived')"
              >已归档</el-button
            >
          </el-space>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="saveBase"
            >保存</el-button
          >
        </el-form-item>
      </el-form>
    </el-card>

    <el-card shadow="never" header="标段总览（卡片视图）" class="mt-3">
      <el-empty v-if="sectionMetrics.length === 0" description="暂无标段数据" />
      <div v-else class="section-grid">
        <div
          v-for="item in sectionMetrics"
          :key="item.section.id"
          class="section-card"
          @click="openSectionDrawer(item.section)"
        >
          <div class="section-card__head">
            <div>
              <div class="section-card__code">
                {{ item.section.section_code }}
              </div>
              <div class="section-card__name">
                {{ item.section.section_name }}
              </div>
            </div>
            <el-tag size="small">{{
              sectionStatusLabel(item.section.status)
            }}</el-tag>
          </div>

          <div class="section-card__line">
            <span>顶进进度</span>
            <span>{{ item.progress.toFixed(1) }}%</span>
          </div>
          <el-progress
            :percentage="Number(item.progress.toFixed(1))"
            :stroke-width="12"
            :color="
              item.progress >= 85
                ? '#67c23a'
                : item.progress >= 60
                  ? '#e6a23c'
                  : '#f56c6c'
            "
          />

          <div class="section-card__meta">
            <span>总里程: {{ item.section.section_length || 0 }}m</span>
            <span>累计顶进: {{ item.footage.toFixed(1) }}m</span>
          </div>
          <div class="section-card__meta">
            <span>施工日志: {{ item.logCount }}</span>
            <span>贯通报告: {{ item.breakthroughCount }}</span>
          </div>
          <div class="section-card__meta">
            最近更新: {{ item.latestLogDate }}
          </div>
        </div>
      </div>
    </el-card>

    <el-card shadow="never" header="项目日志一站式视图" class="mt-3">
      <div class="log-toolbar">
        <el-button
          type="primary"
          :disabled="!canWriteProjectLog"
          @click="openManagerLogDialog"
        >
          快速填写项目日志
        </el-button>
        <el-button @click="router.push('/construction/manager-log')"
          >打开项目日志中心</el-button
        >
        <el-button @click="quickTriggerSummary('daily')"
          >触发日报汇总</el-button
        >
        <el-button @click="quickTriggerSummary('weekly')"
          >触发周报汇总</el-button
        >
      </div>

      <el-descriptions :column="2" border class="mb-3">
        <el-descriptions-item label="项目日志总数">{{
          managerLogs.length
        }}</el-descriptions-item>
        <el-descriptions-item label="最新日志日期">{{
          managerLogs[0]?.log_date || "-"
        }}</el-descriptions-item>
      </el-descriptions>

      <el-table :data="managerLogs" max-height="320">
        <el-table-column prop="log_date" label="日期" width="120" />
        <el-table-column
          prop="title"
          label="标题"
          min-width="220"
          show-overflow-tooltip
        />
        <el-table-column
          prop="risk_note"
          label="风险提示"
          min-width="220"
          show-overflow-tooltip
        />
        <el-table-column prop="manager_userid" label="填报人" width="120" />
        <el-table-column label="状态" width="100">
          <template #default="scope">{{
            statusLabel(scope.row.status)
          }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              @click="openManagerLogDetail(scope.row.id)"
              >查看单条日志</el-button
            >
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer
      v-model="sectionDrawerVisible"
      :title="`标段详情 - ${currentSection?.section_code || ''}`"
      size="78%"
      destroy-on-close
    >
      <div v-loading="sectionDrawerLoading">
        <el-descriptions :column="4" border class="mb-3">
          <el-descriptions-item label="标段编码">{{
            currentSection?.section_code
          }}</el-descriptions-item>
          <el-descriptions-item label="标段名称">{{
            currentSection?.section_name
          }}</el-descriptions-item>
          <el-descriptions-item label="里程(m)">{{
            currentSection?.section_length || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{
            sectionStatusLabel(currentSection?.status)
          }}</el-descriptions-item>
        </el-descriptions>

        <el-card shadow="never" class="mb-3" header="标段状态管理">
          <el-space>
            <el-select v-model="sectionStatusValue" style="width: 220px">
              <el-option
                v-for="opt in sectionStatusOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <el-button
              type="primary"
              :loading="sectionStatusSaving"
              @click="saveSectionStatus"
            >
              保存标段状态
            </el-button>
          </el-space>
        </el-card>

        <el-card shadow="never" class="mb-3" header="标段推进轨迹">
          <div class="rail-header">
            <el-tag type="success" effect="light">{{
              sectionDrawerProgress.phase
            }}</el-tag>
            <span class="rail-percent"
              >{{ sectionDrawerProgress.percent.toFixed(1) }}%</span
            >
          </div>

          <div class="rail-track-wrap">
            <div class="rail-track">
              <div
                class="rail-fill"
                :style="{ width: `${sectionDrawerProgress.percent}%` }"
              />
              <div
                v-for="m in sectionProgressMilestones"
                :key="m"
                class="rail-marker"
                :class="{ active: sectionDrawerProgress.percent >= m }"
                :style="{ left: `${m}%` }"
              >
                <span class="rail-dot" />
                <span class="rail-label">{{ m }}%</span>
              </div>
            </div>
          </div>

          <div class="rail-meta">
            <span>总里程：{{ sectionDrawerProgress.sectionLength || 0 }}m</span>
            <span
              >累计顶进：{{ sectionDrawerProgress.advanced.toFixed(1) }}m</span
            >
            <span>剩余：{{ sectionDrawerProgress.remaining.toFixed(1) }}m</span>
          </div>
        </el-card>

        <el-row :gutter="16">
          <el-col :span="14">
            <el-card shadow="never" header="该标段施工日志">
              <div class="section-toolbar mb-3">
                <el-button type="primary" @click="openCreateOperatorLog"
                  >新增施工日志</el-button
                >
              </div>
              <el-table :data="sectionOperatorLogs" max-height="320">
                <el-table-column prop="log_date" label="日期" width="120" />
                <el-table-column label="班次" width="80">
                  <template #default="scope">{{
                    shiftLabel(scope.row.shift)
                  }}</template>
                </el-table-column>
                <el-table-column
                  prop="completed_pipe_count"
                  label="完成管节"
                  width="100"
                />
                <el-table-column
                  prop="cumulative_pipe_count"
                  label="累计管节"
                  width="100"
                />
                <el-table-column prop="footage_m" label="里程(m)" width="100" />
                <el-table-column
                  prop="issue_summary"
                  label="问题摘要"
                  min-width="200"
                  show-overflow-tooltip
                />
                <el-table-column
                  prop="operator_userid"
                  label="填报人"
                  width="120"
                />
                <el-table-column label="操作" width="180" fixed="right">
                  <template #default="scope">
                    <el-button
                      link
                      type="primary"
                      @click="openEditOperatorLog(scope.row)"
                      >编辑</el-button
                    >
                    <el-button
                      link
                      type="primary"
                      @click="openOperatorLogDetail(scope.row.id)"
                    >
                      查看详情
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>

          <el-col :span="10">
            <el-card shadow="never" header="该标段贯通报告">
              <div class="section-toolbar mb-3">
                <el-button type="primary" @click="openCreateBreakthrough"
                  >新增贯通报告</el-button
                >
              </div>
              <el-table :data="sectionBreakthroughReports" max-height="320">
                <el-table-column
                  prop="report_no"
                  label="报告号"
                  min-width="180"
                />
                <el-table-column prop="report_date" label="日期" width="110" />
                <el-table-column
                  prop="breakthrough_m"
                  label="里程(m)"
                  width="100"
                />
                <el-table-column label="状态" width="90">
                  <template #default="scope">{{
                    statusLabel(scope.row.status)
                  }}</template>
                </el-table-column>
                <el-table-column label="操作" width="90" fixed="right">
                  <template #default="scope">
                    <el-button
                      link
                      type="primary"
                      @click="openEditBreakthrough(scope.row)"
                      >编辑</el-button
                    >
                  </template>
                </el-table-column>
              </el-table>
            </el-card>
          </el-col>
        </el-row>
      </div>
    </el-drawer>

    <el-dialog
      v-model="managerLogDialogVisible"
      title="快速填写项目日志"
      width="720px"
    >
      <el-form label-width="110px">
        <el-form-item label="日志日期" required>
          <el-date-picker
            v-model="managerLogForm.log_date"
            type="date"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="managerLogForm.title" />
        </el-form-item>
        <el-form-item label="日志正文">
          <el-input
            v-model="managerLogForm.detail_html"
            type="textarea"
            :rows="6"
          />
        </el-form-item>
        <el-form-item label="风险说明">
          <el-input
            v-model="managerLogForm.risk_note"
            type="textarea"
            :rows="3"
          />
        </el-form-item>
        <el-form-item label="上传照片">
          <el-upload
            action="#"
            :show-file-list="false"
            :http-request="uploadManagerLogPhoto"
            :disabled="managerLogUploading"
            accept="image/*"
          >
            <el-button type="primary" :loading="managerLogUploading"
              >上传照片</el-button
            >
          </el-upload>
          <div v-if="managerLogPhotos.length" class="photo-list">
            <div
              v-for="(item, index) in managerLogPhotos"
              :key="item.file_key"
              class="photo-item"
            >
              <el-link :href="item.file_url" target="_blank">{{
                item.file_name
              }}</el-link>
              <el-button
                link
                type="danger"
                @click="removeManagerLogPhoto(index)"
                >移除</el-button
              >
            </div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="managerLogDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="creatingManagerLog"
          @click="submitManagerLog"
          >提交日志</el-button
        >
      </template>
    </el-dialog>

    <el-dialog
      v-model="operatorLogDialogVisible"
      :title="editingOperatorLogId ? '编辑施工日志' : '新增施工日志'"
      width="720px"
    >
      <el-form label-width="120px">
        <el-form-item label="日志日期" required>
          <el-date-picker
            v-model="operatorLogForm.log_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item label="班次">
          <el-select v-model="operatorLogForm.shift" style="width: 160px">
            <el-option label="day" value="day" />
            <el-option label="night" value="night" />
          </el-select>
        </el-form-item>
        <el-form-item label="天气">
          <el-input v-model="operatorLogForm.weather" style="width: 220px" />
        </el-form-item>
        <el-form-item label="当班下管数量">
          <el-input-number
            v-model="operatorLogForm.completed_pipe_count"
            :min="0"
          />
        </el-form-item>
        <el-form-item label="累计下管数量">
          <el-input-number
            v-model="operatorLogForm.cumulative_pipe_count"
            :min="0"
          />
        </el-form-item>
        <el-form-item label="当日进尺(m)">
          <el-input-number
            v-model="operatorLogForm.footage_m"
            :min="0"
            :precision="2"
          />
        </el-form-item>
        <el-form-item label="问题摘要">
          <el-input
            v-model="operatorLogForm.issue_summary"
            type="textarea"
            :rows="3"
          />
        </el-form-item>
        <el-form-item label="备注">
          <el-input
            v-model="operatorLogForm.remark"
            type="textarea"
            :rows="2"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="operatorLogDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="operatorLogSubmitting"
          @click="submitOperatorLog"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="breakthroughDialogVisible"
      :title="editingBreakthroughId ? '编辑贯通报告' : '新增贯通报告'"
      width="700px"
    >
      <el-form label-width="110px">
        <el-form-item label="报告日期" required>
          <el-date-picker
            v-model="breakthroughForm.report_date"
            type="date"
            value-format="YYYY-MM-DD"
            style="width: 220px"
          />
        </el-form-item>
        <el-form-item label="贯通里程(m)">
          <el-input-number
            v-model="breakthroughForm.breakthrough_m"
            :min="0"
            :precision="2"
          />
        </el-form-item>
        <el-form-item label="摘要">
          <el-input v-model="breakthroughForm.summary" />
        </el-form-item>
        <el-form-item label="详情">
          <el-input
            v-model="breakthroughForm.detail"
            type="textarea"
            :rows="4"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="breakthroughDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="breakthroughSubmitting"
          @click="submitBreakthrough"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <el-drawer
      v-model="managerLogDetailVisible"
      title="单条项目日志"
      size="560px"
      destroy-on-close
    >
      <div v-loading="managerLogDetailLoading">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="日期">{{
            managerLogDetail?.log_date || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="标题">{{
            managerLogDetail?.title || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="填报人">{{
            managerLogDetail?.manager_userid || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{
            managerLogDetail?.status || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="风险说明">{{
            managerLogDetail?.risk_note || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="日志正文">
            <div class="log-detail-content">
              {{ managerLogDetail?.detail_html || "-" }}
            </div>
          </el-descriptions-item>
          <el-descriptions-item label="照片数量">
            {{ managerLogDetail?.photos?.length || 0 }}
          </el-descriptions-item>
        </el-descriptions>
      </div>
    </el-drawer>

    <el-drawer
      v-model="operatorLogDetailVisible"
      title="单条施工日志"
      size="560px"
      destroy-on-close
    >
      <div v-loading="operatorLogDetailLoading">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="日期">{{
            operatorLogDetail?.log_date || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="班次">{{
            shiftLabel(operatorLogDetail?.shift)
          }}</el-descriptions-item>
          <el-descriptions-item label="填报人">{{
            operatorLogDetail?.operator_userid || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="完成管节">{{
            operatorLogDetail?.completed_pipe_count ?? "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="累计管节">{{
            operatorLogDetail?.cumulative_pipe_count ?? "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="当日顶进(m)">{{
            operatorLogDetail?.footage_m ?? "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="问题摘要">{{
            operatorLogDetail?.issue_summary || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{
            operatorLogDetail?.remark || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{
            operatorLogDetail?.status || "-"
          }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.mb-3 {
  margin-bottom: 12px;
}

.section-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.section-card {
  border: 1px solid #e7ded0;
  border-radius: 10px;
  padding: 14px;
  background: linear-gradient(180deg, #fffefc 0%, #fff8ef 100%);
  cursor: pointer;
  transition: transform 0.2s ease;
}

.section-card:hover {
  transform: translateY(-3px);
}

.section-card__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.section-card__code {
  font-size: 12px;
  color: #8a6f42;
}

.section-card__name {
  margin-top: 2px;
  font-size: 15px;
  font-weight: 600;
  color: #2a241d;
}

.section-card__line {
  margin-top: 10px;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #6e6458;
}

.section-card__meta {
  margin-top: 8px;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #6e6458;
}

.log-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.section-toolbar {
  display: flex;
  justify-content: flex-end;
}

.log-detail-content {
  white-space: pre-wrap;
  line-height: 1.5;
}

.photo-list {
  margin-top: 8px;
  width: 100%;
}

.photo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
}

.rail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.rail-percent {
  font-size: 22px;
  font-weight: 700;
  color: #2f7a53;
}

.rail-track-wrap {
  padding: 8px 4px 24px;
}

.rail-track {
  position: relative;
  height: 14px;
  border-radius: 999px;
  background: linear-gradient(90deg, #f8e2c1 0%, #efe6d7 100%);
}

.rail-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: linear-gradient(90deg, #e6a23c 0%, #67c23a 100%);
}

.rail-marker {
  position: absolute;
  top: -7px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.rail-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #d3c7b4;
  background: #fff;
}

.rail-marker.active .rail-dot {
  border-color: #2f7a53;
  background: #2f7a53;
}

.rail-label {
  font-size: 12px;
  color: #7c6f5b;
}

.rail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  color: #6e6458;
  font-size: 12px;
}
</style>
