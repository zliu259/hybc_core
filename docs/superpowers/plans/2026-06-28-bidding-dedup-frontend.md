# 投标查重对比工具（前端核心）Implementation Plan — Plan A

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/web` 新增「投标 / 查重对比」工具，纯前端解析 docx/pdf、逐句近似查重、母本中心高亮 + 全量相似度矩阵、并具备导出 docx 的底座。

**Architecture:** 纯函数查重引擎（不依赖 Vue，便于 TDD）+ 懒加载解析适配器（mammoth/pdfjs）+ Vue 组件视图层。候选筛选用 **倒排 shingle 索引**（共享 shingle 分块）实现 spec 中“避免 O(n²)”的意图，MinHash/LSH 留作性能瓶颈出现时再上（YAGNI）。AI 去重与跨包后端属 Plan B，不在本计划内。

**Tech Stack:** Vue 3 + Element Plus + Vite + Vitest（happy-dom）+ mammoth + pdfjs-dist + docx + echarts(已有)。

**Spec:** `docs/superpowers/specs/2026-06-28-bidding-dedup-design.md`

**约定：** 所有 `pnpm` 命令在 `packages/web` 下执行（该包 `only-allow pnpm`）。本计划不含 AI（spec 第 8 节）与保版式导出（spec 第 9 节取舍），见 Plan B 与 spec 第 12 节。

---

## File Structure

```
packages/web/
  vitest.config.ts                              新增：Vitest 配置
  package.json                                  修改：加 test 脚本与依赖
  src/
    router/modules/bidding.ts                   新增：顶级菜单「投标」
    views/bidding/dedup/
      index.vue                                 页面装配
      components/
        FileDropZone.vue                        上传/母本标记/文件列表
        SummaryCards.vue                        重复率指标卡
        PairCompareView.vue                     母本↔对比 双栏高亮
        MatrixView.vue                          全量相似度矩阵(echarts)
      composables/
        useDedupTool.ts                         页面状态编排(组合引擎/解析)
      lib/
        types.ts                                领域类型(纯类型)
        hash.ts                                 hashString
        normalize.ts                            normalizeText
        shingle.ts                              toShingles
        similarity.ts                           jaccard
        segment.ts                              splitSentences
        build-doc.ts                            buildParsedDoc(段落→句+shingle)
        engine.ts                               compareToMaster / pairSimilarity / buildSimilarityMatrix
        highlight.ts                            buildHighlightSegments(高亮分段)
        parse-docx.ts                           docx → 段落
        parse-pdf.ts                            pdf → 段落
        doc-parser.ts                           detectKind + parseFile 分发
        docx-export.ts                          buildDocxBuffer / downloadDocx
      lib/__tests__/                            单测
```

---

## Task 1: 安装依赖与 Vitest 配置

**Files:**
- Modify: `packages/web/package.json`
- Create: `packages/web/vitest.config.ts`
- Create: `packages/web/src/views/bidding/dedup/lib/__tests__/smoke.test.ts`

- [ ] **Step 1: 安装依赖**

Run（在 `packages/web` 下）:
```bash
pnpm add mammoth pdfjs-dist docx
pnpm add -D vitest@^3.2.4 @vue/test-utils happy-dom @vitejs/plugin-vue
```

- [ ] **Step 2: 创建 vitest 配置**

Create `packages/web/vitest.config.ts`:
```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/*.{test,spec}.ts"]
  }
});
```

- [ ] **Step 3: 加 test 脚本**

Modify `packages/web/package.json` 的 `scripts`，新增一行（放在 `typecheck` 旁）:
```json
"test": "vitest run"
```

- [ ] **Step 4: 写冒烟测试**

Create `packages/web/src/views/bidding/dedup/lib/__tests__/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";

describe("vitest setup", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm test`
Expected: 1 passed。

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json packages/web/vitest.config.ts packages/web/pnpm-lock.yaml packages/web/src/views/bidding/dedup/lib/__tests__/smoke.test.ts
git commit -m "chore(web): set up vitest for bidding dedup module"
```

---

## Task 2: hashString 工具

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/hash.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/hash.test.ts`

- [ ] **Step 1: 写失败测试**

Create `hash.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hashString } from "../hash";

describe("hashString", () => {
  it("returns a 32-bit unsigned integer", () => {
    const h = hashString("质量管理");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });

  it("is deterministic", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
  });

  it("differs for different inputs", () => {
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test hash.test.ts`
Expected: FAIL（Cannot find module '../hash'）。

- [ ] **Step 3: 实现**

Create `hash.ts`:
```ts
// FNV-1a 32-bit。用于把字符串 shingle 折叠成整数，降低集合内存占用。
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test hash.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/hash.ts packages/web/src/views/bidding/dedup/lib/__tests__/hash.test.ts
git commit -m "feat(dedup): add hashString util"
```

---

## Task 3: normalizeText 规范化

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/normalize.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/normalize.test.ts`

- [ ] **Step 1: 写失败测试**

Create `normalize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { normalizeText } from "../normalize";

describe("normalizeText", () => {
  it("folds full-width to half-width, lowercases, strips punctuation and spaces", () => {
    expect(normalizeText("Ｈello， 世界！")).toBe("hello世界");
  });

  it("removes whitespace between Chinese chars", () => {
    expect(normalizeText("质量  管理\t体系")).toBe("质量管理体系");
  });

  it("keeps digits", () => {
    expect(normalizeText("三检A1制度")).toBe("三检a1制度");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test normalize.test.ts`
Expected: FAIL（找不到模块）。

- [ ] **Step 3: 实现**

Create `normalize.ts`:
```ts
// 全角→半角（含全角空格），统一小写，去除所有标点与空白分隔符；保留数字与中英文。
export function normalizeText(input: string): string {
  const folded = input.replace(/[！-～]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  ).replace(/　/g, " ");
  return folded.toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, "");
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test normalize.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/normalize.ts packages/web/src/views/bidding/dedup/lib/__tests__/normalize.test.ts
git commit -m "feat(dedup): add normalizeText"
```

---

## Task 4: toShingles 字符 n-gram

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/shingle.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/shingle.test.ts`

- [ ] **Step 1: 写失败测试**

Create `shingle.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toShingles } from "../shingle";
import { hashString } from "../hash";

describe("toShingles", () => {
  it("produces (len - k + 1) shingles for normal input", () => {
    const set = toShingles("abcd", 3);
    expect(set.size).toBe(2);
    expect(set.has(hashString("abc"))).toBe(true);
    expect(set.has(hashString("bcd"))).toBe(true);
  });

  it("returns one shingle when input shorter than k", () => {
    const set = toShingles("ab", 3);
    expect(set.size).toBe(1);
    expect(set.has(hashString("ab"))).toBe(true);
  });

  it("returns empty set for empty input", () => {
    expect(toShingles("", 3).size).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test shingle.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `shingle.ts`:
```ts
import { hashString } from "./hash";

// 字符级 k-gram，hash 成整数集合。短于 k 时整体作为一个 shingle。
export function toShingles(norm: string, k = 3): Set<number> {
  const out = new Set<number>();
  if (norm.length === 0) return out;
  if (norm.length <= k) {
    out.add(hashString(norm));
    return out;
  }
  for (let i = 0; i + k <= norm.length; i++) {
    out.add(hashString(norm.slice(i, i + k)));
  }
  return out;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test shingle.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/shingle.ts packages/web/src/views/bidding/dedup/lib/__tests__/shingle.test.ts
git commit -m "feat(dedup): add toShingles"
```

---

## Task 5: jaccard 相似度

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/similarity.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/similarity.test.ts`

- [ ] **Step 1: 写失败测试**

Create `similarity.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { jaccard } from "../similarity";

describe("jaccard", () => {
  it("computes intersection over union", () => {
    expect(jaccard(new Set([1, 2, 3]), new Set([2, 3, 4]))).toBeCloseTo(0.5, 5);
  });

  it("returns 1 for identical sets", () => {
    expect(jaccard(new Set([1, 2]), new Set([1, 2]))).toBe(1);
  });

  it("returns 0 when both empty", () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccard(new Set([1]), new Set([2]))).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test similarity.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `similarity.ts`:
```ts
export function jaccard(a: Set<number>, b: Set<number>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const v of small) {
    if (large.has(v)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test similarity.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/similarity.ts packages/web/src/views/bidding/dedup/lib/__tests__/similarity.test.ts
git commit -m "feat(dedup): add jaccard similarity"
```

---

## Task 6: splitSentences 分句

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/segment.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/segment.test.ts`

- [ ] **Step 1: 写失败测试**

Create `segment.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { splitSentences } from "../segment";

describe("splitSentences", () => {
  it("splits on Chinese terminators and newlines, keeping the terminator", () => {
    const out = splitSentences("今天天气好。明天呢？\n后天");
    expect(out).toEqual(["今天天气好。", "明天呢？", "后天"]);
  });

  it("drops empty fragments and trims", () => {
    expect(splitSentences("  甲。  。乙！ ")).toEqual(["甲。", "乙！"]);
  });

  it("returns empty array for blank input", () => {
    expect(splitSentences("   \n ")).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test segment.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `segment.ts`:
```ts
// 按中文/英文句末标点与换行切句，保留句末标点，去空白片段。
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；!?;\n])/)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !/^[。！？；!?;]+$/.test(s));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test segment.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/segment.ts packages/web/src/views/bidding/dedup/lib/__tests__/segment.test.ts
git commit -m "feat(dedup): add splitSentences"
```

---

## Task 7: 领域类型 + buildParsedDoc

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/types.ts`
- Create: `packages/web/src/views/bidding/dedup/lib/build-doc.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/build-doc.test.ts`

- [ ] **Step 1: 定义类型（无测试）**

Create `types.ts`:
```ts
export type DocRole = "master" | "compare";

export interface Sentence {
  id: string; // `${docId}#${paraIdx}#${sentIdx}`
  text: string;
  norm: string;
  shingles: Set<number>;
}

export interface Para {
  idx: number;
  text: string;
  sentences: Sentence[];
}

export interface ParsedDoc {
  id: string;
  name: string;
  role: DocRole;
  paragraphs: Para[];
}

export interface Match {
  masterSentenceId: string;
  compareSentenceId: string;
  score: number;
}

export interface DedupResult {
  compareDocId: string;
  matches: Match[];
  charDuplicateRate: number;
  sentDuplicateRate: number;
}
```

- [ ] **Step 2: 写失败测试**

Create `build-doc.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildParsedDoc } from "../build-doc";

describe("buildParsedDoc", () => {
  it("splits paragraphs into sentences with ids, norm and shingles", () => {
    const doc = buildParsedDoc({
      id: "d1",
      name: "a.docx",
      role: "compare",
      paragraphTexts: ["质量管理体系健全。我们很好。", "第二段。"]
    });
    expect(doc.paragraphs).toHaveLength(2);
    expect(doc.paragraphs[0].sentences).toHaveLength(2);
    expect(doc.paragraphs[0].sentences[0].id).toBe("d1#0#0");
    expect(doc.paragraphs[0].sentences[0].text).toBe("质量管理体系健全。");
    expect(doc.paragraphs[0].sentences[0].norm).toBe("质量管理体系健全");
    expect(doc.paragraphs[0].sentences[0].shingles.size).toBeGreaterThan(0);
  });

  it("skips paragraphs with no sentences", () => {
    const doc = buildParsedDoc({
      id: "d1",
      name: "a.docx",
      role: "master",
      paragraphTexts: ["   ", "有效段落。"]
    });
    expect(doc.paragraphs).toHaveLength(1);
    expect(doc.paragraphs[0].text).toBe("有效段落。");
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm test build-doc.test.ts`
Expected: FAIL。

- [ ] **Step 4: 实现**

Create `build-doc.ts`:
```ts
import type { ParsedDoc, Para, Sentence, DocRole } from "./types";
import { splitSentences } from "./segment";
import { normalizeText } from "./normalize";
import { toShingles } from "./shingle";

export interface BuildDocInput {
  id: string;
  name: string;
  role: DocRole;
  paragraphTexts: string[];
}

export function buildParsedDoc(input: BuildDocInput): ParsedDoc {
  const paragraphs: Para[] = [];
  input.paragraphTexts.forEach((raw, paraIdx) => {
    const sentenceTexts = splitSentences(raw);
    if (sentenceTexts.length === 0) return;
    const sentences: Sentence[] = sentenceTexts.map((text, sentIdx) => {
      const norm = normalizeText(text);
      return {
        id: `${input.id}#${paraIdx}#${sentIdx}`,
        text,
        norm,
        shingles: toShingles(norm)
      };
    });
    paragraphs.push({ idx: paraIdx, text: raw.trim(), sentences });
  });
  return { id: input.id, name: input.name, role: input.role, paragraphs };
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm test build-doc.test.ts`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/types.ts packages/web/src/views/bidding/dedup/lib/build-doc.ts packages/web/src/views/bidding/dedup/lib/__tests__/build-doc.test.ts
git commit -m "feat(dedup): add domain types and buildParsedDoc"
```

---

## Task 8: 查重引擎 compareToMaster

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/engine.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/engine-compare.test.ts`

- [ ] **Step 1: 写失败测试**

Create `engine-compare.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildParsedDoc } from "../build-doc";
import { compareToMaster } from "../engine";

describe("compareToMaster", () => {
  const master = buildParsedDoc({
    id: "m",
    name: "master",
    role: "master",
    paragraphTexts: ["质量管理体系健全。"]
  });

  it("flags an exact-duplicate sentence and computes char/sentence rates", () => {
    const compare = buildParsedDoc({
      id: "c",
      name: "compare",
      role: "compare",
      paragraphTexts: ["质量管理体系健全。我们很好。"]
    });
    const result = compareToMaster(master, compare, 0.8);
    expect(result.compareDocId).toBe("c");
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].score).toBeCloseTo(1, 5);
    // "质量管理体系健全。"=9 chars matched / total 14 chars
    expect(result.charDuplicateRate).toBeCloseTo(9 / 14, 3);
    expect(result.sentDuplicateRate).toBeCloseTo(0.5, 5);
  });

  it("flags a near-duplicate above threshold", () => {
    const compare = buildParsedDoc({
      id: "c2",
      name: "compare2",
      role: "compare",
      paragraphTexts: ["质量管理体系健全有效。"]
    });
    const result = compareToMaster(master, compare, 0.6);
    expect(result.matches).toHaveLength(1);
    expect(result.charDuplicateRate).toBeCloseTo(1, 5);
  });

  it("reports zero when nothing is similar", () => {
    const compare = buildParsedDoc({
      id: "c3",
      name: "compare3",
      role: "compare",
      paragraphTexts: ["完全不相关的内容描述。"]
    });
    const result = compareToMaster(master, compare, 0.8);
    expect(result.matches).toHaveLength(0);
    expect(result.charDuplicateRate).toBe(0);
    expect(result.sentDuplicateRate).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test engine-compare.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `engine.ts`:
```ts
import type { ParsedDoc, Sentence, Match, DedupResult } from "./types";
import { jaccard } from "./similarity";

interface InvertedIndex {
  byShingle: Map<number, Sentence[]>;
}

function flatten(doc: ParsedDoc): Sentence[] {
  return doc.paragraphs.flatMap(p => p.sentences);
}

function buildIndex(sentences: Sentence[]): InvertedIndex {
  const byShingle = new Map<number, Sentence[]>();
  for (const s of sentences) {
    for (const sh of s.shingles) {
      const bucket = byShingle.get(sh);
      if (bucket) bucket.push(s);
      else byShingle.set(sh, [s]);
    }
  }
  return { byShingle };
}

// 倒排 shingle 索引：仅对“共享至少一个 shingle”的候选句对算 Jaccard，避免 O(n²)。
function bestMatch(
  sentence: Sentence,
  index: InvertedIndex,
  threshold: number
): Match | null {
  const candidates = new Set<Sentence>();
  for (const sh of sentence.shingles) {
    const bucket = index.byShingle.get(sh);
    if (bucket) for (const cand of bucket) candidates.add(cand);
  }
  let best: Match | null = null;
  for (const cand of candidates) {
    const score = jaccard(sentence.shingles, cand.shingles);
    if (score >= threshold && (best === null || score > best.score)) {
      best = {
        masterSentenceId: cand.id,
        compareSentenceId: sentence.id,
        score
      };
    }
  }
  return best;
}

export function compareToMaster(
  master: ParsedDoc,
  compare: ParsedDoc,
  threshold: number
): DedupResult {
  const index = buildIndex(flatten(master));
  const compareSentences = flatten(compare);
  const matches: Match[] = [];
  let dupChars = 0;
  let totalChars = 0;
  let dupSentences = 0;
  for (const s of compareSentences) {
    totalChars += s.text.length;
    const m = bestMatch(s, index, threshold);
    if (m) {
      matches.push(m);
      dupChars += s.text.length;
      dupSentences++;
    }
  }
  return {
    compareDocId: compare.id,
    matches,
    charDuplicateRate: totalChars === 0 ? 0 : dupChars / totalChars,
    sentDuplicateRate:
      compareSentences.length === 0 ? 0 : dupSentences / compareSentences.length
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test engine-compare.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/engine.ts packages/web/src/views/bidding/dedup/lib/__tests__/engine-compare.test.ts
git commit -m "feat(dedup): add compareToMaster engine with inverted-shingle blocking"
```

---

## Task 9: 全量相似度矩阵

**Files:**
- Modify: `packages/web/src/views/bidding/dedup/lib/engine.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/engine-matrix.test.ts`

- [ ] **Step 1: 写失败测试**

Create `engine-matrix.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildParsedDoc } from "../build-doc";
import { pairSimilarity, buildSimilarityMatrix } from "../engine";

const a = buildParsedDoc({ id: "a", name: "a", role: "master", paragraphTexts: ["质量管理体系健全。"] });
const b = buildParsedDoc({ id: "b", name: "b", role: "compare", paragraphTexts: ["质量管理体系健全。"] });
const c = buildParsedDoc({ id: "c", name: "c", role: "compare", paragraphTexts: ["完全不相关的内容。"] });

describe("pairSimilarity", () => {
  it("is 1 for identical docs and symmetric", () => {
    expect(pairSimilarity(a, b, 0.8)).toBeCloseTo(1, 5);
    expect(pairSimilarity(b, a, 0.8)).toBeCloseTo(1, 5);
  });

  it("is 0 for unrelated docs", () => {
    expect(pairSimilarity(a, c, 0.8)).toBe(0);
  });
});

describe("buildSimilarityMatrix", () => {
  it("returns a symmetric matrix with 1 on the diagonal", () => {
    const m = buildSimilarityMatrix([a, b, c], 0.8);
    expect(m).toHaveLength(3);
    expect(m[0][0]).toBeCloseTo(1, 5);
    expect(m[0][1]).toBeCloseTo(1, 5);
    expect(m[1][0]).toBeCloseTo(1, 5);
    expect(m[0][2]).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test engine-matrix.test.ts`
Expected: FAIL（pairSimilarity 未导出）。

- [ ] **Step 3: 实现（追加到 engine.ts 末尾）**

Append to `engine.ts`:
```ts
// 对称的两两相似度：两侧被对方命中的句子字数之和 / 两侧总字数之和。
export function pairSimilarity(
  x: ParsedDoc,
  y: ParsedDoc,
  threshold: number
): number {
  const xy = compareToMaster(y, x, threshold);
  const yx = compareToMaster(x, y, threshold);
  const xChars = flatten(x).reduce((n, s) => n + s.text.length, 0);
  const yChars = flatten(y).reduce((n, s) => n + s.text.length, 0);
  const dupX = xy.matches.reduce((n, m) => {
    const s = flatten(x).find(t => t.id === m.compareSentenceId);
    return n + (s ? s.text.length : 0);
  }, 0);
  const dupY = yx.matches.reduce((n, m) => {
    const s = flatten(y).find(t => t.id === m.compareSentenceId);
    return n + (s ? s.text.length : 0);
  }, 0);
  const total = xChars + yChars;
  return total === 0 ? 0 : (dupX + dupY) / total;
}

export function buildSimilarityMatrix(
  docs: ParsedDoc[],
  threshold: number
): number[][] {
  return docs.map((di, i) =>
    docs.map((dj, j) => {
      if (i === j) return 1;
      return pairSimilarity(di, dj, threshold);
    })
  );
}
```

> 注：`flatten` 已在 Task 8 定义于同文件，直接复用，无需重复声明。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test engine-matrix.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/engine.ts packages/web/src/views/bidding/dedup/lib/__tests__/engine-matrix.test.ts
git commit -m "feat(dedup): add pairwise similarity matrix"
```

---

## Task 10: 高亮分段 buildHighlightSegments

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/highlight.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/highlight.test.ts`

- [ ] **Step 1: 写失败测试**

Create `highlight.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildHighlightSegments } from "../highlight";
import type { Sentence } from "../types";

function sent(id: string, text: string): Sentence {
  return { id, text, norm: text, shingles: new Set() };
}

describe("buildHighlightSegments", () => {
  it("marks sentences whose id is in the duplicate set", () => {
    const sentences = [sent("a#0#0", "重复句。"), sent("a#0#1", "独有句。")];
    const segs = buildHighlightSegments(sentences, new Set(["a#0#0"]));
    expect(segs).toEqual([
      { text: "重复句。", duplicate: true },
      { text: "独有句。", duplicate: false }
    ]);
  });

  it("marks nothing when the set is empty", () => {
    const segs = buildHighlightSegments([sent("a#0#0", "句。")], new Set());
    expect(segs).toEqual([{ text: "句。", duplicate: false }]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test highlight.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `highlight.ts`:
```ts
import type { Sentence } from "./types";

export interface HighlightSegment {
  text: string;
  duplicate: boolean;
}

export function buildHighlightSegments(
  sentences: Sentence[],
  duplicateIds: Set<string>
): HighlightSegment[] {
  return sentences.map(s => ({
    text: s.text,
    duplicate: duplicateIds.has(s.id)
  }));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test highlight.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/highlight.ts packages/web/src/views/bidding/dedup/lib/__tests__/highlight.test.ts
git commit -m "feat(dedup): add highlight segment builder"
```

---

## Task 11: docx 解析（mammoth 往返集成测试）

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/parse-docx.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/parse-docx.test.ts`

- [ ] **Step 1: 写失败测试（用 docx 生成 → mammoth 解析往返）**

Create `parse-docx.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { splitDocxParagraphs, parseDocxArrayBuffer } from "../parse-docx";

describe("splitDocxParagraphs", () => {
  it("splits raw text on newlines and trims, dropping blanks", () => {
    expect(splitDocxParagraphs("第一段\n\n第二段\n")).toEqual(["第一段", "第二段"]);
  });
});

describe("parseDocxArrayBuffer", () => {
  it("extracts paragraph texts from a real docx", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("第一段内容。")] }),
            new Paragraph({ children: [new TextRun("第二段内容。")] })
          ]
        }
      ]
    });
    const buffer = await Packer.toBuffer(doc);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    );
    const paras = await parseDocxArrayBuffer(arrayBuffer);
    expect(paras).toContain("第一段内容。");
    expect(paras).toContain("第二段内容。");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test parse-docx.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `parse-docx.ts`:
```ts
import mammoth from "mammoth";

export function splitDocxParagraphs(rawText: string): string[] {
  return rawText
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

export async function parseDocxArrayBuffer(
  arrayBuffer: ArrayBuffer
): Promise<string[]> {
  const { value } = await mammoth.extractRawText({ arrayBuffer });
  return splitDocxParagraphs(value);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test parse-docx.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/parse-docx.ts packages/web/src/views/bidding/dedup/lib/__tests__/parse-docx.test.ts
git commit -m "feat(dedup): add docx parser via mammoth"
```

---

## Task 12: pdf 解析（纯 helper 单测 + 浏览器适配器）

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/parse-pdf.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/parse-pdf.test.ts`

- [ ] **Step 1: 写失败测试（仅测纯 helper）**

Create `parse-pdf.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { pdfItemsToParagraphs } from "../parse-pdf";

describe("pdfItemsToParagraphs", () => {
  it("joins text items and splits into non-empty paragraphs on line breaks", () => {
    const items = [
      { str: "第一行" },
      { str: "继续", hasEOL: false },
      { str: "", hasEOL: true },
      { str: "第二段", hasEOL: true }
    ];
    expect(pdfItemsToParagraphs(items)).toEqual(["第一行继续", "第二段"]);
  });

  it("returns empty array when no text", () => {
    expect(pdfItemsToParagraphs([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test parse-pdf.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现（helper 可测 + 适配器用于浏览器）**

Create `parse-pdf.ts`:
```ts
import * as pdfjsLib from "pdfjs-dist";
// Vite 会把 worker 作为独立资源处理。
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

// 把页面文本项拼成段落：遇到 EOL 收尾当前段，过滤空段。
export function pdfItemsToParagraphs(items: PdfTextItem[]): string[] {
  const paragraphs: string[] = [];
  let current = "";
  for (const item of items) {
    current += item.str;
    if (item.hasEOL) {
      const trimmed = current.trim();
      if (trimmed.length > 0) paragraphs.push(trimmed);
      current = "";
    }
  }
  const tail = current.trim();
  if (tail.length > 0) paragraphs.push(tail);
  return paragraphs;
}

export async function parsePdfArrayBuffer(
  arrayBuffer: ArrayBuffer
): Promise<string[]> {
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const all: string[] = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const items = content.items as PdfTextItem[];
    if (items.length === 0) continue;
    all.push(...pdfItemsToParagraphs(items));
  }
  if (all.length === 0) {
    throw new Error("此 PDF 无文字层，需先转为可复制文字或另存。");
  }
  return all;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test parse-pdf.test.ts`
Expected: PASS。

- [ ] **Step 5: 手动验证（浏览器）**

构建无误后在页面上传一份电子版 PDF，确认能抽出文字；上传一份扫描版 PDF，确认弹出“无文字层”提示。记录于 `doc/开发记录.md`。

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/parse-pdf.ts packages/web/src/views/bidding/dedup/lib/__tests__/parse-pdf.test.ts
git commit -m "feat(dedup): add pdf parser via pdfjs-dist"
```

---

## Task 13: 文件分发 detectKind + parseFile

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/doc-parser.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/doc-parser.test.ts`

- [ ] **Step 1: 写失败测试（仅测 detectKind）**

Create `doc-parser.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { detectKind } from "../doc-parser";

describe("detectKind", () => {
  it("detects docx and pdf case-insensitively", () => {
    expect(detectKind("标书.DOCX")).toBe("docx");
    expect(detectKind("a.pdf")).toBe("pdf");
  });

  it("throws on unsupported extensions", () => {
    expect(() => detectKind("old.doc")).toThrow(/不支持/);
    expect(() => detectKind("note.txt")).toThrow(/不支持/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test doc-parser.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `doc-parser.ts`:
```ts
import { parseDocxArrayBuffer } from "./parse-docx";
import { parsePdfArrayBuffer } from "./parse-pdf";

export type DocKind = "docx" | "pdf";

export function detectKind(filename: string): DocKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  throw new Error(`不支持的文件格式：${filename}（仅支持 .docx 与电子版 .pdf）`);
}

export async function parseFile(file: File): Promise<string[]> {
  const kind = detectKind(file.name);
  const arrayBuffer = await file.arrayBuffer();
  return kind === "docx"
    ? parseDocxArrayBuffer(arrayBuffer)
    : parsePdfArrayBuffer(arrayBuffer);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test doc-parser.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/doc-parser.ts packages/web/src/views/bidding/dedup/lib/__tests__/doc-parser.test.ts
git commit -m "feat(dedup): add file kind detection and parse dispatch"
```

---

## Task 14: docx 导出底座

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/docx-export.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/docx-export.test.ts`

- [ ] **Step 1: 写失败测试**

Create `docx-export.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildDocxBuffer } from "../docx-export";

describe("buildDocxBuffer", () => {
  it("produces a non-empty docx buffer from paragraph texts", async () => {
    const buf = await buildDocxBuffer(["第一段。", "第二段。"]);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("handles empty input without throwing", async () => {
    const buf = await buildDocxBuffer([]);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test docx-export.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `docx-export.ts`:
```ts
import { Document, Packer, Paragraph, TextRun } from "docx";

// 生成结构干净的 docx（不保留原版式，见 spec 第 9 节取舍）。
export async function buildDocxBuffer(paragraphTexts: string[]): Promise<Buffer> {
  const children =
    paragraphTexts.length > 0
      ? paragraphTexts.map(
          t => new Paragraph({ children: [new TextRun(t)] })
        )
      : [new Paragraph({ children: [new TextRun("")] })];
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

export async function downloadDocx(
  paragraphTexts: string[],
  filename: string
): Promise<void> {
  const { Document, Packer, Paragraph, TextRun } = await import("docx");
  const children =
    paragraphTexts.length > 0
      ? paragraphTexts.map(
          t => new Paragraph({ children: [new TextRun(t)] })
        )
      : [new Paragraph({ children: [new TextRun("")] })];
  const blob = await Packer.toBlob(
    new Document({ sections: [{ children }] })
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".docx") ? filename : `${filename}.docx`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test docx-export.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/docx-export.ts packages/web/src/views/bidding/dedup/lib/__tests__/docx-export.test.ts
git commit -m "feat(dedup): add docx export helper"
```

---

## Task 15: 页面状态编排 useDedupTool

**Files:**
- Create: `packages/web/src/views/bidding/dedup/composables/useDedupTool.ts`
- Test: `packages/web/src/views/bidding/dedup/composables/__tests__/useDedupTool.test.ts`

- [ ] **Step 1: 写失败测试**

Create `composables/__tests__/useDedupTool.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { useDedupTool } from "../useDedupTool";
import { buildParsedDoc } from "../../lib/build-doc";

describe("useDedupTool", () => {
  it("computes star results against the master and a similarity matrix", () => {
    const tool = useDedupTool();
    tool.addDoc(
      buildParsedDoc({ id: "m", name: "母本", role: "master", paragraphTexts: ["质量管理体系健全。"] })
    );
    tool.addDoc(
      buildParsedDoc({ id: "c", name: "对比1", role: "compare", paragraphTexts: ["质量管理体系健全。其他内容。"] })
    );
    tool.compute();
    expect(tool.starResults.value).toHaveLength(1);
    expect(tool.starResults.value[0].charDuplicateRate).toBeGreaterThan(0);
    expect(tool.matrix.value).toHaveLength(2);
    expect(tool.matrix.value[0][0]).toBeCloseTo(1, 5);
  });

  it("throws compute error when no master is set", () => {
    const tool = useDedupTool();
    tool.addDoc(
      buildParsedDoc({ id: "c", name: "对比1", role: "compare", paragraphTexts: ["内容。"] })
    );
    expect(() => tool.compute()).toThrow(/母本/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test useDedupTool.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `composables/useDedupTool.ts`:
```ts
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
    docs.value = docs.value.filter(d => d.id !== id);
  }

  function compute(): void {
    const master = docs.value.find(d => d.role === "master");
    if (!master) throw new Error("请先指定母本再计算");
    const compares = docs.value.filter(d => d.role === "compare");
    starResults.value = compares.map(c =>
      compareToMaster(master, c, threshold.value)
    );
    matrix.value = buildSimilarityMatrix(docs.value, threshold.value);
  }

  return { docs, threshold, starResults, matrix, addDoc, removeDoc, compute };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test useDedupTool.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/composables/useDedupTool.ts packages/web/src/views/bidding/dedup/composables/__tests__/useDedupTool.test.ts
git commit -m "feat(dedup): add useDedupTool orchestrator composable"
```

---

## Task 16: 视图组件（FileDropZone / SummaryCards / PairCompareView / MatrixView / index）

> 这些是 UI 装配；纯逻辑已在 lib/composable 中测过。组件本身用手动验证（spec 第 7、10 节）。每个组件完整代码如下，无占位。

**Files:**
- Create: `packages/web/src/views/bidding/dedup/components/FileDropZone.vue`
- Create: `packages/web/src/views/bidding/dedup/components/SummaryCards.vue`
- Create: `packages/web/src/views/bidding/dedup/components/PairCompareView.vue`
- Create: `packages/web/src/views/bidding/dedup/components/MatrixView.vue`
- Create: `packages/web/src/views/bidding/dedup/index.vue`

- [ ] **Step 1: FileDropZone.vue**

```vue
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
      const hasMaster = props.docs.some(d => d.role === "master");
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
        >设为母本</el-button>
        <el-button link type="danger" @click="emit('remove', d.id)">移除</el-button>
      </li>
    </ul>
  </div>
</template>
```

- [ ] **Step 2: SummaryCards.vue**

```vue
<script setup lang="ts">
import type { DedupResult, ParsedDoc } from "../lib/types";

const props = defineProps<{ results: DedupResult[]; docs: ParsedDoc[] }>();

function docName(id: string): string {
  return props.docs.find(d => d.id === id)?.name ?? id;
}
function pct(v: number): string {
  return `${Math.round(v * 100)}%`;
}
function tone(v: number): string {
  if (v >= 0.3) return "danger";
  if (v >= 0.15) return "warning";
  return "success";
}
</script>

<template>
  <div class="summary-cards">
    <el-card v-for="r in props.results" :key="r.compareDocId" shadow="never">
      <div class="label">{{ docName(r.compareDocId) }} 与母本重复率</div>
      <div class="value" :class="tone(r.charDuplicateRate)">
        {{ pct(r.charDuplicateRate) }}
      </div>
      <div class="sub">句数重复率 {{ pct(r.sentDuplicateRate) }}</div>
    </el-card>
  </div>
</template>
```

- [ ] **Step 3: PairCompareView.vue**

```vue
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
  () => new Set(props.result.matches.map(m => m.masterSentenceId))
);
const compareDupIds = computed(
  () => new Set(props.result.matches.map(m => m.compareSentenceId))
);

const masterSentences = computed(() =>
  props.master.paragraphs.flatMap(p => p.sentences)
);
const compareSentences = computed(() =>
  props.compare.paragraphs.flatMap(p => p.sentences)
);

const masterSegs = computed(() =>
  buildHighlightSegments(masterSentences.value, masterDupIds.value)
);
const compareSegs = computed(() =>
  buildHighlightSegments(compareSentences.value, compareDupIds.value)
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
        >{{ s.text }}</span>
      </p>
    </div>
    <div class="pane">
      <h4>{{ props.compare.name }}</h4>
      <p>
        <span
          v-for="(s, i) in compareSegs"
          :key="i"
          :class="{ dup: s.duplicate }"
        >{{ s.text }}</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.pair-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.dup { background: var(--el-color-danger-light-8); border-radius: 3px; }
</style>
```

- [ ] **Step 4: MatrixView.vue（echarts heatmap）**

```vue
<script setup lang="ts">
import { computed } from "vue";
import VChart from "vue-echarts";
import { use } from "echarts/core";
import { HeatmapChart } from "echarts/charts";
import { GridComponent, VisualMapComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ParsedDoc } from "../lib/types";

use([HeatmapChart, GridComponent, VisualMapComponent, TooltipComponent, CanvasRenderer]);

const props = defineProps<{ docs: ParsedDoc[]; matrix: number[][] }>();

const names = computed(() => props.docs.map(d => d.name));
const data = computed(() => {
  const out: [number, number, number][] = [];
  props.matrix.forEach((row, i) =>
    row.forEach((v, j) => out.push([j, i, Math.round(v * 100)]))
  );
  return out;
});

const option = computed(() => ({
  tooltip: { position: "top" },
  grid: { containLabel: true },
  xAxis: { type: "category", data: names.value },
  yAxis: { type: "category", data: names.value },
  visualMap: { min: 0, max: 100, calculable: true, orient: "horizontal", left: "center", bottom: 0 },
  series: [{ type: "heatmap", data: data.value, label: { show: true, formatter: (p: any) => `${p.value[2]}%` } }]
}));
</script>

<template>
  <v-chart :option="option" autoresize style="height: 360px" />
</template>
```

> 注：若仓库未安装 `vue-echarts`，在 `packages/web` 下执行 `pnpm add vue-echarts`（`echarts` 已存在）。在 Step 6 手动验证时确认。

- [ ] **Step 5: index.vue（页面装配）**

```vue
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

const master = computed(() => tool.docs.value.find(d => d.role === "master"));
const selectedResult = computed(() =>
  tool.starResults.value.find(r => r.compareDocId === selectedCompareId.value)
);
const selectedCompareDoc = computed(() =>
  tool.docs.value.find(d => d.id === selectedCompareId.value)
);

function setRole(payload: { id: string; role: DocRole }) {
  tool.docs.value = tool.docs.value.map(d => {
    if (d.id === payload.id) return { ...d, role: "master" };
    if (d.role === "master") return { ...d, role: "compare" };
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
  const paras = doc.paragraphs.map(p => p.text);
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
      <el-slider v-model="tool.threshold.value" :min="0.5" :max="1" :step="0.05" />
      <el-button type="primary" @click="onCompute">开始查重</el-button>
      <el-button :disabled="!selectedCompareDoc" @click="onExport">导出去重 docx</el-button>
    </div>

    <SummaryCards :results="tool.starResults.value" :docs="tool.docs.value" />

    <el-radio-group v-model="tab">
      <el-radio-button value="star">母本对照</el-radio-button>
      <el-radio-button value="matrix">相似度矩阵</el-radio-button>
    </el-radio-group>

    <template v-if="tab === 'star' && master && selectedResult && selectedCompareDoc">
      <el-select v-model="selectedCompareId">
        <el-option
          v-for="r in tool.starResults.value"
          :key="r.compareDocId"
          :value="r.compareDocId"
          :label="tool.docs.value.find(d => d.id === r.compareDocId)?.name"
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
```

- [ ] **Step 6: 手动验证 + typecheck**

Run: `pnpm typecheck`
Expected: 通过（无 `any` 报错；如 `vue-echarts` 缺失先安装）。
浏览器手动：上传 1 母本 + 2 对比（docx + pdf），点开始查重 → 看到指标卡、母本对照高亮、矩阵；导出去重 docx 能打开。

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/views/bidding/dedup/components packages/web/src/views/bidding/dedup/index.vue packages/web/package.json packages/web/pnpm-lock.yaml
git commit -m "feat(dedup): add bidding dedup views (drop zone, cards, pair compare, matrix)"
```

---

## Task 17: 路由菜单「投标」

**Files:**
- Create: `packages/web/src/router/modules/bidding.ts`

- [ ] **Step 1: 参考现有模块格式**

Read `packages/web/src/router/modules/asset.ts`（照抄其字段结构：`path`/`meta.title`/`meta.icon`/`meta.rank`/`children`，并确认子路由 `component` 的写法）。

- [ ] **Step 2: 实现路由（按 asset.ts 的实际字段对齐）**

Create `bidding.ts`（字段命名以 asset.ts 为准，下面为结构示例）:
```ts
export default {
  path: "/bidding",
  redirect: "/bidding/dedup",
  meta: {
    title: "投标",
    icon: "ri:file-copy-2-line",
    rank: 20
  },
  children: [
    {
      path: "/bidding/dedup",
      name: "BiddingDedup",
      component: () => import("@/views/bidding/dedup/index.vue"),
      meta: {
        title: "查重对比",
        roles: ["super_admin", "manager", "site_manager", "operator"]
      }
    }
  ]
} satisfies RouteConfigsTable;
```

> `RouteConfigsTable` 类型与 `roles` 字段名以 asset.ts 实际为准；若该项目用其它权限字段（如 `meta.auths`），照其约定改。路由模块由 `router/index.ts` 自动加载，无需手动注册。

- [ ] **Step 3: 手动验证**

Run: `pnpm dev`，登录后侧边栏出现「投标 → 查重对比」，点击进入页面正常。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/router/modules/bidding.ts
git commit -m "feat(dedup): register 投标 menu and dedup route"
```

---

## Task 18: 收尾 — 全量测试 + 类型检查 + 开发记录

- [ ] **Step 1: 全量测试**

Run（`packages/web`）: `pnpm test`
Expected: 全部通过。

- [ ] **Step 2: 类型检查**

Run: `pnpm typecheck`
Expected: 通过，无 `any` / `@ts-ignore`。

- [ ] **Step 3: 追加开发记录**

在 `doc/开发记录.md` 末尾追加一段：投标查重前端核心（Plan A）完成内容、文件清单、已知取舍（不保版式、PDF 需文字层）、Plan B（AI 去重）待办。

- [ ] **Step 4: Commit**

```bash
git add doc/开发记录.md
git commit -m "docs: 记录投标查重前端核心(Plan A)"
```

---

## Self-Review 记录

- **Spec 覆盖**：spec §3 架构→Task1-16；§4 文件结构→各 Task 路径一致；§5 数据结构→Task7 types.ts；§6 引擎→Task2-9；§7 视图→Task16；§9 导出→Task14（明确不保版式）；§10 错误处理→detectKind/parsePdf/compute 抛错 + ElMessage；§11 测试→各 Task TDD。**Spec §8 AI 去重**：明确划入 Plan B（跨 api + task-runner），本计划不实现。
- **占位扫描**：无 TBD；UI 任务给出完整组件代码；路由任务因需对齐 asset.ts 字段，标注“以 asset.ts 实际为准”，执行时先 Read 再写（非占位，是接入既有约定）。
- **类型一致**：`ParsedDoc/Sentence/Para/Match/DedupResult` 在 Task7 定义，后续 Task8/9/10/15/16 引用一致；`compareToMaster(master, compare, threshold)`、`buildSimilarityMatrix(docs, threshold)`、`buildHighlightSegments(sentences, ids)`、`buildParsedDoc({paragraphTexts})`、`parseFile/detectKind`、`buildDocxBuffer/downloadDocx` 全程签名一致。
```
