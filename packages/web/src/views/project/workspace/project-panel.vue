<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import QRCode from "qrcode";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import echarts from "@/plugins/echarts";
import { message } from "@/utils/message";
import { ElMessageBox } from "element-plus";
import { statusLabel } from "@/utils/enum-labels";
import { useUserStoreHook } from "@/store/modules/user";
import { formatToken, getToken } from "@/utils/auth";
import {
  buildSectionProgressInsight,
  type SectionTrendRow
} from "@/utils/project-section-progress";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import {
  createProjectSection,
  getProjectById,
  createProjectPublicLogLink,
  listExternalLogSubmissions,
  listProjectPublicLogLinks,
  listProjectSections,
  reviewExternalLogSubmission,
  updateProjectPublicLogLink,
  updateProjectSection,
  updateProject,
  updateProjectStatus,
  type ExternalLogSubmission,
  type Project,
  type ProjectPublicLogLink,
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
const loadError = ref("");
const creatingManagerLog = ref(false);
const project = ref<Project | null>(null);
const sections = ref<ProjectSection[]>([]);
const operatorLogs = ref<OperatorLog[]>([]);
const managerLogs = ref<ManagerLog[]>([]);
const breakthroughReports = ref<BreakthroughReport[]>([]);
const publicLogLinks = ref<ProjectPublicLogLink[]>([]);
const publicLinkDialogVisible = ref(false);
const publicLinkLoading = ref(false);
const publicLinkExpiresAt = ref("");
const generatedPublicUrl = ref("");
const generatedPublicQr = ref("");
const externalSubmissions = ref<ExternalLogSubmission[]>([]);
const externalSubmissionsLoading = ref(false);
const externalReviewingId = ref<number | null>(null);
const externalAiDetailVisible = ref(false);
const externalAiDetailRow = ref<ExternalLogSubmission | null>(null);

const sectionDrawerVisible = ref(false);
const sectionDrawerLoading = ref(false);
const sectionDrawerError = ref("");
const createSectionDialogVisible = ref(false);
const creatingSection = ref(false);
const currentSection = ref<ProjectSection | null>(null);
const sectionOperatorLogs = ref<OperatorLog[]>([]);
const sectionBreakthroughReports = ref<BreakthroughReport[]>([]);
const sectionStatusSaving = ref(false);
const sectionStatusValue = ref("");
const sectionBaseSaving = ref(false);
const sectionBaseForm = ref({
  section_name: "",
  section_length: undefined as number | undefined,
  design_slope: undefined as number | undefined,
  pipe_diameter_mm: undefined as number | undefined,
  pipe_material: "",
  pipe_model: "",
  soil_type: [] as string[],
  jacking_method: ""
});
const sectionTrendChartRef = ref<HTMLElement | null>(null);
const sectionTrendGroup = ref<"progress" | "equipment" | "deviation">(
  "progress"
);
let sectionTrendChart: ReturnType<typeof echarts.init> | null = null;

const sectionTrendGroupOptions = [
  { label: "进度", value: "progress" },
  { label: "设备", value: "equipment" },
  { label: "偏差", value: "deviation" }
];

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

const createSectionForm = ref({
  section_code: "",
  section_name: "",
  section_length: undefined as number | undefined,
  status: "planning",
  design_slope: undefined as number | undefined,
  pipe_diameter_mm: undefined as number | undefined,
  pipe_material: "",
  pipe_model: "",
  soil_type: [] as string[],
  jacking_method: ""
});

const soilTypeOptions = [
  "粘土",
  "粉土",
  "细砂",
  "中砂",
  "粗砂",
  "细砾",
  "中砾",
  "粗砾",
  "卵石",
  "漂石",
  "强风化岩石",
  "中风化岩石",
  "弱风化岩石",
  "岩石"
];

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
  cumulative_footage_m: undefined as number | undefined,
  main_thrust_text: "",
  chamber_pressure_mpa: undefined as number | undefined,
  cutter_current_text: "",
  cutter_frequency_hz: undefined as number | undefined,
  horizontal_deviation_direction: "",
  horizontal_deviation_mm: undefined as number | undefined,
  vertical_deviation_direction: "",
  vertical_deviation_mm: undefined as number | undefined,
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

const canManageSections = computed(() => {
  const roles = userStore.roles ?? [];
  return roles.some(role =>
    ["super_admin", "manager", "site_manager"].includes(role)
  );
});

const activePublicLogLink = computed(() =>
  publicLogLinks.value.find(item => item.status === "active")
);

const pendingExternalSubmissionCount = computed(
  () =>
    externalSubmissions.value.filter(item =>
      ["pending_ai_review", "needs_manual_review", "ai_approved"].includes(
        item.review_status
      )
    ).length
);

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

const externalReviewStatusLabelMap: Record<string, string> = {
  pending_ai_review: "AI审计中",
  ai_approved: "AI低风险",
  needs_manual_review: "需人工复核",
  approved_auto: "AI自动通过",
  approved_manual: "人工通过",
  rejected: "已驳回"
};

type AiReviewIssue = {
  severity?: string;
  message?: string;
};

const aiIssueSeverityLabelMap: Record<string, string> = {
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低",
  info: "提示"
};

const aiIssueSeverityWeightMap: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
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

const externalReviewStatusLabel = (status: string | null | undefined) => {
  if (!status) return "-";
  return externalReviewStatusLabelMap[status] || status;
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

const deviationDirectionOptions = [
  { value: "left", label: "左偏" },
  { value: "right", label: "右偏" },
  { value: "high", label: "高" },
  { value: "low", label: "低" }
];

const horizontalDeviationOptions = deviationDirectionOptions.filter(item =>
  ["left", "right"].includes(item.value)
);

const verticalDeviationOptions = deviationDirectionOptions.filter(item =>
  ["high", "low"].includes(item.value)
);

const deviationDirectionLabel = (value: string | null | undefined) => {
  if (!value) return "";
  return (
    deviationDirectionOptions.find(item => item.value === value)?.label || value
  );
};

const formatDeviation = (row: OperatorLog | null | undefined) => {
  if (!row) return "-";
  const horizontalDirection =
    row.horizontal_deviation_direction || row.deviation_direction || "";
  const horizontalValue =
    row.horizontal_deviation_mm ?? row.deviation_value_mm ?? null;
  const parts = [
    horizontalDirection && typeof horizontalValue === "number"
      ? `${deviationDirectionLabel(horizontalDirection)}${horizontalValue}mm`
      : "",
    row.vertical_deviation_direction &&
    typeof row.vertical_deviation_mm === "number"
      ? `${deviationDirectionLabel(row.vertical_deviation_direction)}${row.vertical_deviation_mm}mm`
      : ""
  ].filter(Boolean);
  return parts.length ? parts.join("，") : "-";
};

const resolveAdvancedFootage = (logs: OperatorLog[]) => {
  const cumulativeValues = logs
    .map(item => item.cumulative_footage_m)
    .filter((value): value is number => typeof value === "number");
  if (cumulativeValues.length > 0) return Math.max(...cumulativeValues);
  return logs.reduce((sum, item) => sum + (item.footage_m || 0), 0);
};

const sectionDrawerProgress = computed(() => {
  const sectionLength = currentSection.value?.section_length || 0;
  const advanced = resolveAdvancedFootage(sectionOperatorLogs.value);
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

const sectionProgressInsight = computed(() =>
  buildSectionProgressInsight(
    currentSection.value?.section_length,
    sectionOperatorLogs.value
  )
);

const sectionTrendSummary = computed(
  () => sectionProgressInsight.value.summary
);

const formatTrendNumber = (
  value: number | null | undefined,
  suffix = "",
  digits = 1
) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value.toFixed(digits)}${suffix}`;
};

const formatEstimateDays = (value: number | null) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${value}天`;
};

const formatTrendDeviation = (row: SectionTrendRow) => {
  const parts = [
    typeof row.horizontalDeviationMm === "number"
      ? `水平${row.horizontalDeviationMm > 0 ? "+" : ""}${row.horizontalDeviationMm}mm`
      : "",
    typeof row.verticalDeviationMm === "number"
      ? `垂直${row.verticalDeviationMm > 0 ? "+" : ""}${row.verticalDeviationMm}mm`
      : ""
  ].filter(Boolean);
  return parts.length ? parts.join("，") : "-";
};

const buildSectionTrendOption = () => {
  const rows = sectionProgressInsight.value.trendRows;
  const labels = rows.map(item => item.label);
  const emptyGraphic = rows.length
    ? undefined
    : {
        type: "text",
        left: "center",
        top: "middle",
        style: {
          text: "暂无施工日志趋势数据",
          fill: "#909399",
          fontSize: 14
        }
      };

  const base = {
    tooltip: { trigger: "axis" },
    legend: { top: 0 },
    grid: { top: 48, right: 48, bottom: 42, left: 56 },
    dataZoom:
      rows.length > 8
        ? [
            {
              type: "inside",
              start: Math.max(0, 100 - (8 / rows.length) * 100),
              end: 100
            },
            { type: "slider", height: 18, bottom: 6 }
          ]
        : [],
    graphic: emptyGraphic,
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: labels,
      axisLabel: { rotate: rows.length > 5 ? 28 : 0 }
    }
  };

  if (sectionTrendGroup.value === "equipment") {
    return {
      ...base,
      legend: { top: 0, data: ["泥仓压力", "刀盘频率", "刀盘电流"] },
      yAxis: [
        { type: "value", name: "MPa" },
        { type: "value", name: "Hz/A" }
      ],
      series: [
        {
          name: "泥仓压力",
          type: "line",
          smooth: true,
          data: rows.map(item => item.chamberPressureMpa),
          itemStyle: { color: "#2f6f6d" }
        },
        {
          name: "刀盘频率",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          data: rows.map(item => item.cutterFrequencyHz),
          itemStyle: { color: "#b66b3d" }
        },
        {
          name: "刀盘电流",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          data: rows.map(item => item.cutterCurrentA),
          itemStyle: { color: "#5b6fa8" }
        }
      ]
    };
  }

  if (sectionTrendGroup.value === "deviation") {
    return {
      ...base,
      legend: { top: 0, data: ["水平偏差", "垂直偏差"] },
      yAxis: [{ type: "value", name: "mm" }],
      series: [
        {
          name: "水平偏差",
          type: "line",
          smooth: true,
          data: rows.map(item => item.horizontalDeviationMm),
          itemStyle: { color: "#3f7f72" }
        },
        {
          name: "垂直偏差",
          type: "line",
          smooth: true,
          data: rows.map(item => item.verticalDeviationMm),
          itemStyle: { color: "#b35f49" }
        }
      ]
    };
  }

  return {
    ...base,
    legend: { top: 0, data: ["累计顶进", "本班顶进", "完成管节"] },
    yAxis: [
      { type: "value", name: "米" },
      { type: "value", name: "节" }
    ],
    series: [
      {
        name: "累计顶进",
        type: "line",
        smooth: true,
        data: rows.map(item => item.cumulativeFootageM),
        areaStyle: { opacity: 0.08 },
        itemStyle: { color: "#2f6f6d" }
      },
      {
        name: "本班顶进",
        type: "line",
        smooth: true,
        data: rows.map(item => item.footageM),
        itemStyle: { color: "#c58a3a" }
      },
      {
        name: "完成管节",
        type: "line",
        yAxisIndex: 1,
        smooth: true,
        data: rows.map(item => item.completedPipeCount),
        itemStyle: { color: "#6672a7" }
      }
    ]
  };
};

const renderSectionTrendChart = async () => {
  await nextTick();
  if (!sectionDrawerVisible.value || !sectionTrendChartRef.value) return;
  if (!sectionTrendChart) {
    sectionTrendChart = echarts.init(sectionTrendChartRef.value);
  }
  sectionTrendChart.setOption(buildSectionTrendOption(), true);
  sectionTrendChart.resize();
};

const sectionMetrics = computed(() => {
  return sections.value.map(section => {
    const sectionLogs = operatorLogs.value.filter(
      item => item.section_id === section.id
    );
    const footage = resolveAdvancedFootage(sectionLogs);
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

const sectionResultLabel = computed(() => {
  if (loading.value) return "正在加载标段数据";
  if (loadError.value) return "标段数据加载失败";
  return `已返回 ${sectionMetrics.value.length} 个标段`;
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

const loadPublicLogLinks = async () => {
  const result = await listProjectPublicLogLinks(props.projectId);
  publicLogLinks.value = result.data;
};

const loadExternalSubmissions = async () => {
  externalSubmissionsLoading.value = true;
  try {
    const result = await listExternalLogSubmissions(props.projectId, {
      page: 1,
      pageSize: 100
    });
    externalSubmissions.value = result.data;
  } finally {
    externalSubmissionsLoading.value = false;
  }
};

const loadData = async () => {
  if (!props.projectId) return;
  loading.value = true;
  loadError.value = "";
  try {
    await Promise.all([
      loadProjectMain(),
      loadProjectLogData(),
      loadPublicLogLinks(),
      loadExternalSubmissions()
    ]);
  } catch {
    loadError.value = "项目工作区数据加载失败，请稍后重试。";
    message(loadError.value, { type: "error" });
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

const parseSoilTypes = (value: string | null | undefined) => {
  if (!value) return [];
  return value
    .split(/[、,，]/)
    .map(item => item.trim())
    .filter(Boolean);
};

const syncSectionBaseForm = (section: ProjectSection) => {
  sectionBaseForm.value = {
    section_name: section.section_name || "",
    section_length:
      section.section_length === null || section.section_length === undefined
        ? undefined
        : section.section_length,
    design_slope:
      section.design_slope === null || section.design_slope === undefined
        ? undefined
        : section.design_slope,
    pipe_diameter_mm:
      section.pipe_diameter_mm === null ||
      section.pipe_diameter_mm === undefined
        ? undefined
        : section.pipe_diameter_mm,
    pipe_material: section.pipe_material || "",
    pipe_model: section.pipe_model || "",
    soil_type: parseSoilTypes(section.soil_type),
    jacking_method: section.jacking_method || ""
  };
};

const openSectionDrawer = async (section: ProjectSection) => {
  currentSection.value = section;
  sectionStatusValue.value = section.status;
  syncSectionBaseForm(section);
  sectionDrawerVisible.value = true;
  sectionDrawerLoading.value = true;
  sectionDrawerError.value = "";
  try {
    await loadSectionDetailData(section.id);
  } catch {
    sectionOperatorLogs.value = [];
    sectionBreakthroughReports.value = [];
    sectionDrawerError.value = "标段详情加载失败，请刷新后重试。";
    message(sectionDrawerError.value, { type: "error" });
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

const saveSectionBase = async () => {
  if (!currentSection.value) return;
  const formData = sectionBaseForm.value;
  const sectionName = formData.section_name.trim();
  if (!sectionName) {
    message("请填写标段名称", { type: "warning" });
    return;
  }

  sectionBaseSaving.value = true;
  try {
    const payload = {
      section_name: sectionName,
      section_length: formData.section_length ?? null,
      design_slope: formData.design_slope ?? null,
      pipe_diameter_mm: formData.pipe_diameter_mm ?? null,
      pipe_material: formData.pipe_material.trim() || null,
      pipe_model: formData.pipe_model.trim() || null,
      soil_type: formData.soil_type.length
        ? formData.soil_type.join("、")
        : null,
      jacking_method: formData.jacking_method.trim() || null
    };
    await updateProjectSection(
      props.projectId,
      currentSection.value.id,
      payload
    );
    currentSection.value = {
      ...currentSection.value,
      ...payload
    };
    const idx = sections.value.findIndex(
      item => item.id === currentSection.value?.id
    );
    if (idx >= 0) {
      sections.value[idx] = {
        ...sections.value[idx],
        ...payload
      };
    }
    message("标段基础信息已保存", { type: "success" });
  } catch {
    message("标段基础信息保存失败，请稍后重试", { type: "error" });
  } finally {
    sectionBaseSaving.value = false;
  }
};

const resetCreateSectionForm = () => {
  createSectionForm.value = {
    section_code: "",
    section_name: "",
    section_length: undefined,
    status: "planning",
    design_slope: undefined,
    pipe_diameter_mm: undefined,
    pipe_material: "",
    pipe_model: "",
    soil_type: [],
    jacking_method: ""
  };
};

const openCreateSectionDialog = () => {
  resetCreateSectionForm();
  createSectionDialogVisible.value = true;
};

const submitCreateSection = async () => {
  const formData = createSectionForm.value;
  const sectionCode = formData.section_code.trim();
  const sectionName = formData.section_name.trim();
  if (!sectionCode) {
    message("请填写标段编码", { type: "warning" });
    return;
  }
  if (!sectionName) {
    message("请填写标段名称", { type: "warning" });
    return;
  }

  creatingSection.value = true;
  try {
    await createProjectSection(props.projectId, {
      section_code: sectionCode,
      section_name: sectionName,
      section_length: formData.section_length ?? null,
      status: formData.status,
      design_slope: formData.design_slope ?? null,
      pipe_diameter_mm: formData.pipe_diameter_mm ?? null,
      pipe_material: formData.pipe_material.trim() || null,
      pipe_model: formData.pipe_model.trim() || null,
      soil_type: formData.soil_type.length
        ? formData.soil_type.join("、")
        : null,
      jacking_method: formData.jacking_method.trim() || null
    });
    message("标段已创建", { type: "success" });
    createSectionDialogVisible.value = false;
    await loadProjectMain();
  } catch {
    message("标段创建失败，请稍后重试", { type: "error" });
  } finally {
    creatingSection.value = false;
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
    cumulative_footage_m: undefined,
    main_thrust_text: "",
    chamber_pressure_mpa: undefined,
    cutter_current_text: "",
    cutter_frequency_hz: undefined,
    horizontal_deviation_direction: "",
    horizontal_deviation_mm: undefined,
    vertical_deviation_direction: "",
    vertical_deviation_mm: undefined,
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
    cumulative_footage_m:
      row.cumulative_footage_m === null ? undefined : row.cumulative_footage_m,
    main_thrust_text: row.main_thrust_text || "",
    chamber_pressure_mpa:
      row.chamber_pressure_mpa === null ? undefined : row.chamber_pressure_mpa,
    cutter_current_text: row.cutter_current_text || "",
    cutter_frequency_hz:
      row.cutter_frequency_hz === null ? undefined : row.cutter_frequency_hz,
    horizontal_deviation_direction:
      row.horizontal_deviation_direction || row.deviation_direction || "",
    horizontal_deviation_mm:
      typeof row.horizontal_deviation_mm === "number"
        ? row.horizontal_deviation_mm
        : (row.deviation_value_mm ?? undefined),
    vertical_deviation_direction: row.vertical_deviation_direction || "",
    vertical_deviation_mm:
      row.vertical_deviation_mm === null
        ? undefined
        : row.vertical_deviation_mm,
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
      cumulative_footage_m: operatorLogForm.value.cumulative_footage_m,
      main_thrust_text: operatorLogForm.value.main_thrust_text || undefined,
      chamber_pressure_mpa: operatorLogForm.value.chamber_pressure_mpa,
      cutter_current_text:
        operatorLogForm.value.cutter_current_text || undefined,
      cutter_frequency_hz: operatorLogForm.value.cutter_frequency_hz,
      horizontal_deviation_direction:
        operatorLogForm.value.horizontal_deviation_direction || undefined,
      horizontal_deviation_mm: operatorLogForm.value.horizontal_deviation_mm,
      vertical_deviation_direction:
        operatorLogForm.value.vertical_deviation_direction || undefined,
      vertical_deviation_mm: operatorLogForm.value.vertical_deviation_mm,
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

    const uploadResp = await fetch(resolveUploadUrl(signed.uploadUrl), {
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

const buildPublicLogUrl = (token: string) => {
  return `${window.location.origin}${window.location.pathname}#/public/project-log/${token}`;
};

const openPublicLinkDialog = async () => {
  publicLinkDialogVisible.value = true;
  generatedPublicUrl.value = "";
  generatedPublicQr.value = "";
  await loadPublicLogLinks();
  if (activePublicLogLink.value?.token) {
    await showPublicLogLinkQr(activePublicLogLink.value);
  }
};

const showPublicLogLinkQr = async (link: ProjectPublicLogLink) => {
  if (!link.token) {
    generatedPublicUrl.value = "";
    generatedPublicQr.value = "";
    message("该二维码为旧数据，未保存可打印链接，请重新生成一次", {
      type: "warning"
    });
    return;
  }
  generatedPublicUrl.value = buildPublicLogUrl(link.token);
  generatedPublicQr.value = await QRCode.toDataURL(generatedPublicUrl.value, {
    margin: 1,
    width: 240
  });
};

const generatePublicLogLink = async () => {
  publicLinkLoading.value = true;
  try {
    const result = await createProjectPublicLogLink(props.projectId, {
      allowed_log_types: ["operator_log", "project_log"],
      expires_at: publicLinkExpiresAt.value || null
    });
    message("外包日志二维码已生成，旧二维码已失效", { type: "success" });
    await loadPublicLogLinks();
    const nextLink = publicLogLinks.value.find(
      item => item.id === result.data.id
    );
    if (nextLink) await showPublicLogLinkQr(nextLink);
    else {
      generatedPublicUrl.value = buildPublicLogUrl(result.data.token);
      generatedPublicQr.value = await QRCode.toDataURL(
        generatedPublicUrl.value,
        {
          margin: 1,
          width: 240
        }
      );
    }
  } finally {
    publicLinkLoading.value = false;
  }
};

const revokePublicLogLink = async (link: ProjectPublicLogLink) => {
  publicLinkLoading.value = true;
  try {
    await updateProjectPublicLogLink(props.projectId, link.id, {
      status: "revoked"
    });
    message("外包日志二维码已停用", { type: "success" });
    await loadPublicLogLinks();
  } finally {
    publicLinkLoading.value = false;
  }
};

const printPublicQr = () => {
  window.print();
};

const reviewExternalSubmission = async (
  row: ExternalLogSubmission,
  action: "approve" | "reject"
) => {
  externalReviewingId.value = row.id;
  try {
    await reviewExternalLogSubmission(props.projectId, row.id, {
      action,
      comment:
        action === "approve"
          ? "管理员复核通过外包日志"
          : "管理员复核驳回外包日志"
    });
    message(action === "approve" ? "外包日志已通过" : "外包日志已驳回", {
      type: "success"
    });
    await Promise.all([loadExternalSubmissions(), loadProjectLogData()]);
  } finally {
    externalReviewingId.value = null;
  }
};

const parseAiIssues = (row: ExternalLogSubmission): AiReviewIssue[] => {
  if (!row.ai_review_result_json) return [];
  try {
    const parsed = JSON.parse(row.ai_review_result_json) as {
      issues?: AiReviewIssue[];
    };
    return Array.isArray(parsed.issues) ? parsed.issues : [];
  } catch {
    return [];
  }
};

const externalAiDetailIssues = computed(() =>
  externalAiDetailRow.value ? parseAiIssues(externalAiDetailRow.value) : []
);

const externalSubmissionReviewed = (row: ExternalLogSubmission) =>
  ["approved_auto", "approved_manual", "rejected"].includes(row.review_status);

const openExternalAiDetail = (row: ExternalLogSubmission) => {
  externalAiDetailRow.value = row;
  externalAiDetailVisible.value = true;
};

const hasExternalAiDetail = (row: ExternalLogSubmission) =>
  Boolean(
    row.ai_review_summary ||
    row.ai_review_result_json ||
    (row.ai_review_score !== null && row.ai_review_score !== undefined) ||
    row.ai_review_risk_level
  );

const aiIssueSeverityLabel = (severity: string | undefined) => {
  const key = (severity || "info").toLowerCase();
  return aiIssueSeverityLabelMap[key] || severity || "提示";
};

const aiIssueSeverityTagType = (severity: string | undefined) => {
  const key = (severity || "info").toLowerCase();
  if (["critical", "high"].includes(key)) return "danger";
  if (key === "medium") return "warning";
  if (key === "low") return "success";
  return "info";
};

const highestAiIssueSeverity = (row: ExternalLogSubmission) => {
  const issues = parseAiIssues(row);
  return issues.reduce<string | undefined>((current, item) => {
    const itemKey = (item.severity || "info").toLowerCase();
    const currentKey = (current || "info").toLowerCase();
    return (aiIssueSeverityWeightMap[itemKey] || 1) >
      (aiIssueSeverityWeightMap[currentKey] || 1)
      ? item.severity
      : current;
  }, undefined);
};

watch(
  () => props.projectId,
  () => {
    void loadData();
  }
);

watch(sectionProgressInsight, () => {
  void renderSectionTrendChart();
});

watch(sectionTrendGroup, () => {
  void renderSectionTrendChart();
});

watch(sectionDrawerVisible, visible => {
  if (visible) {
    void renderSectionTrendChart();
    return;
  }
  sectionTrendChart?.dispose();
  sectionTrendChart = null;
});

const resizeSectionTrendChart = () => {
  sectionTrendChart?.resize();
};

onMounted(loadData);
onMounted(loadWecomUsers);
onMounted(() => {
  window.addEventListener("resize", resizeSectionTrendChart);
});

onUnmounted(() => {
  window.removeEventListener("resize", resizeSectionTrendChart);
  sectionTrendChart?.dispose();
  sectionTrendChart = null;
});
</script>

<template>
  <div v-loading="loading" class="project-panel-page">
    <el-alert
      v-if="loadError"
      type="error"
      show-icon
      :closable="false"
      class="mb-3"
      :title="loadError"
    >
      <template #default>
        <el-button link type="primary" @click="loadData">重新加载</el-button>
      </template>
    </el-alert>

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

    <el-card shadow="never" header="外包日志入口与AI复核" class="mt-3">
      <div class="external-log-toolbar">
        <el-space wrap>
          <el-button type="primary" @click="openPublicLinkDialog">
            打印外包日志二维码
          </el-button>
          <el-button
            :loading="externalSubmissionsLoading"
            @click="loadExternalSubmissions"
          >
            刷新外包提交
          </el-button>
          <el-tag :type="activePublicLogLink ? 'success' : 'info'">
            {{ activePublicLogLink ? "二维码已启用" : "暂无可用二维码" }}
          </el-tag>
          <el-tag v-if="pendingExternalSubmissionCount" type="warning">
            待处理 {{ pendingExternalSubmissionCount }}
          </el-tag>
        </el-space>
      </div>

      <el-table
        v-loading="externalSubmissionsLoading"
        :data="externalSubmissions"
        max-height="360"
        class="mt-3"
      >
        <el-table-column prop="created_at" label="提交时间" width="170" />
        <el-table-column prop="submitter_name" label="填报人" width="120" />
        <el-table-column
          prop="submitter_company"
          label="外包单位"
          min-width="150"
          show-overflow-tooltip
        />
        <el-table-column label="标段" min-width="160">
          <template #default="scope">
            {{ scope.row.section_code || "-" }}
            {{ scope.row.section_name || "" }}
          </template>
        </el-table-column>
        <el-table-column prop="log_date" label="日期" width="110" />
        <el-table-column label="审计状态" width="120">
          <template #default="scope">
            {{ externalReviewStatusLabel(scope.row.review_status) }}
          </template>
        </el-table-column>
        <el-table-column prop="ai_review_score" label="AI分" width="80" />
        <el-table-column label="AI摘要" min-width="260">
          <template #default="scope">
            <div class="external-ai-summary">
              <span class="external-ai-summary__text">
                {{ scope.row.ai_review_summary || "-" }}
              </span>
              <el-button
                v-if="hasExternalAiDetail(scope.row)"
                link
                type="primary"
                @click="openExternalAiDetail(scope.row)"
              >
                详情
              </el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="AI问题" min-width="220">
          <template #default="scope">
            <div
              v-if="parseAiIssues(scope.row).length === 0"
              class="external-ai-issues"
            >
              <el-tag size="small" type="info">无问题</el-tag>
            </div>
            <template v-else>
              <div class="external-ai-issues">
                <el-tag
                  size="small"
                  :type="
                    aiIssueSeverityTagType(highestAiIssueSeverity(scope.row))
                  "
                >
                  {{ parseAiIssues(scope.row).length }} 个问题
                </el-tag>
                <span class="external-ai-issues__preview">
                  {{ parseAiIssues(scope.row)[0]?.message || "查看详情" }}
                </span>
              </div>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="scope">
            <el-button
              link
              type="primary"
              :loading="externalReviewingId === scope.row.id"
              :disabled="externalSubmissionReviewed(scope.row)"
              @click="reviewExternalSubmission(scope.row, 'approve')"
            >
              通过
            </el-button>
            <el-button
              link
              type="danger"
              :loading="externalReviewingId === scope.row.id"
              :disabled="externalSubmissionReviewed(scope.row)"
              @click="reviewExternalSubmission(scope.row, 'reject')"
            >
              驳回
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="externalAiDetailVisible"
      title="AI复核详情"
      width="min(760px, 92vw)"
    >
      <template v-if="externalAiDetailRow">
        <el-descriptions :column="3" border>
          <el-descriptions-item label="审计状态">
            {{ externalReviewStatusLabel(externalAiDetailRow.review_status) }}
          </el-descriptions-item>
          <el-descriptions-item label="AI分">
            {{ externalAiDetailRow.ai_review_score ?? "-" }}
          </el-descriptions-item>
          <el-descriptions-item label="风险等级">
            {{ externalAiDetailRow.ai_review_risk_level || "-" }}
          </el-descriptions-item>
          <el-descriptions-item label="填报人">
            {{ externalAiDetailRow.submitter_name || "-" }}
          </el-descriptions-item>
          <el-descriptions-item label="外包单位">
            {{ externalAiDetailRow.submitter_company || "-" }}
          </el-descriptions-item>
          <el-descriptions-item label="日志日期">
            {{ externalAiDetailRow.log_date || "-" }}
          </el-descriptions-item>
        </el-descriptions>

        <div class="external-ai-detail__section">
          <div class="external-ai-detail__title">AI摘要</div>
          <div class="external-ai-detail__summary">
            {{ externalAiDetailRow.ai_review_summary || "暂无AI摘要" }}
          </div>
        </div>

        <div class="external-ai-detail__section">
          <div class="external-ai-detail__title">AI问题</div>
          <el-empty
            v-if="externalAiDetailIssues.length === 0"
            description="暂无AI问题"
            :image-size="72"
          />
          <div v-else class="external-ai-detail__issues">
            <div
              v-for="(item, index) in externalAiDetailIssues"
              :key="`${index}-${item.severity || 'info'}-${item.message}`"
              class="external-ai-detail__issue"
            >
              <el-tag
                size="small"
                :type="aiIssueSeverityTagType(item.severity)"
              >
                {{ aiIssueSeverityLabel(item.severity) }}
              </el-tag>
              <div class="external-ai-detail__issue-message">
                {{ item.message || "-" }}
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <el-button @click="externalAiDetailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <div>
      <el-card shadow="never" class="mt-3">
        <template #header>
          <div class="card-header card-header--with-action">
            <div>
              <span>标段总览（卡片视图）</span>
              <el-tag class="ml-2" size="small" type="info">
                {{ sectionResultLabel }}
              </el-tag>
            </div>
            <el-space>
              <el-button
                type="primary"
                :disabled="!canManageSections"
                @click="openCreateSectionDialog"
              >
                新增标段
              </el-button>
              <el-button :loading="loading" @click="loadData">
                刷新标段总览
              </el-button>
            </el-space>
          </div>
        </template>
        <el-empty
          v-if="!loading && sectionMetrics.length === 0"
          description="暂无标段数据"
        />
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
              <span>
                管径:
                {{
                  item.section.pipe_model ||
                  (item.section.pipe_diameter_mm
                    ? `DN${item.section.pipe_diameter_mm}`
                    : "-")
                }}
              </span>
              <span>坡度: {{ item.section.design_slope ?? "-" }}%</span>
            </div>
            <div class="section-card__meta">
              <span>施工日志: {{ item.logCount }}</span>
              <span>贯通报告: {{ item.breakthroughCount }}</span>
            </div>
            <div class="section-card__meta">
              <span>最近更新: {{ item.latestLogDate }}</span>
              <el-button
                link
                type="primary"
                @click.stop="openSectionDrawer(item.section)"
              >
                查看详情
              </el-button>
            </div>
          </div>
        </div>
      </el-card>
    </div>

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
        <el-alert
          v-if="sectionDrawerError"
          type="error"
          show-icon
          :closable="false"
          class="mb-3"
          :title="sectionDrawerError"
        >
          <template #default>
            <el-button
              v-if="currentSection"
              link
              type="primary"
              @click="openSectionDrawer(currentSection)"
            >
              重新加载详情
            </el-button>
          </template>
        </el-alert>
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
          <el-descriptions-item label="管径">{{
            currentSection?.pipe_model ||
            (currentSection?.pipe_diameter_mm
              ? `DN${currentSection.pipe_diameter_mm}`
              : "-")
          }}</el-descriptions-item>
          <el-descriptions-item label="坡度(%)">{{
            currentSection?.design_slope ?? "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="顶进方式">{{
            currentSection?.jacking_method || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{
            sectionStatusLabel(currentSection?.status)
          }}</el-descriptions-item>
        </el-descriptions>

        <el-card shadow="never" class="mb-3" header="标段基础信息">
          <el-form label-width="110px">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="标段编码">
                  <el-input
                    :model-value="currentSection?.section_code"
                    disabled
                  />
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="标段名称" required>
                  <el-input
                    v-model="sectionBaseForm.section_name"
                    :disabled="!canManageSections"
                    maxlength="100"
                    show-word-limit
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="里程(m)">
                  <el-input-number
                    v-model="sectionBaseForm.section_length"
                    :disabled="!canManageSections"
                    :min="0"
                    :precision="2"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="管径(mm)">
                  <el-input-number
                    v-model="sectionBaseForm.pipe_diameter_mm"
                    :disabled="!canManageSections"
                    :min="0"
                    :precision="0"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="坡度(%)">
                  <el-input-number
                    v-model="sectionBaseForm.design_slope"
                    :disabled="!canManageSections"
                    :precision="4"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="管材">
                  <el-input
                    v-model="sectionBaseForm.pipe_material"
                    :disabled="!canManageSections"
                    maxlength="60"
                    show-word-limit
                  />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="管型/规格">
                  <el-input
                    v-model="sectionBaseForm.pipe_model"
                    :disabled="!canManageSections"
                    maxlength="60"
                    show-word-limit
                  />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="顶进方式">
                  <el-input
                    v-model="sectionBaseForm.jacking_method"
                    :disabled="!canManageSections"
                    maxlength="80"
                    show-word-limit
                    placeholder="例如 卵石破碎"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="土质">
              <el-select
                v-model="sectionBaseForm.soil_type"
                multiple
                clearable
                filterable
                collapse-tags
                collapse-tags-tooltip
                :disabled="!canManageSections"
                placeholder="可多选土质"
                style="width: 100%"
              >
                <el-option
                  v-for="item in soilTypeOptions"
                  :key="item"
                  :label="item"
                  :value="item"
                />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :disabled="!canManageSections"
                :loading="sectionBaseSaving"
                @click="saveSectionBase"
              >
                保存基础信息
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>

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

        <el-card shadow="never" class="mb-3">
          <template #header>
            <div class="card-header card-header--with-action">
              <span>趋势与预测</span>
              <el-segmented
                v-model="sectionTrendGroup"
                :options="sectionTrendGroupOptions"
              />
            </div>
          </template>

          <div class="trend-summary-grid">
            <div class="trend-summary-item">
              <span>剩余里程</span>
              <strong>{{
                formatTrendNumber(sectionTrendSummary.remainingM, "m")
              }}</strong>
              <small
                >总长
                {{
                  formatTrendNumber(sectionTrendSummary.sectionLengthM, "m")
                }}</small
              >
            </div>
            <div class="trend-summary-item">
              <span>历史日均</span>
              <strong>{{
                formatTrendNumber(
                  sectionTrendSummary.averageDailyFootageM,
                  "m/天"
                )
              }}</strong>
              <small>有效施工 {{ sectionTrendSummary.activeDays }} 天</small>
            </div>
            <div class="trend-summary-item">
              <span>近三日日均</span>
              <strong>{{
                formatTrendNumber(
                  sectionTrendSummary.recentDailyFootageM,
                  "m/天"
                )
              }}</strong>
              <small>按最近有顶进记录日期估算</small>
            </div>
            <div class="trend-summary-item trend-summary-item--accent">
              <span>预计剩余</span>
              <strong>{{
                formatEstimateDays(sectionTrendSummary.estimatedDaysRemaining)
              }}</strong>
              <small>按近三日优先、历史日均兜底</small>
            </div>
          </div>

          <div ref="sectionTrendChartRef" class="section-trend-chart" />

          <el-table
            :data="sectionProgressInsight.recentRows"
            size="small"
            max-height="260"
            class="mt-3"
          >
            <el-table-column prop="label" label="记录" min-width="150" />
            <el-table-column label="累计顶进" width="105">
              <template #default="scope">
                {{ formatTrendNumber(scope.row.cumulativeFootageM, "m") }}
              </template>
            </el-table-column>
            <el-table-column label="本班顶进" width="105">
              <template #default="scope">
                {{ formatTrendNumber(scope.row.footageM, "m") }}
              </template>
            </el-table-column>
            <el-table-column label="下管" width="90">
              <template #default="scope">
                {{ formatTrendNumber(scope.row.completedPipeCount, "节", 0) }}
              </template>
            </el-table-column>
            <el-table-column label="泥仓压力" width="105">
              <template #default="scope">
                {{ formatTrendNumber(scope.row.chamberPressureMpa, "MPa", 2) }}
              </template>
            </el-table-column>
            <el-table-column label="刀盘频率" width="105">
              <template #default="scope">
                {{ formatTrendNumber(scope.row.cutterFrequencyHz, "Hz", 0) }}
              </template>
            </el-table-column>
            <el-table-column label="偏差" min-width="150">
              <template #default="scope">
                {{ formatTrendDeviation(scope.row) }}
              </template>
            </el-table-column>
          </el-table>
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
                <el-table-column
                  prop="footage_m"
                  label="本班顶进(m)"
                  width="110"
                />
                <el-table-column
                  prop="cumulative_footage_m"
                  label="累计顶进(m)"
                  width="110"
                />
                <el-table-column
                  prop="main_thrust_text"
                  label="顶力"
                  width="110"
                  show-overflow-tooltip
                />
                <el-table-column label="偏差" width="130">
                  <template #default="scope">{{
                    formatDeviation(scope.row)
                  }}</template>
                </el-table-column>
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
      v-model="publicLinkDialogVisible"
      title="打印外包日志二维码"
      width="640px"
    >
      <el-alert
        type="info"
        show-icon
        :closable="false"
        class="mb-3"
        title="可查看并再次打印当前有效二维码；生成新二维码会自动停用旧二维码。二维码只用于外包日志提交，不开放后台权限。"
      />
      <el-form label-width="110px">
        <el-form-item label="有效期">
          <el-date-picker
            v-model="publicLinkExpiresAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSS[Z]"
            placeholder="不填则长期有效"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="publicLinkLoading"
            @click="generatePublicLogLink"
          >
            生成新二维码
          </el-button>
        </el-form-item>
      </el-form>

      <div v-if="generatedPublicQr" class="public-qr-print">
        <img :src="generatedPublicQr" alt="external-log-qr" />
        <div class="public-qr-print__title">
          {{ project?.project_name || "项目" }}外包日志填报
        </div>
        <div class="public-qr-print__url">{{ generatedPublicUrl }}</div>
        <el-button class="mt-3" @click="printPublicQr">打印</el-button>
      </div>

      <el-table :data="publicLogLinks" max-height="220" class="mt-3">
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column prop="expires_at" label="有效期" min-width="180" />
        <el-table-column prop="created_at" label="创建时间" min-width="180" />
        <el-table-column label="操作" width="180">
          <template #default="scope">
            <el-button
              v-if="scope.row.status === 'active'"
              link
              type="primary"
              :loading="publicLinkLoading"
              @click="showPublicLogLinkQr(scope.row)"
            >
              查看/打印
            </el-button>
            <el-button
              v-if="scope.row.status === 'active'"
              link
              type="danger"
              :loading="publicLinkLoading"
              @click="revokePublicLogLink(scope.row)"
            >
              停用
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

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
      v-model="createSectionDialogVisible"
      title="新增标段"
      width="760px"
      destroy-on-close
    >
      <el-alert
        type="info"
        show-icon
        :closable="false"
        class="mb-3"
        title="新增后会立即返回到标段总览，可继续进入详情补充施工日志与贯通报告。"
      />
      <el-form label-width="120px">
        <el-form-item label="标段编码" required>
          <el-input
            v-model="createSectionForm.section_code"
            maxlength="50"
            show-word-limit
            placeholder="例如 SECTION-001 / 工作段-A"
          />
        </el-form-item>
        <el-form-item label="标段名称" required>
          <el-input
            v-model="createSectionForm.section_name"
            maxlength="100"
            show-word-limit
            placeholder="填写标段或工作段名称"
          />
        </el-form-item>
        <el-form-item label="计划里程(m)">
          <el-input-number
            v-model="createSectionForm.section_length"
            :min="0"
            :precision="2"
            style="width: 220px"
          />
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="管径(mm)">
              <el-input-number
                v-model="createSectionForm.pipe_diameter_mm"
                :min="0"
                :precision="0"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="坡度(%)">
              <el-input-number
                v-model="createSectionForm.design_slope"
                :precision="4"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="初始状态">
          <el-select v-model="createSectionForm.status" style="width: 220px">
            <el-option
              v-for="opt in sectionStatusOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="管材">
              <el-input
                v-model="createSectionForm.pipe_material"
                maxlength="60"
                show-word-limit
                placeholder="手动填写管材"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="管型/规格">
              <el-input
                v-model="createSectionForm.pipe_model"
                maxlength="60"
                show-word-limit
                placeholder="手动填写管型"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="顶进方式">
          <el-input
            v-model="createSectionForm.jacking_method"
            maxlength="80"
            show-word-limit
            placeholder="例如 卵石破碎"
          />
        </el-form-item>
        <el-form-item label="土质">
          <el-select
            v-model="createSectionForm.soil_type"
            multiple
            clearable
            filterable
            collapse-tags
            collapse-tags-tooltip
            placeholder="可多选土质"
            style="width: 100%"
          >
            <el-option
              v-for="item in soilTypeOptions"
              :key="item"
              :label="item"
              :value="item"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createSectionDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="creatingSection"
          @click="submitCreateSection"
        >
          创建标段
        </el-button>
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
        <el-form-item label="累计顶进(m)">
          <el-input-number
            v-model="operatorLogForm.cumulative_footage_m"
            :min="0"
            :precision="2"
          />
        </el-form-item>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="刀盘电流">
              <el-input
                v-model="operatorLogForm.cutter_current_text"
                placeholder="例如 2*35A"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="刀盘频率(Hz)">
              <el-input-number
                v-model="operatorLogForm.cutter_frequency_hz"
                :min="0"
                :precision="2"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="泥仓压力(MPa)">
              <el-input-number
                v-model="operatorLogForm.chamber_pressure_mpa"
                :min="0"
                :precision="3"
                style="width: 100%"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="顶力">
              <el-input
                v-model="operatorLogForm.main_thrust_text"
                placeholder="例如 4×12MPa"
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="水平偏差">
              <el-input-number
                v-model="operatorLogForm.horizontal_deviation_mm"
                :min="0"
                :precision="1"
                style="width: 120px"
              />
              <el-select
                v-model="operatorLogForm.horizontal_deviation_direction"
                clearable
                style="width: 120px; margin-left: 8px"
              >
                <el-option
                  v-for="opt in horizontalDeviationOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="高程偏差">
              <el-input-number
                v-model="operatorLogForm.vertical_deviation_mm"
                :min="0"
                :precision="1"
                style="width: 120px"
              />
              <el-select
                v-model="operatorLogForm.vertical_deviation_direction"
                clearable
                style="width: 120px; margin-left: 8px"
              >
                <el-option
                  v-for="opt in verticalDeviationOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
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
          <el-descriptions-item label="累计顶进(m)">{{
            operatorLogDetail?.cumulative_footage_m ?? "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="刀盘电流">{{
            operatorLogDetail?.cutter_current_text || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="刀盘频率(Hz)">{{
            operatorLogDetail?.cutter_frequency_hz ?? "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="泥仓压力(MPa)">{{
            operatorLogDetail?.chamber_pressure_mpa ?? "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="顶力">{{
            operatorLogDetail?.main_thrust_text || "-"
          }}</el-descriptions-item>
          <el-descriptions-item label="偏差">{{
            formatDeviation(operatorLogDetail)
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

.card-header {
  font-weight: 700;
  color: #1f2937;
}

.card-header--with-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ml-2 {
  margin-left: 8px;
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

.external-log-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.external-ai-summary,
.external-ai-issues {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.external-ai-summary__text,
.external-ai-issues__preview {
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-regular);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.external-ai-summary__text {
  flex: 1;
}

.external-ai-issues__preview {
  color: var(--el-text-color-secondary);
}

.external-ai-detail__section {
  margin-top: 18px;
}

.external-ai-detail__title {
  margin-bottom: 8px;
  font-weight: 700;
  color: var(--el-text-color-primary);
}

.external-ai-detail__summary,
.external-ai-detail__issue-message {
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.external-ai-detail__summary {
  padding: 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
}

.external-ai-detail__issues {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.external-ai-detail__issue {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.external-ai-detail__issue-message {
  flex: 1;
}

.public-qr-print {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  background: #fff;
}

.public-qr-print img {
  width: 220px;
  height: 220px;
}

.public-qr-print__title {
  font-size: 16px;
  font-weight: 700;
}

.public-qr-print__url {
  max-width: 100%;
  word-break: break-all;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

@media print {
  .project-panel-page > :not(.el-overlay) {
    display: none !important;
  }

  .el-dialog__header,
  .el-dialog__footer,
  .el-overlay .el-button,
  .el-overlay .el-alert,
  .el-overlay .el-form,
  .el-overlay .el-table {
    display: none !important;
  }

  .public-qr-print {
    border: 0;
  }
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

.trend-summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}

.trend-summary-item {
  display: flex;
  min-height: 86px;
  flex-direction: column;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid #e7ded0;
  border-radius: 8px;
  background: #fffdf8;
}

.trend-summary-item span {
  color: #6e6458;
  font-size: 12px;
}

.trend-summary-item strong {
  color: #25372f;
  font-size: 22px;
  line-height: 1.2;
}

.trend-summary-item small {
  color: #8b8172;
}

.trend-summary-item--accent {
  border-color: #b9d7c5;
  background: #f5fbf7;
}

.section-trend-chart {
  width: 100%;
  height: 320px;
}
</style>
