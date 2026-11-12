<script setup lang="ts">
import { ref } from "vue";

import {
  entriesFromDrop,
  fromInputFiles,
  readDroppedEntries,
  type PickedFile
} from "../folder-read";

/** 文件夹导入的第一步：选一个文件夹，或者把文件夹拖进来。 */
const emit = defineEmits<{
  picked: [files: PickedFile[]];
  /** 正在读拖进来的文件夹（文件多的时候要一会儿） */
  reading: [value: boolean];
}>();

const picker = ref<HTMLInputElement | null>(null);
const dragging = ref(false);

const onPick = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = fromInputFiles(input.files ?? []);
  input.value = "";
  emit("picked", files);
};

const onDrop = async (event: DragEvent) => {
  dragging.value = false;
  // 条目要在事件处理函数里同步取出来，过后浏览器就不给了
  const entries = entriesFromDrop(event.dataTransfer);
  emit("reading", true);
  try {
    emit("picked", await readDroppedEntries(entries));
  } finally {
    emit("reading", false);
  }
};
</script>

<template>
  <div>
    <div
      class="drop"
      :class="{ over: dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p>把装着资料的文件夹拖到这里，或者</p>
      <el-button type="primary" @click="picker?.click()">选择文件夹</el-button>
      <input
        ref="picker"
        type="file"
        webkitdirectory
        multiple
        class="hidden"
        @change="onPick"
      />
    </div>
    <ul class="tips">
      <li>
        可以选总文件夹：下面一个子文件夹是一台设备，子文件夹名里有设备编号，或者就是设备名称、现场叫法，会自动对上。
      </li>
      <li>也可以只选某一台设备的文件夹。</li>
      <li>
        对不上的文件夹下一步可以手选设备、归到某类设备、归为通用，或者跳过。
      </li>
      <li>
        资料类别先按文件名和文件夹名猜，下一步能改。有效期导入后在列表里补。
      </li>
    </ul>
  </div>
</template>

<style scoped>
.drop {
  padding: 32px 16px;
  color: var(--el-text-color-regular);
  text-align: center;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
}

.drop.over {
  background: var(--el-color-primary-light-9);
  border-color: var(--el-color-primary);
}

.drop p {
  margin-bottom: 12px;
}

.hidden {
  display: none;
}

.tips {
  padding-left: 20px;
  margin-top: 16px;
  font-size: 13px;
  line-height: 1.9;
  color: var(--el-text-color-secondary);
  list-style: disc;
}
</style>
