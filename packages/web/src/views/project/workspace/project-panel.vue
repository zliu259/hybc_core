<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { message } from "@/utils/message";
import { useUserStoreHook } from "@/store/modules/user";
import { formatToken, getToken } from "@/utils/auth";
import { createUploadSignature } from "@/api/upload";
import {
  createProjectFile,
  deleteProjectFile,
  getProjectById,
  listProjectFiles,
  listProjectSections,
  updateProject,
  updateProjectStatus,
  type Project,
  type ProjectFile,
  type ProjectSection
} from "@/api/project";
import {
  listManagerLogs,
  listOperatorLogs,
  type ManagerLog,
  type OperatorLog
} from "@/api/log";
import { listBreakthroughReports, type BreakthroughReport } from "@/api/survey";

const props = defineProps<{ projectId: number }>();

const userStore = useUserStoreHook();
const loading = ref(false);
const saving = ref(false);
const project = ref<Project | null>(null);
const sections = ref<ProjectSection[]>([]);
const projectFiles = ref<ProjectFile[]>([]);
const operatorLogs = ref<OperatorLog[]>([]);
const managerLogs = ref<ManagerLog[]>([]);
const breakthroughReports = ref<BreakthroughReport[]>([]);

const sectionDialogVisible = ref(false);
const sectionDialogLoading = ref(false);
const currentSection = ref<ProjectSection | null>(null);
const sectionOperatorLogs = ref<OperatorLog[]>([]);
const sectionBreakthroughReports = ref<BreakthroughReport[]>([]);

const uploading = ref(false);
const uploadForm = ref({
  section_id: null as number | null,
  category: "project_doc",
  remark: ""
});

const form = ref({
  project_name: "",
  manager_userid: ""
});

const canUpload = computed(() => {
  const roles = userStore.roles ?? [];
  return roles.some(role =>
    ["super_admin", "manager", "site_manager", "operator"].includes(role)
  );
});

const sectionOptionList = computed(() =>
  sections.value.map(item => ({
    label: `${item.section_code} | ${item.section_name}`,
    value: item.id
  }))
);

const formatBytes = (size: number | null) => {
  if (!size || size <= 0) return "-";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

const loadProjectMain = async () => {
  const [detail, sectionData] = await Promise.all([
    getProjectById(props.projectId),
    listProjectSections(props.projectId)
  ]);
  project.value = detail.data;
  sections.value = sectionData.data;
  form.value.project_name = detail.data.project_name;
  form.value.manager_userid = detail.data.manager_userid || "";
};

const loadProjectFilesData = async () => {
  const res = await listProjectFiles(props.projectId);
  projectFiles.value = res.data;
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
    await Promise.all([
      loadProjectMain(),
      loadProjectFilesData(),
      loadProjectLogData()
    ]);
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
      manager_userid: form.value.manager_userid || null
    });
    message("项目信息已保存", { type: "success" });
    await loadProjectMain();
  } finally {
    saving.value = false;
  }
};

const setStatus = async (status: string) => {
  if (!project.value) return;
  await updateProjectStatus(project.value.id, status);
  message("状态已更新", { type: "success" });
  await loadProjectMain();
};

const openSectionDialog = async (section: ProjectSection) => {
  currentSection.value = section;
  sectionDialogVisible.value = true;
  sectionDialogLoading.value = true;
  try {
    const [sectionOperatorsRes, sectionBreakthroughRes] = await Promise.all([
      listOperatorLogs({
        project_id: props.projectId,
        section_id: section.id,
        page: 1,
        pageSize: 200
      }),
      listBreakthroughReports({
        project_id: props.projectId,
        section_id: section.id
      })
    ]);
    sectionOperatorLogs.value = sectionOperatorsRes.data;
    sectionBreakthroughReports.value = sectionBreakthroughRes.data;
  } finally {
    sectionDialogLoading.value = false;
  }
};

const uploadProjectFileBySignedUrl = async (options: UploadRequestOptions) => {
  if (!canUpload.value) {
    message("当前角色无上传权限", { type: "warning" });
    return;
  }
  if (!props.projectId) return;
  const rawFile = options.file;
  uploading.value = true;
  try {
    const signedRes = await createUploadSignature({
      fileName: rawFile.name,
      contentType: rawFile.type,
      category: `project/${props.projectId}`
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

    await createProjectFile(props.projectId, {
      file_name: rawFile.name,
      file_key: signed.key,
      file_size: rawFile.size,
      category: uploadForm.value.category || null,
      section_id: uploadForm.value.section_id,
      remark: uploadForm.value.remark || null
    });

    await loadProjectFilesData();
    message("项目文件上传成功", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("项目文件上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploading.value = false;
  }
};

const removeProjectFile = async (row: ProjectFile) => {
  await deleteProjectFile(props.projectId, row.id);
  message("文件已移除", { type: "success" });
  await loadProjectFilesData();
};

watch(
  () => props.projectId,
  () => {
    void loadData();
  }
);

onMounted(loadData);
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
          <el-input v-model="form.manager_userid" />
        </el-form-item>
        <el-form-item label="项目状态">
          <el-space>
            <el-tag>{{ project?.status }}</el-tag>
            <el-button size="small" @click="setStatus('planning')"
              >planning</el-button
            >
            <el-button size="small" @click="setStatus('preparing')"
              >preparing</el-button
            >
            <el-button size="small" @click="setStatus('active')"
              >active</el-button
            >
            <el-button size="small" @click="setStatus('completing')"
              >completing</el-button
            >
            <el-button size="small" @click="setStatus('archived')"
              >archived</el-button
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

    <el-card shadow="never" header="项目文件管理" class="mt-3">
      <div class="file-toolbar">
        <el-select
          v-model="uploadForm.section_id"
          clearable
          placeholder="绑定标段（可选）"
          style="width: 260px"
        >
          <el-option
            v-for="item in sectionOptionList"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-input
          v-model="uploadForm.category"
          placeholder="分类，例如 project_doc / drawing"
          style="width: 220px"
        />
        <el-input
          v-model="uploadForm.remark"
          placeholder="备注（可选）"
          style="width: 300px"
        />
        <el-upload
          action="#"
          :show-file-list="false"
          :http-request="uploadProjectFileBySignedUrl"
          :disabled="uploading || !canUpload"
        >
          <el-button type="primary" :loading="uploading" :disabled="!canUpload">
            上传项目文件
          </el-button>
        </el-upload>
      </div>

      <el-alert
        v-if="!canUpload"
        title="当前角色只读，可查看全部项目资料"
        type="info"
        :closable="false"
        class="mb-3"
      />

      <el-table :data="projectFiles" max-height="360">
        <el-table-column prop="file_name" label="文件名" min-width="220" />
        <el-table-column label="标段" min-width="160">
          <template #default="scope">
            {{
              scope.row.section_code
                ? `${scope.row.section_code} | ${scope.row.section_name}`
                : "项目级"
            }}
          </template>
        </el-table-column>
        <el-table-column prop="category" label="分类" width="140" />
        <el-table-column label="大小" width="120">
          <template #default="scope">{{
            formatBytes(scope.row.file_size)
          }}</template>
        </el-table-column>
        <el-table-column prop="uploaded_by_userid" label="上传人" width="120" />
        <el-table-column prop="created_at" label="上传时间" width="200" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="scope">
            <el-link :href="scope.row.file_url" target="_blank" type="primary"
              >查看</el-link
            >
            <el-popconfirm
              title="确认移除该文件？"
              @confirm="removeProjectFile(scope.row)"
            >
              <template #reference>
                <el-button link type="danger">移除</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" header="标段总览" class="mt-3">
      <el-table :data="sections">
        <el-table-column prop="section_code" label="标段编码" width="140" />
        <el-table-column prop="section_name" label="标段名称" min-width="200" />
        <el-table-column prop="section_length" label="里程(m)" width="120" />
        <el-table-column prop="status" label="状态" width="120" />
        <el-table-column label="日志数" width="120">
          <template #default="scope">
            {{
              operatorLogs.filter(item => item.section_id === scope.row.id)
                .length
            }}
          </template>
        </el-table-column>
        <el-table-column label="贯通报告" width="120">
          <template #default="scope">
            {{
              breakthroughReports.filter(
                item => item.section_id === scope.row.id
              ).length
            }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="scope">
            <el-button
              type="primary"
              link
              @click="openSectionDialog(scope.row)"
            >
              查看详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never" header="项目日志一站式视图" class="mt-3">
      <el-descriptions :column="3" border class="mb-3">
        <el-descriptions-item label="操作员日志总数">
          {{ operatorLogs.length }}
        </el-descriptions-item>
        <el-descriptions-item label="管理员日志总数">
          {{ managerLogs.length }}
        </el-descriptions-item>
        <el-descriptions-item label="贯通报告总数">
          {{ breakthroughReports.length }}
        </el-descriptions-item>
      </el-descriptions>

      <el-tabs>
        <el-tab-pane label="操作员日志">
          <el-table :data="operatorLogs" max-height="320">
            <el-table-column prop="log_date" label="日期" width="120" />
            <el-table-column prop="shift" label="班次" width="90" />
            <el-table-column label="标段" min-width="180">
              <template #default="scope">
                {{
                  sections.find(item => item.id === scope.row.section_id)
                    ?.section_name || "-"
                }}
              </template>
            </el-table-column>
            <el-table-column
              prop="completed_pipe_count"
              label="完成管节"
              width="110"
            />
            <el-table-column
              prop="cumulative_pipe_count"
              label="累计管节"
              width="110"
            />
            <el-table-column
              prop="issue_summary"
              label="问题摘要"
              min-width="220"
              show-overflow-tooltip
            />
            <el-table-column
              prop="operator_userid"
              label="填报人"
              width="120"
            />
            <el-table-column prop="status" label="状态" width="100" />
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="管理员日志">
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
            <el-table-column prop="status" label="状态" width="100" />
          </el-table>
        </el-tab-pane>

        <el-tab-pane label="贯通报告">
          <el-table :data="breakthroughReports" max-height="320">
            <el-table-column prop="report_no" label="报告号" width="180" />
            <el-table-column prop="report_date" label="报告日期" width="120" />
            <el-table-column label="标段" min-width="180">
              <template #default="scope">
                {{
                  sections.find(item => item.id === scope.row.section_id)
                    ?.section_name || "未绑定标段"
                }}
              </template>
            </el-table-column>
            <el-table-column
              prop="breakthrough_m"
              label="贯通里程(m)"
              width="120"
            />
            <el-table-column
              prop="summary"
              label="摘要"
              min-width="220"
              show-overflow-tooltip
            />
            <el-table-column prop="status" label="状态" width="100" />
          </el-table>
        </el-tab-pane>
      </el-tabs>
    </el-card>

    <el-dialog
      v-model="sectionDialogVisible"
      :title="`标段详情 - ${currentSection?.section_code || ''}`"
      width="1100px"
    >
      <div v-loading="sectionDialogLoading">
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
            currentSection?.status
          }}</el-descriptions-item>
        </el-descriptions>

        <el-row :gutter="16">
          <el-col :span="14">
            <el-card shadow="never" header="该标段操作员日志">
              <el-table :data="sectionOperatorLogs" max-height="320">
                <el-table-column prop="log_date" label="日期" width="120" />
                <el-table-column prop="shift" label="班次" width="80" />
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
              </el-table>
            </el-card>
          </el-col>

          <el-col :span="10">
            <el-card shadow="never" header="该标段绑定贯通报告">
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
                <el-table-column prop="status" label="状态" width="90" />
              </el-table>
            </el-card>
          </el-col>
        </el-row>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.file-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.mb-3 {
  margin-bottom: 12px;
}
</style>
