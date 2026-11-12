<script setup lang="ts">
import { ElMessageBox } from "element-plus";
import { computed, ref, watch } from "vue";

import { listDevices } from "@/api/wh/device";
import type { DocLibraryConfig } from "@/api/wh/doc-library-types";
import type { DeviceCategory } from "@/api/wh/types";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import {
  defaultImportOwner,
  groupFolderImport,
  isJunkFile,
  uploadProblem,
  type ImportDevice
} from "../doc-upload";
import { ownerInput, ownerProblem } from "../doc-view";
import type { PickedFile } from "../folder-read";
import { useDocUploadQueue } from "../useDocUploadQueue";
import FolderImportReview, {
  type ImportGroupDraft
} from "./FolderImportReview.vue";
import FolderPickZone from "./FolderPickZone.vue";
import UploadQueueList from "./UploadQueueList.vue";

/** 按文件夹导入：把现有的「一台设备一个文件夹」的资料整批搬进来。 */
const props = defineProps<{
  config: DocLibraryConfig | null;
  categories: DeviceCategory[];
}>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ uploaded: [] }>();

const DEVICE_PAGE_SIZE = 200;
const MAX_DEVICE_PAGES = 20;

const { items, busy, queue, reset } = useDocUploadQueue();
const phase = ref<"pick" | "review" | "upload">("pick");
const loading = ref(false);
const devices = ref<ImportDevice[]>([]);
const picked = ref<PickedFile[]>([]);
const groups = ref<ImportGroupDraft[]>([]);
const rejected = ref<{ name: string; reason: string }[]>([]);
/** 开始导入那一刻跳过的文件夹，汇总里要写 */
const skippedFolders = ref<string[]>([]);
let nextKey = 0;

const importing = computed(() =>
  groups.value
    .filter(group => !group.skip)
    .reduce((count, group) => count + group.files.length, 0)
);
const summary = computed(() => {
  const all = items.value;
  return {
    total: all.length,
    done: all.filter(item => item.status === "done").length,
    failed: all.filter(item => item.status === "failed").length
  };
});
const unfinished = computed(() =>
  items.value.filter(item => item.status !== "done")
);

const loadDevices = async (): Promise<boolean> => {
  loading.value = true;
  try {
    let all: ImportDevice[] = [];
    for (let page = 1; page <= MAX_DEVICE_PAGES; page += 1) {
      const result = await listDevices({ page, pageSize: DEVICE_PAGE_SIZE });
      all = [...all, ...result.data];
      if (all.length >= result.pagination.total || result.data.length === 0) {
        break;
      }
    }
    devices.value = all;
    return true;
  } catch (error) {
    message(resolveApiErrorMessage(error, "设备清单取不到，请稍后再试"), {
      type: "error"
    });
    return false;
  } finally {
    loading.value = false;
  }
};

const buildGroups = () => {
  const config = props.config;
  if (!config) return;
  const real = picked.value.filter(item => !isJunkFile(item.file.name));
  const checked = real.map(item => ({
    item,
    reason: uploadProblem(item.file, config)
  }));
  rejected.value = checked
    .filter(entry => entry.reason)
    .map(entry => ({ name: entry.item.path, reason: entry.reason }));
  groups.value = groupFolderImport(
    checked.filter(entry => !entry.reason).map(entry => entry.item),
    devices.value
  ).map((group, index): ImportGroupDraft => {
    const device = devices.value.find(item => item.id === group.deviceId);
    return {
      id: `group-${index}`,
      folder: group.folder,
      matchedBy: group.matchedBy,
      owner: defaultImportOwner(group),
      deviceLabel: device ? `${device.device_code} ${device.name}` : null,
      skip: false,
      files: group.files.map(file => {
        nextKey += 1;
        return { ...file, key: `import-${Date.now()}-${nextKey}` };
      })
    };
  });
};

const take = async (files: PickedFile[]) => {
  if (files.length === 0) {
    message("没有读到文件", { type: "warning" });
    return;
  }
  if (!props.config) {
    message("上传设置还没取到，请稍后再试", { type: "warning" });
    return;
  }
  picked.value = files;
  if (!(await loadDevices())) return;
  buildGroups();
  if (groups.value.length === 0) {
    message("这个文件夹里没有能导入的文件", { type: "warning" });
    return;
  }
  phase.value = "review";
};

/** 新建了设备之后重新对一遍（之前手选的归属会重来）。 */
const rematch = async () => {
  if (await loadDevices()) buildGroups();
};

const start = async () => {
  const stuck = groups.value.find(
    group => !group.skip && ownerProblem(group.owner)
  );
  if (stuck) {
    message(
      `「${stuck.folder || "没放在子文件夹里的文件"}」还没定归到哪里：${ownerProblem(stuck.owner)}，或者勾上跳过`,
      { type: "warning" }
    );
    return;
  }
  if (importing.value === 0) {
    message("所有文件夹都跳过了，没有要导入的", { type: "warning" });
    return;
  }
  skippedFolders.value = groups.value
    .filter(group => group.skip)
    .map(group => group.folder || "没放在子文件夹里的文件");
  queue.add(
    groups.value
      .filter(group => !group.skip)
      .flatMap(group =>
        group.files.map(file => ({
          key: file.key,
          file: file.file,
          name: group.folder
            ? `${group.folder}/${file.file.name}`
            : file.file.name,
          meta: {
            title: file.title,
            doc_category: file.category,
            ...ownerInput(group.owner),
            valid_until: null
          }
        }))
      )
  );
  phase.value = "upload";
  await queue.start();
};

watch(busy, (now, before) => {
  if (!before || now || !visible.value || summary.value.total === 0) return;
  if (summary.value.done > 0) emit("uploaded");
});

watch(visible, open => {
  if (!open) return;
  reset();
  phase.value = "pick";
  picked.value = [];
  groups.value = [];
  rejected.value = [];
  skippedFolders.value = [];
});

const beforeClose = async (done: () => void) => {
  if (busy.value) {
    try {
      await ElMessageBox.confirm(
        "还有文件没传完，关掉会中断，没传完的要重新导入。",
        "要关掉吗？",
        {
          type: "warning",
          confirmButtonText: "关掉",
          cancelButtonText: "接着传"
        }
      );
    } catch {
      return;
    }
  }
  // 这一轮只要有文件开始传过，记录就可能已经写成了（哪怕看着是失败或没传完）：关的时候让列表刷新
  const dirty = reset();
  done();
  if (dirty) emit("uploaded");
};
const close = () => beforeClose(() => (visible.value = false));
</script>

<template>
  <el-dialog
    v-model="visible"
    title="按文件夹导入"
    width="960px"
    :before-close="beforeClose"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <div v-if="phase === 'pick'" v-loading="loading">
      <FolderPickZone @picked="take" @reading="value => (loading = value)" />
    </div>

    <div v-else-if="phase === 'review'" v-loading="loading">
      <div class="lead">
        读到 {{ groups.length }} 个文件夹，这次导入
        <b>{{ importing }}</b>
        个文件。点每行左边的箭头可以改各个文件的资料类别。
      </div>
      <FolderImportReview
        :groups="groups"
        :categories="props.categories"
        :doc-categories="props.config?.categories ?? []"
        @change="next => (groups = next)"
      />
      <div v-if="rejected.length > 0" class="rejected">
        <div class="rejected-title">
          这 {{ rejected.length }} 个文件不会导入
        </div>
        <div class="rejected-list">
          <div v-for="(item, index) in rejected" :key="index">
            {{ item.name }}：{{ item.reason }}
          </div>
        </div>
      </div>
    </div>

    <div v-else>
      <el-alert
        v-if="!busy && summary.total > 0"
        :type="summary.failed > 0 ? 'warning' : 'success'"
        :closable="false"
        show-icon
        class="block"
        :title="`成功 ${summary.done} 个，失败 ${summary.failed} 个。`"
        :description="
          skippedFolders.length > 0
            ? `跳过的文件夹：${skippedFolders.join('、')}`
            : undefined
        "
      />
      <div v-else class="lead">
        已传完 {{ summary.done }} / {{ summary.total }} 个<template
          v-if="summary.failed > 0"
          >，失败 {{ summary.failed }} 个</template
        >
      </div>
      <el-progress
        :percentage="
          summary.total > 0
            ? Math.floor((summary.done / summary.total) * 100)
            : 0
        "
        class="block"
      />
      <UploadQueueList
        v-if="unfinished.length > 0"
        :items="unfinished"
        @retry="key => queue.retry(key)"
        @cancel="key => queue.cancel(key)"
      />
    </div>

    <template #footer>
      <template v-if="phase === 'pick'">
        <el-button @click="close">取消</el-button>
      </template>
      <template v-else-if="phase === 'review'">
        <el-button @click="phase = 'pick'">重新选文件夹</el-button>
        <el-button :loading="loading" @click="rematch">重新对设备</el-button>
        <el-button type="primary" :disabled="importing === 0" @click="start"
          >导入 {{ importing }} 个文件</el-button
        >
      </template>
      <template v-else>
        <el-button type="primary" @click="close">{{
          busy ? "关闭" : "完成"
        }}</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.lead {
  margin-bottom: 12px;
  font-size: 14px;
}

.block {
  margin-bottom: 12px;
}

.rejected {
  padding: 8px 12px;
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-radius: 4px;
}

.rejected-title {
  font-weight: 600;
}

.rejected-list {
  max-height: 120px;
  overflow: auto;
}
</style>
