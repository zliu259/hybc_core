<script setup lang="ts">
import { ElMessageBox } from "element-plus";
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";

import {
  deleteDocFile,
  getDocConfig,
  getDocTree,
  listDocFiles
} from "@/api/wh/doc-library";
import type {
  DocCategory,
  DocFileRow,
  DocLibraryConfig,
  DocTree as DocTreeData
} from "@/api/wh/doc-library-types";
import { listDeviceCategories } from "@/api/wh/settings";
import { getWedriveStatus, remirrorDoc } from "@/api/wh/wedrive";
import type { DeviceCategory } from "@/api/wh/types";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import DocEditDialog from "./components/DocEditDialog.vue";
import DocHistoryDrawer from "./components/DocHistoryDrawer.vue";
import DocPreviewDialog from "./components/DocPreviewDialog.vue";
import DocShareDialog from "./components/DocShareDialog.vue";
import DocTable from "./components/DocTable.vue";
import DocTree from "./components/DocTree.vue";
import DocUploadDialog from "./components/DocUploadDialog.vue";
import FolderImportDialog from "./components/FolderImportDialog.vue";
import {
  buildTreeNodes,
  GENERAL_OWNER,
  treeSelection,
  type DocOwner,
  type DocTreeNode,
  type DocTreeSelection
} from "./doc-view";

defineOptions({ name: "WhDocLibrary" });

const route = useRoute();
const { caps, load: loadCaps } = useWhCapabilities();
const { busy, run } = useWhAction();

const config = ref<DocLibraryConfig | null>(null);
const deviceCategories = ref<DeviceCategory[]>([]);
const tree = ref<DocTreeData | null>(null);
const selection = ref<DocTreeSelection>({ kind: "all" });
const currentKey = ref("all");
/** 选中那一项叫什么：从目录里找；带着设备过来、目录还没取到时先用个说法顶着 */
const currentLabel = computed(() => {
  const nodes = buildTreeNodes(tree.value);
  const all = nodes.flatMap(node => [node, ...(node.children ?? [])]);
  return all.find(node => node.key === currentKey.value)?.label ?? "这台设备";
});
const filters = reactive<{
  doc_category?: DocCategory;
  keyword: string;
  expiring: boolean;
  history: boolean;
}>({ keyword: "", expiring: false, history: false });
const page = reactive({ page: 1, pageSize: 20, total: 0 });
const rows = ref<DocFileRow[]>([]);
/** 「微盘」一列和「重新同步」：建过微盘空间、看的人是库管或资料管理员才出现 */
const showMirror = ref(false);

const active = ref<DocFileRow | null>(null);
const previewVisible = ref(false);
const editVisible = ref(false);
const historyVisible = ref(false);
const historyId = ref<number | null>(null);
const shareVisible = ref(false);
const uploadVisible = ref(false);
const importVisible = ref(false);
const replaceTarget = ref<DocFileRow | null>(null);

/** 上传时默认归到左边选中的那一项；选的是「全部」时让人自己挑设备 */
const defaultOwner = computed<DocOwner>(() => {
  const current = selection.value;
  if (current.kind === "device") {
    return { kind: "device", deviceId: current.deviceId, categoryId: null };
  }
  if (current.kind === "category") {
    return { kind: "category", deviceId: null, categoryId: current.categoryId };
  }
  if (current.kind === "general") return GENERAL_OWNER;
  return { kind: "device", deviceId: null, categoryId: null };
});

const load = async () => {
  const result = await run(() =>
    listDocFiles({
      ...treeSelection(selection.value),
      doc_category: filters.doc_category,
      keyword: filters.keyword.trim() || undefined,
      validity: filters.expiring ? "expiring" : undefined,
      include_history: filters.history ? "1" : undefined,
      page: page.page,
      pageSize: page.pageSize
    })
  );
  if (!result) return;
  rows.value = result.data;
  page.total = result.pagination.total;
};

const loadTree = async () => {
  try {
    tree.value = (await getDocTree()).data;
  } catch (error) {
    console.error("[doc-library] 目录加载失败", error);
  }
};

/** 微盘镜像建没建过。只有管资料的人问得到；问不到就当没有，不打扰别的功能。 */
const loadMirror = async () => {
  if (!caps.value?.is_doc_admin) return;
  try {
    showMirror.value = (await getWedriveStatus()).data.initialized;
  } catch (error) {
    console.error("[doc-library] 微盘镜像状态加载失败", error);
  }
};

const reload = async () => {
  page.page = 1;
  await load();
};
/** 改、删、传之后：列表和目录上的数字都要变 */
const refresh = () => Promise.all([load(), loadTree()]);

const selectNode = (node: DocTreeNode) => {
  selection.value = node.selection;
  currentKey.value = node.key;
  void reload();
};

const openPreview = (row: DocFileRow) => {
  active.value = row;
  previewVisible.value = true;
};
const openEdit = (row: DocFileRow) => {
  active.value = row;
  editVisible.value = true;
};
const openUpload = () => {
  replaceTarget.value = null;
  uploadVisible.value = true;
};
const openReplace = (row: DocFileRow) => {
  replaceTarget.value = row;
  uploadVisible.value = true;
};
const openShare = (row: DocFileRow) => {
  active.value = row;
  shareVisible.value = true;
};
const openHistory = (row: DocFileRow) => {
  historyId.value = row.id;
  historyVisible.value = true;
};

const remove = async (row: DocFileRow) => {
  try {
    await ElMessageBox.confirm(
      `删除后 Web 和小程序上都看不到，对外链接同时失效。${
        row.supersedes_id !== null ? "它替换掉的上一版会重新显示出来。" : ""
      }`,
      `删除「${row.title}」？`,
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
    );
  } catch {
    return;
  }
  await run(() => deleteDocFile(row.id, row.version), { success: "已删除" });
  // 不管成没成都刷一遍：失败多半是别人刚动过
  await refresh();
};

const remirror = async (row: DocFileRow) => {
  await run(() => remirrorDoc(row.id), {
    success: "已排上，过一会儿刷新看结果"
  });
  await load();
};

onMounted(async () => {
  // 从设备详情带着设备过来：直接筛到那台
  const deviceId = Number(route.query.device_id);
  if (Number.isInteger(deviceId) && deviceId > 0) {
    selection.value = { kind: "device", deviceId };
    currentKey.value = `device-${deviceId}`;
  }
  // 从总览的「证书到期」过来：只看快到期和已过期的
  if (route.query.expiring === "1") filters.expiring = true;
  const [configResult, categoryResult] = await Promise.all([
    run(() => getDocConfig()),
    run(() => listDeviceCategories()),
    loadCaps(),
    loadTree()
  ]);
  if (configResult) config.value = configResult.data;
  if (categoryResult) deviceCategories.value = categoryResult.data;
  await Promise.all([load(), loadMirror()]);
});
</script>

<template>
  <el-card shadow="never" class="doc-library">
    <div class="layout">
      <aside class="side">
        <div class="side-title">按设备找</div>
        <DocTree :tree="tree" :current="currentKey" @select="selectNode" />
      </aside>
      <section v-loading="busy" class="main">
        <div class="toolbar">
          <span class="where">{{ currentLabel }}</span>
          <el-select
            v-model="filters.doc_category"
            clearable
            placeholder="全部资料类别"
            style="width: 150px"
            @change="reload"
          >
            <el-option
              v-for="item in config?.categories ?? []"
              :key="item.key"
              :label="item.label"
              :value="item.key"
            />
          </el-select>
          <el-input
            v-model="filters.keyword"
            clearable
            placeholder="标题、文件名、设备编号"
            style="width: 220px"
            @change="reload"
          />
          <el-checkbox v-model="filters.expiring" @change="reload"
            >只看快到期和已过期的</el-checkbox
          >
          <el-checkbox v-model="filters.history" @change="reload"
            >显示旧版本</el-checkbox
          >
          <div class="spacer" />
          <template v-if="caps?.is_doc_admin">
            <el-button type="primary" @click="openUpload">上传</el-button>
            <el-button @click="importVisible = true">按文件夹导入</el-button>
          </template>
        </div>
        <DocTable
          :rows="rows"
          :caps="caps"
          :doc-categories="config?.categories ?? []"
          :show-mirror="showMirror"
          @view="openPreview"
          @edit="openEdit"
          @history="openHistory"
          @replace="openReplace"
          @share="openShare"
          @remove="remove"
          @remirror="remirror"
        />
        <el-pagination
          v-model:current-page="page.page"
          v-model:page-size="page.pageSize"
          :total="page.total"
          :page-sizes="[20, 50, 100, 200]"
          layout="total, sizes, prev, pager, next"
          class="pager"
          @change="load"
        />
      </section>
    </div>
    <DocPreviewDialog v-model="previewVisible" :doc="active" />
    <DocEditDialog
      v-model="editVisible"
      :doc="active"
      :categories="deviceCategories"
      :doc-categories="config?.categories ?? []"
      @saved="refresh"
    />
    <DocShareDialog v-model="shareVisible" :doc="active" />
    <DocUploadDialog
      v-model="uploadVisible"
      :config="config"
      :categories="deviceCategories"
      :replace-target="replaceTarget"
      :default-owner="defaultOwner"
      :default-device-label="selection.kind === 'device' ? currentLabel : null"
      @uploaded="refresh"
    />
    <FolderImportDialog
      v-model="importVisible"
      :config="config"
      :categories="deviceCategories"
      @uploaded="refresh"
    />
    <DocHistoryDrawer
      v-model="historyVisible"
      :doc-id="historyId"
      @view="openPreview"
    />
  </el-card>
</template>

<style scoped>
.layout {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.side {
  flex: 0 0 230px;
  max-height: calc(100vh - 180px);
  padding-right: 12px;
  overflow: auto;
  border-right: 1px solid var(--el-border-color-lighter);
}

.side-title {
  margin-bottom: 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.main {
  flex: 1;
  min-width: 0;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  margin-bottom: 12px;
}

.where {
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.pager {
  justify-content: flex-end;
  margin-top: 12px;
}

@media (width <= 900px) {
  .layout {
    flex-direction: column;
  }

  .side {
    flex: none;
    width: 100%;
    max-height: 220px;
    padding-right: 0;
    border-right: none;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }
}
</style>
