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

const tool = useDedupTool();
const tab = ref<"star" | "matrix">("star");
const selectedCompareId = ref<string>("");

const master = computed(() => tool.docs.value.find((d) => d.role === "master"));
const selectedResult = computed(() =>
  tool.starResults.value.find((r) => r.compareDocId === selectedCompareId.value),
);
const selectedCompareDoc = computed(() =>
  tool.docs.value.find((d) => d.id === selectedCompareId.value),
);

function setRole(payload: { id: string; role: DocRole }) {
  tool.docs.value = tool.docs.value.map((d) => {
    if (d.id === payload.id) return { ...d, role: "master" as DocRole };
    if (d.role === "master") return { ...d, role: "compare" as DocRole };
    return d;
  });
}

function onCompute() {
  try {
    tool.compute();
    if (tool.starResults.value.length > 0) {
      selectedCompareId.value = tool.starResults.value[0].compareDocId;
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
      :docs="tool.docs.value"
      @add="tool.addDoc"
      @remove="tool.removeDoc"
      @set-role="setRole"
    />
    <div class="controls">
      <span>相似阈值 {{ tool.threshold.value.toFixed(2) }}</span>
      <el-slider
        v-model="tool.threshold.value"
        :min="0.5"
        :max="1"
        :step="0.05"
      />
      <el-button type="primary" @click="onCompute">开始查重</el-button>
      <el-button :disabled="!selectedCompareDoc" @click="onExport"
        >导出去重 docx</el-button
      >
    </div>

    <SummaryCards :results="tool.starResults.value" :docs="tool.docs.value" />

    <el-radio-group v-model="tab">
      <el-radio-button value="star">母本对照</el-radio-button>
      <el-radio-button value="matrix">相似度矩阵</el-radio-button>
    </el-radio-group>

    <template
      v-if="tab === 'star' && master && selectedResult && selectedCompareDoc"
    >
      <el-select v-model="selectedCompareId">
        <el-option
          v-for="r in tool.starResults.value"
          :key="r.compareDocId"
          :value="r.compareDocId"
          :label="tool.docs.value.find((d) => d.id === r.compareDocId)?.name"
        />
      </el-select>
      <PairCompareView
        :master="master"
        :compare="selectedCompareDoc"
        :result="selectedResult"
      />
    </template>

    <MatrixView
      v-if="tab === 'matrix'"
      :docs="tool.docs.value"
      :matrix="tool.matrix.value"
    />
  </div>
</template>
