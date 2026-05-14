<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { message } from "@/utils/message";
import { resolveUploadUrl } from "@/api/upload";
import {
  createPublicProjectLogUploadSignature,
  getPublicProjectLogContext,
  submitPublicProjectLog,
  type PublicProjectLogProject,
  type PublicProjectLogSection
} from "@/api/public-project-log";

defineOptions({ name: "PublicProjectLog" });

const profileCacheKey = "hybc_public_log_profile_v1";

const route = useRoute();
const token = computed(() => String(route.params.token || ""));
const loading = ref(false);
const submitting = ref(false);
const uploading = ref(false);
const loadError = ref("");
const submitError = ref("");
const submittedId = ref<number | null>(null);
const submittedTaskId = ref<number | null>(null);
const project = ref<PublicProjectLogProject | null>(null);
const sections = ref<PublicProjectLogSection[]>([]);
const photoFiles = ref<
  Array<{ file_key: string; file_url: string; file_name: string }>
>([]);
const selectedLogTypes = ref<string[]>(["project_log", "operator_log"]);

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
const logTypeOptions = [
  { label: "项目日志", value: "project_log" },
  { label: "标段日志", value: "operator_log" }
];

const hasProjectLog = computed(() =>
  selectedLogTypes.value.includes("project_log")
);

const hasOperatorLog = computed(() =>
  selectedLogTypes.value.includes("operator_log")
);

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

const loadContext = async () => {
  loadError.value = "";
  loading.value = true;
  try {
    const result = await getPublicProjectLogContext(token.value);
    project.value = result.data.project;
    sections.value = result.data.sections;
    if (!form.value.section_id && sections.value.length > 0) {
      form.value.section_id = sections.value[0].id;
    }
  } catch (error) {
    loadError.value = getErrorMessage(
      error,
      "二维码已失效或项目暂不可填报，请联系项目管理员。"
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
  if (!hasProjectLog.value && !hasOperatorLog.value) {
    message("请选择项目日志或标段日志", { type: "warning" });
    return;
  }
  if (!form.value.log_date || !form.value.shift) {
    message("请填写日期和班次", { type: "warning" });
    return;
  }
  if (hasOperatorLog.value && !form.value.section_id) {
    message("填写标段日志时请选择标段", { type: "warning" });
    return;
  }
  if (hasProjectLog.value && !form.value.project_detail.trim()) {
    message("请填写项目日志内容", { type: "warning" });
    return;
  }

  submitting.value = true;
  try {
    cacheProfile();
    const result = await submitPublicProjectLog(token.value, {
      submitter_name: form.value.submitter_name.trim(),
      submitter_company: form.value.submitter_company.trim() || undefined,
      submitter_phone: form.value.submitter_phone.trim() || undefined,
      log_types: selectedLogTypes.value,
      section_id: hasOperatorLog.value ? (form.value.section_id ?? null) : null,
      log_date: form.value.log_date,
      shift: form.value.shift,
      operator_log: {
        enabled: hasOperatorLog.value,
        weather: form.value.weather.trim() || undefined,
        completed_pipe_count: form.value.completed_pipe_count,
        cumulative_pipe_count: form.value.cumulative_pipe_count,
        footage_m: form.value.footage_m,
        soil_type: form.value.soil_type.trim() || undefined,
        issue_summary: form.value.issue_summary.trim() || undefined,
        remark: form.value.remark.trim() || undefined
      },
      project_log: {
        enabled: hasProjectLog.value,
        title: form.value.project_title.trim() || undefined,
        detail_html: form.value.project_detail.trim(),
        tomorrow_plan: form.value.tomorrow_plan.trim() || undefined,
        risk_note: form.value.risk_note.trim() || undefined
      },
      photo_keys: photoFiles.value.map(item => item.file_key)
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
      <div class="public-log-header__title">外包日志填报</div>
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
        </template>
      </el-result>
    </section>

    <section v-else-if="loadError" class="success-panel">
      <el-result icon="warning" title="暂不可填报" :sub-title="loadError">
        <template #extra>
          <el-button :loading="loading" type="primary" @click="loadContext">
            重新加载
          </el-button>
        </template>
      </el-result>
    </section>

    <section v-else v-loading="loading" class="form-panel">
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
            <el-input v-model="form.submitter_name" placeholder="请输入姓名" />
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
          <div class="form-section__title">填写内容</div>
          <el-form-item label="日志类型" required>
            <el-checkbox-group v-model="selectedLogTypes">
              <el-checkbox-button
                v-for="item in logTypeOptions"
                :key="item.value"
                :label="item.value"
              >
                {{ item.label }}
              </el-checkbox-button>
            </el-checkbox-group>
          </el-form-item>
          <el-form-item label="日志日期" required>
            <el-date-picker
              v-model="form.log_date"
              type="date"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
          </el-form-item>
        </div>

        <div v-if="hasOperatorLog" class="form-section">
          <div class="form-section__title">标段施工日志</div>
          <el-form-item label="标段">
            <el-select v-model="form.section_id" filterable style="width: 100%">
              <el-option
                v-for="item in sections"
                :key="item.id"
                :label="`${item.section_code} ${item.section_name}`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-row :gutter="12">
            <el-col :xs="24" :sm="12">
              <el-form-item label="班次" required>
                <el-segmented v-model="form.shift" :options="shiftOptions" />
              </el-form-item>
            </el-col>
          </el-row>
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
          </el-row>
          <el-form-item label="天气">
            <el-input v-model="form.weather" />
          </el-form-item>
          <el-form-item label="土质">
            <el-input v-model="form.soil_type" />
          </el-form-item>
          <el-form-item label="问题摘要">
            <el-input v-model="form.issue_summary" type="textarea" :rows="3" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="3" />
          </el-form-item>
        </div>

        <div v-if="hasProjectLog" class="form-section">
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
            <el-input v-model="form.tomorrow_plan" type="textarea" :rows="3" />
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
    </section>
  </main>
</template>

<style scoped>
.public-log-page {
  min-height: 100vh;
  background: #f6f8fb;
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

.form-panel,
.success-panel {
  max-width: 860px;
  margin: 0 auto;
  padding: 16px;
}

.form-section {
  margin-bottom: 14px;
  padding: 16px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.form-section__title {
  margin-bottom: 12px;
  font-size: 16px;
  font-weight: 700;
}

.photo-list {
  width: 100%;
  margin-top: 10px;
}

.photo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid #edf0f4;
}

.submit-bar {
  position: sticky;
  bottom: 0;
  padding: 12px 0 18px;
  background: linear-gradient(180deg, rgb(246 248 251 / 0), #f6f8fb 30%);
}

.submit-bar .el-button {
  width: 100%;
}
</style>
