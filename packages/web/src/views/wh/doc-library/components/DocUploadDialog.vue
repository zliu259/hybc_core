<script setup lang="ts">
import { ElMessageBox } from "element-plus";
import { computed, ref, watch } from "vue";

import type { DocFileRow, DocLibraryConfig } from "@/api/wh/doc-library-types";
import type { DeviceCategory } from "@/api/wh/types";
import { message } from "@/utils/message";
import {
  guessDocCategory,
  titleFromFileName,
  uploadProblem
} from "../doc-upload";
import {
  formatFileSize,
  GENERAL_OWNER,
  ownerInput,
  ownerOfRow,
  ownerProblem,
  ownerText,
  type DocOwner
} from "../doc-view";
import { useDocUploadQueue } from "../useDocUploadQueue";
import OwnerPicker from "./OwnerPicker.vue";
import UploadDraftTable, {
  hasValidity,
  type UploadDraft
} from "./UploadDraftTable.vue";
import UploadQueueList from "./UploadQueueList.vue";

/**
 * 上传资料：一次选一批文件，归属统一选，标题、资料类别、有效期逐个可改。
 * replaceTarget 有值时是「替换」：只能选一个文件，归属沿用旧文件。
 */
const props = defineProps<{
  config: DocLibraryConfig | null;
  categories: DeviceCategory[];
  replaceTarget: DocFileRow | null;
  /** 打开时默认的归属（跟着左边目录树选中的那一项） */
  defaultOwner: DocOwner;
  defaultDeviceLabel: string | null;
}>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ uploaded: [] }>();

const { items, busy, queue, reset } = useDocUploadQueue();
const phase = ref<"edit" | "upload">("edit");
const drafts = ref<UploadDraft[]>([]);
const rejected = ref<{ name: string; reason: string }[]>([]);
const owner = ref<DocOwner>(GENERAL_OWNER);
const picker = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
let nextKey = 0;

const replacing = computed(() => props.replaceTarget !== null);

watch(visible, open => {
  if (!open) return;
  reset();
  phase.value = "edit";
  drafts.value = [];
  rejected.value = [];
  owner.value = props.replaceTarget
    ? ownerOfRow(props.replaceTarget)
    : props.defaultOwner;
});

const addFiles = (files: File[]) => {
  const config = props.config;
  if (!config) {
    message("上传设置还没取到，请稍后再试", { type: "warning" });
    return;
  }
  const checked = files.map(file => ({
    file,
    reason: uploadProblem(file, config)
  }));
  rejected.value = [
    ...rejected.value,
    ...checked
      .filter(item => item.reason)
      .map(item => ({ name: item.file.name, reason: item.reason }))
  ];
  const target = props.replaceTarget;
  const fresh = checked
    .filter(item => !item.reason)
    .filter(
      item =>
        !drafts.value.some(
          draft =>
            draft.file.name === item.file.name &&
            draft.file.size === item.file.size &&
            draft.file.lastModified === item.file.lastModified
        )
    )
    .map(({ file }): UploadDraft => {
      nextKey += 1;
      return {
        key: `upload-${Date.now()}-${nextKey}`,
        file,
        title: target ? target.title : titleFromFileName(file.name),
        category: target ? target.doc_category : guessDocCategory(file.name),
        validUntil: null
      };
    });
  if (target) {
    // 替换只要一个文件：再选就换掉上一个
    if (fresh.length > 0) drafts.value = [fresh[0]];
    if (checked.length > 1) {
      message("替换只能选一个文件，已取第一个", { type: "warning" });
    }
    return;
  }
  drafts.value = [...drafts.value, ...fresh];
};

const onPick = (event: Event) => {
  const input = event.target as HTMLInputElement;
  addFiles(Array.from(input.files ?? []));
  input.value = "";
};
const onDrop = (event: DragEvent) => {
  dragging.value = false;
  addFiles(Array.from(event.dataTransfer?.files ?? []));
};

const problem = (): string => {
  if (drafts.value.length === 0) return "先选要传的文件";
  if (drafts.value.some(draft => !draft.title.trim())) return "有文件没填标题";
  return replacing.value ? "" : ownerProblem(owner.value);
};

const start = async () => {
  const reason = problem();
  if (reason) {
    message(reason, { type: "warning" });
    return;
  }
  const target = props.replaceTarget;
  queue.add(
    drafts.value.map(draft => ({
      key: draft.key,
      file: draft.file,
      name: draft.file.name,
      meta: {
        title: draft.title.trim(),
        doc_category: draft.category,
        ...ownerInput(owner.value),
        valid_until: hasValidity(draft.category) ? draft.validUntil : null,
        ...(target ? { supersedes_id: target.id } : {})
      }
    }))
  );
  drafts.value = [];
  phase.value = "upload";
  await queue.start();
};

// 一轮传完（包括重试的那一轮）：报个数，让列表刷新
watch(busy, (now, before) => {
  if (!before || now || !visible.value) return;
  const summary = queue.summary();
  if (summary.total === 0) return;
  message(
    `${summary.done} 个已上传${summary.failed > 0 ? `，${summary.failed} 个失败` : ""}`,
    { type: summary.failed > 0 ? "warning" : "success" }
  );
  if (summary.done > 0) emit("uploaded");
  if (replacing.value && summary.failed === 0) visible.value = false;
});

const addMore = () => {
  queue.clearFinished();
  phase.value = "edit";
};

const beforeClose = async (done: () => void) => {
  if (busy.value) {
    try {
      await ElMessageBox.confirm(
        "还有文件没传完，关掉会中断，没传完的要重新传。",
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
  reset();
  done();
};
const close = () => beforeClose(() => (visible.value = false));
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="
      props.replaceTarget ? `替换「${props.replaceTarget.title}」` : '上传资料'
    "
    width="860px"
    :before-close="beforeClose"
    :close-on-click-modal="false"
    destroy-on-close
  >
    <template v-if="phase === 'edit'">
      <el-alert
        v-if="props.replaceTarget"
        type="info"
        :closable="false"
        show-icon
        title="旧文件保留为历史版本，原来的对外链接作废。"
        class="block"
      />
      <el-form label-width="70px" @submit.prevent>
        <el-form-item label="归属" required>
          <span v-if="props.replaceTarget"
            >{{ ownerText(props.replaceTarget) }}（沿用旧文件）</span
          >
          <OwnerPicker
            v-else
            v-model="owner"
            :categories="props.categories"
            :device-label="props.defaultDeviceLabel"
          />
        </el-form-item>
      </el-form>
      <div
        class="drop"
        :class="{ over: dragging }"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <span>把文件拖到这里，或者</span>
        <el-button type="primary" link @click="picker?.click()"
          >点这里选文件</el-button
        >
        <input
          ref="picker"
          type="file"
          :multiple="!props.replaceTarget"
          class="hidden"
          @change="onPick"
        />
        <div class="hint">
          单个文件最大
          {{
            props.config ? formatFileSize(props.config.max_bytes) : "-"
          }}；支持 PDF、图片、Office 文档、视频、压缩包、图纸。
        </div>
      </div>
      <UploadDraftTable
        v-if="drafts.length > 0"
        :drafts="drafts"
        :doc-categories="props.config?.categories ?? []"
        :batch="!props.replaceTarget"
        class="block"
        @change="next => (drafts = next)"
      />
      <div v-if="rejected.length > 0" class="rejected">
        <div class="rejected-title">
          这些文件没有加进来
          <el-button link size="small" @click="rejected = []">知道了</el-button>
        </div>
        <div v-for="(item, index) in rejected" :key="index">
          {{ item.name }}：{{ item.reason }}
        </div>
      </div>
    </template>
    <template v-else>
      <UploadQueueList
        :items="items"
        @retry="key => queue.retry(key)"
        @cancel="key => queue.cancel(key)"
      />
    </template>
    <template #footer>
      <template v-if="phase === 'edit'">
        <el-button @click="close">取消</el-button>
        <el-button type="primary" :disabled="drafts.length === 0" @click="start"
          >{{ props.replaceTarget ? "替换" : `上传 ${drafts.length} 个文件` }}
        </el-button>
      </template>
      <template v-else>
        <el-button v-if="!props.replaceTarget" :disabled="busy" @click="addMore"
          >继续添加</el-button
        >
        <el-button type="primary" @click="close">{{
          busy ? "关闭" : "完成"
        }}</el-button>
      </template>
    </template>
  </el-dialog>
</template>

<style scoped>
.block {
  margin-bottom: 12px;
}

.drop {
  padding: 20px 16px;
  margin-bottom: 12px;
  font-size: 14px;
  color: var(--el-text-color-regular);
  text-align: center;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
}

.drop.over {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
}

.hidden {
  display: none;
}

.hint,
.sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.hint {
  margin-top: 6px;
}

.rejected {
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--el-color-danger);
  background: var(--el-color-danger-light-9);
  border-radius: 4px;
}

.rejected-title {
  display: flex;
  justify-content: space-between;
  font-weight: 600;
}
</style>
