<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  addAssetDocument,
  addAssetEvent,
  getTrackedAsset,
  type TrackedAsset,
  updateTrackedAsset
} from "@/api/asset";

defineOptions({ name: "AssetDetail" });

type AssetDocument = {
  id: number;
  doc_type: string;
  file_key: string;
  file_name: string | null;
  remark: string | null;
  created_at: string;
};

type AssetEvent = {
  id: number;
  event_type: string;
  event_time: string;
  operator_userid: string;
  detail: string | null;
};

const route = useRoute();
const router = useRouter();
const id = computed(() => Number(route.params.id));

const loading = ref(false);
const saving = ref(false);
const asset = ref<
  (TrackedAsset & { documents: AssetDocument[]; events: AssetEvent[] }) | null
>(null);

const form = ref({
  asset_name: "",
  brand: "",
  model: "",
  serial_no: "",
  status: "idle",
  current_location: "",
  properties_json: ""
});

const docDialogVisible = ref(false);
const docSubmitting = ref(false);
const docForm = ref({
  doc_type: "manual",
  file_key: "",
  file_name: "",
  remark: ""
});

const eventDialogVisible = ref(false);
const eventSubmitting = ref(false);
const eventForm = ref({
  event_type: "maintenance",
  event_time: "",
  detail: ""
});

const loadData = async () => {
  loading.value = true;
  try {
    const result = await getTrackedAsset(id.value);
    asset.value = result.data;
    form.value = {
      asset_name: result.data.asset_name,
      brand: result.data.brand ?? "",
      model: result.data.model ?? "",
      serial_no: result.data.serial_no ?? "",
      status: result.data.status,
      current_location: result.data.current_location ?? "",
      properties_json: result.data.properties_json ?? ""
    };
  } finally {
    loading.value = false;
  }
};

const saveAsset = async () => {
  saving.value = true;
  try {
    await updateTrackedAsset(id.value, {
      asset_name: form.value.asset_name,
      brand: form.value.brand || undefined,
      model: form.value.model || undefined,
      serial_no: form.value.serial_no || undefined,
      status: form.value.status,
      current_location: form.value.current_location || undefined,
      properties_json: form.value.properties_json || undefined
    });
    message("资产信息已更新", { type: "success" });
    await loadData();
  } finally {
    saving.value = false;
  }
};

const submitDocument = async () => {
  if (!docForm.value.file_key.trim()) {
    message("请填写文件Key", { type: "warning" });
    return;
  }
  docSubmitting.value = true;
  try {
    await addAssetDocument(id.value, {
      doc_type: docForm.value.doc_type,
      file_key: docForm.value.file_key,
      file_name: docForm.value.file_name || undefined,
      remark: docForm.value.remark || undefined
    });
    message("文档已添加", { type: "success" });
    docDialogVisible.value = false;
    await loadData();
  } finally {
    docSubmitting.value = false;
  }
};

const submitEvent = async () => {
  if (!eventForm.value.event_type.trim()) {
    message("请填写事件类型", { type: "warning" });
    return;
  }
  eventSubmitting.value = true;
  try {
    await addAssetEvent(id.value, {
      event_type: eventForm.value.event_type,
      event_time: eventForm.value.event_time || undefined,
      detail: eventForm.value.detail || undefined
    });
    message("事件已记录", { type: "success" });
    eventDialogVisible.value = false;
    await loadData();
  } finally {
    eventSubmitting.value = false;
  }
};

const goBack = () => router.push("/asset/list");

onMounted(loadData);
</script>

<template>
  <div v-loading="loading">
    <el-page-header style="margin-bottom: 16px" @back="goBack">
      <template #content>
        <span>{{ asset?.asset_code || "资产详情" }}</span>
      </template>
    </el-page-header>

    <el-row :gutter="16">
      <el-col :md="12" :xs="24">
        <el-card shadow="never" header="基础信息" style="background: #fffaf2">
          <el-form label-width="110px">
            <el-form-item label="资产名称">
              <el-input v-model="form.asset_name" />
            </el-form-item>
            <el-form-item label="品牌/型号">
              <el-input
                v-model="form.brand"
                placeholder="品牌"
                style="width: 48%; margin-right: 4%"
              />
              <el-input
                v-model="form.model"
                placeholder="型号"
                style="width: 48%"
              />
            </el-form-item>
            <el-form-item label="序列号">
              <el-input v-model="form.serial_no" />
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="form.status" style="width: 180px">
                <el-option label="idle" value="idle" />
                <el-option label="using" value="using" />
                <el-option label="repair" value="repair" />
                <el-option label="scrapped" value="scrapped" />
              </el-select>
            </el-form-item>
            <el-form-item label="当前位置">
              <el-input v-model="form.current_location" />
            </el-form-item>
            <el-form-item label="属性JSON">
              <el-input
                v-model="form.properties_json"
                type="textarea"
                :rows="4"
              />
            </el-form-item>
          </el-form>
          <el-button type="primary" :loading="saving" @click="saveAsset"
            >保存信息</el-button
          >
        </el-card>
      </el-col>

      <el-col :md="12" :xs="24">
        <el-card shadow="never" header="文档库" style="background: #fffaf2">
          <el-button type="primary" plain @click="docDialogVisible = true"
            >添加文档</el-button
          >
          <el-table :data="asset?.documents ?? []" style="margin-top: 12px">
            <el-table-column prop="doc_type" label="文档类型" width="120" />
            <el-table-column prop="file_name" label="文件名" min-width="140" />
            <el-table-column
              prop="file_key"
              label="文件Key"
              min-width="180"
              show-overflow-tooltip
            />
            <el-table-column prop="created_at" label="上传时间" width="180" />
          </el-table>
        </el-card>

        <el-card
          shadow="never"
          header="事件时间线"
          style="margin-top: 16px; background: #fffaf2"
        >
          <el-button type="primary" plain @click="eventDialogVisible = true"
            >记录事件</el-button
          >
          <el-timeline style="margin-top: 12px">
            <el-timeline-item
              v-for="item in asset?.events ?? []"
              :key="item.id"
              :timestamp="item.event_time"
              placement="top"
            >
              <div>{{ item.event_type }} · {{ item.operator_userid }}</div>
              <div style="color: #6e6458">{{ item.detail || "-" }}</div>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="docDialogVisible" title="添加文档" width="520px">
      <el-form label-width="100px">
        <el-form-item label="文档类型">
          <el-input v-model="docForm.doc_type" />
        </el-form-item>
        <el-form-item label="文件Key" required>
          <el-input v-model="docForm.file_key" />
        </el-form-item>
        <el-form-item label="文件名">
          <el-input v-model="docForm.file_name" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="docForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="docDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="docSubmitting"
          @click="submitDocument"
          >提交</el-button
        >
      </template>
    </el-dialog>

    <el-dialog v-model="eventDialogVisible" title="记录事件" width="520px">
      <el-form label-width="100px">
        <el-form-item label="事件类型" required>
          <el-input
            v-model="eventForm.event_type"
            placeholder="如 maintenance/repair/transfer"
          />
        </el-form-item>
        <el-form-item label="事件时间">
          <el-date-picker
            v-model="eventForm.event_time"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss[Z]"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="eventForm.detail" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="eventDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="eventSubmitting"
          @click="submitEvent"
          >提交</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>
