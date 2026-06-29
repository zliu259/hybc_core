<script setup lang="ts">
import { ref } from "vue";
import { ElMessage } from "element-plus";
import type { ParsedDoc, DocRole } from "../lib/types";
import { parseFile } from "../lib/doc-parser";
import { buildParsedDoc } from "../lib/build-doc";

const props = defineProps<{ docs: ParsedDoc[] }>();
const emit = defineEmits<{
  (e: "add", doc: ParsedDoc): void;
  (e: "remove", id: string): void;
  (e: "set-role", payload: { id: string; role: DocRole }): void;
}>();

const loading = ref(false);

async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement;
  if (!input.files) return;
  loading.value = true;
  for (const file of Array.from(input.files)) {
    try {
      const paragraphTexts = await parseFile(file);
      const hasMaster = props.docs.some((d) => d.role === "master");
      const doc = buildParsedDoc({
        id: `${Date.now()}-${file.name}`,
        name: file.name,
        role: hasMaster ? "compare" : "master",
        paragraphTexts
      });
      emit("add", doc);
    } catch (err) {
      ElMessage.error(err instanceof Error ? err.message : "解析失败");
    }
  }
  loading.value = false;
  input.value = "";
}
</script>

<template>
  <div class="file-drop">
    <input
      type="file"
      multiple
      accept=".docx,.pdf"
      :disabled="loading"
      @change="onFiles"
    />
    <ul>
      <li v-for="d in props.docs" :key="d.id">
        <el-tag :type="d.role === 'master' ? 'primary' : 'info'">
          {{ d.role === "master" ? "母本" : "对比" }}
        </el-tag>
        <span class="name">{{ d.name }}</span>
        <el-button
          v-if="d.role === 'compare'"
          link
          @click="emit('set-role', { id: d.id, role: 'master' })"
          >设为母本</el-button
        >
        <el-button link type="danger" @click="emit('remove', d.id)"
          >移除</el-button
        >
      </li>
    </ul>
  </div>
</template>
