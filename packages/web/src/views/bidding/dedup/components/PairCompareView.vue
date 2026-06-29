<script setup lang="ts">
import { computed } from "vue";
import type { ParsedDoc, DedupResult } from "../lib/types";
import { buildHighlightSegments } from "../lib/highlight";

const props = defineProps<{
  master: ParsedDoc;
  compare: ParsedDoc;
  result: DedupResult;
}>();

const masterDupIds = computed(
  () => new Set(props.result.matches.map((m) => m.masterSentenceId)),
);
const compareDupIds = computed(
  () => new Set(props.result.matches.map((m) => m.compareSentenceId)),
);

const masterSentences = computed(() =>
  props.master.paragraphs.flatMap((p) => p.sentences),
);
const compareSentences = computed(() =>
  props.compare.paragraphs.flatMap((p) => p.sentences),
);

const masterSegs = computed(() =>
  buildHighlightSegments(masterSentences.value, masterDupIds.value),
);
const compareSegs = computed(() =>
  buildHighlightSegments(compareSentences.value, compareDupIds.value),
);
</script>

<template>
  <div class="pair-compare">
    <div class="pane">
      <h4>母本（只读）：{{ props.master.name }}</h4>
      <p>
        <span
          v-for="(s, i) in masterSegs"
          :key="i"
          :class="{ dup: s.duplicate }"
          >{{ s.text }}</span
        >
      </p>
    </div>
    <div class="pane">
      <h4>{{ props.compare.name }}</h4>
      <p>
        <span
          v-for="(s, i) in compareSegs"
          :key="i"
          :class="{ dup: s.duplicate }"
          >{{ s.text }}</span
        >
      </p>
    </div>
  </div>
</template>

<style scoped>
.pair-compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.dup {
  background: var(--el-color-danger-light-8);
  border-radius: 3px;
}
</style>
