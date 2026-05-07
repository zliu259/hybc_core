<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { listAssetTypes, type AssetType } from "@/api/asset";
import {
  createWarehouseManualAiDraft,
  createWarehouseManualBinding,
  createWarehouseManual,
  createWarehouseManualVersion,
  listWarehouseManualBindings,
  listWarehouseManuals,
  listWarehouseManualVersions,
  publishWarehouseManualVersion,
  submitWarehouseManualVersionReview,
  updateWarehouseManualBinding,
  type WarehouseManual,
  type WarehouseManualBinding,
  type WarehouseManualType,
  type WarehouseManualVersion
} from "@/api/warehouse-manual";

defineOptions({ name: "WarehouseManualLibrary" });

const loading = ref(false);
const manuals = ref<WarehouseManual[]>([]);
const versions = ref<WarehouseManualVersion[]>([]);
const bindings = ref<WarehouseManualBinding[]>([]);
const assetTypes = ref<AssetType[]>([]);
const selectedManualId = ref<number | null>(null);
const editorVisible = ref(false);
const versionVisible = ref(false);
const bindingVisible = ref(false);
const bindingSaving = ref(false);
const aiDraftLoading = ref(false);
const createForm = ref({
  manual_title: "",
  manual_type: "operation" as WarehouseManualType,
  asset_type_id: undefined as number | undefined,
  content_json: '{\n  "steps": []\n}'
});
const versionForm = ref({ content_json: '{\n  "steps": []\n}' });
const bindingForm = ref({
  id: 0,
  manual_id: undefined as number | undefined,
  asset_type_id: undefined as number | undefined,
  asset_model: "",
  work_order_type: undefined as string | undefined,
  configuration_role: undefined as string | undefined,
  status: "active" as WarehouseManualBinding["status"]
});

const typeOptions: Array<{ label: string; value: WarehouseManualType }> = [
  { label: "操作", value: "operation" },
  { label: "检查", value: "inspection" },
  { label: "维修", value: "maintenance" },
  { label: "保养", value: "servicing" },
  { label: "改装", value: "modification" },
  { label: "安全", value: "safety" }
];

const workOrderTypeOptions = [
  { label: "检查", value: "inspection" },
  { label: "维修", value: "maintenance" },
  { label: "保养", value: "servicing" },
  { label: "改装", value: "modification" },
  { label: "报废", value: "scrapping" }
];

const roleOptions = [
  { label: "整机", value: "whole_machine" },
  { label: "壳体", value: "shell" },
  { label: "机芯", value: "core" },
  { label: "操作台", value: "console" },
  { label: "通用", value: "generic" }
];

const versionStatusName = (status: WarehouseManualVersion["status"]) => {
  const statusMap: Record<WarehouseManualVersion["status"], string> = {
    draft: "草稿",
    reviewing: "待发布",
    published: "已发布",
    archived: "已归档"
  };
  return statusMap[status];
};

const assetTypeName = (id: number | null) => {
  if (!id) return "全部资产类型";
  return assetTypes.value.find(item => item.id === id)?.type_name || `#${id}`;
};

const workOrderTypeName = (type: string | null) => {
  if (!type) return "全部任务";
  return workOrderTypeOptions.find(item => item.value === type)?.label || type;
};

const roleName = (role: string | null) => {
  if (!role) return "全部组件";
  return roleOptions.find(item => item.value === role)?.label || role;
};

const modelName = (model: string | null) => {
  return model?.trim() || "全部型号";
};

const loadData = async () => {
  loading.value = true;
  try {
    const [manualRes, assetTypeRes, bindingRes] = await Promise.all([
      listWarehouseManuals(),
      listAssetTypes(),
      listWarehouseManualBindings()
    ]);
    manuals.value = manualRes.data;
    assetTypes.value = assetTypeRes.data;
    bindings.value = bindingRes.data;
  } finally {
    loading.value = false;
  }
};

const openVersions = async (row: WarehouseManual) => {
  selectedManualId.value = row.id;
  const result = await listWarehouseManualVersions(row.id);
  versions.value = result.data;
};

const submitCreate = async () => {
  if (!createForm.value.manual_title.trim()) {
    message("请输入手册标题", { type: "warning" });
    return;
  }
  await createWarehouseManual({
    manual_title: createForm.value.manual_title,
    manual_type: createForm.value.manual_type,
    asset_type_id: createForm.value.asset_type_id,
    content_json: createForm.value.content_json
  });
  editorVisible.value = false;
  message("手册已创建", { type: "success" });
  await loadData();
};

const submitVersion = async () => {
  if (!selectedManualId.value) return;
  await createWarehouseManualVersion(selectedManualId.value, {
    content_json: versionForm.value.content_json
  });
  versionVisible.value = false;
  message("新版本已保存", { type: "success" });
  const manual = manuals.value.find(item => item.id === selectedManualId.value);
  if (manual) await openVersions(manual);
  await loadData();
};

const publishVersion = async (version: WarehouseManualVersion) => {
  await publishWarehouseManualVersion(version.manual_id, version.id);
  message("手册版本已发布", { type: "success" });
  const manual = manuals.value.find(item => item.id === version.manual_id);
  if (manual) await openVersions(manual);
  await loadData();
};

const submitVersionReview = async (version: WarehouseManualVersion) => {
  await submitWarehouseManualVersionReview(version.manual_id, version.id);
  message("手册版本已提交审核", { type: "success" });
  const manual = manuals.value.find(item => item.id === version.manual_id);
  if (manual) await openVersions(manual);
  await loadData();
};

const createAiDraft = async () => {
  if (!selectedManualId.value) {
    message("请先选择手册", { type: "warning" });
    return;
  }
  const manual = manuals.value.find(item => item.id === selectedManualId.value);
  aiDraftLoading.value = true;
  try {
    const result = await createWarehouseManualAiDraft(selectedManualId.value, {
      source_limit: 20
    });
    message(`AI草稿已创建：v${result.data.version_no}`, { type: "success" });
    if (manual) await openVersions(manual);
    await loadData();
  } finally {
    aiDraftLoading.value = false;
  }
};

const openBindingCreate = () => {
  bindingForm.value = {
    id: 0,
    manual_id: selectedManualId.value ?? undefined,
    asset_type_id: undefined,
    asset_model: "",
    work_order_type: undefined,
    configuration_role: undefined,
    status: "active"
  };
  bindingVisible.value = true;
};

const openBindingEdit = (row: WarehouseManualBinding) => {
  bindingForm.value = {
    id: row.id,
    manual_id: row.manual_id,
    asset_type_id: row.asset_type_id ?? undefined,
    asset_model: row.asset_model ?? "",
    work_order_type: row.work_order_type ?? undefined,
    configuration_role: row.configuration_role ?? undefined,
    status: row.status
  };
  bindingVisible.value = true;
};

const submitBinding = async () => {
  if (!bindingForm.value.manual_id) {
    message("请选择手册", { type: "warning" });
    return;
  }
  bindingSaving.value = true;
  try {
    const payload = {
      manual_id: bindingForm.value.manual_id,
      asset_type_id: bindingForm.value.asset_type_id ?? null,
      asset_model: bindingForm.value.asset_model.trim() || null,
      work_order_type: bindingForm.value.work_order_type ?? null,
      configuration_role: bindingForm.value.configuration_role ?? null,
      status: bindingForm.value.status
    };
    if (bindingForm.value.id) {
      await updateWarehouseManualBinding(bindingForm.value.id, payload);
      message("绑定规则已更新", { type: "success" });
    } else {
      await createWarehouseManualBinding(payload);
      message("绑定规则已创建", { type: "success" });
    }
    bindingVisible.value = false;
    await loadData();
  } finally {
    bindingSaving.value = false;
  }
};

onMounted(loadData);
</script>

<template>
  <el-card v-loading="loading" shadow="never" class="page">
    <template #header>
      <div class="page__head">
        <div>
          <div class="page__title">操作手册库</div>
          <div class="page__sub">
            库房经验沉淀为版本化手册，任务执行时绑定到具体设备和任务
          </div>
        </div>
        <div class="page__actions">
          <el-button @click="openBindingCreate">新建绑定规则</el-button>
          <el-button type="primary" @click="editorVisible = true"
            >新建手册</el-button
          >
        </div>
      </div>
    </template>

    <div class="layout">
      <el-table :data="manuals" border height="560" @row-click="openVersions">
        <el-table-column prop="manual_code" label="手册编号" width="150" />
        <el-table-column prop="manual_title" label="标题" min-width="220" />
        <el-table-column prop="manual_type" label="类型" width="100" />
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column
          prop="latest_version_no"
          label="最新版本"
          width="100"
        />
      </el-table>

      <div class="version-panel">
        <div class="version-panel__head">
          <strong>版本记录</strong>
          <div class="version-panel__actions">
            <el-button
              size="small"
              :disabled="!selectedManualId"
              :loading="aiDraftLoading"
              @click="createAiDraft"
              >AI草稿</el-button
            >
            <el-button
              size="small"
              :disabled="!selectedManualId"
              @click="versionVisible = true"
              >新增版本</el-button
            >
          </div>
        </div>
        <el-table :data="versions" border height="516">
          <el-table-column prop="version_no" label="版本" width="80" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              {{ versionStatusName(row.status) }}
            </template>
          </el-table-column>
          <el-table-column
            prop="created_by_userid"
            label="创建人"
            width="130"
          />
          <el-table-column prop="created_at" label="创建时间" min-width="170" />
          <el-table-column label="操作" width="130">
            <template #default="{ row }">
              <el-button
                v-if="row.status === 'draft'"
                link
                type="primary"
                @click="submitVersionReview(row)"
                >提审</el-button
              >
              <el-button
                v-if="row.status === 'reviewing'"
                link
                type="primary"
                @click="publishVersion(row)"
                >发布</el-button
              >
              <span
                v-if="row.status === 'published' || row.status === 'archived'"
                class="muted"
                >-</span
              >
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <div class="binding-panel">
      <div class="binding-panel__head">
        <strong>自动匹配规则</strong>
        <span
          >任务创建时按型号、资产类型、任务类型、组件角色匹配已发布版本</span
        >
      </div>
      <el-table :data="bindings" border>
        <el-table-column prop="manual_title" label="手册" min-width="220" />
        <el-table-column label="资产类型" min-width="150">
          <template #default="{ row }">
            {{ assetTypeName(row.asset_type_id) }}
          </template>
        </el-table-column>
        <el-table-column label="型号" min-width="120">
          <template #default="{ row }">
            {{ modelName(row.asset_model) }}
          </template>
        </el-table-column>
        <el-table-column label="任务类型" width="110">
          <template #default="{ row }">
            {{ workOrderTypeName(row.work_order_type) }}
          </template>
        </el-table-column>
        <el-table-column label="组件角色" width="110">
          <template #default="{ row }">
            {{ roleName(row.configuration_role) }}
          </template>
        </el-table-column>
        <el-table-column label="发布版本" width="110">
          <template #default="{ row }">
            v{{ row.active_version_no || "-" }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button link type="primary" @click="openBindingEdit(row)"
              >编辑</el-button
            >
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="editorVisible" title="新建操作手册" width="640px">
      <el-form label-width="90px">
        <el-form-item label="标题">
          <el-input v-model="createForm.manual_title" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="createForm.manual_type" style="width: 100%">
            <el-option
              v-for="item in typeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="资产类型">
          <el-select
            v-model="createForm.asset_type_id"
            clearable
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="item in assetTypes"
              :key="item.id"
              :label="item.type_name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="内容">
          <el-input
            v-model="createForm.content_json"
            type="textarea"
            :rows="8"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="versionVisible" title="新增手册版本" width="640px">
      <el-input v-model="versionForm.content_json" type="textarea" :rows="12" />
      <template #footer>
        <el-button @click="versionVisible = false">取消</el-button>
        <el-button type="primary" @click="submitVersion">保存版本</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="bindingVisible" title="手册绑定规则" width="520px">
      <el-form label-width="90px">
        <el-form-item label="手册">
          <el-select
            v-model="bindingForm.manual_id"
            filterable
            style="width: 100%"
          >
            <el-option
              v-for="item in manuals"
              :key="item.id"
              :label="`${item.manual_title} (${item.manual_code})`"
              :value="item.id"
              :disabled="!item.active_version_id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="资产类型">
          <el-select
            v-model="bindingForm.asset_type_id"
            clearable
            filterable
            placeholder="全部资产类型"
            style="width: 100%"
          >
            <el-option
              v-for="item in assetTypes"
              :key="item.id"
              :label="item.type_name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="型号">
          <el-input
            v-model="bindingForm.asset_model"
            clearable
            placeholder="全部型号，或填写设备型号精确匹配"
          />
        </el-form-item>
        <el-form-item label="任务类型">
          <el-select
            v-model="bindingForm.work_order_type"
            clearable
            placeholder="全部任务"
            style="width: 100%"
          >
            <el-option
              v-for="item in workOrderTypeOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="组件角色">
          <el-select
            v-model="bindingForm.configuration_role"
            clearable
            placeholder="全部组件"
            style="width: 100%"
          >
            <el-option
              v-for="item in roleOptions"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="bindingForm.status">
            <el-radio-button label="active">启用</el-radio-button>
            <el-radio-button label="disabled">停用</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bindingVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="bindingSaving"
          @click="submitBinding"
          >保存</el-button
        >
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.page {
  background: #fffaf2;
}

.page__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.page__title {
  font-size: 20px;
  font-weight: 700;
  color: #2a241d;
}

.page__sub {
  margin-top: 4px;
  color: #6e6458;
}

.page__actions {
  display: flex;
  gap: 8px;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr);
  gap: 14px;
}

.version-panel {
  min-width: 0;
  padding: 12px;
  border: 1px solid #d9ceb9;
  border-radius: 8px;
  background: #fff;
}

.version-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.version-panel__actions {
  display: flex;
  gap: 8px;
}

.binding-panel {
  margin-top: 14px;
}

.binding-panel__head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}

.binding-panel__head span {
  color: #6e6458;
}

.muted {
  color: #9b9489;
}
</style>
