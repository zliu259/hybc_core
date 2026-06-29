import { ref, shallowRef } from "vue";
import type { ParsedDoc, DedupResult, DocRole } from "../lib/types";
import { compareToMaster, buildSimilarityMatrix } from "../lib/engine";

export function useDedupTool() {
  const docs = shallowRef<ParsedDoc[]>([]);
  const threshold = ref(0.8);
  const starResults = shallowRef<DedupResult[]>([]);
  const matrix = shallowRef<number[][]>([]);

  function clearResults(): void {
    starResults.value = [];
    matrix.value = [];
  }

  function addDoc(doc: ParsedDoc): void {
    docs.value = [...docs.value, doc];
    clearResults();
  }

  function removeDoc(id: string): void {
    docs.value = docs.value.filter((d) => d.id !== id);
    clearResults();
  }

  function setRole(id: string, role: DocRole): void {
    docs.value = docs.value.map((d) => {
      if (d.id === id) return { ...d, role };
      if (role === "master" && d.role === "master")
        return { ...d, role: "compare" };
      return d;
    });
    clearResults();
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

  return {
    docs,
    threshold,
    starResults,
    matrix,
    addDoc,
    removeDoc,
    setRole,
    compute,
  };
}
