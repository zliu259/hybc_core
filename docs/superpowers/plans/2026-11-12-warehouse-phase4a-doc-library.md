# 库房重做 阶段 4A：设备资料库（系统内）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设备资料上传一次，在 Web 和小程序上都能按设备、按类别找到并打开；可以替换、删除、填证书有效期、生成对外链接；现有约 150 个文件能在 Web 上按文件夹导入。

**Architecture:** 新表 `doc_file`、`doc_share`（迁移 0097）。文件放在 R2 的 `doc-library/` 前缀下，一律走 R2 分片上传（初始化、逐片、完成，Worker 中转，每片 8 MiB）；分片请求用服务端签发的上传令牌鉴权，不建上传会话表。读取一律先经鉴权接口换 15 分钟的签名地址，对象读取接口补上 Range。动手之前先修签名：上传签名和下载签名分开，下载签名不能再拿去覆盖文件。Web 新增「设备资料库」页，设备详情和任务抽屉带出适用资料；小程序新增三个页面（路径设计稿已定）。

**Tech Stack:** Hono + D1 + R2（`packages/api`）、Vue 3 + Element Plus + `pdfjs-dist`（`packages/web`）、原生企微小程序（`packages/miniapp`）、Vitest、`node:sqlite` 测试夹具、小程序 node assert 测试。

**Spec:** `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`（6.1 的「资料」、8.1 到 8.3、9、11 的「资料」、12 第 8 条、13、18、20）

**前置：** 阶段 1 到 3 已上线（迁移 0095、0096，PR #24、#25、#28）。沿用它们的约定：`guarded`、`handleWarehouseError`、`WarehouseError`、`queryIn`、`runAtomicBatch`、`requireHuman`、`getWarehouseCapabilities`（已有 `is_doc_admin`）、小程序的 `createPageHarness`、`wh-wxml.test.js`。

**为什么是 4A：** 设计稿的阶段 4 还包括微盘镜像（8.4）。镜像依赖阶段 0 的微盘探测结论（应用空间的行为、每月调用上限、分块上传的累计 SHA1），探测代码已上线但还没在生产上跑：要 owner 先在企微管理后台把应用加进「协作 → 微盘 → API」。在那之前写镜像的计划是猜。设计稿也要求镜像出问题不影响系统内看资料，所以资料库本体不依赖它。**微盘镜像单独一份计划（4B），探测跑完再写**；4A 上线后「三处都能看」里先有 Web 和小程序两处。

## Global Constraints

- 迁移 `0097_warehouse_doc_library.sql` 只建 `doc_file`、`doc_share` 和索引。**不建**镜像字段和 `wedrive_folder`（留给 4B 用 `ALTER TABLE ... ADD COLUMN`）。迁移先于合并执行，需要 owner 同意。
- 文件键：`doc-library/<年>/<uuid>-<安全文件名>`，一个键只写一次。替换是新键加新行，旧行旧文件都留着。只做软删除，不删 R2 对象。
- 分片大小固定 `DOC_PART_SIZE = 8 * 1024 * 1024`（R2 要求除最后一片外每片一样大、不小于 5 MiB）。小文件也走同一条路（只有一片）。
- 大小上限：服务端 `warehouse.doc_max_mb`（默认 2048），小程序 `warehouse.doc_max_mb_miniapp`（默认 200），都存 `system_config`，由 `GET /doc-library/config` 给前端。
- 只收这些扩展名：`pdf jpg jpeg png webp gif bmp heic doc docx xls xlsx ppt pptx txt csv mp4 mov zip rar 7z dwg dxf`。`content_type` 由服务端按扩展名定，不信客户端传的。
- 从对象接口出去的文件：只有 PDF、图片、视频用 `Content-Disposition: inline`，其余一律 `attachment`；都带 `X-Content-Type-Options: nosniff`。不收 `html`、`svg`、`js`。
- 权限（设计稿第 9 节）：看资料是全部五个角色；上传、替换、改、删、生成和作废对外链接是库管或资料管理员（`caps.is_doc_admin`，超管两者都有）。智能体令牌没有任何资料接口（不在只读白名单里，保持这样）。
- 写接口先过 `requireHuman`，再过新的 `requireDocAdmin`。接口返回 `{ success, data }`，`message` 中文。
- R2 和 D1 之间没有事务：先完成 R2 分片、核对对象大小，再写库。宁可留下没人引用的对象，不能有指向不存在对象的记录。
- 页面路径 `packageWarehouse/docs/index`、`doc-view/index`、`doc-upload/index` 是设计稿定下的，不能改名。
- 单个路由、service、视图、页面文件不超过 400 行。界面上不出现英文枚举值和数字 ID。
- 用到 `node:sqlite` 的测试包在 `describe.skipIf(!hasSqlite)` 里，推送前本地必须跑。小程序测试 `cd packages/miniapp && npm run test:wh`。
- 提交信息格式 `<type>: <description>`，不加 AI 署名。分支 `feat/warehouse-phase4a-doc-library`，从最新的 `origin/main` 切出，开 PR，不直接推 `main`。
- 本计划不做：微盘镜像和「重新同步」（4B）、每日摘要里的证书到期提醒（阶段 5）、盘点（阶段 5）。

**设计稿没写死、本计划定下的地方（实施时如有不同意见，先改这里）：**

1. 阶段 4 拆成 4A（本计划）和 4B（微盘镜像），原因见上。
2. 设计稿说上传签名的问题「已单独立项」，实际没有单独的计划，所以放在本计划 Task 1，先于其他任务。
3. 分片请求（`PUT /doc-library/upload/part`）不带登录态，靠初始化时签发的上传令牌鉴权（令牌里有文件键、分片上传 ID、大小、上传人、24 小时有效期，用 `UPLOAD_SIGNING_SECRET` 签名）。这样小程序现有的二进制上传通道和 Web 的 `fetch` 都能直接用，也不用建上传会话表。
4. 替换文件走同一个完成接口，带 `supersedes_id`；不另设 `/file/:id/replace`。
5. 替换或删除一个文件时，它上面还有效的对外链接一并作废（替换多半是因为旧文件有问题，不能让旧链接继续发旧文件）。
6. 对外链接指向生成时的那一版文件。有效期 1 到 30 天，默认 7 天。公开接口直接把文件流出去（带 Range），不跳转到签名地址。
7. `doc_file` 多一个 `version` 列，改资料信息时用它防并发覆盖。
8. `POST /upload/sign-download` 不再给 `doc-library/` 的键签名（要从资料库接口拿地址）；`POST /upload/sign` 不接受 `doc-library` 这个类别。`wh-task/`、`wh-doc/`、`doc-library/` 加入受保护前缀。其他前缀谁能签下载地址保持现状，只是签名分了用途。
9. 小程序上资料管理员只做上传；改、删、替换、对外链接在 Web 上做。
10. 文件夹导入时的设备匹配：一级子文件夹名里含设备编号，或等于设备名称、现场叫法，就算匹配；匹配不到的行由人选设备、选类别、归为通用或跳过。资料类别按文件名里的关键字猜（合格证、检测或报告、参数、说明书、维修或保养），可改。
11. 列表里证书 30 天内到期标橙、已过期标红；主动提醒在阶段 5 的每日摘要里。

## Review Focus

1. **拿下载签名去上传。** 用 `sign-download` 得到的地址发 PUT、用别的键的签名、用过期的签名，都返回 401，R2 里的文件不变。Task 1。
2. **分片上传中途断网，某一片失败后重传，或者完成请求超时后再发一次。** 最后文件完整（R2 对象大小等于申报的大小），不会有指向半个文件的记录，重复完成不会出两条记录。Task 4、9、12。
3. **上传 `.html`、`.svg`、`.exe`，或把网页改名成 `.pdf`。** 前三种直接拒绝；改名的能传上去，但出去时类型是按扩展名定的 `application/pdf` 加 `nosniff`，不会在我们的域名下当网页执行。Task 1、4。
4. **对外链接过期、被作废、文件被删或被替换之后。** 都打不开，提示「链接已失效」；令牌猜不到；一个链接只能取到那一个文件；被刷时限流。Task 6。
5. **看视频时拖进度条、打开几十兆的 PDF。** 对象接口对 `Range: bytes=a-b` 返回 206 和正确的 `Content-Range`；范围越界返回 416；不带 Range 照旧返回整个文件。Task 1。

---

### Task 1: 签名分用途、受保护前缀、Range

**Files:**
- Modify: `packages/api/src/services/upload-signature.ts`
- Create: `packages/api/src/services/object-serve.ts`
- Modify: `packages/api/src/routes/upload.ts`
- Modify: `packages/api/src/routes/public-project-log.ts`（第 391 行附近，改成上传用途）
- Test: `packages/api/test/upload-signature-purpose.test.ts`、`packages/api/test/upload-object-serve.test.ts`
- Create: `packages/api/test/helpers/fake-r2.ts`

**Interfaces:**
- Produces（`upload-signature.ts`）：
  - `type ObjectAccessPurpose = "get" | "put"`
  - `signObjectAccess(secret: string, key: string, expiresAt: number, purpose: ObjectAccessPurpose): Promise<string>`，签名内容是 `` `${purpose}:${key}:${expiresAt}` ``。
  - `isObjectAccessSignatureValid(secret, key, expiresAt, signature, purpose): Promise<boolean>`
  - `buildSignedObjectUrl` 不变。
  - `getUploadBaseUrl(env: Env, requestUrl: string): string`：现在是 `routes/upload.ts` 里的私有函数，原样搬到这里并导出（Task 5、6 要用它拼查看地址和对外链接）。
- Produces（`object-serve.ts`）：
  - `INLINE_TYPES`：`application/pdf` 和 `image/*`、`video/*`。
  - `parseRange(header: string | null, size: number): { offset: number; length: number } | "invalid" | null`：只认单段 `bytes=a-b`、`bytes=a-`、`bytes=-n`；没有头返回 `null`；越界或写法不对返回 `"invalid"`。
  - `serveObject(env: Env, key: string, request: Request, options?: { fileName?: string; forceAttachment?: boolean }): Promise<Response>`：对象不存在 404；有合法 Range 返回 206 加 `Content-Range: bytes a-b/size`；`"invalid"` 返回 416 加 `Content-Range: bytes */size`；都带 `Accept-Ranges: bytes`、`X-Content-Type-Options: nosniff`；类型不在 `INLINE_TYPES` 或 `forceAttachment` 时带 `Content-Disposition: attachment; filename*=UTF-8''<编码后的文件名>`。
- Produces（`test/helpers/fake-r2.ts`）：`createFakeR2(): R2Bucket 的最小实现`，支持 `put`、`get(key, { range })`、`head`、`delete`、`createMultipartUpload`、`resumeMultipartUpload`（`uploadPart`、`complete`、`abort`），并导出 `objects: Map<string, { body: Uint8Array; contentType: string }>` 供断言。`complete` 时分片号不连续、etag 不对、除最后一片外大小不一致都抛错（和 R2 一样）。

`routes/upload.ts` 的改动：
- `POST /sign` 用 `"put"`；`category` 是 `doc-library` 或以 `doc-library/` 开头时返回 400「资料请从资料库上传」。
- `POST /sign-download` 用 `"get"`；键以 `doc-library/` 开头时返回 403「请从资料库打开这个文件」。
- `PUT /object/:key` 只认 `"put"` 签名。
- `GET /object/:key`：受保护前缀改成 `["contract-draft/", "legacy/fin/", "doc-library/", "wh-task/", "wh-doc/"]`；签名只认 `"get"`；Bearer 令牌的 `auth_method` 是 `mcp_agent` 时，对后三个前缀不放行；取对象和回包改用 `serveObject`。
- `public-project-log.ts` 签的是上传地址，用 `"put"`。

- [ ] **Step 1: 写失败的测试**

`upload-signature-purpose.test.ts`（用 `createFakeR2` 和现有路由测试的写法起 `uploadRoutes`，登录态用 `vi.mock("../src/services/auth")`）：

```ts
it("下载签名不能用来上传", async () => {
  files.objects.set("wh-task/a.jpg", { body: bytes("原图"), contentType: "image/jpeg" });
  const signed = await post("/sign-download", { key: "wh-task/a.jpg" });
  const res = await put(pathAndQueryOf(signed.body.data.url), bytes("覆盖"));
  expect(res.status).toBe(401);
  expect(text(files.objects.get("wh-task/a.jpg")!.body)).toBe("原图");
});
it("上传签名能上传，但不能用来下载受保护的文件", async () => {
  const signed = await post("/sign", { fileName: "a.jpg", contentType: "image/jpeg", category: "wh-task" });
  expect((await put(pathAndQueryOf(signed.body.data.uploadUrl), bytes("图"))).status).toBe(200);
  expect((await get(pathAndQueryOf(signed.body.data.uploadUrl))).status).toBe(401);
});
it("别的键的签名、过期的签名都拒绝", async () => { /* 换 key 后 401；expires 改成过去 401 */ });
it("资料库的键不能从通用接口签", async () => {
  expect((await post("/sign", { fileName: "a.pdf", category: "doc-library" })).status).toBe(400);
  expect((await post("/sign-download", { key: "doc-library/2026/x-a.pdf" })).status).toBe(403);
});
it("任务照片、库房单照片、资料不带签名和登录态读不到", async () => {
  for (const key of ["wh-task/a.jpg", "wh-doc/b.jpg", "doc-library/2026/c.pdf"]) expect((await get(`/object/${encodeURIComponent(key)}`)).status).toBe(401);
});
it("智能体令牌读不到这三类文件，人的令牌可以", async () => { /* auth_method: mcp_agent → 401；wecom_oauth → 200 */ });
it("原来不受保护的前缀照旧能读", async () => { /* miniapp/x.jpg 不带任何东西 → 200 */ });
```

`upload-object-serve.test.ts`：

```ts
expect(parseRange(null, 100)).toBeNull();
expect(parseRange("bytes=0-9", 100)).toEqual({ offset: 0, length: 10 });
expect(parseRange("bytes=90-", 100)).toEqual({ offset: 90, length: 10 });
expect(parseRange("bytes=-10", 100)).toEqual({ offset: 90, length: 10 });
expect(parseRange("bytes=95-200", 100)).toEqual({ offset: 95, length: 5 });   // 结尾超出按文件末尾
expect(parseRange("bytes=100-", 100)).toBe("invalid");
expect(parseRange("bytes=5-2", 100)).toBe("invalid");
expect(parseRange("bytes=0-1,5-6", 100)).toBe("invalid");                      // 多段不支持
expect(parseRange("items=0-1", 100)).toBe("invalid");
```

再测 `serveObject`：不带 Range 返回 200 和整个文件；`bytes=2-5` 返回 206、`Content-Range: bytes 2-5/10`、正文 4 个字节；越界返回 416、`Content-Range: bytes */10`；PDF 是 `inline`，`docx` 是 `attachment` 且 `filename*` 里中文文件名编码正确；都带 `nosniff` 和 `Accept-Ranges: bytes`；对象不存在返回 404。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npm test -- test/upload-signature-purpose.test.ts test/upload-object-serve.test.ts`
Expected: FAIL（`object-serve` 不存在；「下载签名不能用来上传」返回 200，文件被覆盖）。

- [ ] **Step 3: 实现**

- [ ] **Step 4: 跑测试确认通过，并跑用到签名和上传的现有测试**

Run: `cd packages/api && npm test -- test/upload-signature-purpose.test.ts test/upload-object-serve.test.ts && npm test -- upload public-project-log && npm run typecheck`
Expected: PASS。类型检查会指出所有漏传 `purpose` 的调用处，逐个补上。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/upload-signature.ts packages/api/src/services/object-serve.ts packages/api/src/routes/upload.ts packages/api/src/routes/public-project-log.ts packages/api/test/upload-signature-purpose.test.ts packages/api/test/upload-object-serve.test.ts packages/api/test/helpers/fake-r2.ts
git commit -m "fix: 上传签名和下载签名分开，下载地址不能再用来覆盖文件；对象读取支持 Range"
```

---

### Task 2: 迁移 0097、类型、文件类型表、测试夹具

**Files:**
- Create: `packages/api/migrations/0097_warehouse_doc_library.sql`
- Modify: `packages/api/src/types/wh.ts`
- Create: `packages/api/src/services/doc-library/file-types.ts`
- Modify: `packages/api/test/helpers/warehouse-harness.ts`（`env.FILES = createFakeR2()`，加 `seed.docFile`）
- Test: `packages/api/test/doc-library-schema.test.ts`、`packages/api/test/doc-library-file-types.test.ts`

**Interfaces:**
- Produces（`types/wh.ts`）：
  - `type DocCategory = "cert" | "report" | "params" | "manual" | "maintenance" | "other"`
  - `interface DocFile { id; title; file_name; file_key; file_size: number; content_type; doc_category: DocCategory; device_id: number | null; device_category_id: number | null; valid_until: string | null; supersedes_id: number | null; uploaded_by_userid; deleted_at: string | null; deleted_by_userid: string | null; version: number; created_at; updated_at }`
  - `interface DocShare { id; token; doc_file_id; expires_at; created_by_userid; revoked_at: string | null; access_count: number; created_at }`
- Produces（`file-types.ts`）：
  - `DOC_PART_SIZE = 8 * 1024 * 1024`
  - `DOC_CATEGORIES: readonly DocCategory[]`、`DOC_CATEGORY_LABELS`（合格证、检测报告、技术参数、说明书、保养维修、其他）
  - `extensionOf(fileName: string): string`（小写，不带点）
  - `contentTypeFor(fileName: string): string | null`：不在白名单返回 `null`
  - `safeFileName(fileName: string): string`：去掉路径和控制字符，保留中文，最长 120 字符，保住扩展名
  - `buildDocKey(fileName: string, now: Date, uuid: string): string` → `doc-library/<年>/<uuid>-<安全文件名>`
- Produces（夹具）：`seed.docFile(overrides?) → id`（默认 `doc_category: "manual"`、通用、`file_key` 自动生成、同时往假 R2 里放 10 个字节）。

表结构：
- `doc_file`：字段同上；`file_key` 唯一；`doc_category` CHECK 六个值；CHECK `device_id IS NULL OR device_category_id IS NULL`；`file_size` CHECK `> 0`；`device_id`、`device_category_id`、`supersedes_id` 外键；`version` 默认 0。
- `doc_share`：`token` 唯一；`doc_file_id` 外键；`access_count` 默认 0。
- 索引：`idx_doc_file_device_id`、`idx_doc_file_device_category_id`、`idx_doc_file_supersedes_id`、`idx_doc_file_valid_until`、`idx_doc_share_doc_file_id`。

- [ ] **Step 1: 写失败的测试**

`doc-library-schema.test.ts`：两张表和五个索引存在；同时填 `device_id` 和 `device_category_id` 被 CHECK 拒绝；`doc_category` 填 `"x"` 被拒绝；`file_key` 重复被拒绝；`file_size` 为 0 被拒绝；`seed.docFile()` 之后假 R2 里有那个键。

`doc-library-file-types.test.ts`：

```ts
expect(contentTypeFor("合格证.PDF")).toBe("application/pdf");
expect(contentTypeFor("图纸.dwg")).toBe("application/acad");
expect(contentTypeFor("a.docx")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
for (const name of ["a.html", "a.svg", "a.exe", "a.js", "没有扩展名", "a.pdf.exe"]) expect(contentTypeFor(name)).toBeNull();
expect(safeFileName("../../etc/合格 证\u0000.pdf")).toBe("合格 证.pdf");
expect(safeFileName(`${"长".repeat(200)}.pdf`).length).toBeLessThanOrEqual(120);
expect(safeFileName(`${"长".repeat(200)}.pdf`).endsWith(".pdf")).toBe(true);
expect(buildDocKey("合格证.pdf", new Date("2026-11-12T00:00:00Z"), "u-1")).toBe("doc-library/2026/u-1-合格证.pdf");
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npm test -- test/doc-library-schema.test.ts test/doc-library-file-types.test.ts`
Expected: FAIL（没有表 `doc_file`；找不到 `file-types`）。

- [ ] **Step 3: 写迁移、类型、文件类型表、夹具**

- [ ] **Step 4: 跑测试确认通过，并检查迁移编号**

Run: `cd packages/api && npm test -- test/doc-library-schema.test.ts test/doc-library-file-types.test.ts test/warehouse-schema.test.ts && node scripts/check-migration-numbers.mjs`
Expected: PASS，没有新的重复编号。

- [ ] **Step 5: 提交**

```bash
git add packages/api/migrations/0097_warehouse_doc_library.sql packages/api/src/types/wh.ts packages/api/src/services/doc-library/file-types.ts packages/api/test/helpers/warehouse-harness.ts packages/api/test/doc-library-schema.test.ts packages/api/test/doc-library-file-types.test.ts
git commit -m "feat: 设备资料库的表、文件类型白名单和测试夹具"
```

---

### Task 3: 资料的查询：列表、目录树、设备适用资料、详情

**Files:**
- Create: `packages/api/src/services/doc-library/query.ts`
- Create: `packages/api/src/routes/doc-library.ts`
- Modify: `packages/api/src/index.ts`（挂 `/api/v1/doc-library`）
- Modify: `packages/api/src/services/warehouse/access.ts`（加 `requireDocAdmin`）
- Test: `packages/api/test/doc-library-query.test.ts`

**Interfaces:**
- Produces（`query.ts`）：

```ts
export type DocScope = "device" | "category" | "general";
export interface DocFileRow extends DocFile {
  device_code: string | null;
  device_name: string | null;
  category_name: string | null;       // 归属类别的名字（不是资料类别）
  scope: DocScope;
  /** 有没有被一个没删除的新版本替换 */
  is_latest: boolean;
  /** valid_until 相对北京时间今天：expired、soon（30 天内）、ok、none */
  validity: "expired" | "soon" | "ok" | "none";
}
export const listDocFiles: (env: Env, query: Record<string, string | undefined>) => Promise<Paged<DocFileRow>>;
export const getDocFile: (env: Env, id: number) => Promise<(DocFileRow & { history: DocFileRow[] }) | null>;
export interface DocTree {
  total: number;
  general: number;
  categories: { category_id: number; category_name: string; own: number; devices: { device_id: number; device_code: string; name: string; count: number }[] }[];
}
export const getDocTree: (env: Env) => Promise<DocTree>;
export const listDocsForDevice: (env: Env, deviceId: number, taskKind?: string) => Promise<DocFileRow[]>;
```

- 路由（都 `requireRoles(ALL_ROLES)`，`guarded`）：`GET /doc-library/config`、`GET /doc-library/file`、`GET /doc-library/file/:id`、`GET /doc-library/tree`、`GET /doc-library/for-device/:deviceId?task_kind=`（`task_kind` 可选，原样传给 `listDocsForDevice`）。
- `GET /doc-library/config` 返回 `{ part_size, max_bytes, max_bytes_miniapp, categories: { key, label }[], extensions: string[] }`。
- Produces（`access.ts`）：`requireDocAdmin`（`caps.is_doc_admin`，否则 403「只有库管或资料管理员可以操作」）。

规则：
- 列表默认只列没删除、且是最新版的（`is_latest`）；`include_history=1` 时连被替换的旧版一起列；删除的永远不列。
- 筛选：`device_id`、`device_category_id`（只列归到这个类别的，不含类别下各台设备的）、`scope=general`、`doc_category`、`keyword`（匹配标题、文件名、设备编号）、`validity=expiring`（`expired` 加 `soon`）。按 `created_at` 倒序，分页 `page`、`pageSize`（最大 200）。
- 目录树只数最新版、没删除的；设备只列有资料的。
- `listDocsForDevice`：这台设备的、它的类别的、通用的，按这个顺序；同一层里，任务类型是 `inspection`、`maintenance`、`servicing` 时资料类别按「保养维修、说明书、技术参数、检测报告、合格证、其他」排，否则按「说明书、技术参数、合格证、检测报告、保养维修、其他」；再按时间倒序。设备不存在返回 404。
- `getDocFile` 的 `history`：沿 `supersedes_id` 往回找到的所有旧版（没删除的），新的在前。

- [ ] **Step 1: 写失败的测试**（`describe.skipIf(!hasSqlite)`）

每条一个主题，期望值写全：
1. 默认列表不含被替换的旧版和已删除的；`include_history=1` 含旧版、仍不含已删除的。
2. 新版被删除后，旧版重新成为最新版（`is_latest: true`）。
3. 五种筛选各一例；`keyword` 能按设备编号找到归在那台设备上的资料。
4. `scope` 字段：有 `device_id` 是 `device`，有 `device_category_id` 是 `category`，都没有是 `general`。
5. `validity`：把时间固定在北京时间 2026-11-12，`valid_until` 为 `2026-11-11` 是 `expired`，`2026-12-12` 是 `soon`，`2026-12-13` 是 `ok`，空是 `none`。
6. 目录树：两个类别、三台设备、通用各有若干，数字对得上；没有资料的设备不出现；被替换的旧版不计数。
7. `listDocsForDevice`：设备、类别、通用三层的顺序；维修任务时保养维修排在说明书前，无任务类型时说明书在前；别的设备、别的类别的资料不出现。
8. 详情带历史版本，顺序是新的在前。
9. 路由：`GET /doc-library/config` 返回分片大小 8388608 和六个资料类别的中文；操作员能读列表；智能体令牌经全局只读白名单访问 `/doc-library/file` 被拒（在 `src/middleware/agent-readonly.test.ts` 的现有用例旁加一条，确认这个路径不在白名单里）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npm test -- test/doc-library-query.test.ts`
Expected: FAIL，找不到 `services/doc-library/query`。

- [ ] **Step 3: 实现查询、路由、挂载**

`index.ts` 里先挂 Task 4、6 的不带登录态的路由（见那两个任务），再挂带 `authMiddleware` 的 `docLibraryRoutes`。本任务只挂后者。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/api && npm test -- test/doc-library-query.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/doc-library/query.ts packages/api/src/routes/doc-library.ts packages/api/src/index.ts packages/api/src/services/warehouse/access.ts packages/api/test/doc-library-query.test.ts
git commit -m "feat: 设备资料的列表、目录树和设备适用资料"
```

---

### Task 4: 分片上传：初始化、传分片、完成、放弃

**Files:**
- Create: `packages/api/src/services/doc-library/upload-token.ts`
- Create: `packages/api/src/services/doc-library/upload.ts`
- Create: `packages/api/src/routes/doc-library-open.ts`（不带登录态的路由：传分片；Task 6 再加公开下载）
- Modify: `packages/api/src/routes/doc-library.ts`、`packages/api/src/index.ts`
- Test: `packages/api/test/doc-library-upload.test.ts`

**Interfaces:**
- Produces（`upload-token.ts`）：

```ts
export interface DocUploadClaims { key: string; uploadId: string; name: string; size: number; type: string; uid: string; exp: number }
export const signUploadToken: (secret: string, claims: DocUploadClaims) => Promise<string>;      // base64url(JSON) + "." + HMAC-SHA256 十六进制
export const verifyUploadToken: (secret: string, token: unknown, now: number) => Promise<DocUploadClaims | null>;  // 格式不对、签名不对、过期都返回 null
```

- Produces（`upload.ts`）：

```ts
export const initDocUpload: (env: Env, input: Record<string, unknown>, auth: AuthTokenPayload)
  => Promise<{ upload_token: string; part_size: number; part_count: number }>;
export const putDocUploadPart: (env: Env, token: unknown, partNumber: unknown, body: ArrayBuffer)
  => Promise<{ part_number: number; etag: string }>;
export const completeDocUpload: (env: Env, input: Record<string, unknown>, auth: AuthTokenPayload)
  => Promise<{ id: number; replayed: boolean }>;
export const abortDocUpload: (env: Env, input: Record<string, unknown>, auth: AuthTokenPayload) => Promise<void>;
```

- 路由：
  - `POST /doc-library/upload/init`（`requireHuman`、`requireDocAdmin`）：`{ file_name, file_size, client?: "web" | "miniapp" }`
  - `PUT /doc-library/upload/part?token=&part=`（**不带登录态**，在 `doc-library-open.ts`，正文是这一片的字节）
  - `POST /doc-library/upload/complete`（`requireHuman`、`requireDocAdmin`）：`{ upload_token, parts: [{ part_number, etag }], title, doc_category, device_id?, device_category_id?, valid_until?, supersedes_id? }`
  - `POST /doc-library/upload/abort`（`requireHuman`、`requireDocAdmin`）：`{ upload_token }`

规则：
- 初始化：扩展名不在白名单 → 400「不支持这种文件：<扩展名>」；`file_size` 不是正整数 → 400；超过上限（`client` 是 `miniapp` 用小程序的上限，否则用服务端上限）→ 400「文件太大，最大 <n> MB」。通过后 `FILES.createMultipartUpload(key, { httpMetadata: { contentType } })`，令牌 24 小时有效，`part_count = ceil(size / DOC_PART_SIZE)`。
- 传分片：令牌无效或过期 → 401「上传已失效，请重新上传」；`part` 不是 1 到 `part_count` 的整数 → 400；正文为空或大于 `DOC_PART_SIZE` → 400；不是最后一片但大小不等于 `DOC_PART_SIZE` → 400「分片大小不对」。同一片重传覆盖前一次（R2 的行为），返回新的 etag。
- 完成：令牌里的 `uid` 必须是当前用户，否则 403；`parts` 必须正好是 1 到 `part_count` 各一个；先查 `doc_file` 里有没有这个 `file_key`，有就直接返回 `{ id, replayed: true }`（完成请求超时后重发）；校验标题（必填，最长 120）、资料类别、归属（设备或类别存在，最多填一个）、有效期（日期）、`supersedes_id`（存在、没删除、是最新版，否则 409「这个文件已经被替换或删除，请刷新」）；然后 `complete(parts)`，再 `head(key)` 核对大小等于令牌里的 `size`，不等就删掉对象并返回 400「文件不完整，请重新上传」；最后一个批处理里写 `doc_file`，带 `supersedes_id` 时同批把旧文件上还有效的 `doc_share` 置 `revoked_at`。
- R2 的 `complete` 抛错（分片缺失、etag 不对）→ 400「文件不完整，请重新上传」。
- 放弃：令牌有效且是本人时 `abort()`；其他情况静默返回成功（清理动作，不该报错）。

- [ ] **Step 1: 写失败的测试**（`describe.skipIf(!hasSqlite)`，`env.FILES` 是假 R2）

1. 令牌：签了能验；改一个字符、过期、不是字符串都返回 `null`。
2. 走完整流程：20 MiB 的假文件（3 片：8、8、4）→ 初始化返回 `part_count: 3` → 传三片 → 完成 → `doc_file` 一行，`file_size`、`content_type`（按扩展名）、`uploaded_by_userid` 正确；假 R2 里对象大小 20 MiB；列表里能查到。
3. 只有一片的小文件（1 KB）也走通。
4. 初始化拒绝 `a.html`、`a.exe`、大小 0、超过上限；`client: "miniapp"` 时 201 MB 被拒而 Web 可以。
5. 传分片：令牌过期 401；`part=0`、`part=4`（共 3 片）400；中间一片大小不对 400；最后一片可以小；重传第 2 片后完成用新的 etag 成功。
6. 完成时缺一片 → 400「文件不完整，请重新上传」，没有 `doc_file` 行。
7. 完成两次（同一个令牌）→ 第二次 `replayed: true`，`doc_file` 仍只有一行。
8. 别人的令牌完成 → 403。
9. 归属：设备不存在 400；同时填设备和类别 400；都不填是通用。
10. 替换：带 `supersedes_id` 完成后，旧行还在、默认列表只列新行、旧文件上有效的对外链接被作废；`supersedes_id` 指向已被替换的旧版 → 409。
11. 申报 20 MiB 实际只传了 12 MiB（把最后一片当成第 2 片传、`parts` 只给两片且 `part_count` 被绕过的情况用假 R2 直接构造对象大小不符）→ 400，对象被删，没有记录。
12. 权限：操作员、现场负责人、经理、财务初始化 403；资料管理员、库管、超管可以；智能体令牌 403。
13. 放弃：之后再传分片失败；用别人的令牌放弃不报错也不影响那次上传。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npm test -- test/doc-library-upload.test.ts`
Expected: FAIL，找不到 `upload-token`、`upload`。

- [ ] **Step 3: 实现**

分片正文用 `await c.req.arrayBuffer()`（一片最多 8 MiB，内存够）。`doc-library-open.ts` 是一个不挂 `authMiddleware` 的 Hono 实例，在 `index.ts` 里挂在 `/api/v1/doc-library` 上、排在带登录态的那个之前；它只注册明确的路径，其余路径 `next()` 交给后面。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/api && npm test -- test/doc-library-upload.test.ts test/doc-library-query.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/doc-library/upload-token.ts packages/api/src/services/doc-library/upload.ts packages/api/src/routes/doc-library-open.ts packages/api/src/routes/doc-library.ts packages/api/src/index.ts packages/api/test/doc-library-upload.test.ts
git commit -m "feat: 设备资料分片上传，完成时核对文件大小，支持替换旧文件"
```

---

### Task 5: 改资料信息、删除、取查看地址

**Files:**
- Create: `packages/api/src/services/doc-library/file.ts`
- Modify: `packages/api/src/routes/doc-library.ts`
- Test: `packages/api/test/doc-library-file.test.ts`

**Interfaces:**
- Produces（`file.ts`）：

```ts
export const updateDocFile: (env: Env, id: number, input: Record<string, unknown>) => Promise<void>;   // { version, title, doc_category, device_id, device_category_id, valid_until }
export const deleteDocFile: (env: Env, id: number, input: Record<string, unknown>, userid: string) => Promise<void>;   // { version }
export const getDocFileUrl: (env: Env, id: number, requestUrl: string)
  => Promise<{ url: string; expires_at: string; file_name: string; content_type: string; file_size: number; inline: boolean }>;
```

- 路由：`PUT /doc-library/file/:id`、`DELETE /doc-library/file/:id`（`requireHuman`、`requireDocAdmin`）；`GET /doc-library/file/:id/url`（`requireRoles(ALL_ROLES)`）。

规则：
- 改和删都用批内断言核对 `version` 和 `deleted_at IS NULL`，对不上返回 409「数据已变化，请刷新后重试」；已删除的返回 404。
- 改：字段校验同上传完成；不能改文件本身。
- 删：软删除，记 `deleted_at`、`deleted_by_userid`；同批作废它的对外链接。旧版本不跟着删。
- 取地址：已删除返回 404「资料不存在」；被替换的旧版仍然能取（历史版本要能看）；地址是 15 分钟的 `"get"` 签名，用 `getUploadBaseUrl`；`inline` 表示类型在 `INLINE_TYPES` 里。

- [ ] **Step 1: 写失败的测试**

1. 改标题、资料类别、归属、有效期后列表里是新值，`version` 加一。
2. 两个人拿同一个 `version` 先后改 → 第二个 409，内容是第一个人的。
3. 删除后列表、详情、目录树都没有它；它的对外链接 `revoked_at` 有值；再删一次 404。
4. 删除新版后旧版重新出现在默认列表里。
5. 取地址：返回的地址用 Task 1 的对象接口能读到文件内容；过 15 分钟后 401；已删除的资料 404；旧版本能取；PDF 的 `inline` 为真，`docx` 为假。
6. 权限矩阵（`it.each`）：`PUT`、`DELETE` 对操作员、现场负责人、经理、财务 403，对资料管理员、库管、超管不是 403，对智能体令牌 403；`GET .../url` 五个角色都能用。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npm test -- test/doc-library-file.test.ts`
Expected: FAIL，找不到 `services/doc-library/file`。

- [ ] **Step 3: 实现**

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/api && npm test -- test/doc-library-file.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/doc-library/file.ts packages/api/src/routes/doc-library.ts packages/api/test/doc-library-file.test.ts
git commit -m "feat: 设备资料的修改、删除和查看地址"
```

---

### Task 6: 对外链接

**Files:**
- Create: `packages/api/src/services/doc-library/share.ts`
- Modify: `packages/api/src/routes/doc-library.ts`、`packages/api/src/routes/doc-library-open.ts`
- Test: `packages/api/test/doc-library-share.test.ts`

**Interfaces:**
- Produces（`share.ts`）：

```ts
export interface DocShareRow extends DocShare { url: string; active: boolean }
export const createDocShare: (env: Env, fileId: number, input: Record<string, unknown>, userid: string, requestUrl: string) => Promise<DocShareRow>;   // { days?: 1..30，默认 7 }
export const listDocShares: (env: Env, fileId: number, requestUrl: string) => Promise<DocShareRow[]>;
export const revokeDocShare: (env: Env, token: string) => Promise<void>;
/** 公开下载用：有效就把访问次数加一并返回文件；否则返回 null。 */
export const openDocShare: (env: Env, token: string) => Promise<Pick<DocFile, "file_key" | "file_name" | "content_type"> | null>;
```

- 路由：
  - `POST /doc-library/file/:id/share`、`GET /doc-library/file/:id/share`、`DELETE /doc-library/share/:token`（`requireHuman`、`requireDocAdmin`；`GET` 也只给资料管理员，令牌不该让所有人看到）
  - `GET /doc-library/shared/:token`（**不带登录态**，在 `doc-library-open.ts`；`createRateLimitMiddleware({ scope: "doc-share", maxRequests: 30, windowSeconds: 60 })`）

规则：
- 令牌：`crypto.getRandomValues` 32 字节，base64url（43 个字符）。
- 只能给没删除的文件建链接；`days` 不是 1 到 30 的整数返回 400。
- `url` 是 `<getUploadBaseUrl>/api/v1/doc-library/shared/<token>`。
- 公开下载：令牌不存在、已作废、已过期、文件已删除，一律返回 404 和同一句话「链接已失效」（不区分原因，免得被探测）；有效时访问次数加一，用 `serveObject(env, key, request, { fileName, forceAttachment: true })` 把文件流出去（支持 Range；带 Range 的后续请求也算一次访问，可以接受）。
- 访问次数用单条 `UPDATE ... WHERE token = ? AND revoked_at IS NULL AND expires_at > ?`，按受影响行数判断是否有效，不先查再改。

- [ ] **Step 1: 写失败的测试**

1. 建链接：默认 7 天后过期；令牌 43 个字符，两次生成不同；`url` 以 `/api/v1/doc-library/shared/<token>` 结尾。
2. 公开下载（不带任何登录态）：返回文件内容，`Content-Disposition` 是 `attachment` 且文件名正确，`access_count` 变 1；再下一次变 2。
3. 过期（把时间拨到 8 天后）、作废、文件删除、文件被替换后：都是 404「链接已失效」，`access_count` 不变。
4. 随便一个令牌、空令牌：404，同一句话。
5. 一个链接取不到别的文件：`/shared/<token>?key=别的键`、`/shared/<token>/../file/2/url` 都不会给出别的文件。
6. `days` 为 0、31、`"abc"` → 400；给已删除的文件建链接 → 404。
7. 限流：同一个来源一分钟内第 31 次请求返回 429。
8. 列出某个文件的链接：有效的和失效的都列，`active` 对；只有资料管理员、库管、超管能列、能建、能作废（`it.each` 权限矩阵，含智能体令牌）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/api && npm test -- test/doc-library-share.test.ts`
Expected: FAIL，找不到 `services/doc-library/share`。

- [ ] **Step 3: 实现**

- [ ] **Step 4: 跑全部资料库测试和类型检查、lint**

Run: `cd packages/api && npm test -- test/doc-library test/upload && npm run typecheck && npm run lint`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/doc-library/share.ts packages/api/src/routes/doc-library.ts packages/api/src/routes/doc-library-open.ts packages/api/test/doc-library-share.test.ts
git commit -m "feat: 设备资料的对外链接，可设有效期、可作废、记访问次数"
```

---

### Task 7: Web 接口封装和纯函数

**Files:**
- Create: `packages/web/src/api/wh/doc-types.ts`、`packages/web/src/api/wh/doc.ts`
- Create: `packages/web/src/views/wh/docs/doc-view.ts`、`packages/web/src/views/wh/docs/doc-upload.ts`
- Modify: `packages/web/src/router/modules/wh.ts`（加 `/wh/docs`，菜单「设备资料库」）
- Test: `packages/web/src/views/wh/docs/doc-view.test.ts`、`doc-upload.test.ts`

**Interfaces:**
- Produces（`doc.ts`）：`getDocConfig`、`listDocFiles`、`getDocFile`、`getDocTree`、`listDocsForDevice`、`initDocUpload`、`putDocPart(token, partNumber, blob, signal?)`、`completeDocUpload`、`abortDocUpload`、`updateDocFile`、`deleteDocFile`、`getDocFileUrl`、`createDocShare`、`listDocShares`、`revokeDocShare`。类型在 `doc-types.ts`，和后端的 `DocFileRow`、`DocTree`、`DocShareRow` 字段一致。
- Produces（`doc-view.ts`）：
  - `previewKind(contentType: string): "pdf" | "image" | "video" | "download"`
  - `formatFileSize(bytes: number): string`（`980 B`、`1.2 MB`、`1.5 GB`）
  - `validityTag(validity): { text: string; type: "danger" | "warning" } | null`（`已过期`、`30 天内到期`）
  - `ownerText(row): string`（`<设备编号> <设备名>`、`类别：<类别名>`、`通用`）
  - `docActions(row, caps): { canEdit; canDelete; canReplace; canShare }`（都要 `is_doc_admin`；被替换的旧版只能看，四个都为假）
  - `treeSelection(node): Record<string, string>`（点目录树的一项 → 列表的筛选参数）
- Produces（`doc-upload.ts`）：
  - `splitParts(size: number, partSize: number): { partNumber: number; start: number; end: number }[]`
  - `uploadFileInParts(file: Blob, name: string, deps, onProgress): Promise<{ upload_token: string; parts: { part_number: number; etag: string }[] }>`，`deps = { init, putPart, abort, retries = 3 }`：每片失败自动重试到 `retries` 次，仍失败就调 `abort` 并抛出「第 N 片上传失败」。
  - `guessDocCategory(fileName: string): DocCategory`（合格证 → `cert`；检测、报告、检定 → `report`；参数 → `params`；说明书、手册 → `manual`；维修、保养 → `maintenance`；其余 `other`）
  - `titleFromFileName(fileName: string): string`（去掉扩展名）
  - `groupFolderImport(files: { path: string; file: File }[], devices: { id; device_code; name; alias }[]): { folder: string; deviceId: number | null; matchedBy: "code" | "name" | null; files: { file: File; title: string; category: DocCategory }[] }[]`（按一级子文件夹分组；根目录下的散文件归到 `folder: ""`；匹配规则见 Global Constraints 第 10 条；忽略 `.DS_Store`、`Thumbs.db` 和 `~$` 开头的临时文件）
  - `uploadProblem(file: { name: string; size: number }, config): string`（扩展名不支持、空文件、超过上限时返回中文原因，否则 `""`）

- [ ] **Step 1: 写失败的测试**

`doc-upload.test.ts` 至少包括：

```ts
expect(splitParts(20 * MB, 8 * MB)).toEqual([
  { partNumber: 1, start: 0, end: 8 * MB },
  { partNumber: 2, start: 8 * MB, end: 16 * MB },
  { partNumber: 3, start: 16 * MB, end: 20 * MB }
]);
expect(splitParts(1024, 8 * MB)).toEqual([{ partNumber: 1, start: 0, end: 1024 }]);
expect(splitParts(16 * MB, 8 * MB)).toHaveLength(2);   // 正好整除不多出空片
```

- `uploadFileInParts`：三片都成功时按顺序调 `putPart`，进度回调依次是已传字节数；第 2 片前两次失败第三次成功 → 整体成功，`putPart` 共调 5 次；第 2 片三次都失败 → 抛「第 2 片上传失败」且调了 `abort`，没有调第 3 片。
- `guessDocCategory` 六个类别各一例，加一个都不沾的。
- `groupFolderImport`：`顶管机资料/DG-1200-03 泥水平衡/合格证.pdf` 按编号匹配到设备；`顶管机资料/老三号/说明书.pdf` 按现场叫法匹配；`顶管机资料/不认识的/x.pdf` 的 `deviceId` 为 `null`；根目录散文件单独一组；`.DS_Store` 被忽略；只有一层目录时（`合格证/a.pdf`）按一级目录分组。
- `uploadProblem`：`a.exe`、0 字节、超过上限各返回对应的话。

`doc-view.test.ts`：`previewKind` 四种；`formatFileSize` 边界值；`validityTag` 四种；`ownerText` 三种；`docActions` 对资料管理员、普通员工、旧版本三种情况。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/web && npm test -- src/views/wh/docs`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现**

- [ ] **Step 4: 跑测试和类型检查**

Run: `cd packages/web && npm test -- src/views/wh/docs && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/web/src/api/wh/doc-types.ts packages/web/src/api/wh/doc.ts packages/web/src/views/wh/docs packages/web/src/router/modules/wh.ts
git commit -m "feat: 设备资料库的 Web 接口封装和分片上传、文件夹分组的纯函数"
```

---

### Task 8: Web 资料库页：目录树、列表、预览、改、删、历史版本

**Files:**
- Create: `packages/web/src/views/wh/docs/index.vue`
- Create: `packages/web/src/views/wh/docs/components/DocTree.vue`、`DocPreviewDialog.vue`、`PdfPreview.vue`、`DocEditDialog.vue`、`DocHistoryDrawer.vue`

**Interfaces:**
- Consumes: Task 7 的接口和纯函数；`useWhCapabilities`、`useWecomUserOptions`、`resolveApiErrorMessage`。

页面：
- 左边目录树：全部、通用、各设备类别（类别自己的资料数）下挂有资料的设备。点一项，右边列表按它筛。
- 右边：资料类别筛选、关键字、「只看快到期和已过期的」、「显示旧版本」。表格列：标题、资料类别、归属、大小、上传人、上传时间、有效期（带到期标签）、操作。
- 操作：查看（所有人）；改、替换、对外链接、删除（资料管理员；旧版本没有）；「历史版本」（有旧版时）。
- 预览对话框：PDF 用 `pdfjs-dist` 逐页画到 canvas，先画前 3 页，滚到底再画后面的（`pdfjs` 的加载方式参考 `views/bidding/dedup/lib/parse-pdf.ts`，文档地址用签名地址，开 `rangeChunkSize` 让它分段取）；图片直接显示；视频 `<video controls>`；其他类型不预览，直接给「下载」。都有「下载」按钮。签名地址 15 分钟过期：打开对话框时才取，过期后重新取。
- 改：标题、资料类别、归属（设备可搜索选择、设备类别、通用三选一）、有效期。409 时提示并刷新。
- 删除：确认框写清楚「删除后 Web 和小程序上都看不到，对外链接同时失效」。
- 右上角「上传」「按文件夹导入」按钮（Task 9）。没有资料管理员权限的人看不到这两个按钮和改删操作。

- [ ] **Step 1: 写页面和组件**（每个文件不超过 400 行）

- [ ] **Step 2: 类型检查、lint、构建**

Run: `cd packages/web && npm run typecheck && npx eslint src/views/wh/docs && npm run build`
Expected: 无错误。

- [ ] **Step 3: 浏览器里走一遍**（`preview_start` 起 api 和 web，本地账号 `admin`；先用接口或 Task 9 之前的临时脚本放几条资料）

核对：目录树数字和列表对得上；点设备只列那台的；PDF 能翻到后面的页；视频能拖进度条（网络面板里是 206）；docx 只能下载；改归属后目录树跟着变；删除后消失；用 `site_manager` 账号看不到上传、改、删按钮但能查看。控制台没有报错。

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/views/wh/docs
git commit -m "feat: Web 设备资料库页，按类别和设备浏览、预览、修改、删除"
```

---

### Task 9: Web 上传和按文件夹导入

**Files:**
- Create: `packages/web/src/views/wh/docs/components/DocUploadDialog.vue`、`FolderImportDialog.vue`、`OwnerPicker.vue`
- Create: `packages/web/src/views/wh/docs/upload-queue.ts`（+ `upload-queue.test.ts`）
- Modify: `packages/web/src/views/wh/docs/index.vue`

**Interfaces:**
- Produces（`upload-queue.ts`）：`createDocUploadQueue(deps)`，`deps = { init, putPart, complete, abort }`。`add(items)`、`start()`、`retry(key)`、`cancel(key)`；每项的状态 `waiting | uploading | done | failed`、进度、失败原因；同时最多传 2 个文件；一个失败不影响其他的；`complete` 失败时可以只重试 `complete`（分片已经在了，令牌没过期就不用重传）。

上传对话框：
- 拖进来或点选多个文件；一次选定归属（`OwnerPicker`）和资料类别，逐个文件可以改标题（默认文件名去掉扩展名）、改类别；合格证和检测报告可填有效期。
- 不支持的类型、空文件、超大文件加进来时就标出原因，不进入队列。
- 逐个显示进度；失败的显示原因和「重试」；全部完成后提示「N 个已上传，M 个失败」，关闭时刷新列表。上传中关对话框要确认。
- 「替换」从列表的操作进来：只能选一个文件，标题、类别、归属沿用旧文件，带 `supersedes_id`，并提示「旧文件保留为历史版本，原来的对外链接作废」。

文件夹导入对话框（现有资料迁入，设计稿 8.3）：
- 选一个文件夹（`<input webkitdirectory>`，也支持把文件夹拖进来，用 `webkitGetAsEntry` 递归读）。
- 用 `groupFolderImport` 分组，显示预览表：子文件夹名、匹配到的设备（或「没匹配到」加一个选择：选设备、归到某个设备类别、归为通用、跳过）、文件数；可展开看每个文件猜的资料类别并改。
- 没匹配到的行旁边有「去新建设备」的链接（新窗口打开设备页）。
- 确认后进同一个上传队列。导入完给出汇总：成功多少、失败多少、跳过了哪些文件夹。

- [ ] **Step 1: 写队列的失败测试**

`upload-queue.test.ts`：三个文件、并发 2 → 任一时刻 `uploading` 不超过 2；第二个文件某一片一直失败 → 它是 `failed`，另外两个 `done`；`retry` 后成功；`complete` 第一次超时第二次成功 → 没有重新传分片（`putPart` 调用次数不变），最终一条记录；`cancel` 等待中的项后它不会开始；全部结束时的汇总数字对。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/web && npm test -- src/views/wh/docs/upload-queue.test.ts`
Expected: FAIL，找不到模块。

- [ ] **Step 3: 实现队列和三个组件，接进页面**

- [ ] **Step 4: 测试、类型检查、构建**

Run: `cd packages/web && npm test -- src/views/wh/docs && npm run typecheck && npm run build`
Expected: PASS。

- [ ] **Step 5: 浏览器里走一遍**

核对：一次拖 3 个文件（一个 30 MB 以上的 PDF、一张图、一个 docx）传到某台设备，进度在走，传完列表里有；把 `.exe` 拖进来被标出不进队列；传到一半断网（开发者工具里切离线）→ 那个文件失败，恢复后点重试能传完，文件能正常打开；替换一个文件后旧版进历史；用一个三层的测试文件夹做文件夹导入，匹配、手选、跳过三种情况都对，导入后目录树上各台设备的数字对。

- [ ] **Step 6: 提交**

```bash
git add packages/web/src/views/wh/docs
git commit -m "feat: Web 设备资料多文件上传和按文件夹导入"
```

---

### Task 10: Web 对外链接，设备详情和任务抽屉带出资料

**Files:**
- Create: `packages/web/src/views/wh/docs/components/DocShareDialog.vue`、`DeviceDocsCard.vue`
- Modify: `packages/web/src/views/wh/docs/index.vue`
- Modify: `packages/web/src/views/wh/device/detail.vue`（加「资料」卡片）
- Modify: `packages/web/src/views/wh/task/components/TaskDetailDrawer.vue`（加「适用资料」）

- 对外链接对话框：选有效天数（默认 7）生成；列出这个文件的链接（到期时间、访问次数、是否有效）；「复制链接」「作废」。生成后提示「拿到链接的人不用登录就能下载这一个文件」。
- `DeviceDocsCard`（属性 `deviceId`、`taskKind?`、`compact?`）：调 `listDocsForDevice`，按「这台设备的、这类设备的、通用的」分三段，每条可查看；资料管理员有「上传到这台设备」（打开上传对话框，归属预填）。设备详情用完整版；任务抽屉用 `compact`（只列标题和类别，点开预览），任务没有设备时不显示。

- [ ] **Step 1: 实现**

- [ ] **Step 2: 类型检查、构建**

Run: `cd packages/web && npm run typecheck && npx eslint src/views/wh && npm run build`
Expected: 无错误。

- [ ] **Step 3: 浏览器里走一遍**

核对：生成链接后在无痕窗口（没登录）打开能下载，访问次数加一；作废后同一个地址显示「链接已失效」；替换文件后旧链接失效；设备详情的资料分三段且顺序对；维修任务的抽屉里保养维修资料排在前面；没有设备的任务不显示资料区。

- [ ] **Step 4: 提交**

```bash
git add packages/web/src/views/wh
git commit -m "feat: Web 设备资料对外链接，设备详情和任务里带出适用资料"
```

---

### Task 11: 小程序资料列表和查看

**Files:**
- Create: `packages/miniapp/packageWarehouse/docs/index.{js,wxml,wxss,json}`
- Create: `packages/miniapp/packageWarehouse/doc-view/index.{js,wxml,wxss,json}`
- Create: `packages/miniapp/packageWarehouse/common/wh-doc-view.js`
- Modify: `packages/miniapp/app.json`（分包加 `docs/index`、`doc-view/index`）
- Modify: `packages/miniapp/utils/wh-home-view.js`、`pages/warehouse/index.wxml`（所有人都有的「设备资料」入口）
- Modify: `packages/miniapp/packageWarehouse/device/index.{js,wxml}`（「资料」入口，带条数）
- Modify: `packages/miniapp/packageWarehouse/task-detail/index.{js,wxml}`、`common/wh-task-view.js`（「适用资料」一段）
- Modify: `packages/miniapp/utils/wh-app-json.test.js`（分包页面清单加这两个，Task 12 再加第三个）
- Test: `packages/miniapp/packageWarehouse/common/wh-doc-view.test.js`、`wh-docs-page.test.js`、`wh-doc-view-page.test.js`；改 `wh-home-view.test.js`、`wh-device-page.test.js`、`wh-task-detail-page.test.js`

**Interfaces:**
- Consumes: `GET /api/v1/doc-library/file`、`/for-device/:deviceId`、`/file/:id`、`/file/:id/url`、`/config`。这些不在 `/warehouse` 前缀下，`wh-api.js` 加 `docGet(path, query)`、`docSend(method, path, data)`（前缀 `/api/v1/doc-library`）。
- Produces（`wh-doc-view.js`）：
  - `openKind(contentType, fileName): "image" | "video" | "document" | "unsupported"`（图片；`mp4`、`mov`；`pdf doc docx xls xlsx ppt pptx` 用 `wx.openDocument`；其余 `unsupported`，页面提示「这种文件请在电脑上打开」）
  - `formatFileSize(bytes)`、`validityText(validity)`（`已过期`、`30 天内到期`、`""`）
  - `toDocRow(doc)` → `{ id, title, categoryLabel, ownerText, sizeText, validityText, expired }`
  - `groupForDevice(docs)` → `[{ scope, label: "这台设备" | "这类设备" | "通用", rows }]`（空的段不要）
  - `buildDocDetail(doc, toUserName)` → 头部信息、`history` 行、`kind`
  - `DOC_CATEGORY_TABS`（全部加六个资料类别）

页面：
- `docs/index`：参数 `deviceId`（可选）。带了就显示这台设备的适用资料（三段分组，标题是设备编号）；不带就是全库浏览：搜索框（停 300ms 查）、资料类别页签、每页 20 条触底加载。资料管理员右下角有「上传」（Task 12）。点一条进 `doc-view/index?id=`。
- `doc-view/index`：参数 `id`。显示标题、资料类别、归属、大小、上传人和时间、有效期（到期标红）、历史版本（点开看旧版）。「打开」按钮按 `openKind`：
  - 图片：取签名地址后 `wx.previewImage`。
  - 视频：页面里 `<video>`，`src` 是签名地址。
  - 文档：`wx.downloadFile` 下到临时目录再 `wx.openDocument({ showMenu: true })`，下载时显示进度；失败提示原因。企微 Windows 端打不开时提示「请用手机或网页版打开」（`wx.openDocument` 的 `fail`）。
  - 文件大于 50 MB 时先确认「文件有 N MB，要下载吗」。
- 签名地址过期（15 分钟）后再点「打开」要重新取。
- 设备页多一行「资料（N）」进 `docs/index?deviceId=`。任务详情在任务说明下面多一段「适用资料」，最多列 5 条（`for-device` 带 `task_kind`），更多的点「全部」进设备的资料页；任务没有设备时不显示。
- 库房 tab 页：扫一扫下面加「设备资料」入口（所有人）。

- [ ] **Step 1: 写视图模块和页面流程的失败测试**

视图：`openKind` 各类型；`groupForDevice` 三段的顺序和空段省略；`toDocRow` 的到期文字；`buildDocDetail` 带历史版本。
`wh-docs-page.test.js`：不带参数时请求 `/doc-library/file?page=1&pageSize=20`，切资料类别、搜索、触底加载；带 `deviceId` 时请求 `/for-device/7` 并分组；加载失败有提示且页面上写「加载失败，下拉重试」；资料管理员才有上传入口。
`wh-doc-view-page.test.js`：图片 → 取地址后 `previewImage`；文档 → `downloadFile` 后 `openDocument`，下载失败提示、按钮恢复；`openDocument` 失败提示「请用手机或网页版打开」；不支持的类型提示且不下载；资料不存在显示「没有找到这份资料」；连点两次「打开」只下载一次。（夹具的 `wx` 里加 `downloadFile`、`openDocument`。）
设备页、任务详情、首页的现有测试各补一条：入口存在、跳转地址对、任务没有设备时不请求资料。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/miniapp && npm run test:wh`
Expected: 新脚本报 `Cannot find module`，改过的旧脚本断言失败。

- [ ] **Step 3: 实现**

- [ ] **Step 4: 跑测试**

Run: `cd packages/miniapp && npm run test:wh && npm run typecheck`
Expected: 全部通过；`wh-wxml.test.js` 自动查到两个新页面。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/packageWarehouse packages/miniapp/app.json packages/miniapp/utils/wh-home-view.js packages/miniapp/utils/wh-home-view.test.js packages/miniapp/utils/wh-app-json.test.js packages/miniapp/pages/warehouse
git commit -m "feat: 小程序设备资料列表和查看，设备页和任务页带出适用资料"
```

---

### Task 12: 小程序上传资料

**Files:**
- Create: `packages/miniapp/packageWarehouse/doc-upload/index.{js,wxml,wxss,json}`
- Create: `packages/miniapp/packageWarehouse/common/wh-doc-upload.js`
- Modify: `packages/miniapp/app.json`、`packages/miniapp/utils/wh-app-json.test.js`
- Modify: `packages/miniapp/packageWarehouse/docs/index.{js,wxml}`（上传入口）
- Test: `packages/miniapp/packageWarehouse/common/wh-doc-upload.test.js`、`wh-doc-upload-page.test.js`

**Interfaces:**
- Consumes: `POST /doc-library/upload/init`（带 `client: "miniapp"`）、`PUT /doc-library/upload/part?token=&part=`（用 `utils/request.js` 的 `uploadBinary({ path, arrayBuffer, contentType })`，它走中继并带重试）、`POST /doc-library/upload/complete`、`/abort`、`GET /doc-library/config`；`wxChooseMessageFile`、`wxChooseMediaImage`（`utils/wx.js`）。
- Produces（`wh-doc-upload.js`）：
  - `splitParts(size, partSize)`（同 Web）
  - `uploadInParts(file /* { path, name, size } */, deps, onProgress)`，`deps = { init, readChunk(path, position, length), putPart(token, partNumber, arrayBuffer), abort, retries = 3 }`，返回 `{ upload_token, parts }`；失败抛「第 N 片上传失败」并调 `abort`。
  - `readChunk` 的默认实现用 `wx.getFileSystemManager().read({ filePath, position, length })`，一次只读一片，不把整个文件读进内存。
  - `uploadProblem(file, config)`、`guessDocCategory(fileName)`、`titleFromFileName(fileName)`（规则同 Web）
  - `newUploadForm(device)`、`uploadFormProblem(form)`（没选文件 → 「请选择文件」；标题为空 → 「请填写标题」）、`toCompletePayload(form, uploaded)`

页面：参数 `deviceId`（可选，带了归属预填并锁定这台设备）。
- 选文件：「从聊天记录选」（`wxChooseMessageFile`，一次一个）、「拍照或相册」（图片，一次一张）。选完显示文件名和大小；类型不支持、超过小程序上限时当场提示，不能提交。
- 标题（默认文件名去扩展名）、资料类别（按文件名猜，可改）、归属（这台设备、某个设备类别、通用；不带参数时设备用可搜索选择）、有效期（合格证和检测报告时显示）。
- 「上传」：显示进度（已传百分比）；成功后提示并返回上一页；失败提示原因，表单保留，可以再点。上传中不能重复点；上传中返回要确认。
- 只有资料管理员能进这个页面：没有权限时显示「只有库管或资料管理员可以上传」。

- [ ] **Step 1: 写失败的测试**

`wh-doc-upload.test.js`：`splitParts` 同 Web 的三例；`uploadInParts` 用假的 `readChunk`、`putPart`：20 MB 文件读三次（位置 0、8M、16M，长度 8M、8M、4M），进度回调对；某一片两次失败后成功 → 整体成功；三次都失败 → 抛「第 2 片上传失败」、调了 `abort`、没有读第 3 片；`uploadProblem` 对 `.exe`、空文件、201 MB；`toCompletePayload` 的字段。
`wh-doc-upload-page.test.js`：带 `deviceId` 时归属锁定；没选文件点上传提示「请选择文件」；选了超限的文件当场提示且不能上传；走完一次上传 → 依次是 `init`、分片、`complete`，`complete` 的内容对，成功后返回；`complete` 失败 → 提示、`busy` 复位、再点一次只重发 `complete`（不重传分片）；非资料管理员看到的是无权限提示。（夹具里加 `uploadBinary` 和 `wx.getFileSystemManager().read` 的替身。）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/miniapp && node packageWarehouse/common/wh-doc-upload.test.js; node packageWarehouse/common/wh-doc-upload-page.test.js`
Expected: `Cannot find module`。

- [ ] **Step 3: 实现**

- [ ] **Step 4: 跑全部小程序测试**

Run: `cd packages/miniapp && npm run test:wh && for f in utils/*.test.js; do node "$f" || echo "FAILED $f"; done && npm run typecheck`
Expected: 全部通过，没有 `FAILED`。

- [ ] **Step 5: 提交**

```bash
git add packages/miniapp/packageWarehouse packages/miniapp/app.json packages/miniapp/utils/wh-app-json.test.js
git commit -m "feat: 小程序上传设备资料，大文件分片读取上传"
```

---

### Task 13: 文档、整体验证、审查、开 PR

**Files:**
- Modify: `doc/UI设计文档.md`（J 节加「设备资料库」；4.38 加三个小程序页面和入口）
- Modify: `doc/开发记录.md`（追加：补记阶段 3 的上线——PR #28、合并提交 `52b59ea3`、API 版本 `dca347ec`；本阶段的内容、没做的、真机清单）
- Modify: `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`（状态行；第 21 节加「阶段 4A」，列出本计划「设计稿没写死」的 11 条和实施中新定的；第 15 节的表注明阶段 4 拆成 4A、4B）
- Modify: `CLAUDE.md`（如有新的约定，例如资料库的键前缀和受保护前缀）

- [ ] **Step 1: 跑全部检查**

```bash
cd packages/api && npm run typecheck && npm run lint && npm test && node scripts/check-migration-numbers.mjs
cd ../web && npm run typecheck && npm test && npm run build
cd ../miniapp && npm run typecheck && npm run test:wh && for f in utils/*.test.js; do node "$f" || echo "FAILED $f"; done
cd ../mcp && npm test
```

Expected: 全部通过。

- [ ] **Step 2: 本地跑迁移并端到端走一遍**

`cd packages/api && npm run db:migrate:local`，起本地 api 和 web（`preview_start`）。本地 R2 是真的 miniflare 实现，分片上传在这里才是真跑：
- 传一个 40 MB 以上的文件，查本地对象大小和申报的一致；用 `curl -H "Range: bytes=0-99"` 取签名地址，返回 206。
- 用 `sign-download` 的地址发 PUT，返回 401。
- 对外链接在没登录的情况下能下载，作废后 404。

- [ ] **Step 3: 小程序版式**

照阶段 3 的做法用真实 WXML/WXSS 加假数据渲染三个新页面和改过的三个页面的静态页核对。`wx.downloadFile`、`wx.openDocument`、`<video>`、分片读文件只能真机验证，写进真机清单。

- [ ] **Step 4: 写文档并提交**

`doc/开发记录.md` 里的**真机清单**：
1. 从聊天记录选一个 PDF 上传到某台设备；在设备页的「资料」里能看到并打开。
2. 传一个 50 MB 以上的视频：进度在走，传完能播放、能拖进度条；经中继和直连各试一次。
3. 打开 docx、xlsx；企微 Windows 端打不开时有提示。
4. 任务详情里看到适用资料，点开能看。
5. 上传到一半切到后台再回来、断网再恢复：有明确的失败提示，重新上传能成功。
6. 主包体积没有超过 2MB。

```bash
git add doc/UI设计文档.md doc/开发记录.md docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md CLAUDE.md
git commit -m "docs: 记录库房阶段 4A（设备资料库）和阶段 3 的上线"
```

- [ ] **Step 5: 整分支审查**

按 executing-plans 的 Final Review：派一个新开的审查子代理（最强的模型），把 Review Focus 五条原样给它，另外请它专门看：对象接口和公开下载有没有越权读到别的文件的办法；上传令牌能不能被别人复用或篡改；小程序页面的 WXML 和页面数据对不对得上。Critical 和 Important 一轮修完，每个修复先写失败的测试。

- [ ] **Step 6: 推送并开 PR（要 owner 明确同意）**

PR 说明写清楚：有迁移 0097（只加两张表），合并前要先跑；Task 1 改了全站的上传签名，部署瞬间还没用掉的旧签名地址会失效（最长 15 分钟，重新打开页面即可）；小程序的三个新页面要随下一次上传一起提审。

---

### Task 14: 发布和迁入现有资料（每一步都要 owner 确认）

- [ ] **Step 1: 跑生产迁移。** `cd packages/api && npx wrangler d1 migrations list hybcdg-prod-db --remote --env prod`，确认待执行的只有 0097，再 `apply`。
- [ ] **Step 2: 合并 PR。** 合并前看 Cloudflare 状态页；合并后健康检查 `ok=true`，在 Web 上传一个文件、打开、生成一个对外链接并在没登录的浏览器里下载。
- [ ] **Step 3: 定资料管理员。** 经理在「库房 → 设置」里把负责资料的人加为资料管理员（设计稿第 16 节第 5 条：现有资料多数是刘鹏上传的）。
- [ ] **Step 4: 迁入现有资料。** 有权限的人在微盘客户端把「顶管机参数、合格证、检测报告」「设备说明书」「设备合格证」下载到电脑，用 Web 的「按文件夹导入」传上来；在线表格和微文档先在微盘里导出成文件。导入前设备台账里要先有这些设备（阶段 1 的导入）。
- [ ] **Step 5: 小程序随下一版上传提审**，过真机清单。
- [ ] **Step 6: 4B。** owner 在企微管理后台给应用开微盘 API 权限后，跑阶段 0 的微盘探测，再写微盘镜像的计划。
