<script setup lang="ts">
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
// Vite 会把 worker 作为独立资源处理（同 views/bidding/dedup/lib/parse-pdf.ts）。
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

/** 逐页把 PDF 画到 canvas 上：先画前几页，滚到底再画后面的；文件按 1 MiB 一段去取，不一次拉完。 */
const props = defineProps<{ url: string }>();
const emit = defineEmits<{ failed: [] }>();

const FIRST_PAGES = 3;
const MORE_PAGES = 2;
const RANGE_CHUNK = 1024 * 1024;
/**
 * 字符映射表的地址（build/pdfjs-cmaps.ts 把它们放在这里）。
 * 没内嵌中文字体的 PDF 靠它才画得出字。要写成完整地址：取它的是 worker，相对地址会相对到 worker 脚本上去。
 */
const CMAP_URL = new URL(
  `${import.meta.env.BASE_URL}static/pdfjs/cmaps/`,
  window.location.href
).href;
const MAX_PAGE_WIDTH = 1100;
/** 离底部还有这么多像素时就开始画后面的页 */
const NEAR_BOTTOM = 600;

const container = ref<HTMLElement | null>(null);
const pages = ref<number[]>([]);
const total = ref(0);
const loading = ref(true);
const failed = ref(false);

// pdf.js 的对象不能放进响应式里（会被代理坏），用普通变量拿着
let task: PDFDocumentLoadingTask | null = null;
let pdf: PDFDocumentProxy | null = null;
let rendering = false;
/** 每次换文件加一：旧文件还没画完的那几步看到它变了就停手 */
let generation = 0;
const canvases = new Map<number, HTMLCanvasElement>();

const setCanvas = (pageNumber: number, element: unknown) => {
  if (element instanceof HTMLCanvasElement) canvases.set(pageNumber, element);
  else canvases.delete(pageNumber);
};

const fail = (error: unknown) => {
  console.error("[doc-library] PDF 打不开", error);
  loading.value = false;
  failed.value = true;
  emit("failed");
};

const drawPage = async (
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement
) => {
  const page = await doc.getPage(pageNumber);
  const width = Math.min(
    Math.max((container.value?.clientWidth ?? 800) - 32, 320),
    MAX_PAGE_WIDTH
  );
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: (width / base.width) * ratio });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
  canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
  await page.render({ canvas, viewport }).promise;
};

const nearBottom = (): boolean => {
  const element = container.value;
  if (!element) return false;
  return (
    element.scrollTop + element.clientHeight >=
    element.scrollHeight - NEAR_BOTTOM
  );
};

const renderMore = async (count: number): Promise<void> => {
  const doc = pdf;
  if (!doc || rendering || pages.value.length >= total.value) return;
  const mine = generation;
  const from = pages.value.length + 1;
  const to = Math.min(total.value, from + count - 1);
  rendering = true;
  try {
    for (let pageNumber = from; pageNumber <= to; pageNumber += 1) {
      pages.value = [...pages.value, pageNumber];
      await nextTick();
      const canvas = canvases.get(pageNumber);
      if (mine !== generation || !canvas) return;
      await drawPage(doc, pageNumber, canvas);
      if (mine !== generation) return;
    }
  } catch (error) {
    if (mine === generation) fail(error);
    return;
  } finally {
    if (mine === generation) rendering = false;
  }
  // 页面矮、窗口高的时候画完还没填满：接着画
  if (nearBottom()) await renderMore(MORE_PAGES);
};

const close = () => {
  generation += 1;
  rendering = false;
  const previous = task;
  task = null;
  pdf = null;
  canvases.clear();
  if (previous) void previous.destroy().catch(() => undefined);
};

const open = async (url: string) => {
  close();
  const mine = generation;
  pages.value = [];
  total.value = 0;
  loading.value = true;
  failed.value = false;
  if (!url) return;
  try {
    const started = pdfjsLib.getDocument({
      url,
      rangeChunkSize: RANGE_CHUNK,
      disableAutoFetch: true,
      disableStream: true,
      cMapUrl: CMAP_URL,
      cMapPacked: true
    });
    task = started;
    const doc = await started.promise;
    if (mine !== generation) return;
    pdf = doc;
    total.value = doc.numPages;
    loading.value = false;
    await renderMore(FIRST_PAGES);
  } catch (error) {
    if (mine === generation) fail(error);
  }
};

const onScroll = () => {
  if (nearBottom()) void renderMore(MORE_PAGES);
};

watch(
  () => props.url,
  url => void open(url),
  { immediate: true }
);
onBeforeUnmount(close);
</script>

<template>
  <div ref="container" class="pdf" @scroll.passive="onScroll">
    <div v-if="loading" class="state">正在打开…</div>
    <canvas
      v-for="pageNumber in pages"
      :key="pageNumber"
      :ref="element => setCanvas(pageNumber, element)"
      class="page"
    />
    <div v-if="total > 0 && !failed" class="foot">
      已显示 {{ pages.length }} / {{ total }} 页<template
        v-if="pages.length < total"
        >，往下滚继续</template
      >
    </div>
  </div>
</template>

<style scoped>
.pdf {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
  height: 100%;
  padding: 12px 16px;
  overflow: auto;
  background: var(--el-fill-color-light);
}

.page {
  flex-shrink: 0;
  background: #fff;
  box-shadow: 0 1px 4px rgb(0 0 0 / 12%);
}

.state,
.foot {
  padding: 8px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
