<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { message } from "@/utils/message";
import { fileCategoryLabel } from "@/utils/enum-labels";
import { formatToken, getToken } from "@/utils/auth";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import {
  createProjectFile,
  deleteProjectFile,
  listProjectFiles,
  listProjectSections,
  type ProjectFile,
  type ProjectSection
} from "@/api/project";

const props = defineProps<{ projectId: number }>();

const loading = ref(false);
const uploading = ref(false);
const rows = ref<ProjectFile[]>([]);
const sections = ref<ProjectSection[]>([]);

const drawerVisible = ref(false);
const currentFile = ref<ProjectFile | null>(null);

const form = ref({
  section_id: null as number | null,
  category: "project_doc",
  remark: ""
});

const sectionOptions = computed(() =>
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

const loadData = async () => {
  if (!props.projectId) return;
  loading.value = true;
  try {
    const [fileRes, sectionRes] = await Promise.all([
      listProjectFiles(props.projectId),
      listProjectSections(props.projectId)
    ]);
    rows.value = fileRes.data;
    sections.value = sectionRes.data;
  } finally {
    loading.value = false;
  }
};

const openDrawer = (row: ProjectFile) => {
  currentFile.value = row;
  drawerVisible.value = true;
};

const uploadBySignedUrl = async (options: UploadRequestOptions) => {
  if (!props.projectId) return;
  uploading.value = true;
  try {
    const rawFile = options.file;
    const signRes = await createUploadSignature({
      fileName: rawFile.name,
      contentType: rawFile.type,
      category: `project/${props.projectId}`
    });
    const sign = signRes.data;

    const uploadResp = await fetch(resolveUploadUrl(sign.uploadUrl), {
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
      file_key: sign.key,
      file_size: rawFile.size,
      category: form.value.category || null,
      section_id: form.value.section_id,
      remark: form.value.remark || null
    });

    message("文件上传成功", { type: "success" });
    options.onSuccess?.({});
    await loadData();
  } catch {
    message("文件上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploading.value = false;
  }
};

const removeFile = async (row: ProjectFile) => {
  await deleteProjectFile(props.projectId, row.id);
  message("文件已移除", { type: "success" });
  await loadData();
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
  <el-card v-loading="loading" shadow="never" header="文件库">
    <div class="toolbar">
      <el-select
        v-model="form.section_id"
        clearable
        placeholder="按工作段过滤/绑定"
        style="width: 240px"
      >
        <el-option
          v-for="item in sectionOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-input
        v-model="form.category"
        placeholder="分类"
        style="width: 160px"
      />
      <el-input
        v-model="form.remark"
        placeholder="备注（可选）"
        style="width: 280px"
      />
      <el-upload
        action="#"
        :show-file-list="false"
        :http-request="uploadBySignedUrl"
        :disabled="uploading"
      >
        <el-button type="primary" :loading="uploading">上传文件</el-button>
      </el-upload>
    </div>

    <el-table :data="rows" size="small" stripe style="margin-top: 10px">
      <el-table-column prop="file_name" label="文件名" min-width="220" />
      <el-table-column label="工作段" min-width="160">
        <template #default="scope">
          {{
            scope.row.section_code
              ? `${scope.row.section_code} | ${scope.row.section_name}`
              : "项目级"
          }}
        </template>
      </el-table-column>
      <el-table-column label="分类" width="140">
        <template #default="scope">{{
          fileCategoryLabel(scope.row.category)
        }}</template>
      </el-table-column>
      <el-table-column label="大小" width="110">
        <template #default="scope">{{
          formatBytes(scope.row.file_size)
        }}</template>
      </el-table-column>
      <el-table-column prop="uploaded_by_userid" label="上传人" width="120" />
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openDrawer(scope.row)"
            >详情</el-button
          >
          <el-link :href="scope.row.file_url" target="_blank" type="primary"
            >查看</el-link
          >
          <el-popconfirm
            title="确认移除该文件？"
            @confirm="removeFile(scope.row)"
          >
            <template #reference>
              <el-button link type="danger">移除</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-drawer
    v-model="drawerVisible"
    title="文件详情"
    size="520px"
    destroy-on-close
  >
    <el-descriptions :column="1" border>
      <el-descriptions-item label="文件名">{{
        currentFile?.file_name
      }}</el-descriptions-item>
      <el-descriptions-item label="分类">{{
        currentFile?.category ? fileCategoryLabel(currentFile.category) : "-"
      }}</el-descriptions-item>
      <el-descriptions-item label="工作段">
        {{
          currentFile?.section_code
            ? `${currentFile?.section_code} | ${currentFile?.section_name}`
            : "项目级"
        }}
      </el-descriptions-item>
      <el-descriptions-item label="大小">
        {{ formatBytes(currentFile?.file_size || null) }}
      </el-descriptions-item>
      <el-descriptions-item label="上传人">{{
        currentFile?.uploaded_by_userid
      }}</el-descriptions-item>
      <el-descriptions-item label="备注">{{
        currentFile?.remark || "-"
      }}</el-descriptions-item>
    </el-descriptions>
  </el-drawer>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
</style>
