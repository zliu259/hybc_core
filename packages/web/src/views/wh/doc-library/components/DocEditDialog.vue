<script setup lang="ts">
import { ref, watch } from "vue";

import { updateDocFile } from "@/api/wh/doc-library";
import type {
  DocCategory,
  DocFileRow,
  DocLibraryConfig
} from "@/api/wh/doc-library-types";
import type { DeviceCategory } from "@/api/wh/types";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import { isConflictError } from "../../task/task-view";
import {
  GENERAL_OWNER,
  ownerInput,
  ownerOfRow,
  ownerProblem,
  ownerText,
  type DocOwner
} from "../doc-view";
import OwnerPicker from "./OwnerPicker.vue";

const props = defineProps<{
  doc: DocFileRow | null;
  categories: DeviceCategory[];
  docCategories: DocLibraryConfig["categories"];
}>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [] }>();

const busy = ref(false);
const title = ref("");
const docCategory = ref<DocCategory>("other");
const owner = ref<DocOwner>(GENERAL_OWNER);
const validUntil = ref<string | null>(null);

watch(visible, open => {
  const doc = props.doc;
  if (!open || !doc) return;
  title.value = doc.title;
  docCategory.value = doc.doc_category;
  owner.value = ownerOfRow(doc);
  validUntil.value = doc.valid_until;
});

const save = async () => {
  const doc = props.doc;
  if (!doc) return;
  const problem = title.value.trim() ? ownerProblem(owner.value) : "请填写标题";
  if (problem) {
    message(problem, { type: "warning" });
    return;
  }
  busy.value = true;
  try {
    await updateDocFile(doc.id, {
      version: doc.version,
      title: title.value.trim(),
      doc_category: docCategory.value,
      ...ownerInput(owner.value),
      valid_until: validUntil.value || null
    });
    message("已保存", { type: "success" });
    visible.value = false;
    emit("saved");
  } catch (error) {
    if (isConflictError(error)) {
      // 别人刚改过或替换过：关掉，让列表刷出最新的
      message(resolveApiErrorMessage(error, "数据已变化，请刷新后重试"), {
        type: "warning"
      });
      visible.value = false;
      emit("saved");
      return;
    }
    message(resolveApiErrorMessage(error, "保存失败，请稍后重试"), {
      type: "error"
    });
  } finally {
    busy.value = false;
  }
};
</script>

<template>
  <el-dialog
    v-model="visible"
    title="修改资料信息"
    width="560px"
    destroy-on-close
  >
    <el-form label-width="80px" @submit.prevent>
      <el-form-item label="标题" required>
        <el-input v-model="title" maxlength="120" show-word-limit />
      </el-form-item>
      <el-form-item label="资料类别" required>
        <el-select v-model="docCategory" style="width: 100%">
          <el-option
            v-for="item in props.docCategories"
            :key="item.key"
            :label="item.label"
            :value="item.key"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="归属" required>
        <OwnerPicker
          v-model="owner"
          :categories="props.categories"
          :device-label="
            props.doc?.scope === 'device' ? ownerText(props.doc) : null
          "
        />
      </el-form-item>
      <el-form-item label="有效期至">
        <el-date-picker
          v-model="validUntil"
          type="date"
          value-format="YYYY-MM-DD"
          clearable
          placeholder="证书、检测报告才需要填"
        />
      </el-form-item>
      <el-form-item label="文件">
        <span class="file">{{ props.doc?.file_name }}</span>
        <div class="hint">文件本身不能改；要换文件请用「替换」。</div>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="busy" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.file {
  word-break: break-all;
}

.hint {
  width: 100%;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
