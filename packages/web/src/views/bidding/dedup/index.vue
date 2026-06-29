<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";
import type { DocRole } from "./lib/types";
import { useDedupTool } from "./composables/useDedupTool";
import { downloadDocx } from "./lib/docx-export";
import FileDropZone from "./components/FileDropZone.vue";
import SummaryCards from "./components/SummaryCards.vue";
import PairCompareView from "./components/PairCompareView.vue";
import MatrixView from "./components/MatrixView.vue";

const {
  docs,
  threshold,
  starResults,
  matrix,
  addDoc,
  removeDoc,
  setRole,
  compute
} = useDedupTool();
const tab = ref<"star" | "matrix">("star");
const selectedCompareId = ref<string>("");

const master = computed(() => docs.value.find((d) => d.role === "master"));
const selectedResult = computed(() =>
  starResults.value.find((r) => r.compareDocId === selectedCompareId.value)
);
const selectedCompareDoc = computed(() =>
  docs.value.find((d) => d.id === selectedCompareId.value)
);
const canCompute = computed(
  () =>
    docs.value.some((d) => d.role === "master") &&
    docs.value.some((d) => d.role === "compare")
);

function onSetRole(payload: { id: string; role: DocRole }): void {
  setRole(payload.id, payload.role);
}

function onCompute() {
  try {
    compute();
    if (starResults.value.length > 0) {
      selectedCompareId.value = starResults.value[0].compareDocId;
    }
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "计算失败");
  }
}

async function onExport() {
  const doc = selectedCompareDoc.value;
  if (!doc) return;
  const paras = doc.paragraphs.map((p) => p.text);
  await downloadDocx(paras, `去重_${doc.name}`);
}
</script>

<template>
  <div class="dedup-page">
    <FileDropZone
      :docs="docs"
      @add="addDoc"
      @remove="removeDoc"
      @set-role="onSetRole"
    />
    <div class="controls">
      <span>相似阈值 {{ threshold.toFixed(2) }}</span>
      <el-slider v-model="threshold" :min="0.5" :max="1" :step="0.05" />
      <el-button type="primary" :disabled="!canCompute" @click="onCompute"
        >开始查重</el-button
      >
      <el-button :disabled="!selectedCompareDoc" @click="onExport"
        >导出去重 docx</el-button
      >
    </div>

    <SummaryCards :results="starResults" :docs="docs" />

    <el-radio-group v-model="tab">
      <el-radio-button value="star">母本对照</el-radio-button>
      <el-radio-button value="matrix">相似度矩阵</el-radio-button>
    </el-radio-group>

    <template
      v-if="tab === 'star' && master && selectedResult && selectedCompareDoc"
    >
      <el-select v-model="selectedCompareId">
        <el-option
          v-for="r in starResults"
          :key="r.compareDocId"
          :value="r.compareDocId"
          :label="docs.find((d) => d.id === r.compareDocId)?.name"
        />
      </el-select>
      <PairCompareView
        :master="master"
        :compare="selectedCompareDoc"
        :result="selectedResult"
      />
    </template>

    <MatrixView v-if="tab === 'matrix'" :docs="docs" :matrix="matrix" />
  </div>
</template>
