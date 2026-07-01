# 投标查重对比工具 — 设计文档

- 日期：2026-06-28
- 模块：`packages/web`（Vue 3 + Element Plus + PureAdmin）新增「投标 / 查重对比」
- 目标用户：投标部门

## 1. 背景与目标

投标部门常在多份标书/技术文件之间复用模板内容。评标系统会检测“雷同标书”，相似度过高可能被判废标。本工具用于在**内部提交前**，以一份文件为母本，查出其他文件与母本（以及彼此之间）的重复段落，并支持 AI 自动重写降低相似度，最终导出去重后的文档。

核心诉求：
- 以一份文件为**母本**，对比文件与母本之间的重复比例。
- 支持**同时对比多份**（母本 + 对比1 + 对比2 + … + 对比n）。
- 提供 **AI 一键去重（润色）**，尽量去掉重复区域。

## 2. 已确认的关键决策

| 维度 | 决策 |
| --- | --- |
| 交付形态 | 集成进现有 `packages/web` 后台，新增「投标」模块。解析与查重全部在浏览器本地完成，文件不上传 |
| 输入格式 | `.docx`（mammoth.js 解析）+ 电子版可复制文字 PDF（pdf.js 取文字层）。**不做 OCR**，不支持扫描版 PDF |
| 查重算法 | 逐句近似查重：字符 n-gram shingle + MinHash/LSH 候选筛选 + Jaccard 阈值判定，纯前端 |
| 对比拓扑 | 两者都做：① 母本中心星型视图 ② 全量两两相似度矩阵 |
| AI 去重方式 | 整段/整篇自动重写。母本始终不动，只重写对比文件中被标红的段落；只把重复片段发后端 |
| AI 调用链路 | 与现有其他 AI 业务一致，走 `/api/v1` → AI Slot → task-runner（Runner Nodes）异步队列 |
| 结果输出 | ① 网页内高亮对照查看 ② 导出去重后的 `.docx` |
| 菜单归属 | 新建顶级菜单「投标」→ 查重对比 |
| 权限 | operator 及以上（投标相关人员），后续按 RBAC 收紧 |

## 3. 整体架构

```
浏览器（packages/web 新模块）
  解析层  →  规范化  →  查重引擎  →  视图  →  AI去重  →  导出
 docx/pdf    分句       shingle+LSH   高亮/矩阵   ↘后端     docx
                                                AI Slot→task-runner
```

- 文件解析、分句、查重、高亮、矩阵、报告导出：**全部浏览器本地**，文件不上传。
- 唯一出网点：AI 去重时，**只把被标红的重复段落文本**发给后端，经 AI Slot → task-runner 返回改写文本。整份文件永不上传。
- 重型库（mammoth、pdfjs-dist、docx）动态 `import()` 懒加载，不拖累主包体积。解析在 Web Worker 中执行，避免阻塞 UI。

## 4. 模块与文件结构

遵循 PureAdmin / 现有约定（`router/modules/*.ts` 注册菜单、`views/<domain>/`、`api/<domain>.ts`）。

```
packages/web/src/
  router/modules/bidding.ts        新增顶级菜单「投标」
  views/bidding/dedup/
    index.vue                      页面装配（上传区 / 指标卡 / 视图切换）
    components/
      FileDropZone.vue             拖拽上传、母本标记、文件列表
      SummaryCards.vue             重复率指标卡
      PairCompareView.vue          母本 ↔ 对比 双栏高亮对照
      MatrixView.vue               全量相似度矩阵（echarts heatmap）
      RewritePanel.vue             AI 改写建议 + 采纳 / 跳过 / 手改
    composables/
      useDocParser.ts              docx(mammoth) / pdf(pdf.js) → 纯文本 + 段落
      useSegmenter.ts              分句 + 规范化
      useDedupEngine.ts            shingle / MinHash / LSH / Jaccard 核心（纯函数，不依赖 Vue）
      useDedupAI.ts                调后端 AI 改写
      useDocxExport.ts             生成去重后 docx
  api/bidding-dedup.ts             仅封装 AI 改写一个接口
```

每个文件单一职责、可独立测试。查重引擎为纯函数模块，便于单测。

## 5. 数据结构（全部不可变）

```ts
interface ParsedDoc {
  id: string;
  name: string;
  role: "master" | "compare";
  paragraphs: Para[];
}
interface Para {
  idx: number;
  text: string;
  sentences: Sentence[];
}
interface Sentence {
  id: string;        // `${docId}#${paraIdx}#${sentIdx}`
  text: string;      // 原文
  norm: string;      // 规范化后文本
  shingles: number[];// 规范化文本的 hash 化 shingle 集合
}
interface Match {
  masterSentenceId: string;
  compareSentenceId: string;
  score: number;     // Jaccard 相似度
}
interface DedupResult {
  compareDocId: string;
  matches: Match[];
  charDuplicateRate: number;  // 主指标：重复字数 / 对比文件总字数
  sentDuplicateRate: number;  // 副指标：重复句数 / 对比文件总句数
}
```

所有结构 immutable；引擎为输入 → 输出的纯函数，不做原地修改。

## 6. 查重引擎（算法细节）

1. **分句**：按中文标点 `。！？；` 及换行切分段落为句子。
2. **规范化**：去空白、全/半角统一、可选去标点与数字 → `norm`。
3. **shingle**：对 `norm` 取字符 3-gram，hash 成整数集合。
4. **候选筛选（LSH）**：对每句计算 MinHash 签名并分桶，仅对落入同桶的句对作精算，避免多文档 O(n²) 爆炸。
5. **精算判定**：候选句对算 Jaccard 相似度，`≥ 阈值` 判为重复。
6. **精确层前置**：先对 `norm` 直接哈希，秒级命中一字不改的复制段。

- **阈值**：默认 `0.80`，界面滑杆可调（0.5–1.0）。
- **重复率口径**：主指标按**字数占比** =（对比文件中命中重复的句子字数）/（对比文件总字数），贴近评标“雷同字数比”；句数占比作为副指标同时显示。
- **全量矩阵**：任意两份文件两两做同样匹配，取对称相似度填 heatmap。
- **性能目标**：约 10 份、每份数千句，秒级出结果。

## 7. 视图

- **母本中心星型**：默认视图。指标卡列出每个对比文件与母本的重复率；下方双栏（母本只读 vs 选中对比文件）逐句高亮重复段，点击可跳转定位。
- **全量相似度矩阵**：echarts heatmap，展示所有文件两两相似度，定位“互相雷同”的文件对。

## 8. AI 一键去重

- 重写单元为**含重复内容的段落**。把这些段落连同“需降低与母本相似度、保持原意与专业表述”的指令发给后端，逐段返回改写稿。母本始终不动。
- 链路：`api/bidding-dedup.ts` → `/api/v1/...` → AI Slot → task-runner 异步队列（与现有 AI 业务一致）。
- **导出前人工闸门**：虽为自动重写，导出前保留 采纳 / 跳过 / 手改（支持“全部采纳”）。生成正式标书属不可逆外发，必须人来拍板。
- **本地开发**：`MOCK_AI_ONLY=true` 时走 mock 改写，无需 Key。

## 9. 导出去重后的 docx

- 采纳后的段落替换回文本，用 `docx` 库生成一份**结构干净**的新 `.docx` 下载。
- **明确取舍**：不保留原文复杂排版（页眉页脚 / 样式 / 表格 / 图片），输出规整的标题 + 段落文本稿，供投标人员再套模板。保版式留作二期。

## 10. 错误处理与边界

- 加密 / 损坏 / 扫描版 PDF（取不到文字层）→ 明确提示“此 PDF 无文字层，需先转为可复制文字或另存”，不静默失败。
- 未指定母本不可计算；无对比文件时禁用计算按钮。
- 超大文件给体积上限提示；解析在 Web Worker 中执行避免卡 UI。
- AI 接口失败可重试；错误信息面向用户友好，不泄露内部细节。

## 11. 测试策略（目标覆盖率 80%+）

- 单元：`useSegmenter`、`useDedupEngine` 纯函数测试——已知文本对 → 期望重复率 / 命中，覆盖中文分句、近似命中、阈值边界、精确命中。
- 集成：`useDocParser` 用小样本 docx/pdf 固件测抽取；`useDocxExport` 测生成产物。
- 组件：交互测试（采纳 / 跳过、视图切换、母本标记）。

## 12. 非目标（YAGNI / 后续迭代）

- 扫描版 PDF 的 OCR。
- 语义级（embedding）相似度检测。
- 保留原文复杂排版的 docx 导出。
- `.doc` / `.wps` 原生解析（要求用户先另存为 docx）。
- 查重历史记录 / 服务端留存（当前一律本地、不落库）。
