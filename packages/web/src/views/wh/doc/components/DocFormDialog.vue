<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";

import { uploadAttachmentFile } from "@/api/upload";
import { createWhDoc, getProjectHoldings } from "@/api/wh/doc";
import type { DeviceRow, WhDocResult } from "@/api/wh/types";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import { DOC_TYPE_LABELS } from "../../shared/labels";
import { useWhAction } from "../../shared/useWhAction";
import {
  buildDocPayload,
  newDocForm,
  prefillBackForm,
  validateDocForm,
  type DocFormState,
  type DocFormType
} from "../doc-form-model";
import DevicePicker from "./DevicePicker.vue";
import MaterialLineTable from "./MaterialLineTable.vue";

const props = defineProps<{ docType: DocFormType }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [result: WhDocResult] }>();

const { projects, loadProjects } = useProjectOptions();
const { busy, run } = useWhAction();
const form = ref<DocFormState>(newDocForm(props.docType));
const uploading = ref(false);

const title = computed(() => DOC_TYPE_LABELS[props.docType]);
const fromLabel = computed(() =>
  props.docType === "transfer" ? "来源项目" : "项目"
);

watch(visible, open => {
  if (open) form.value = newDocForm(props.docType);
});

watch(
  () => form.value.project_id,
  async projectId => {
    if (
      projectId === null ||
      (props.docType !== "back" && props.docType !== "transfer")
    )
      return;
    const result = await run(() => getProjectHoldings(projectId));
    if (result) form.value = prefillBackForm(form.value, result.data);
  }
);

const addDevice = (device: DeviceRow) => {
  form.value.devices = [
    ...form.value.devices,
    {
      device_id: device.id,
      device_code: device.device_code,
      name: device.name,
      usage_meters: "",
      soil_type: ""
    }
  ];
};

const upload = async (options: { file: File }) => {
  uploading.value = true;
  try {
    const uploaded = await uploadAttachmentFile(options.file, "wh-doc");
    form.value.photo_keys = [...form.value.photo_keys, uploaded.file_key];
  } catch (error) {
    message(resolveApiErrorMessage(error, "照片上传失败"), { type: "error" });
  } finally {
    uploading.value = false;
  }
};

const submit = async () => {
  const problem = validateDocForm(form.value);
  if (problem) {
    message(problem, { type: "warning" });
    return;
  }
  const result = await run(() => createWhDoc(buildDocPayload(form.value)));
  if (!result) return;
  const tasks = result.data.created_task_ids.length;
  message(
    tasks > 0
      ? `已提交 ${result.data.doc_no}，已生成 ${tasks} 个检查任务`
      : `已提交 ${result.data.doc_no}`,
    {
      type: "success"
    }
  );
  visible.value = false;
  emit("created", result.data);
};

onMounted(() => {
  loadProjects(100).catch(error =>
    message(resolveApiErrorMessage(error, "项目列表加载失败"), {
      type: "error"
    })
  );
});
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    width="860px"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <el-form label-width="90px">
      <el-form-item
        v-if="props.docType !== 'inbound'"
        :label="fromLabel"
        required
      >
        <el-select
          v-model="form.project_id"
          filterable
          placeholder="选择项目"
          style="width: 320px"
        >
          <el-option
            v-for="p in projects"
            :key="p.id"
            :label="p.project_name"
            :value="p.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item
        v-if="props.docType === 'transfer'"
        label="目的项目"
        required
      >
        <el-select
          v-model="form.to_project_id"
          filterable
          placeholder="选择项目"
          style="width: 320px"
        >
          <el-option
            v-for="p in projects"
            :key="p.id"
            :label="p.project_name"
            :value="p.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="props.docType === 'inbound'" label="供应商">
        <el-input
          v-model="form.counterparty"
          maxlength="80"
          style="width: 320px"
        />
      </el-form-item>
      <el-form-item
        v-if="props.docType === 'out' || props.docType === 'back'"
        label="领料人"
      >
        <el-input
          v-model="form.handover_name"
          maxlength="30"
          style="width: 200px"
          placeholder="交接人或司机"
        />
      </el-form-item>

      <el-form-item v-if="props.docType !== 'inbound'" label="设备">
        <div class="block">
          <el-table :data="form.devices" size="small" empty-text="没有设备">
            <el-table-column prop="device_code" label="编号" width="110" />
            <el-table-column prop="name" label="名称" min-width="160" />
            <template v-if="props.docType === 'back'">
              <el-table-column label="顶进距离(米)" width="130">
                <template #default="{ row }"
                  ><el-input v-model="row.usage_meters" size="small"
                /></template>
              </el-table-column>
              <el-table-column label="土质" width="120">
                <template #default="{ row }"
                  ><el-input
                    v-model="row.soil_type"
                    size="small"
                    maxlength="50"
                /></template>
              </el-table-column>
            </template>
            <el-table-column width="60">
              <template #default="{ $index }">
                <el-button
                  link
                  type="danger"
                  @click="
                    form.devices = form.devices.filter((_, i) => i !== $index)
                  "
                  >移除</el-button
                >
              </template>
            </el-table-column>
          </el-table>
          <DevicePicker
            v-if="props.docType === 'out'"
            state="available"
            :exclude-ids="form.devices.map(d => d.device_id)"
            style="margin-top: 8px"
            @pick="addDevice"
          />
        </div>
      </el-form-item>

      <el-form-item label="物资">
        <MaterialLineTable
          v-model="form.materials"
          class="block"
          :doc-type="props.docType"
          :allow-add="props.docType !== 'transfer'"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          v-model="form.remark"
          type="textarea"
          maxlength="300"
          :rows="2"
        />
      </el-form-item>
      <el-form-item label="照片">
        <el-upload
          :show-file-list="false"
          accept="image/*"
          multiple
          :http-request="upload"
        >
          <el-button :loading="uploading"
            >上传照片（{{ form.photo_keys.length }}）</el-button
          >
        </el-upload>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="busy" @click="submit">提交</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.block {
  width: 100%;
}
</style>
