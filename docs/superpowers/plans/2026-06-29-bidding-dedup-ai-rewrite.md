# 投标查重 AI 一键去重（Plan B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 给已完成的前端查重工具（Plan A）加「AI 一键去重」：把被标红的重复段落（仅文本）发后端，经现有 task_queue → AI Slot → Runner Nodes 异步改写降重，前端轮询取回、人工逐段采纳，采纳结果并入导出 docx。

**Architecture:** 复用现有任务链路：`POST /api/v1/bidding/dedup-rewrite` 用 `createTask` 入队（`task_type='bidding_dedup_rewrite'`, `biz_type='bidding_dedup'`, `biz_id=0`），Runner 轮询认领并执行（`MOCK_AI_ONLY` 走 local provider 的 mock；生产走 claude/openai，prompt 由 Runner 内置默认改写 prompt 提供），结果写回 `task_queue.result_json`。前端轮询 `GET /api/v1/bidding/dedup-rewrite/:taskId`，**取回完成结果后后端立即清空该任务的 payload/result 片段文本**（保留任务元数据供审计）。母本始终不动；仅改写对比文件中含重复内容的段落。

**Tech Stack:** packages/api（Hono/D1/vitest）+ task-runner（Python/pytest）+ packages/web（Vue3/Element Plus/vitest）。

**Spec:** `docs/superpowers/specs/2026-06-28-bidding-dedup-design.md` §8。**Plan A（前端核心）已完成**，本计划在其分支 `feat/bidding-dedup` 上续作。

## 共享契约（所有任务以此为准）

- 前端→API POST body：`{ "paragraphs": [{ "id": string, "text": string }] }`（id 形如 `${docId}#${paraIdx}`）。
- 任务 payload：同上 `{ paragraphs }`。
- 任务结果 `output`（字符串化 JSON）：`{ "rewrites": [{ "id": string, "text": string }] }`。
- API GET 响应：`{ status: "pending"|"running"|"completed"|"failed"|"timeout", rewrites?: [{id,text}], error?: string }`。
- 约束：`paragraphs` 非空、≤200 段、每段 `text` ≤5000 字符。

## 约定
- 所有 `pnpm` 命令在 `packages/web`；api 测试 `cd packages/api && npx vitest run <file>`；runner 测试 `cd task-runner && python -m pytest tests/<file> -q`（若无 pytest：`pip install pytest`）。
- 提交：每任务一提交，conventional commits，无 `--no-verify`，无 Co-Authored-By。禁止 `any`/`@ts-ignore`（api/web）。
- biz_id=0 表示无领域记录（stateless）。

---

## File Structure

```
packages/api/src/
  types/ai.ts                                  修改：taskTypes 增 "bidding_dedup_rewrite"
  routes/bidding-dedup.ts                      新增：POST 创建 + GET 轮询(取回即清除)
  routes/bidding-dedup.test.ts                 新增：纯函数(校验/结果解析)单测
  index.ts                                     修改：注册 /api/v1/bidding
task-runner/runner/
  config.py                                    修改：默认 capabilities 增 "bidding_dedup_rewrite"
  rewrite_prompt.py                            新增：build_rewrite_prompt(payload) 纯函数
  executor.py                                  修改：无 prompt 时为该 task_type 注入默认 prompt
  providers/local_rules.py                     修改：supports + _bidding_dedup_rewrite mock
  providers/claude.py                          修改：supports 增该 task_type
  providers/openai_provider.py                 修改：supports 增该 task_type
task-runner/tests/
  test_rewrite_prompt.py                       新增
  test_local_rules_dedup.py                    新增
packages/web/src/views/bidding/dedup/
  lib/rewrite.ts                               新增：collectDuplicateParagraphs / applyRewrites
  lib/__tests__/rewrite.test.ts                新增
  api/bidding-dedup.ts                         新增：requestRewrite / pollRewrite（注：放 views 下就近）
  composables/useDedupAI.ts                    新增：请求+轮询+采纳状态
  composables/__tests__/useDedupAI.test.ts     新增
  components/RewritePanel.vue                   新增
  index.vue                                    修改：AI 去重按钮 + 面板 + 导出合并
```

---

## Task 1: 扩展 task_type 与节点能力

**Files:**
- Modify: `packages/api/src/types/ai.ts`
- Modify: `task-runner/runner/config.py`

- [ ] **Step 1: api — 在 `taskTypes` 数组末尾加一项**

在 `packages/api/src/types/ai.ts` 的 `taskTypes` 常量数组（以 `] as const;` 结尾）最后一个元素后加：
```ts
  "bidding_dedup_rewrite"
```
（确保上一行补逗号；`TaskType` 自动包含它。）

- [ ] **Step 2: runner — 默认能力增项**

在 `task-runner/runner/config.py` 的 `capabilities` 默认 `default_factory` 列表末尾加：
```python
            "bidding_dedup_rewrite",
```

- [ ] **Step 3: 校验**

Run: `cd packages/api && npm run typecheck`
Expected: 通过。
Run: `python -c "import ast; ast.parse(open('task-runner/runner/config.py').read()); print('ok')"`
Expected: `ok`。

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/types/ai.ts task-runner/runner/config.py
git commit -m "feat(dedup-ai): register bidding_dedup_rewrite task type and node capability"
```

---

## Task 2: Runner — build_rewrite_prompt 纯函数

**Files:**
- Create: `task-runner/runner/rewrite_prompt.py`
- Test: `task-runner/tests/test_rewrite_prompt.py`

- [ ] **Step 1: 写失败测试**

Create `task-runner/tests/test_rewrite_prompt.py`:
```python
import json
from runner.rewrite_prompt import build_rewrite_prompt


def test_build_rewrite_prompt_embeds_paragraphs_and_demands_json():
    payload = {"paragraphs": [{"id": "d#0", "text": "项目部建立质量管理体系。"}]}
    prompt = build_rewrite_prompt(payload)
    assert set(prompt.keys()) == {"system", "user"}
    assert "项目部建立质量管理体系。" in prompt["user"]
    assert "d#0" in prompt["user"]
    assert "rewrites" in prompt["user"]  # 要求严格 JSON 输出
    assert "降低" in prompt["system"] or "相似" in prompt["system"]


def test_build_rewrite_prompt_handles_empty():
    prompt = build_rewrite_prompt({"paragraphs": []})
    assert "rewrites" in prompt["user"]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd task-runner && python -m pytest tests/test_rewrite_prompt.py -q`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

Create `task-runner/runner/rewrite_prompt.py`:
```python
from __future__ import annotations

import json


def build_rewrite_prompt(payload: dict[str, object]) -> dict[str, str]:
    """Build a system+user prompt that rewrites paragraphs to reduce literal
    duplication while preserving meaning. Output must be strict JSON."""
    paragraphs = payload.get("paragraphs")
    if not isinstance(paragraphs, list):
        paragraphs = []
    paragraphs_json = json.dumps(paragraphs, ensure_ascii=False, indent=2)
    system = (
        "你是投标文件润色专家。任务：在完整保留原意与专业表述的前提下，"
        "改写下列段落，使其与原文在字面上尽量不同（降低重复/雷同），"
        "可调整句式、措辞与顺序，但不得改变技术含义、数据与承诺。"
        "只输出严格 JSON，不要任何额外说明或 markdown。"
    )
    user = (
        "请改写以下段落（保持每段的 id 不变），并仅返回 JSON 对象，"
        '格式：{"rewrites":[{"id":"<原id>","text":"<改写后正文>"}]}。\n'
        f"待改写段落：\n{paragraphs_json}"
    )
    return {"system": system, "user": user}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd task-runner && python -m pytest tests/test_rewrite_prompt.py -q`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add task-runner/runner/rewrite_prompt.py task-runner/tests/test_rewrite_prompt.py
git commit -m "feat(dedup-ai): add build_rewrite_prompt for runner"
```

---

## Task 3: Runner — local provider mock + supports

**Files:**
- Modify: `task-runner/runner/providers/local_rules.py`
- Test: `task-runner/tests/test_local_rules_dedup.py`

- [ ] **Step 1: 写失败测试**

Create `task-runner/tests/test_local_rules_dedup.py`:
```python
import json
from runner.providers.local_rules import LocalRulesProvider


def test_supports_bidding_dedup_rewrite():
    assert LocalRulesProvider().supports("bidding_dedup_rewrite") is True


def test_mock_rewrites_each_paragraph_preserving_ids_and_changing_text():
    provider = LocalRulesProvider()
    payload = {
        "paragraphs": [
            {"id": "d#0", "text": "项目部建立以项目经理为核心的质量管理体系。"},
            {"id": "d#1", "text": "落实三检制度。"},
        ]
    }
    result = provider.execute("bidding_dedup_rewrite", payload)
    parsed = json.loads(result.output)
    assert [r["id"] for r in parsed["rewrites"]] == ["d#0", "d#1"]
    # mock 必须产出非空且与原文不同的文本
    for original, rewritten in zip(payload["paragraphs"], parsed["rewrites"]):
        assert rewritten["text"]
        assert rewritten["text"] != original["text"]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd task-runner && python -m pytest tests/test_local_rules_dedup.py -q`
Expected: FAIL。

- [ ] **Step 3: 实现**

In `task-runner/runner/providers/local_rules.py`:
1. Add `"bidding_dedup_rewrite"` to the list returned by `supports()`.
2. In `execute()`, add a branch before the final `else`:
```python
        elif task_type == "bidding_dedup_rewrite":
            output = self._bidding_dedup_rewrite(payload)
```
3. Add the method:
```python
    def _bidding_dedup_rewrite(self, payload: dict[str, object]) -> str:
        paragraphs_raw = payload.get("paragraphs", [])
        paragraphs = paragraphs_raw if isinstance(paragraphs_raw, list) else []
        rewrites: list[dict[str, str]] = []
        for item in paragraphs:
            if not isinstance(item, dict):
                continue
            pid = str(item.get("id", ""))
            text = str(item.get("text", ""))
            # 本地 mock：确定性改写（非真实 AI），保证与原文不同。
            rewritten = f"【已降重】{text}" if text else text
            rewrites.append({"id": pid, "text": rewritten})
        return json.dumps({"rewrites": rewrites}, ensure_ascii=False)
```

- [ ] **Step 4: 运行确认通过**

Run: `cd task-runner && python -m pytest tests/test_local_rules_dedup.py -q`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add task-runner/runner/providers/local_rules.py task-runner/tests/test_local_rules_dedup.py
git commit -m "feat(dedup-ai): local mock provider for bidding_dedup_rewrite"
```

---

## Task 4: Runner — real providers supports + executor prompt wiring

**Files:**
- Modify: `task-runner/runner/providers/claude.py`
- Modify: `task-runner/runner/providers/openai_provider.py`
- Modify: `task-runner/runner/executor.py`

- [ ] **Step 1: claude + openai supports**

In both `providers/claude.py` and `providers/openai_provider.py`, add `"bidding_dedup_rewrite"` to the list returned by `supports()`. (Open each file, find the `supports` method's list, append the string.)

- [ ] **Step 2: executor 注入默认 prompt**

In `task-runner/runner/executor.py`:
1. Add import near the top: `from .rewrite_prompt import build_rewrite_prompt`.
2. In `execute()`, after the existing block:
```python
        if prompt is None:
            prompt = self._default_prompt_for_task(task_type)
```
   add:
```python
        if prompt is None and task_type == "bidding_dedup_rewrite":
            prompt = build_rewrite_prompt(payload)
```
   (So real providers get a proper rewrite prompt with the paragraphs embedded; local provider ignores `prompt` and uses its mock.)

- [ ] **Step 3: 校验**

Run: `cd task-runner && python -m pytest tests/ -q`
Expected: all pass (existing + new).
Run: `python -c "import ast,glob;[ast.parse(open(f).read()) for f in ['task-runner/runner/executor.py','task-runner/runner/providers/claude.py','task-runner/runner/providers/openai_provider.py']];print('ok')"`
Expected: `ok`。

- [ ] **Step 4: Commit**

```bash
git add task-runner/runner/providers/claude.py task-runner/runner/providers/openai_provider.py task-runner/runner/executor.py
git commit -m "feat(dedup-ai): real providers support + executor default rewrite prompt"
```

---

## Task 5: API — bidding-dedup 路由（创建 + 轮询取回即清除）

**Files:**
- Create: `packages/api/src/routes/bidding-dedup.ts`
- Test: `packages/api/src/routes/bidding-dedup.test.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: 写失败测试（纯函数）**

Create `packages/api/src/routes/bidding-dedup.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  parseRewriteRequest,
  parseRewriteResult,
  type RewriteParagraph
} from "./bidding-dedup";

describe("parseRewriteRequest", () => {
  it("accepts a valid paragraphs array", () => {
    const out = parseRewriteRequest({ paragraphs: [{ id: "d#0", text: "甲。" }] });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.paragraphs).toHaveLength(1);
  });

  it("rejects empty / malformed / oversized input", () => {
    expect(parseRewriteRequest({ paragraphs: [] }).ok).toBe(false);
    expect(parseRewriteRequest({ paragraphs: [{ id: "", text: "x" }] }).ok).toBe(false);
    expect(parseRewriteRequest({}).ok).toBe(false);
    const tooMany: RewriteParagraph[] = Array.from({ length: 201 }, (_, i) => ({
      id: `d#${i}`,
      text: "x"
    }));
    expect(parseRewriteRequest({ paragraphs: tooMany }).ok).toBe(false);
    expect(
      parseRewriteRequest({ paragraphs: [{ id: "d#0", text: "x".repeat(5001) }] }).ok
    ).toBe(false);
  });
});

describe("parseRewriteResult", () => {
  it("maps a completed task with parseable rewrites", () => {
    const res = parseRewriteResult({
      status: "completed",
      result_json: JSON.stringify({ output: JSON.stringify({ rewrites: [{ id: "d#0", text: "改写。" }] }) })
    });
    expect(res.status).toBe("completed");
    expect(res.rewrites).toEqual([{ id: "d#0", text: "改写。" }]);
  });

  it("returns pending/running as-is", () => {
    expect(parseRewriteResult({ status: "pending", result_json: null }).status).toBe("pending");
  });

  it("maps failed with error", () => {
    const res = parseRewriteResult({ status: "failed", result_json: null, error_message: "boom" });
    expect(res.status).toBe("failed");
    expect(res.error).toBe("boom");
  });

  it("completed but already-redacted result yields empty rewrites", () => {
    const res = parseRewriteResult({ status: "completed", result_json: "" });
    expect(res.status).toBe("completed");
    expect(res.rewrites).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npx vitest run src/routes/bidding-dedup.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现路由 + 纯函数**

Create `packages/api/src/routes/bidding-dedup.ts`:
```ts
import { Hono } from "hono";
import { authMiddleware, type AuthVariables } from "../middleware/auth";
import { requireRoles } from "../middleware/rbac";
import type { Env } from "../types/env";
import { enqueueTask } from "../services/task-queue";

export interface RewriteParagraph {
  id: string;
  text: string;
}

const MAX_PARAGRAPHS = 200;
const MAX_TEXT = 5000;
const ROLES = ["super_admin", "manager", "site_manager", "operator"];

type ParseOk = { ok: true; paragraphs: RewriteParagraph[] };
type ParseErr = { ok: false; error: string };

export function parseRewriteRequest(body: unknown): ParseOk | ParseErr {
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const raw = obj.paragraphs;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "paragraphs 不能为空" };
  }
  if (raw.length > MAX_PARAGRAPHS) {
    return { ok: false, error: `段落数量超过上限 ${MAX_PARAGRAPHS}` };
  }
  const paragraphs: RewriteParagraph[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, error: "段落格式错误" };
    const id = (item as Record<string, unknown>).id;
    const text = (item as Record<string, unknown>).text;
    if (typeof id !== "string" || id.length === 0) return { ok: false, error: "段落缺少 id" };
    if (typeof text !== "string" || text.length === 0) return { ok: false, error: "段落缺少 text" };
    if (text.length > MAX_TEXT) return { ok: false, error: `单段文本超过 ${MAX_TEXT} 字符` };
    paragraphs.push({ id, text });
  }
  return { ok: true, paragraphs };
}

export interface RewriteResultResponse {
  status: string;
  rewrites?: RewriteParagraph[];
  error?: string;
}

export function parseRewriteResult(task: {
  status: string;
  result_json: string | null;
  error_message?: string | null;
}): RewriteResultResponse {
  if (task.status === "failed" || task.status === "timeout") {
    return { status: task.status, error: task.error_message ?? "任务失败" };
  }
  if (task.status !== "completed") {
    return { status: task.status };
  }
  if (!task.result_json) {
    return { status: "completed", rewrites: [] };
  }
  try {
    const outer = JSON.parse(task.result_json) as { output?: string };
    if (!outer.output) return { status: "completed", rewrites: [] };
    const inner = JSON.parse(outer.output) as { rewrites?: unknown };
    const list = Array.isArray(inner.rewrites) ? inner.rewrites : [];
    const rewrites: RewriteParagraph[] = list
      .filter((r): r is RewriteParagraph =>
        !!r && typeof r === "object" &&
        typeof (r as RewriteParagraph).id === "string" &&
        typeof (r as RewriteParagraph).text === "string"
      )
      .map((r) => ({ id: r.id, text: r.text }));
    return { status: "completed", rewrites };
  } catch {
    return { status: "completed", rewrites: [] };
  }
}

export const biddingDedupRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

biddingDedupRoutes.post("/dedup-rewrite", authMiddleware, requireRoles(ROLES), async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = parseRewriteRequest(body);
  if (!parsed.ok) {
    return c.json({ success: false, error: { message: parsed.error } }, 400);
  }
  const task = await enqueueTask(c.env, {
    task_type: "bidding_dedup_rewrite",
    biz_type: "bidding_dedup",
    biz_id: 0,
    payload: { paragraphs: parsed.paragraphs },
    priority: 6
  });
  return c.json({ success: true, data: { task_id: task.id } });
});

biddingDedupRoutes.get("/dedup-rewrite/:taskId", authMiddleware, requireRoles(ROLES), async (c) => {
  const taskId = Number(c.req.param("taskId"));
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return c.json({ success: false, error: { message: "无效任务 id" } }, 400);
  }
  const task = await c.env.DB.prepare(
    "SELECT id, biz_type, status, result_json, error_message FROM task_queue WHERE id = ?"
  )
    .bind(taskId)
    .first<{
      id: number;
      biz_type: string;
      status: string;
      result_json: string | null;
      error_message: string | null;
    }>();
  if (!task || task.biz_type !== "bidding_dedup") {
    return c.json({ success: false, error: { message: "任务不存在" } }, 404);
  }
  const response = parseRewriteResult(task);
  // 终态：取回后立即清除片段/改写文本（保留任务元数据供审计）。
  if (task.status === "completed" || task.status === "failed" || task.status === "timeout") {
    await c.env.DB.prepare(
      "UPDATE task_queue SET payload_json = '', result_json = '' WHERE id = ?"
    )
      .bind(taskId)
      .run();
  }
  return c.json({ success: true, data: response });
});
```

Then register in `packages/api/src/index.ts`: add the import alongside the other route imports, and add (near the other `app.route` lines, e.g. after the `/api/v1/task` line):
```ts
app.route("/api/v1/bidding", biddingDedupRoutes);
```
(Import: `import { biddingDedupRoutes } from "./routes/bidding-dedup";`.)

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npx vitest run src/routes/bidding-dedup.test.ts`
Expected: PASS。
Run: `cd packages/api && npm run typecheck`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/bidding-dedup.ts packages/api/src/routes/bidding-dedup.test.ts packages/api/src/index.ts
git commit -m "feat(dedup-ai): add bidding dedup-rewrite API (create + poll with purge)"
```

---

## Task 6: Web — 纯函数 collectDuplicateParagraphs / applyRewrites

**Files:**
- Create: `packages/web/src/views/bidding/dedup/lib/rewrite.ts`
- Test: `packages/web/src/views/bidding/dedup/lib/__tests__/rewrite.test.ts`

- [ ] **Step 1: 写失败测试**

Create `lib/__tests__/rewrite.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildParsedDoc } from "../build-doc";
import { compareToMaster } from "../engine";
import { collectDuplicateParagraphs, applyRewrites } from "../rewrite";

const master = buildParsedDoc({
  id: "m", name: "母本", role: "master",
  paragraphTexts: ["质量管理体系健全。"]
});
const compare = buildParsedDoc({
  id: "c", name: "对比1", role: "compare",
  paragraphTexts: ["质量管理体系健全。独有内容甲。", "完全无关的段落乙。"]
});

describe("collectDuplicateParagraphs", () => {
  it("returns only paragraphs containing a flagged duplicate sentence, id=`${docId}#${paraIdx}`", () => {
    const result = compareToMaster(master, compare, 0.8);
    const paras = collectDuplicateParagraphs(compare, result);
    expect(paras).toHaveLength(1);
    expect(paras[0].id).toBe("c#0");
    expect(paras[0].text).toContain("质量管理体系健全");
  });
});

describe("applyRewrites", () => {
  it("replaces flagged paragraph text with accepted rewrites, leaving others intact", () => {
    const accepted = new Map<string, string>([["c#0", "由项目经理牵头组建质量管控小组。"]]);
    const texts = applyRewrites(compare, accepted);
    expect(texts[0]).toBe("由项目经理牵头组建质量管控小组。");
    expect(texts[1]).toBe("完全无关的段落乙。");
  });

  it("keeps original text when no rewrite accepted for a paragraph", () => {
    const texts = applyRewrites(compare, new Map());
    expect(texts).toEqual(["质量管理体系健全。独有内容甲。", "完全无关的段落乙。"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test rewrite.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `lib/rewrite.ts`:
```ts
import type { ParsedDoc, DedupResult } from "./types";

export interface RewriteParagraph {
  id: string;
  text: string;
}

// 段 id 形如 `${docId}#${paraIdx}`；句 id 形如 `${docId}#${paraIdx}#${sentIdx}`。
function paragraphIdOf(docId: string, paraIdx: number): string {
  return `${docId}#${paraIdx}`;
}

export function collectDuplicateParagraphs(
  compare: ParsedDoc,
  result: DedupResult
): RewriteParagraph[] {
  const dupSentenceIds = new Set(result.matches.map((m) => m.compareSentenceId));
  return compare.paragraphs
    .filter((p) => p.sentences.some((s) => dupSentenceIds.has(s.id)))
    .map((p) => ({ id: paragraphIdOf(compare.id, p.idx), text: p.text }));
}

export function applyRewrites(
  compare: ParsedDoc,
  accepted: ReadonlyMap<string, string>
): string[] {
  return compare.paragraphs.map((p) => {
    const rewritten = accepted.get(paragraphIdOf(compare.id, p.idx));
    return rewritten ?? p.text;
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test rewrite.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/lib/rewrite.ts packages/web/src/views/bidding/dedup/lib/__tests__/rewrite.test.ts
git commit -m "feat(dedup-ai): web rewrite helpers (collect/apply)"
```

---

## Task 7: Web — API 封装

**Files:**
- Create: `packages/web/src/views/bidding/dedup/api/bidding-dedup.ts`

> 复用项目现有 HTTP 客户端。先 Read `packages/web/src/api/` 下任意一个文件（如 `user.ts`）确认导入的 http 工具与写法（如 `http.request`/`http.post`），并照其约定实现下面两个函数。

- [ ] **Step 1: 实现**

Create `api/bidding-dedup.ts`（占位签名，import 路径与调用方式以现有 api/* 为准）:
```ts
import type { RewriteParagraph } from "../lib/rewrite";

export interface RewriteResultResponse {
  status: "pending" | "assigned" | "running" | "completed" | "failed" | "timeout";
  rewrites?: RewriteParagraph[];
  error?: string;
}

// 用项目现有 http 客户端实现：
// POST /bidding/dedup-rewrite  body { paragraphs } -> { task_id }
export async function requestRewrite(paragraphs: RewriteParagraph[]): Promise<number> {
  // return (await http.post<...>("/bidding/dedup-rewrite", { data: { paragraphs } })).data.task_id;
  throw new Error("implement with project http client");
}

// GET /bidding/dedup-rewrite/:taskId -> RewriteResultResponse
export async function pollRewrite(taskId: number): Promise<RewriteResultResponse> {
  throw new Error("implement with project http client");
}
```

- [ ] **Step 2: 替换为真实实现**

Read an existing `packages/web/src/api/*.ts` for the exact http import/usage, then implement both functions accordingly (base path `/api` is handled by the client/proxy; use `/bidding/dedup-rewrite`). Remove the `throw` placeholders.

- [ ] **Step 3: 校验**

Run: `pnpm typecheck`
Expected: 通过（无 placeholder 残留、无 `any`）。

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/views/bidding/dedup/api/bidding-dedup.ts
git commit -m "feat(dedup-ai): web api wrapper for dedup-rewrite"
```

---

## Task 8: Web — useDedupAI 组合式（请求 + 轮询 + 采纳）

**Files:**
- Create: `packages/web/src/views/bidding/dedup/composables/useDedupAI.ts`
- Test: `packages/web/src/views/bidding/dedup/composables/__tests__/useDedupAI.test.ts`

> 设计为可测：轮询用注入的 `poll`/`request`/`sleep`，默认绑定到 api 封装；测试用 mock 注入，避免真实计时器/网络。

- [ ] **Step 1: 写失败测试**

Create `composables/__tests__/useDedupAI.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { useDedupAI } from "../useDedupAI";
import type { RewriteParagraph } from "../../lib/rewrite";

const paras: RewriteParagraph[] = [{ id: "c#0", text: "原文甲。" }];

describe("useDedupAI", () => {
  it("requests, polls until completed, and exposes rewrites + accept state", async () => {
    const request = vi.fn(async () => 42);
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ status: "running" })
      .mockResolvedValueOnce({
        status: "completed",
        rewrites: [{ id: "c#0", text: "改写甲。" }]
      });
    const ai = useDedupAI({ request, poll, sleep: async () => {} });

    await ai.start(paras);

    expect(request).toHaveBeenCalledWith(paras);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(ai.status.value).toBe("completed");
    expect(ai.rewrites.value.get("c#0")).toBe("改写甲。");

    ai.accept("c#0");
    expect(ai.accepted.value.get("c#0")).toBe("改写甲。");
    ai.skip("c#0");
    expect(ai.accepted.value.has("c#0")).toBe(false);
    ai.acceptAll();
    expect(ai.accepted.value.get("c#0")).toBe("改写甲。");
  });

  it("surfaces failed status", async () => {
    const request = vi.fn(async () => 7);
    const poll = vi.fn().mockResolvedValue({ status: "failed", error: "boom" });
    const ai = useDedupAI({ request, poll, sleep: async () => {} });
    await ai.start(paras);
    expect(ai.status.value).toBe("failed");
    expect(ai.error.value).toBe("boom");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test useDedupAI.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `composables/useDedupAI.ts`:
```ts
import { ref, shallowRef } from "vue";
import type { RewriteParagraph } from "../lib/rewrite";
import {
  requestRewrite as defaultRequest,
  pollRewrite as defaultPoll,
  type RewriteResultResponse
} from "../api/bidding-dedup";

interface Deps {
  request?: (paragraphs: RewriteParagraph[]) => Promise<number>;
  poll?: (taskId: number) => Promise<RewriteResultResponse>;
  sleep?: (ms: number) => Promise<void>;
  intervalMs?: number;
  maxPolls?: number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useDedupAI(deps: Deps = {}) {
  const request = deps.request ?? defaultRequest;
  const poll = deps.poll ?? defaultPoll;
  const sleep = deps.sleep ?? realSleep;
  const intervalMs = deps.intervalMs ?? 2000;
  const maxPolls = deps.maxPolls ?? 150;

  const status = ref<RewriteResultResponse["status"] | "idle">("idle");
  const error = ref<string>("");
  const rewrites = shallowRef<Map<string, string>>(new Map());
  const accepted = shallowRef<Map<string, string>>(new Map());

  async function start(paragraphs: RewriteParagraph[]): Promise<void> {
    status.value = "pending";
    error.value = "";
    rewrites.value = new Map();
    accepted.value = new Map();
    const taskId = await request(paragraphs);
    for (let i = 0; i < maxPolls; i++) {
      const res = await poll(taskId);
      status.value = res.status;
      if (res.status === "completed") {
        rewrites.value = new Map((res.rewrites ?? []).map((r) => [r.id, r.text]));
        return;
      }
      if (res.status === "failed" || res.status === "timeout") {
        error.value = res.error ?? "AI 去重失败";
        return;
      }
      await sleep(intervalMs);
    }
    status.value = "timeout";
    error.value = "AI 去重超时，请重试";
  }

  function accept(id: string): void {
    const text = rewrites.value.get(id);
    if (text === undefined) return;
    accepted.value = new Map(accepted.value).set(id, text);
  }
  function skip(id: string): void {
    const next = new Map(accepted.value);
    next.delete(id);
    accepted.value = next;
  }
  function acceptAll(): void {
    accepted.value = new Map(rewrites.value);
  }

  return { status, error, rewrites, accepted, start, accept, skip, acceptAll };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm test useDedupAI.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/composables/useDedupAI.ts packages/web/src/views/bidding/dedup/composables/__tests__/useDedupAI.test.ts
git commit -m "feat(dedup-ai): useDedupAI composable (request/poll/accept)"
```

---

## Task 9: Web — RewritePanel.vue + 集成到 index.vue

**Files:**
- Create: `packages/web/src/views/bidding/dedup/components/RewritePanel.vue`
- Modify: `packages/web/src/views/bidding/dedup/index.vue`

- [ ] **Step 1: RewritePanel.vue**

```vue
<script setup lang="ts">
import type { RewriteParagraph } from "../lib/rewrite";

const props = defineProps<{
  status: string;
  error: string;
  originals: RewriteParagraph[];
  rewrites: ReadonlyMap<string, string>;
  accepted: ReadonlyMap<string, string>;
}>();
const emit = defineEmits<{
  (e: "accept", id: string): void;
  (e: "skip", id: string): void;
  (e: "accept-all"): void;
}>();
</script>

<template>
  <div class="rewrite-panel">
    <div v-if="props.status === 'pending' || props.status === 'running'" class="hint">
      AI 改写中…
    </div>
    <div v-else-if="props.status === 'failed' || props.status === 'timeout'" class="hint err">
      {{ props.error }}
    </div>
    <template v-else-if="props.status === 'completed'">
      <el-button size="small" type="primary" @click="emit('accept-all')">全部采纳</el-button>
      <div v-for="o in props.originals" :key="o.id" class="row">
        <div class="orig">原文：{{ o.text }}</div>
        <div class="new">改写：{{ props.rewrites.get(o.id) ?? "（无建议）" }}</div>
        <div class="ops">
          <el-tag v-if="props.accepted.has(o.id)" type="success">已采纳</el-tag>
          <template v-else>
            <el-button size="small" :disabled="!props.rewrites.has(o.id)" @click="emit('accept', o.id)">采纳</el-button>
            <el-button size="small" @click="emit('skip', o.id)">跳过</el-button>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.row { border-top: 0.5px solid var(--el-border-color); padding: 8px 0; }
.new { color: var(--el-color-success); }
.hint { color: var(--el-text-color-secondary); }
.hint.err { color: var(--el-color-danger); }
</style>
```

- [ ] **Step 2: 集成到 index.vue**

In `index.vue` `<script setup>`:
1. Imports:
```ts
import RewritePanel from "./components/RewritePanel.vue";
import { useDedupAI } from "./composables/useDedupAI";
import { collectDuplicateParagraphs, applyRewrites } from "./lib/rewrite";
```
2. After the existing setup:
```ts
const ai = useDedupAI();
const dupParagraphs = computed(() =>
  selectedCompareDoc.value && selectedResult.value
    ? collectDuplicateParagraphs(selectedCompareDoc.value, selectedResult.value)
    : []
);
const canRewrite = computed(() => dupParagraphs.value.length > 0);

async function onRewrite() {
  try {
    await ai.start(dupParagraphs.value);
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : "AI 去重失败");
  }
}
```
3. Change `onExport` to merge accepted rewrites:
```ts
async function onExport() {
  const doc = selectedCompareDoc.value;
  if (!doc) return;
  const paras = applyRewrites(doc, ai.accepted.value);
  await downloadDocx(paras, `去重_${doc.name}`);
}
```

In the TEMPLATE: add an AI button next to 导出 (only meaningful in the star view with a selected compare doc):
```html
<el-button :disabled="!canRewrite" @click="onRewrite">AI 一键去重</el-button>
```
And render the panel inside the star-view block (after `PairCompareView`):
```html
<RewritePanel
  :status="ai.status.value"
  :error="ai.error.value"
  :originals="dupParagraphs"
  :rewrites="ai.rewrites.value"
  :accepted="ai.accepted.value"
  @accept="ai.accept"
  @skip="ai.skip"
  @accept-all="ai.acceptAll"
/>
```

- [ ] **Step 3: 校验**

Run: `pnpm test`
Expected: 全绿（含此前所有 web 测试 + 本计划新增）。
Run: `pnpm typecheck`
Expected: exit 0（tsc + vue-tsc）。若 .vue 绑定有类型问题，修复后再过；不得用 `any`/`@ts-ignore`。

- [ ] **Step 4: 手动验证（浏览器，交由协调者/用户）**

`pnpm dev` 后：选中一个有重复的对比文件 → 点「AI 一键去重」→ 面板出现改写建议 → 采纳/全部采纳 → 导出 docx，确认被采纳段落已替换、母本与未采纳段落不变。（本地 `MOCK_AI_ONLY` 下改写为「【已降重】…」mock。）

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/views/bidding/dedup/components/RewritePanel.vue packages/web/src/views/bidding/dedup/index.vue
git commit -m "feat(dedup-ai): RewritePanel + AI rewrite wired into dedup page"
```

---

## Task 10: 收尾 — 全量校验 + 开发记录

- [ ] **Step 1: 三端测试**

```bash
cd packages/web && pnpm test
cd packages/api && npx vitest run
cd task-runner && python -m pytest tests/ -q
```
Expected: 全部通过。

- [ ] **Step 2: 类型检查**

```bash
cd packages/web && pnpm typecheck
cd packages/api && npm run typecheck
```
Expected: 均通过。

- [ ] **Step 3: 追加开发记录**

在 `doc/开发记录.md` 末尾追加一段：投标查重 AI 一键去重（Plan B）完成内容、跨包改动清单、隐私处理（取回即清除）、已知点（节点需带 `bidding_dedup_rewrite` 能力；浏览器端真机验证；生产 prompt 可后续在 DB 模板中细化）。

- [ ] **Step 4: Commit**

```bash
git add doc/开发记录.md
git commit -m "docs: 记录投标查重 AI 去重(Plan B)"
```

---

## Self-Review 记录

- **Spec §8 覆盖**：母本不动、仅发重复段落文本→Task5/6/9；走 Runner Nodes（task_queue→AI Slot→runner）→Task1-5；导出前人工闸门（采纳/跳过/全部采纳）→Task8/9；MOCK_AI_ONLY 走 local mock→Task3。
- **隐私**：取回即清除（payload/result 置空，留任务元数据）→Task5。
- **类型/契约一致**：`RewriteParagraph{id,text}`、结果 `{rewrites:[{id,text}]}`、段 id `${docId}#${paraIdx}`、句 id `${docId}#${paraIdx}#${sentIdx}` 全程一致；`task_type='bidding_dedup_rewrite'` 在 api `taskTypes`、三个 provider 的 `supports`、config 默认能力、executor prompt 注入处一致。
- **占位**：Task7 api 封装因需对齐项目 http 客户端，给了占位+“先 Read 再实现”指令（执行时必须替换 `throw`）。
- **测试可行性**：纯函数/ mock 注入为主（parseRewriteRequest/parseRewriteResult、collect/applyRewrites、build_rewrite_prompt、local mock、useDedupAI 注入式轮询）；route/.vue 经 typecheck + 手动验证。
```
