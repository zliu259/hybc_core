<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import { listProjects } from "@/api/project";
import {
  listWarehouses,
  type Warehouse,
  type WarehouseAssetWorkOrder,
  type WarehouseTaskEvidence
} from "@/api/warehouse";
import {
  addAssetDocument,
  addAssetEvent,
  getTrackedAsset,
  type TrackedAssetConfiguration,
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
  | (TrackedAsset & {
      documents: AssetDocument[];
      events: AssetEvent[];
      configurations: TrackedAssetConfiguration[];
      warehouse_tasks: Array<
        WarehouseAssetWorkOrder & {
          manual_title: string | null;
          manual_version_no: number | null;
        }
      >;
      task_evidence: Array<
        WarehouseTaskEvidence & {
          work_order_no: string;
          work_order_type: string;
          work_order_status: string;
          result_summary: string | null;
          manual_title: string | null;
          manual_version_no: number | null;
        }
      >;
    })
  | null
>(null);

type LocationOption = {
  label: string;
  value: string;
  kind: "warehouse" | "project" | "rent_out";
  warehouseId?: number;
  projectId?: number;
};

const warehouses = ref<Warehouse[]>([]);
const activeProjects = ref<
  Array<{ id: number; project_name: string; status: string }>
>([]);

const statusOptions = [
  { label: "在库", value: "idle" },
  { label: "出库中", value: "using" },
  { label: "返库待检", value: "returned_quarantine" },
  { label: "检查中", value: "inspection" },
  { label: "维护中", value: "maintenance" },
  { label: "保养中", value: "servicing" },
  { label: "改装中", value: "modification" },
  { label: "维修", value: "repair" },
  { label: "报废", value: "scrapped" }
];

const statusLabelMap: Record<string, string> = {
  idle: "在库",
  using: "出库中",
  returned_quarantine: "返库待检",
  quarantine: "返库待检",
  inspection: "检查中",
  maintenance: "维护中",
  servicing: "保养中",
  modification: "改装中",
  repair: "维修",
  scrapped: "报废"
};

const eventTypeLabelMap: Record<string, string> = {
  create: "建档",
  update: "更新",
  maintenance: "维护",
  repair: "维修",
  transfer: "调拨",
  check: "查验",
  incident: "事件",
  configuration_created: "组合配置创建",
  configuration_updated: "组合配置更新",
  work_order_created: "工单创建",
  work_order_submitted: "工单提审",
  work_order_assigned: "工单派工",
  work_order_started: "工单开始",
  work_order_completed: "工单完成",
  work_order_rejected: "工单退回",
  work_order_evidence: "任务证据",
  work_order_cancelled: "工单取消"
};

const taskStatusLabelMap: Record<string, string> = {
  draft: "草稿",
  pending_assignment: "待派工",
  assigned: "已派工",
  pending_approval: "审批中",
  approved: "已批准",
  in_progress: "执行中",
  submitted: "待复核",
  completed: "已完成",
  rejected: "已退回",
  cancelled: "已取消"
};

const workOrderTypeLabelMap: Record<string, string> = {
  inspection: "检查",
  maintenance: "维修",
  servicing: "保养",
  modification: "改装",
  scrapping: "报废"
};

const evidenceTypeLabelMap: Record<string, string> = {
  photo: "照片",
  video: "视频",
  voice: "语音",
  brief: "简报",
  document: "文档"
};

const configurationStatusLabelMap: Record<
  TrackedAssetConfiguration["status"],
  string
> = {
  planned: "待组装",
  assembling: "组装中",
  active: "生效中",
  disassembling: "拆解中",
  closed: "已关闭"
};

const docTypeOptions = [
  { label: "操作手册", value: "manual" },
  { label: "合格证", value: "certificate" },
  { label: "检查记录", value: "inspection" },
  { label: "合同文件", value: "contract" },
  { label: "图片资料", value: "image" },
  { label: "其他", value: "other" }
];

const docTypeLabelMap: Record<string, string> = {
  manual: "操作手册",
  certificate: "合格证",
  inspection: "检查记录",
  contract: "合同文件",
  image: "图片资料",
  other: "其他"
};

const locationOptions = computed<LocationOption[]>(() => {
  const options: LocationOption[] = [];
  warehouses.value.forEach(item => {
    options.push({
      label: `库房：${item.warehouse_name}`,
      value: `warehouse:${item.id}`,
      kind: "warehouse",
      warehouseId: item.id
    });
  });
  activeProjects.value.forEach(item => {
    options.push({
      label: `项目：${item.project_name}`,
      value: `project:${item.id}`,
      kind: "project",
      projectId: item.id
    });
  });
  options.push({ label: "出租", value: "rent_out", kind: "rent_out" });
  return options;
});

const form = ref({
  asset_name: "",
  brand: "",
  model: "",
  serial_no: "",
  status: "idle",
  ownership_type: "owned" as "owned" | "leased_in",
  current_location: "",
  remarks: ""
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
  event_type: "maintenance" as
    | "maintenance"
    | "repair"
    | "incident"
    | "transfer"
    | "check",
  event_time: "",
  detail: ""
});

const eventTypeOptions = [
  { label: "维护记录", value: "maintenance" },
  { label: "维修记录", value: "repair" },
  { label: "事件记录", value: "incident" },
  { label: "调拨记录", value: "transfer" },
  { label: "查验记录", value: "check" }
];

const selectedLocation = ref("");
const propertySnapshot = ref<Record<string, unknown> | null>(null);

const parseRemarkFromProperties = (value: string | null): string => {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      propertySnapshot.value = obj;
      const remark = obj.remark;
      if (typeof remark === "string") return remark;
      const spec = obj.spec;
      if (typeof spec === "string") return spec;
      return "";
    }
  } catch {
    return value;
  }
  return "";
};

const buildPropertiesJson = (remarks: string): string | undefined => {
  const base = propertySnapshot.value ? { ...propertySnapshot.value } : {};
  if (remarks.trim()) {
    base.remark = remarks.trim();
  } else {
    delete base.remark;
  }
  if (Object.keys(base).length === 0) return undefined;
  return JSON.stringify(base);
};

const toDisplayTime = (isoText: string): string => {
  const stamp = Date.parse(isoText);
  if (Number.isNaN(stamp)) return isoText;
  return new Date(stamp).toLocaleString("zh-CN", { hour12: false });
};

const toEventDetailText = (detail: string | null): string => {
  if (!detail) return "-";
  try {
    const parsed = JSON.parse(detail) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const text = (parsed as { text?: unknown }).text;
      if (typeof text === "string" && text.trim()) return text;
    }
  } catch {
    return detail;
  }
  return detail;
};

const resolveLocationSelection = (result: TrackedAsset) => {
  if (result.current_warehouse_id)
    return `warehouse:${result.current_warehouse_id}`;
  if (result.current_project_id) return `project:${result.current_project_id}`;
  if ((result.current_location ?? "").trim() === "出租") return "rent_out";
  return "";
};

const applyLocationSelection = (value: string) => {
  const target = locationOptions.value.find(item => item.value === value);
  if (!target) return;
  if (target.kind === "warehouse") {
    form.value.current_location = target.label;
  } else if (target.kind === "project") {
    form.value.current_location = target.label;
  } else {
    form.value.current_location = "出租";
  }
};

const loadMeta = async () => {
  const [warehouseRes, projectRes] = await Promise.all([
    listWarehouses(),
    listProjects({ page: 1, pageSize: 500 })
  ]);
  warehouses.value = warehouseRes.data;
  const doneStatuses = new Set([
    "completed",
    "closed",
    "cancelled",
    "archived",
    "done"
  ]);
  activeProjects.value = projectRes.data
    .filter(item => !doneStatuses.has((item.status || "").toLowerCase()))
    .map(item => ({
      id: item.id,
      project_name: item.project_name,
      status: item.status
    }));
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await getTrackedAsset(id.value);
    asset.value = result.data;
    propertySnapshot.value = null;
    form.value = {
      asset_name: result.data.asset_name,
      brand: result.data.brand ?? "",
      model: result.data.model ?? "",
      serial_no: result.data.serial_no ?? "",
      status: result.data.status,
      ownership_type: result.data.ownership_type ?? "owned",
      current_location: result.data.current_location ?? "",
      remarks: parseRemarkFromProperties(result.data.properties_json)
    };
    selectedLocation.value = resolveLocationSelection(result.data);
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
      ownership_type: form.value.ownership_type,
      current_project_id: selectedLocation.value.startsWith("project:")
        ? Number(selectedLocation.value.slice("project:".length))
        : undefined,
      current_warehouse_id: selectedLocation.value.startsWith("warehouse:")
        ? Number(selectedLocation.value.slice("warehouse:".length))
        : undefined,
      current_location: form.value.current_location || undefined,
      properties_json: buildPropertiesJson(form.value.remarks)
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
    message("请选择记录类型", { type: "warning" });
    return;
  }
  if (!eventForm.value.detail.trim()) {
    message("请填写记录说明", { type: "warning" });
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

const goBack = () => router.push("/warehouse-assets/ledger");

onMounted(async () => {
  await loadMeta();
  await loadData();
});
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
                <el-option
                  v-for="item in statusOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="归属">
              <el-select v-model="form.ownership_type" style="width: 180px">
                <el-option label="自有" value="owned" />
                <el-option label="租入" value="leased_in" />
              </el-select>
            </el-form-item>
            <el-form-item label="当前位置">
              <el-select
                v-model="selectedLocation"
                filterable
                clearable
                placeholder="请选择库房/施工项目/出租"
                style="width: 100%"
                @change="applyLocationSelection"
              >
                <el-option
                  v-for="item in locationOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="备注">
              <el-input
                v-model="form.remarks"
                type="textarea"
                :rows="4"
                placeholder="请填写设备使用备注，便于库房人员交接"
              />
            </el-form-item>
          </el-form>
          <el-button type="primary" :loading="saving" @click="saveAsset"
            >保存信息</el-button
          >
        </el-card>
      </el-col>

      <el-col :md="12" :xs="24">
        <el-card
          shadow="never"
          header="组合配置历史"
          style="background: #fffaf2; margin-bottom: 16px"
        >
          <el-empty
            v-if="!(asset?.configurations?.length ?? 0)"
            description="暂无组合配置记录"
          />
          <el-table v-else :data="asset?.configurations ?? []">
            <el-table-column
              prop="configuration_code"
              label="配置编号"
              min-width="150"
            />
            <el-table-column
              prop="whole_machine_code"
              label="整机编号"
              min-width="140"
            />
            <el-table-column label="状态" width="110">
              <template #default="scope">
                {{
                  configurationStatusLabelMap[scope.row.status] ||
                  scope.row.status
                }}
              </template>
            </el-table-column>
            <el-table-column prop="project_id" label="项目ID" width="100" />
            <el-table-column prop="warehouse_id" label="仓库ID" width="100" />
            <el-table-column
              prop="effective_from"
              label="生效开始"
              width="160"
            />
            <el-table-column prop="effective_to" label="生效结束" width="160" />
          </el-table>
        </el-card>

        <el-card
          shadow="never"
          header="库房任务追溯"
          style="background: #fffaf2; margin-bottom: 16px"
        >
          <el-empty
            v-if="!(asset?.warehouse_tasks?.length ?? 0)"
            description="暂无库房任务记录"
          />
          <el-table v-else :data="asset?.warehouse_tasks ?? []">
            <el-table-column
              prop="work_order_no"
              label="任务号"
              min-width="150"
            />
            <el-table-column label="类型" width="90">
              <template #default="scope">
                {{
                  workOrderTypeLabelMap[scope.row.work_order_type] ||
                  scope.row.work_order_type
                }}
              </template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="scope">
                {{ taskStatusLabelMap[scope.row.status] || scope.row.status }}
              </template>
            </el-table-column>
            <el-table-column
              prop="assignee_userid"
              label="执行人"
              width="120"
            />
            <el-table-column label="手册" min-width="160" show-overflow-tooltip>
              <template #default="scope">
                <span v-if="scope.row.manual_title">
                  {{ scope.row.manual_title }} v{{
                    scope.row.manual_version_no || "-"
                  }}
                </span>
                <span v-else>-</span>
              </template>
            </el-table-column>
            <el-table-column
              prop="result_summary"
              label="简报"
              min-width="180"
              show-overflow-tooltip
            />
          </el-table>
        </el-card>

        <el-card
          shadow="never"
          header="任务照片与简报"
          style="background: #fffaf2; margin-bottom: 16px"
        >
          <el-empty
            v-if="!(asset?.task_evidence?.length ?? 0)"
            description="暂无任务证据"
          />
          <el-table v-else :data="asset?.task_evidence ?? []">
            <el-table-column
              prop="work_order_no"
              label="任务号"
              min-width="150"
            />
            <el-table-column label="证据类型" width="100">
              <template #default="scope">
                {{
                  evidenceTypeLabelMap[scope.row.evidence_type] ||
                  scope.row.evidence_type
                }}
              </template>
            </el-table-column>
            <el-table-column
              prop="file_name"
              label="文件名"
              min-width="140"
              show-overflow-tooltip
            />
            <el-table-column
              prop="file_key"
              label="文件Key"
              min-width="170"
              show-overflow-tooltip
            />
            <el-table-column
              prop="summary"
              label="说明"
              min-width="180"
              show-overflow-tooltip
            />
            <el-table-column
              prop="operator_userid"
              label="提交人"
              width="120"
            />
            <el-table-column label="采集时间" width="180">
              <template #default="scope">{{
                toDisplayTime(scope.row.captured_at)
              }}</template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card shadow="never" header="文档库" style="background: #fffaf2">
          <el-button type="primary" plain @click="docDialogVisible = true"
            >添加文档</el-button
          >
          <el-table :data="asset?.documents ?? []" style="margin-top: 12px">
            <el-table-column label="文档类型" width="120">
              <template #default="scope">{{
                docTypeLabelMap[scope.row.doc_type] || scope.row.doc_type
              }}</template>
            </el-table-column>
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
              :timestamp="toDisplayTime(item.event_time)"
              placement="top"
            >
              <div>
                {{ eventTypeLabelMap[item.event_type] || item.event_type }} ·
                操作人：{{ item.operator_userid }}
              </div>
              <div style="color: #6e6458">
                {{ toEventDetailText(item.detail) }}
              </div>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="docDialogVisible" title="添加文档" width="520px">
      <el-form label-width="100px">
        <el-form-item label="文档类型">
          <el-select v-model="docForm.doc_type" style="width: 100%">
            <el-option
              v-for="item in docTypeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
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

    <el-dialog v-model="eventDialogVisible" title="记录维护/事件" width="520px">
      <el-form label-width="100px">
        <el-form-item label="记录类型" required>
          <el-select
            v-model="eventForm.event_type"
            placeholder="请选择维护或事件类型"
            style="width: 100%"
          >
            <el-option
              v-for="item in eventTypeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
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
          <el-input
            v-model="eventForm.detail"
            type="textarea"
            :rows="2"
            placeholder="请填写本次维护或事件说明"
          />
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
