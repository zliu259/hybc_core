<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import { resolveUploadUrl } from "@/api/upload";
import {
  createPublicProjectLogUploadSignature,
  getPublicLatestOperatorLog,
  getPublicOperatorLogItems,
  getPublicProjectLogContext,
  getPublicProjectLogItems,
  submitPublicProjectLog,
  type PublicOperatorLogItem,
  type PublicProjectLogItem,
  type PublicProjectLogProject,
  type PublicProjectLogSection
} from "@/api/public-project-log";

defineOptions({ name: "PublicProjectLog" });

type PageMode =
  | "home"
  | "view_project"
  | "view_operator"
  | "write_project"
  | "write_operator";

const profileCacheKey = "hybc_public_log_profile_v1";

const route = useRoute();
const router = useRouter();
const token = computed(() => String(route.params.token || ""));
const loading = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const projectLogLoading = ref(false);
const operatorLogLoading = ref(false);
const latestOperatorLoading = ref(false);
const loadError = ref("");
const submitError = ref("");
const submittedId = ref<number | null>(null);
const submittedTaskId = ref<number | null>(null);
const mode = ref<PageMode>("home");
const project = ref<PublicProjectLogProject | null>(null);
const sections = ref<PublicProjectLogSection[]>([]);
const allowedLogTypes = ref<string[]>(["project_log", "operator_log"]);
const projectLogs = ref<PublicProjectLogItem[]>([]);
const operatorLogs = ref<PublicOperatorLogItem[]>([]);
const latestOperatorLog = ref<PublicOperatorLogItem | null>(null);
const selectedViewSectionId = ref<number | undefined>();
const photoFiles = ref<
  Array<{ file_key: string; file_url: string; file_name: string }>
>([]);

const today = new Date().toISOString().slice(0, 10);
const form = ref({
  submitter_name: "",
  submitter_company: "",
  submitter_phone: "",
  section_id: undefined as number | undefined,
  log_date: today,
  shift: "day",
  weather: "",
  completed_pipe_count: 0,
  cumulative_pipe_count: 0,
  footage_m: undefined as number | undefined,
  cumulative_footage_m: undefined as number | undefined,
  cutter_current_text: "",
  cutter_frequency_hz: undefined as number | undefined,
  chamber_pressure_mpa: undefined as number | undefined,
  main_thrust_text: "",
  horizontal_deviation_direction: "",
  horizontal_deviation_mm: undefined as number | undefined,
  vertical_deviation_direction: "",
  vertical_deviation_mm: undefined as number | undefined,
  soil_type: "",
  issue_summary: "",
  remark: "",
  project_title: "",
  project_detail: "",
  tomorrow_plan: "",
  risk_note: ""
});

const shiftOptions = [
  { label: "白班", value: "day" },
  { label: "夜班", value: "night" }
];

const horizontalDeviationOptions = [
  { label: "左偏", value: "left" },
  { label: "右偏", value: "right" }
];

const verticalDeviationOptions = [
  { label: "高", value: "high" },
  { label: "低", value: "low" }
];

const deviationDirectionLabel = (value?: string | null) => {
  const options = [...horizontalDeviationOptions, ...verticalDeviationOptions];
  return options.find(item => item.value === value)?.label || value || "";
};

const modeTitle = computed(() => {
  if (mode.value === "view_project") return "查看项目日志";
  if (mode.value === "view_operator") return "查看工作段日志";
  if (mode.value === "write_project") return "填写项目日志";
  if (mode.value === "write_operator") return "填写工作段日志";
  return "外包日志工作台";
});

const canUseProjectLog = computed(() =>
  allowedLogTypes.value.includes("project_log")
);
const canUseOperatorLog = computed(() =>
  allowedLogTypes.value.includes("operator_log")
);

const isWritingProject = computed(() => mode.value === "write_project");
const isWritingOperator = computed(() => mode.value === "write_operator");
const formDisabled = computed(
  () => loading.value || submitting.value || Boolean(submittedId.value)
);
const submitDisabled = computed(
  () =>
    loading.value ||
    submitting.value ||
    uploading.value ||
    Boolean(submittedId.value) ||
    Boolean(loadError.value)
);

const sectionLabel = (section?: PublicProjectLogSection | null) => {
  if (!section) return "-";
  return `${section.section_code} ${section.section_name}`;
};

const selectedSection = computed(() =>
  sections.value.find(item => item.id === form.value.section_id)
);

const sectionMetaText = (section?: PublicProjectLogSection | null) => {
  if (!section) return "";
  return [
    section.pipe_model ||
      (section.pipe_diameter_mm ? `DN${section.pipe_diameter_mm}` : ""),
    section.section_length ? `总长${section.section_length}m` : "",
    section.design_slope !== null && section.design_slope !== undefined
      ? `坡度${section.design_slope}%`
      : "",
    section.jacking_method ? `顶进方式：${section.jacking_method}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
};

const shiftLabel = (shift?: string | null) => {
  if (shift === "day") return "白班";
  if (shift === "night") return "夜班";
  return shift || "-";
};

const deviationLabel = (item: PublicOperatorLogItem) => {
  const horizontalDirection =
    item.horizontal_deviation_direction || item.deviation_direction || "";
  const horizontalValue =
    item.horizontal_deviation_mm ?? item.deviation_value_mm;
  const parts = [
    horizontalDirection && typeof horizontalValue === "number"
      ? `${deviationDirectionLabel(horizontalDirection)}${horizontalValue}mm`
      : "",
    item.vertical_deviation_direction &&
    typeof item.vertical_deviation_mm === "number"
      ? `${deviationDirectionLabel(item.vertical_deviation_direction)}${item.vertical_deviation_mm}mm`
      : ""
  ].filter(Boolean);
  return parts.length ? parts.join("，") : "-";
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error && typeof error === "object") {
    const response = (error as { response?: { data?: unknown } }).response;
    const data = response?.data;
    if (data && typeof data === "object") {
      const err = (data as { error?: { message?: string }; message?: string })
        .error;
      if (typeof err?.message === "string" && err.message.trim()) {
        return err.message;
      }
      const messageText = (data as { message?: string }).message;
      if (typeof messageText === "string" && messageText.trim()) {
        return messageText;
      }
    }
    const messageText = (error as { message?: string }).message;
    if (typeof messageText === "string" && messageText.trim()) {
      return messageText;
    }
  }
  return fallback;
};

const syncModeFromRoute = () => {
  const nextMode = String(route.query.mode || "home");
  mode.value = [
    "view_project",
    "view_operator",
    "write_project",
    "write_operator"
  ].includes(nextMode)
    ? (nextMode as PageMode)
    : "home";
  const routeSectionId = Number(route.query.section_id ?? "0");
  if (routeSectionId > 0) {
    selectedViewSectionId.value = routeSectionId;
  }
};

const goMode = async (nextMode: PageMode) => {
  submittedId.value = null;
  submittedTaskId.value = null;
  submitError.value = "";
  await router.push({
    path: route.path,
    query: nextMode === "home" ? {} : { mode: nextMode }
  });
};

const loadCachedProfile = () => {
  try {
    const raw = window.localStorage.getItem(profileCacheKey);
    if (!raw) return;
    const cached = JSON.parse(raw) as {
      submitter_name?: string;
      submitter_company?: string;
      submitter_phone?: string;
    };
    form.value.submitter_name = cached.submitter_name || "";
    form.value.submitter_company = cached.submitter_company || "";
    form.value.submitter_phone = cached.submitter_phone || "";
  } catch {
    window.localStorage.removeItem(profileCacheKey);
  }
};

const cacheProfile = () => {
  try {
    window.localStorage.setItem(
      profileCacheKey,
      JSON.stringify({
        submitter_name: form.value.submitter_name.trim(),
        submitter_company: form.value.submitter_company.trim(),
        submitter_phone: form.value.submitter_phone.trim()
      })
    );
  } catch {}
};

const ensureDefaultSections = () => {
  if (!form.value.section_id && sections.value.length > 0) {
    form.value.section_id = sections.value[0].id;
  }
  if (!selectedViewSectionId.value && sections.value.length > 0) {
    selectedViewSectionId.value = sections.value[0].id;
  }
};

const loadProjectLogs = async () => {
  projectLogLoading.value = true;
  try {
    const result = await getPublicProjectLogItems(token.value, {
      page: 1,
      pageSize: 20
    });
    projectLogs.value = result.data;
  } catch (error) {
    message(getErrorMessage(error, "项目日志加载失败"), { type: "error" });
  } finally {
    projectLogLoading.value = false;
  }
};

const loadOperatorLogs = async () => {
  operatorLogLoading.value = true;
  try {
    const result = await getPublicOperatorLogItems(token.value, {
      section_id: selectedViewSectionId.value,
      page: 1,
      pageSize: 20
    });
    operatorLogs.value = result.data;
  } catch (error) {
    message(getErrorMessage(error, "工作段日志加载失败"), { type: "error" });
  } finally {
    operatorLogLoading.value = false;
  }
};

const loadLatestOperatorLog = async () => {
  latestOperatorLog.value = null;
  if (!form.value.section_id) return;
  latestOperatorLoading.value = true;
  try {
    const result = await getPublicLatestOperatorLog(token.value, {
      section_id: form.value.section_id
    });
    latestOperatorLog.value = result.data;
    if (
      result.data &&
      !form.value.cumulative_pipe_count &&
      !form.value.completed_pipe_count
    ) {
      form.value.cumulative_pipe_count = result.data.cumulative_pipe_count;
      form.value.cumulative_footage_m =
        result.data.cumulative_footage_m ?? undefined;
    }
  } catch (error) {
    message(getErrorMessage(error, "上一条工作段日志加载失败"), {
      type: "error"
    });
  } finally {
    latestOperatorLoading.value = false;
  }
};

const loadContext = async () => {
  loadError.value = "";
  loading.value = true;
  try {
    const result = await getPublicProjectLogContext(token.value);
    project.value = result.data.project;
    sections.value = result.data.sections;
    allowedLogTypes.value = result.data.allowed_log_types;
    ensureDefaultSections();
    if (mode.value === "view_project") await loadProjectLogs();
    if (mode.value === "view_operator") await loadOperatorLogs();
    if (mode.value === "write_operator") await loadLatestOperatorLog();
  } catch (error) {
    loadError.value = getErrorMessage(
      error,
      "二维码已失效或项目暂不可用，请联系项目管理员。"
    );
  } finally {
    loading.value = false;
  }
};

const uploadPhoto = async (options: UploadRequestOptions) => {
  if (uploading.value) {
    options.onError?.(new Error("uploading") as never);
    return;
  }
  if (photoFiles.value.length >= 12) {
    message("最多上传12张照片", { type: "warning" });
    options.onError?.(new Error("too_many_photos") as never);
    return;
  }

  const rawFile = options.file;
  uploading.value = true;
  try {
    const signedRes = await createPublicProjectLogUploadSignature(token.value, {
      fileName: rawFile.name,
      contentType: rawFile.type
    });
    const signed = signedRes.data;
    const uploadResp = await fetch(resolveUploadUrl(signed.uploadUrl), {
      method: "PUT",
      headers: {
        "content-type": rawFile.type || "application/octet-stream"
      },
      body: rawFile
    });
    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }
    photoFiles.value.unshift({
      file_key: signed.key,
      file_url: signed.fileUrl,
      file_name: rawFile.name
    });
    message("照片已上传", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("照片上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploading.value = false;
  }
};

const removePhoto = (index: number) => {
  if (submitting.value) return;
  photoFiles.value.splice(index, 1);
};

const usePreviousWeather = () => {
  if (!latestOperatorLog.value) return;
  form.value.weather = latestOperatorLog.value.weather || form.value.weather;
  form.value.cutter_current_text =
    latestOperatorLog.value.cutter_current_text ||
    form.value.cutter_current_text;
  form.value.cutter_frequency_hz =
    latestOperatorLog.value.cutter_frequency_hz ??
    form.value.cutter_frequency_hz;
  form.value.chamber_pressure_mpa =
    latestOperatorLog.value.chamber_pressure_mpa ??
    form.value.chamber_pressure_mpa;
  form.value.main_thrust_text =
    latestOperatorLog.value.main_thrust_text || form.value.main_thrust_text;
  form.value.horizontal_deviation_direction =
    latestOperatorLog.value.horizontal_deviation_direction ||
    form.value.horizontal_deviation_direction;
  form.value.horizontal_deviation_mm =
    latestOperatorLog.value.horizontal_deviation_mm ??
    form.value.horizontal_deviation_mm;
  form.value.vertical_deviation_direction =
    latestOperatorLog.value.vertical_deviation_direction ||
    form.value.vertical_deviation_direction;
  form.value.vertical_deviation_mm =
    latestOperatorLog.value.vertical_deviation_mm ??
    form.value.vertical_deviation_mm;
  form.value.issue_summary =
    latestOperatorLog.value.issue_summary || form.value.issue_summary;
  form.value.remark = latestOperatorLog.value.remark || form.value.remark;
};

const usePreviousCumulative = () => {
  if (!latestOperatorLog.value) return;
  form.value.cumulative_pipe_count =
    latestOperatorLog.value.cumulative_pipe_count;
  form.value.cumulative_footage_m =
    latestOperatorLog.value.cumulative_footage_m ?? undefined;
};

const submit = async () => {
  if (submitDisabled.value) {
    if (uploading.value) {
      message("照片上传中，请稍后提交", { type: "warning" });
    }
    return;
  }

  submitError.value = "";
  if (!form.value.submitter_name.trim()) {
    message("请填写填报人姓名", { type: "warning" });
    return;
  }
  if (!form.value.log_date || !form.value.shift) {
    message("请填写日期和班次", { type: "warning" });
    return;
  }
  if (isWritingOperator.value && !form.value.section_id) {
    message("请先选择工作段", { type: "warning" });
    return;
  }
  if (isWritingProject.value && !form.value.project_detail.trim()) {
    message("请填写项目日志内容", { type: "warning" });
    return;
  }
  if (!isWritingProject.value && !isWritingOperator.value) return;

  submitting.value = true;
  try {
    cacheProfile();
    const result = await submitPublicProjectLog(token.value, {
      submitter_name: form.value.submitter_name.trim(),
      submitter_company: form.value.submitter_company.trim() || undefined,
      submitter_phone: form.value.submitter_phone.trim() || undefined,
      log_types: [isWritingOperator.value ? "operator_log" : "project_log"],
      section_id: isWritingOperator.value
        ? (form.value.section_id ?? null)
        : null,
      log_date: form.value.log_date,
      shift: form.value.shift,
      operator_log: {
        enabled: isWritingOperator.value,
        weather: form.value.weather.trim() || undefined,
        completed_pipe_count: form.value.completed_pipe_count,
        cumulative_pipe_count: form.value.cumulative_pipe_count,
        footage_m: form.value.footage_m,
        cumulative_footage_m: form.value.cumulative_footage_m,
        cutter_current_text: form.value.cutter_current_text.trim() || undefined,
        cutter_frequency_hz: form.value.cutter_frequency_hz,
        chamber_pressure_mpa: form.value.chamber_pressure_mpa,
        main_thrust_text: form.value.main_thrust_text.trim() || undefined,
        horizontal_deviation_direction:
          form.value.horizontal_deviation_direction || undefined,
        horizontal_deviation_mm: form.value.horizontal_deviation_mm,
        vertical_deviation_direction:
          form.value.vertical_deviation_direction || undefined,
        vertical_deviation_mm: form.value.vertical_deviation_mm,
        soil_type: form.value.soil_type.trim() || undefined,
        issue_summary: form.value.issue_summary.trim() || undefined,
        remark: form.value.remark.trim() || undefined
      },
      project_log: {
        enabled: isWritingProject.value,
        title: form.value.project_title.trim() || undefined,
        detail_html: form.value.project_detail.trim(),
        tomorrow_plan: form.value.tomorrow_plan.trim() || undefined,
        risk_note: form.value.risk_note.trim() || undefined
      },
      photo_keys: isWritingProject.value
        ? photoFiles.value.map(item => item.file_key)
        : []
    });
    submittedId.value = result.data.id;
    submittedTaskId.value = result.data.ai_review_task_id;
    message("提交成功，系统将进行AI审计", { type: "success" });
  } catch (error) {
    submitError.value = getErrorMessage(
      error,
      "提交失败，请检查网络后重试；如多次失败请联系项目管理员。"
    );
    message(submitError.value, { type: "error" });
  } finally {
    submitting.value = false;
  }
};

watch(
  () => route.query.mode,
  () => {
    syncModeFromRoute();
    if (!project.value) return;
    if (mode.value === "view_project") void loadProjectLogs();
    if (mode.value === "view_operator") void loadOperatorLogs();
    if (mode.value === "write_operator") void loadLatestOperatorLog();
  },
  { immediate: true }
);

watch(
  () => token.value,
  () => {
    submittedId.value = null;
    submittedTaskId.value = null;
    submitError.value = "";
    project.value = null;
    sections.value = [];
    projectLogs.value = [];
    operatorLogs.value = [];
    latestOperatorLog.value = null;
    void loadContext();
  }
);

watch(
  () => selectedViewSectionId.value,
  () => {
    if (mode.value === "view_operator" && project.value) {
      void loadOperatorLogs();
    }
  }
);

watch(
  () => form.value.section_id,
  () => {
    if (mode.value === "write_operator" && project.value) {
      void loadLatestOperatorLog();
    }
  }
);

watch(
  () => [
    form.value.submitter_name,
    form.value.submitter_company,
    form.value.submitter_phone
  ],
  cacheProfile
);

onMounted(() => {
  loadCachedProfile();
  void loadContext();
});
</script>

<template>
  <main class="public-log-page">
    <section class="public-log-header">
      <div class="public-log-header__title">{{ modeTitle }}</div>
      <div class="public-log-header__project">
        {{ project?.project_name || "项目日志" }}
      </div>
      <div class="public-log-header__meta">
        {{ project?.project_code || "-" }}
      </div>
    </section>

    <section v-if="submittedId" class="success-panel">
      <el-result
        icon="success"
        title="提交成功"
        :sub-title="`提交编号：${submittedId}，系统将进行AI审计，低风险日志会自动通过。`"
      >
        <template #extra>
          <el-alert
            type="success"
            :closable="false"
            show-icon
            :title="`AI审计任务：${submittedTaskId || '-'}`"
            description="请不要重复提交同一班次日志。如需补充内容，请联系项目管理员。"
          />
          <el-button class="mt-3" type="primary" @click="goMode('home')">
            返回日志工作台
          </el-button>
        </template>
      </el-result>
    </section>

    <section v-else-if="loadError" class="success-panel">
      <el-result icon="warning" title="暂不可用" :sub-title="loadError">
        <template #extra>
          <el-button :loading="loading" type="primary" @click="loadContext">
            重新加载
          </el-button>
        </template>
      </el-result>
    </section>

    <section v-else v-loading="loading" class="content-panel">
      <div v-if="mode !== 'home'" class="top-actions">
        <el-button @click="goMode('home')">返回工作台</el-button>
      </div>

      <template v-if="mode === 'home'">
        <div class="notice-strip">
          <div>
            <strong>现场快速入口</strong>
            <span>先选择查看或填写，再进入对应功能页。</span>
          </div>
          <div v-if="form.submitter_name" class="profile-chip">
            {{ form.submitter_name }}
            <span v-if="form.submitter_company">
              · {{ form.submitter_company }}
            </span>
          </div>
        </div>

        <div class="action-grid">
          <button
            class="action-card"
            :disabled="!canUseProjectLog"
            @click="goMode('view_project')"
          >
            <span class="action-card__label">查看</span>
            <strong>项目日志</strong>
            <small>查看项目每日概况、风险和协调事项</small>
          </button>
          <button
            class="action-card"
            :disabled="!canUseOperatorLog"
            @click="goMode('view_operator')"
          >
            <span class="action-card__label">查看</span>
            <strong>工作段日志</strong>
            <small>按工作段查看下管、进尺、问题记录</small>
          </button>
          <button
            class="action-card action-card--primary"
            :disabled="!canUseProjectLog"
            @click="goMode('write_project')"
          >
            <span class="action-card__label">填写</span>
            <strong>项目日志</strong>
            <small>填写现场概况、明日计划和照片</small>
          </button>
          <button
            class="action-card action-card--primary"
            :disabled="!canUseOperatorLog"
            @click="goMode('write_operator')"
          >
            <span class="action-card__label">填写</span>
            <strong>工作段日志</strong>
            <small>选择工作段后对照上一条快速填写</small>
          </button>
        </div>
      </template>

      <template v-else-if="mode === 'view_project'">
        <div class="view-header">
          <div>
            <div class="section-title">项目日志</div>
            <div class="section-subtitle">最近20条项目日志</div>
          </div>
          <el-button :loading="projectLogLoading" @click="loadProjectLogs">
            刷新
          </el-button>
        </div>
        <div v-loading="projectLogLoading" class="log-list">
          <el-empty v-if="!projectLogs.length" description="暂无项目日志" />
          <article v-for="item in projectLogs" :key="item.id" class="log-card">
            <div class="log-card__head">
              <strong>{{ item.title || "项目日志" }}</strong>
              <span>{{ item.log_date }}</span>
            </div>
            <p class="log-card__text">{{ item.detail_html || "未填写详情" }}</p>
            <p v-if="item.risk_note" class="log-card__muted">
              风险/协调：{{ item.risk_note }}
            </p>
            <div class="log-card__meta">
              {{ item.source_type === "external" ? "外包提交" : "内部填写" }}
              <span v-if="item.external_submitter_name">
                · {{ item.external_submitter_name }}
              </span>
            </div>
          </article>
        </div>
      </template>

      <template v-else-if="mode === 'view_operator'">
        <div class="view-header">
          <div>
            <div class="section-title">工作段日志</div>
            <div class="section-subtitle">选择工作段后查看最近20条记录</div>
          </div>
          <el-button :loading="operatorLogLoading" @click="loadOperatorLogs">
            刷新
          </el-button>
        </div>
        <el-select
          v-model="selectedViewSectionId"
          filterable
          class="section-select"
          placeholder="选择工作段"
        >
          <el-option
            v-for="item in sections"
            :key="item.id"
            :label="sectionLabel(item)"
            :value="item.id"
          />
        </el-select>
        <div class="section-meta">
          {{
            sectionMetaText(
              sections.find(item => item.id === selectedViewSectionId)
            ) || "该工作段暂无补充参数"
          }}
        </div>
        <div v-loading="operatorLogLoading" class="log-list">
          <el-empty v-if="!operatorLogs.length" description="暂无工作段日志" />
          <article v-for="item in operatorLogs" :key="item.id" class="log-card">
            <div class="log-card__head">
              <strong>{{ item.section_code }} {{ item.section_name }}</strong>
              <span>{{ item.log_date }} · {{ shiftLabel(item.shift) }}</span>
            </div>
            <div class="metric-grid">
              <div>
                <small>本班下管</small>
                <strong>{{ item.completed_pipe_count }}</strong>
              </div>
              <div>
                <small>累计下管</small>
                <strong>{{ item.cumulative_pipe_count }}</strong>
              </div>
              <div>
                <small>本班进尺</small>
                <strong>{{ item.footage_m ?? "-" }}m</strong>
              </div>
              <div>
                <small>累计顶进</small>
                <strong>{{ item.cumulative_footage_m ?? "-" }}m</strong>
              </div>
              <div>
                <small>泥仓压力</small>
                <strong>{{ item.chamber_pressure_mpa ?? "-" }}MPa</strong>
              </div>
              <div>
                <small>偏差</small>
                <strong>{{ deviationLabel(item) }}</strong>
              </div>
            </div>
            <p class="log-card__muted">
              刀盘电流：{{ item.cutter_current_text || "-" }} · 刀盘频率：{{
                item.cutter_frequency_hz ?? "-"
              }}Hz · 顶力：{{ item.main_thrust_text || "-" }}
            </p>
            <p v-if="item.issue_summary" class="log-card__text">
              {{ item.issue_summary }}
            </p>
            <p v-if="item.remark" class="log-card__muted">
              备注：{{ item.remark }}
            </p>
          </article>
        </div>
      </template>

      <template v-else>
        <el-alert
          v-if="submitError"
          type="error"
          show-icon
          :closable="false"
          class="mb-3"
          :title="submitError"
        />

        <el-alert
          v-if="uploading"
          type="info"
          show-icon
          :closable="false"
          class="mb-3"
          title="照片正在上传，请等待上传完成后再提交。"
        />

        <el-form label-position="top" :disabled="formDisabled">
          <div class="form-section">
            <div class="form-section__title">填报人</div>
            <el-form-item label="姓名" required>
              <el-input
                v-model="form.submitter_name"
                placeholder="请输入姓名"
              />
            </el-form-item>
            <el-form-item label="外包单位">
              <el-input
                v-model="form.submitter_company"
                placeholder="公司或班组"
              />
            </el-form-item>
            <el-form-item label="联系电话">
              <el-input v-model="form.submitter_phone" inputmode="tel" />
            </el-form-item>
          </div>

          <div class="form-section">
            <div class="form-section__title">基础信息</div>
            <el-form-item v-if="isWritingOperator" label="工作段" required>
              <el-select
                v-model="form.section_id"
                filterable
                style="width: 100%"
                placeholder="选择工作段"
              >
                <el-option
                  v-for="item in sections"
                  :key="item.id"
                  :label="sectionLabel(item)"
                  :value="item.id"
                />
              </el-select>
              <div class="section-meta">
                {{ sectionMetaText(selectedSection) || "该工作段暂无补充参数" }}
              </div>
            </el-form-item>
            <el-form-item label="日志日期" required>
              <el-date-picker
                v-model="form.log_date"
                type="date"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </el-form-item>
            <el-form-item label="班次" required>
              <el-segmented v-model="form.shift" :options="shiftOptions" />
            </el-form-item>
          </div>

          <div
            v-if="isWritingOperator"
            v-loading="latestOperatorLoading"
            class="previous-log"
          >
            <div class="previous-log__head">
              <div>
                <div class="form-section__title">上一条同工作段日志</div>
                <div class="section-subtitle">
                  用于对比累计数、进尺和问题描述
                </div>
              </div>
              <div v-if="latestOperatorLog" class="previous-log__date">
                {{ latestOperatorLog.log_date }} ·
                {{ shiftLabel(latestOperatorLog.shift) }}
              </div>
            </div>
            <el-empty
              v-if="!latestOperatorLog"
              description="该工作段暂无历史日志"
            />
            <template v-else>
              <div class="metric-grid">
                <div>
                  <small>本班下管</small>
                  <strong>{{ latestOperatorLog.completed_pipe_count }}</strong>
                </div>
                <div>
                  <small>累计下管</small>
                  <strong>{{ latestOperatorLog.cumulative_pipe_count }}</strong>
                </div>
                <div>
                  <small>本班进尺</small>
                  <strong>{{ latestOperatorLog.footage_m ?? "-" }}m</strong>
                </div>
                <div>
                  <small>累计顶进</small>
                  <strong
                    >{{
                      latestOperatorLog.cumulative_footage_m ?? "-"
                    }}m</strong
                  >
                </div>
                <div>
                  <small>偏差</small>
                  <strong>{{ deviationLabel(latestOperatorLog) }}</strong>
                </div>
                <div>
                  <small>泥仓压力</small>
                  <strong
                    >{{
                      latestOperatorLog.chamber_pressure_mpa ?? "-"
                    }}MPa</strong
                  >
                </div>
              </div>
              <p v-if="latestOperatorLog.issue_summary" class="log-card__text">
                {{ latestOperatorLog.issue_summary }}
              </p>
              <p v-if="latestOperatorLog.remark" class="log-card__muted">
                备注：{{ latestOperatorLog.remark }}
              </p>
              <div class="quick-buttons">
                <el-button @click="usePreviousCumulative">
                  沿用累计下管
                </el-button>
                <el-button @click="usePreviousWeather">
                  沿用现场参数
                </el-button>
              </div>
            </template>
          </div>

          <div v-if="isWritingOperator" class="form-section">
            <div class="form-section__title">工作段操作日志</div>
            <el-row :gutter="12">
              <el-col :xs="24" :sm="8">
                <el-form-item label="本班下管数量">
                  <el-input-number
                    v-model="form.completed_pipe_count"
                    :min="0"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="8">
                <el-form-item label="累计下管数量">
                  <el-input-number
                    v-model="form.cumulative_pipe_count"
                    :min="0"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="8">
                <el-form-item label="本班进尺(m)">
                  <el-input-number
                    v-model="form.footage_m"
                    :min="0"
                    :precision="2"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="8">
                <el-form-item label="累计顶进(m)">
                  <el-input-number
                    v-model="form.cumulative_footage_m"
                    :min="0"
                    :precision="2"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :xs="24" :sm="12">
                <el-form-item label="刀盘电流">
                  <el-input
                    v-model="form.cutter_current_text"
                    placeholder="例如 2*35A"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12">
                <el-form-item label="刀盘频率(Hz)">
                  <el-input-number
                    v-model="form.cutter_frequency_hz"
                    :min="0"
                    :precision="2"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :xs="24" :sm="12">
                <el-form-item label="泥仓压力(MPa)">
                  <el-input-number
                    v-model="form.chamber_pressure_mpa"
                    :min="0"
                    :precision="3"
                    style="width: 100%"
                  />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :sm="12">
                <el-form-item label="顶力">
                  <el-input
                    v-model="form.main_thrust_text"
                    placeholder="例如 4×12MPa"
                  />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="12">
              <el-col :xs="24" :sm="12">
                <el-form-item label="水平偏差">
                  <el-input-number
                    v-model="form.horizontal_deviation_mm"
                    :min="0"
                    :precision="1"
                    style="width: 48%"
                  />
                  <el-select
                    v-model="form.horizontal_deviation_direction"
                    clearable
                    style="width: 48%; margin-left: 4%"
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
              <el-col :xs="24" :sm="12">
                <el-form-item label="高程偏差">
                  <el-input-number
                    v-model="form.vertical_deviation_mm"
                    :min="0"
                    :precision="1"
                    style="width: 48%"
                  />
                  <el-select
                    v-model="form.vertical_deviation_direction"
                    clearable
                    style="width: 48%; margin-left: 4%"
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
            <el-form-item label="天气">
              <el-input v-model="form.weather" />
            </el-form-item>
            <el-form-item label="土质">
              <el-input v-model="form.soil_type" />
            </el-form-item>
            <el-form-item label="问题摘要">
              <el-input
                v-model="form.issue_summary"
                type="textarea"
                :rows="3"
              />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="form.remark" type="textarea" :rows="3" />
            </el-form-item>
          </div>

          <div v-if="isWritingProject" class="form-section">
            <div class="form-section__title">项目日志</div>
            <el-form-item label="标题">
              <el-input v-model="form.project_title" />
            </el-form-item>
            <el-form-item label="今日详情" required>
              <el-input
                v-model="form.project_detail"
                type="textarea"
                :rows="6"
                placeholder="填写今日现场概况、施工内容、协调事项"
              />
            </el-form-item>
            <el-form-item label="明日计划">
              <el-input
                v-model="form.tomorrow_plan"
                type="textarea"
                :rows="3"
              />
            </el-form-item>
            <el-form-item label="风险或协调事项">
              <el-input v-model="form.risk_note" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="现场照片">
              <el-upload
                action="#"
                accept="image/*"
                :show-file-list="false"
                :http-request="uploadPhoto"
                :disabled="uploading || submitting"
              >
                <el-button :loading="uploading">上传照片</el-button>
              </el-upload>
              <div v-if="photoFiles.length" class="photo-list">
                <div
                  v-for="(item, index) in photoFiles"
                  :key="item.file_key"
                  class="photo-item"
                >
                  <el-link :href="item.file_url" target="_blank">{{
                    item.file_name
                  }}</el-link>
                  <el-button
                    link
                    type="danger"
                    :disabled="submitting"
                    @click="removePhoto(index)"
                  >
                    移除
                  </el-button>
                </div>
              </div>
            </el-form-item>
          </div>

          <div class="submit-bar">
            <el-button
              type="primary"
              size="large"
              :loading="submitting"
              :disabled="submitDisabled"
              @click="submit"
            >
              {{ uploading ? "等待照片上传完成" : "提交日志" }}
            </el-button>
          </div>
        </el-form>
      </template>
    </section>
  </main>
</template>

<style scoped>
.public-log-page {
  min-height: 100vh;
  background: #f5f7fb;
  color: #1f2a37;
}

.public-log-header {
  padding: 22px 18px 18px;
  background: #163a5f;
  color: #fff;
}

.public-log-header__title {
  font-size: 14px;
  opacity: 0.82;
}

.public-log-header__project {
  margin-top: 8px;
  font-size: 22px;
  font-weight: 700;
}

.public-log-header__meta {
  margin-top: 6px;
  font-size: 13px;
  opacity: 0.78;
}

.content-panel,
.success-panel {
  max-width: 900px;
  margin: 0 auto;
  padding: 16px;
}

.top-actions {
  margin-bottom: 12px;
}

.notice-strip,
.view-header,
.previous-log__head {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.notice-strip {
  padding: 14px 16px;
  margin-bottom: 14px;
  background: #fff;
  border: 1px solid #dde4ee;
  border-radius: 8px;
}

.notice-strip span,
.section-subtitle {
  display: block;
  margin-top: 3px;
  font-size: 13px;
  color: #64748b;
}

.profile-chip {
  flex: 0 0 auto;
  padding: 6px 10px;
  font-size: 13px;
  color: #0f3d5f;
  background: #e9f2f8;
  border-radius: 999px;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.action-card {
  min-height: 132px;
  padding: 16px;
  text-align: left;
  cursor: pointer;
  background: #fff;
  border: 1px solid #d9e2ec;
  border-radius: 8px;
}

.action-card:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

.action-card--primary {
  border-color: #2d6c9f;
  box-shadow: inset 4px 0 0 #2d6c9f;
}

.action-card__label {
  display: inline-block;
  margin-bottom: 10px;
  font-size: 13px;
  color: #52657a;
}

.action-card strong {
  display: block;
  font-size: 20px;
  color: #152436;
}

.action-card small {
  display: block;
  margin-top: 10px;
  font-size: 13px;
  line-height: 1.5;
  color: #64748b;
}

.view-header,
.form-section,
.previous-log,
.log-card {
  padding: 16px;
  margin-bottom: 14px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.section-title,
.form-section__title {
  font-size: 16px;
  font-weight: 700;
}

.section-select {
  width: 100%;
  margin-bottom: 14px;
}

.section-meta {
  width: 100%;
  margin: 8px 0 14px;
  font-size: 13px;
  line-height: 1.5;
  color: #64748b;
}

.log-list {
  min-height: 180px;
}

.log-card__head {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 10px;
}

.log-card__head span,
.log-card__meta,
.log-card__muted {
  font-size: 13px;
  color: #64748b;
}

.log-card__text,
.log-card__muted {
  margin: 8px 0 0;
  line-height: 1.6;
  white-space: pre-wrap;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 10px 0;
}

.metric-grid div {
  padding: 10px;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.metric-grid small {
  display: block;
  font-size: 12px;
  color: #64748b;
}

.metric-grid strong {
  display: block;
  margin-top: 4px;
  font-size: 18px;
}

.previous-log__date {
  flex: 0 0 auto;
  font-size: 13px;
  color: #64748b;
}

.quick-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.photo-list {
  width: 100%;
  margin-top: 10px;
}

.photo-item {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #edf0f4;
}

.submit-bar {
  position: sticky;
  bottom: 0;
  padding: 12px 0 18px;
  background: linear-gradient(180deg, rgb(245 247 251 / 0), #f5f7fb 30%);
}

.submit-bar .el-button {
  width: 100%;
}

@media (max-width: 640px) {
  .action-grid,
  .metric-grid {
    grid-template-columns: 1fr;
  }

  .notice-strip,
  .view-header,
  .previous-log__head,
  .log-card__head {
    display: block;
  }

  .profile-chip,
  .previous-log__date {
    display: inline-block;
    margin-top: 10px;
  }
}
</style>
