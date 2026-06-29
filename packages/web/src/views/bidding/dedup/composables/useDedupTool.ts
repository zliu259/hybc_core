import { ref, shallowRef } from "vue";
import type { ParsedDoc, DedupResult } from "../lib/types";
import { compareToMaster, buildSimilarityMatrix } from "../lib/engine";

export function useDedupTool() {
  const docs = shallowRef<ParsedDoc[]>([]);
  const threshold = ref(0.8);
  const starResults = shallowRef<DedupResult[]>([]);
  const matrix = shallowRef<number[][]>([]);

  function addDoc(doc: ParsedDoc): void {
    docs.value = [...docs.value, doc];
  }

  function removeDoc(id: string): void {
    docs.value = docs.value.filter((d) => d.id !== id);
  }

  function compute(): void {
    const master = docs.value.find((d) => d.role === "master");
    if (!master) throw new Error("请先指定母本再计算");
    const compares = docs.value.filter((d) => d.role === "compare");
    starResults.value = compares.map((c) =>
      compareToMaster(master, c, threshold.value),
    );
    matrix.value = buildSimilarityMatrix(docs.value, threshold.value);
  }

  return { docs, threshold, starResults, matrix, addDoc, removeDoc, compute };
}
