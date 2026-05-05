<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { listAssetTypes, type AssetType } from "@/api/asset";
import {
  createWarehouseManual,
  createWarehouseManualVersion,
  listWarehouseManuals,
  listWarehouseManualVersions,
  publishWarehouseManualVersion,
  type WarehouseManual,
  type WarehouseManualType,
  type WarehouseManualVersion
} from "@/api/warehouse-manual";

defineOptions({ name: "WarehouseManualLibrary" });

const loading = ref(false);
const manuals = ref<WarehouseManual[]>([]);
const versions = ref<WarehouseManualVersion[]>([]);
const assetTypes = ref<AssetType[]>([]);
const selectedManualId = ref<number | null>(null);
const editorVisible = ref(false);
const versionVisible = ref(false);
const createForm = ref({
  manual_title: "",
  manual_type: "operation" as WarehouseManualType,
  asset_type_id: undefined as number | undefined,
  content_json: '{\n  "steps": []\n}'
});
const versionForm = ref({ content_json: '{\n  "steps": []\n}' });

const typeOptions: Array<{ label: string; value: WarehouseManualType }> = [
  { label: "操作", value: "operation" },
  { label: "检查", value: "inspection" },
  { label: "维修", value: "maintenance" },
  { label: "保养", value: "servicing" },
  { label: "改装", value: "modification" },
  { label: "安全", value: "safety" }
];

const loadData = async () => {
  loading.value = true;
  try {
    const [manualRes, assetTypeRes] = await Promise.all([
      listWarehouseManuals(),
      listAssetTypes()
    ]);
    manuals.value = manualRes.data;
    assetTypes.value = assetTypeRes.data;
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
        <el-button type="primary" @click="editorVisible = true"
          >新建手册</el-button
        >
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
          <el-button
            size="small"
            :disabled="!selectedManualId"
            @click="versionVisible = true"
            >新增版本</el-button
          >
        </div>
        <el-table :data="versions" border height="516">
          <el-table-column prop="version_no" label="版本" width="80" />
          <el-table-column prop="status" label="状态" width="100" />
          <el-table-column
            prop="created_by_userid"
            label="创建人"
            width="130"
          />
          <el-table-column prop="created_at" label="创建时间" min-width="170" />
          <el-table-column label="操作" width="100">
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                :disabled="row.status === 'published'"
                @click="publishVersion(row)"
                >发布</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </div>
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
</style>
