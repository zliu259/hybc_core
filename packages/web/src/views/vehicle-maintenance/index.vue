<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import type { UploadRequestOptions } from "element-plus";
import { message } from "@/utils/message";
import { statusLabel } from "@/utils/enum-labels";
import { useUserStoreHook } from "@/store/modules/user";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { listFleetVehicles, type FleetVehicle } from "@/api/fleet";
import {
  createMaintenanceRecord,
  getMaintenanceRecord,
  listMaintenanceRecords,
  listMaintenanceTypes,
  updateMaintenanceRecord,
  voidMaintenanceRecord,
  type MaintenanceAttachment,
  type MaintenanceCreatePayload,
  type MaintenanceTypeOption,
  type VehicleMaintenanceRecord
} from "@/api/vehicle-maintenance";

const userStore = useUserStoreHook();
const canManage = computed(() =>
  (userStore.roles ?? []).some(role =>
    ["super_admin", "manager", "finance", "site_manager"].includes(role)
  )
);

const loading = ref(false);
const records = ref<VehicleMaintenanceRecord[]>([]);
const vehicles = ref<FleetVehicle[]>([]);
const maintenanceTypes = ref<MaintenanceTypeOption[]>([]);
const pagination = reactive({ page: 1, pageSize: 20, total: 0 });

const filters = reactive<{
  vehicle_id: number | undefined;
  maintenance_type: string | undefined;
  status: string | undefined;
  date_from: string | undefined;
  date_to: string | undefined;
}>({
  vehicle_id: undefined,
  maintenance_type: undefined,
  status: undefined,
  date_from: undefined,
  date_to: undefined
});

const parseAttachments = (raw: string | null): MaintenanceAttachment[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MaintenanceAttachment[]) : [];
  } catch {
    return [];
  }
};

const typeLabel = (value: string) =>
  maintenanceTypes.value.find(item => item.dict_value === value)?.dict_label ?? value;

const vehicleLabel = (row: VehicleMaintenanceRecord) =>
  row.current_plate_no ? `${row.current_plate_no}` : `车辆#${row.vehicle_id}`;

const loadVehicles = async () => {
  const res = await listFleetVehicles({ status: "active" });
  vehicles.value = res.data ?? [];
};

const loadTypes = async () => {
  const res = await listMaintenanceTypes();
  maintenanceTypes.value = res.data ?? [];
};

const loadRecords = async () => {
  loading.value = true;
  try {
    const res = await listMaintenanceRecords({
      vehicle_id: filters.vehicle_id,
      maintenance_type: filters.maintenance_type,
      status: filters.status,
      date_from: filters.date_from,
      date_to: filters.date_to,
      page: pagination.page,
      pageSize: pagination.pageSize
    });
    records.value = res.data ?? [];
    pagination.total = res.pagination?.total ?? 0;
  } finally {
    loading.value = false;
  }
};

const onSearch = () => {
  pagination.page = 1;
  loadRecords();
};

const onPageChange = (page: number) => {
  pagination.page = page;
  loadRecords();
};

// ---- 新增/编辑对话框 ----
const dialogVisible = ref(false);
const editingId = ref<number | null>(null);
const submitting = ref(false);
const form = reactive<{
  vehicle_id: number | undefined;
  maintenance_type: string | undefined;
  content: string;
  mileage_km: number | undefined;
  service_provider: string;
  cost: number | undefined;
  serviced_at: string;
  remark: string;
  attachments: MaintenanceAttachment[];
}>({
  vehicle_id: undefined,
  maintenance_type: undefined,
  content: "",
  mileage_km: undefined,
  service_provider: "",
  cost: undefined,
  serviced_at: "",
  remark: "",
  attachments: []
});

const resetForm = () => {
  editingId.value = null;
  form.vehicle_id = undefined;
  form.maintenance_type = undefined;
  form.content = "";
  form.mileage_km = undefined;
  form.service_provider = "";
  form.cost = undefined;
  form.serviced_at = "";
  form.remark = "";
  form.attachments = [];
};

const openCreate = () => {
  resetForm();
  dialogVisible.value = true;
};

const openEdit = (row: VehicleMaintenanceRecord) => {
  resetForm();
  editingId.value = row.id;
  form.vehicle_id = row.vehicle_id;
  form.maintenance_type = row.maintenance_type;
  form.content = row.content;
  form.mileage_km = row.mileage_km;
  form.service_provider = row.service_provider ?? "";
  form.cost = row.cost ?? undefined;
  form.serviced_at = row.serviced_at?.slice(0, 10) ?? "";
  form.remark = row.remark ?? "";
  form.attachments = parseAttachments(row.attachments_json);
  dialogVisible.value = true;
};

const uploadAttachment = async (options: UploadRequestOptions) => {
  try {
    const signResult = await createUploadSignature({
      fileName: options.file.name,
      contentType: options.file.type || undefined,
      category: "vehicle-maintenance"
    });
    const uploadResp = await fetch(resolveUploadUrl(signResult.data.uploadUrl), {
      method: "PUT",
      headers: {
        "content-type": options.file.type || "application/octet-stream"
      },
      body: options.file
    });
    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }
    form.attachments.push({
      file_key: signResult.data.key,
      file_name: options.file.name,
      file_size: options.file.size
    });
    options.onSuccess?.({} as never);
    message("附件上传成功", { type: "success" });
  } catch {
    options.onError?.(new Error("upload_failed") as never);
    message("附件上传失败", { type: "error" });
  }
};

const removeFormAttachment = (index: number) => {
  form.attachments.splice(index, 1);
};

const buildPayload = (): MaintenanceCreatePayload | null => {
  if (!form.vehicle_id) {
    message("请选择车辆", { type: "warning" });
    return null;
  }
  if (!form.maintenance_type) {
    message("请选择保养类型", { type: "warning" });
    return null;
  }
  if (!form.content.trim()) {
    message("请填写保养内容", { type: "warning" });
    return null;
  }
  if (form.mileage_km === undefined || Number(form.mileage_km) < 0) {
    message("请填写有效里程", { type: "warning" });
    return null;
  }
  return {
    vehicle_id: form.vehicle_id,
    maintenance_type: form.maintenance_type,
    content: form.content.trim(),
    mileage_km: Number(form.mileage_km),
    service_provider: form.service_provider.trim() || null,
    cost: form.cost === undefined || form.cost === null ? null : Number(form.cost),
    serviced_at: form.serviced_at || undefined,
    attachments_json: JSON.stringify(form.attachments),
    remark: form.remark.trim() || null
  };
};

const submitForm = async () => {
  const payload = buildPayload();
  if (!payload) return;
  submitting.value = true;
  try {
    if (editingId.value) {
      await updateMaintenanceRecord(editingId.value, payload);
      message("保养记录已更新", { type: "success" });
    } else {
      await createMaintenanceRecord(payload);
      message("保养记录已新增", { type: "success" });
    }
    dialogVisible.value = false;
    await loadRecords();
  } catch (error) {
    message((error as Error)?.message || "提交失败", { type: "error" });
  } finally {
    submitting.value = false;
  }
};

const voidRecord = async (row: VehicleMaintenanceRecord) => {
  await voidMaintenanceRecord(row.id, { reason: "管理层作废" });
  message("记录已作废", { type: "success" });
  await loadRecords();
};

// ---- 详情抽屉 ----
const drawerVisible = ref(false);
const detail = ref<VehicleMaintenanceRecord | null>(null);
const detailAttachments = computed(() => parseAttachments(detail.value?.attachments_json ?? null));

const openDetail = async (row: VehicleMaintenanceRecord) => {
  const res = await getMaintenanceRecord(row.id);
  detail.value = res.data;
  drawerVisible.value = true;
};

const downloadAttachment = (att: MaintenanceAttachment) => {
  const url = resolveUploadUrl(`/api/v1/upload/object/${encodeURIComponent(att.file_key)}`);
  window.open(url, "_blank", "noopener,noreferrer");
};

onMounted(async () => {
  await Promise.all([loadVehicles(), loadTypes()]);
  await loadRecords();
});
</script>

<template>
  <el-card shadow="never" :loading="loading">
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center">
        <span>车辆保养记录</span>
        <el-button type="primary" @click="openCreate">新增保养记录</el-button>
      </div>
    </template>

    <el-form inline>
      <el-form-item label="车辆">
        <el-select
          v-model="filters.vehicle_id"
          clearable
          filterable
          placeholder="全部车辆"
          style="width: 200px"
          @change="onSearch"
        >
          <el-option
            v-for="v in vehicles"
            :key="v.id"
            :label="v.current_plate_no"
            :value="v.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="保养类型">
        <el-select
          v-model="filters.maintenance_type"
          clearable
          placeholder="全部类型"
          style="width: 160px"
          @change="onSearch"
        >
          <el-option
            v-for="t in maintenanceTypes"
            :key="t.dict_value"
            :label="t.dict_label"
            :value="t.dict_value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="状态">
        <el-select
          v-model="filters.status"
          clearable
          placeholder="全部"
          style="width: 120px"
          @change="onSearch"
        >
          <el-option label="有效" value="active" />
          <el-option label="已作废" value="voided" />
        </el-select>
      </el-form-item>
      <el-form-item label="保养日期">
        <el-date-picker
          v-model="filters.date_from"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="起"
          style="width: 150px"
          @change="onSearch"
        />
        <span style="margin: 0 6px">至</span>
        <el-date-picker
          v-model="filters.date_to"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="止"
          style="width: 150px"
          @change="onSearch"
        />
      </el-form-item>
    </el-form>

    <el-table :data="records" style="margin-top: 12px">
      <el-table-column prop="record_no" label="保养单号" min-width="150" />
      <el-table-column label="车辆" width="120">
        <template #default="scope">{{ vehicleLabel(scope.row) }}</template>
      </el-table-column>
      <el-table-column label="类型" width="110">
        <template #default="scope">{{ typeLabel(scope.row.maintenance_type) }}</template>
      </el-table-column>
      <el-table-column prop="mileage_km" label="里程(km)" width="110" />
      <el-table-column prop="cost" label="费用(元)" width="110" />
      <el-table-column prop="serviced_at" label="保养时间" width="120">
        <template #default="scope">{{ scope.row.serviced_at?.slice(0, 10) }}</template>
      </el-table-column>
      <el-table-column prop="created_by_userid" label="登记人" width="120" />
      <el-table-column label="状态" width="90">
        <template #default="scope">
          <el-tag :type="scope.row.status === 'active' ? 'success' : 'info'">
            {{ statusLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="scope">
          <el-button link type="primary" @click="openDetail(scope.row)">详情</el-button>
          <el-button
            v-if="canManage && scope.row.status === 'active'"
            link
            type="primary"
            @click="openEdit(scope.row)"
          >
            编辑
          </el-button>
          <el-popconfirm
            v-if="canManage && scope.row.status === 'active'"
            title="确认作废该记录？"
            @confirm="voidRecord(scope.row)"
          >
            <template #reference>
              <el-button link type="danger">作废</el-button>
            </template>
          </el-popconfirm>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      style="margin-top: 12px; justify-content: flex-end"
      layout="total, prev, pager, next"
      :total="pagination.total"
      :page-size="pagination.pageSize"
      :current-page="pagination.page"
      @current-change="onPageChange"
    />
  </el-card>

  <!-- 新增/编辑对话框 -->
  <el-dialog
    v-model="dialogVisible"
    :title="editingId ? '编辑保养记录' : '新增保养记录'"
    width="640px"
  >
    <el-form label-width="90px">
      <el-form-item label="车辆" required>
        <el-select v-model="form.vehicle_id" filterable placeholder="请选择车辆" style="width: 100%">
          <el-option v-for="v in vehicles" :key="v.id" :label="v.current_plate_no" :value="v.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="保养类型" required>
        <el-select v-model="form.maintenance_type" placeholder="请选择类型" style="width: 100%">
          <el-option
            v-for="t in maintenanceTypes"
            :key="t.dict_value"
            :label="t.dict_label"
            :value="t.dict_value"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="保养内容" required>
        <el-input v-model="form.content" type="textarea" :rows="3" placeholder="保养/维修内容" />
      </el-form-item>
      <el-form-item label="里程(km)" required>
        <el-input-number v-model="form.mileage_km" :min="0" :controls="false" style="width: 100%" />
      </el-form-item>
      <el-form-item label="保养人">
        <el-input v-model="form.service_provider" placeholder="修理厂/4S店/保养人姓名" />
      </el-form-item>
      <el-form-item label="费用(元)">
        <el-input-number v-model="form.cost" :min="0" :controls="false" style="width: 100%" />
      </el-form-item>
      <el-form-item label="保养时间">
        <el-date-picker
          v-model="form.serviced_at"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="默认今天"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" placeholder="可选" />
      </el-form-item>
      <el-form-item label="附件">
        <el-upload :http-request="uploadAttachment" :show-file-list="false" multiple>
          <el-button>上传附件</el-button>
        </el-upload>
        <div style="width: 100%; margin-top: 8px">
          <div
            v-for="(att, index) in form.attachments"
            :key="att.file_key"
            style="display: flex; align-items: center; gap: 8px"
          >
            <span>{{ att.file_name }}</span>
            <el-button link type="danger" @click="removeFormAttachment(index)">移除</el-button>
          </div>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submitForm">保存</el-button>
    </template>
  </el-dialog>

  <!-- 详情抽屉 -->
  <el-drawer v-model="drawerVisible" title="保养记录详情" size="420px">
    <template v-if="detail">
      <el-descriptions :column="1" border>
        <el-descriptions-item label="保养单号">{{ detail.record_no }}</el-descriptions-item>
        <el-descriptions-item label="车辆">
          {{ detail.current_plate_no || `车辆#${detail.vehicle_id}` }}
        </el-descriptions-item>
        <el-descriptions-item label="类型">{{ typeLabel(detail.maintenance_type) }}</el-descriptions-item>
        <el-descriptions-item label="里程(km)">{{ detail.mileage_km }}</el-descriptions-item>
        <el-descriptions-item label="保养人">{{ detail.service_provider || "-" }}</el-descriptions-item>
        <el-descriptions-item label="费用(元)">{{ detail.cost ?? "-" }}</el-descriptions-item>
        <el-descriptions-item label="保养时间">{{ detail.serviced_at?.slice(0, 10) }}</el-descriptions-item>
        <el-descriptions-item label="登记人">{{ detail.created_by_userid }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{ statusLabel(detail.status) }}</el-descriptions-item>
        <el-descriptions-item label="内容">{{ detail.content }}</el-descriptions-item>
        <el-descriptions-item label="备注">{{ detail.remark || "-" }}</el-descriptions-item>
      </el-descriptions>
      <div style="margin-top: 16px">
        <div style="font-weight: 600; margin-bottom: 8px">附件</div>
        <el-empty v-if="detailAttachments.length === 0" description="无附件" :image-size="60" />
        <div
          v-for="att in detailAttachments"
          :key="att.file_key"
          style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px"
        >
          <span>{{ att.file_name }}</span>
          <el-button link type="primary" @click="downloadAttachment(att)">下载</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>
