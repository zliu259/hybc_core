# 库房重做 阶段 4B：设备资料镜像到微盘 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设备资料库里的每一份最新资料，在企业微信的微盘里也有一份，按「设备类别 / 设备」分好目录，全公司能看能下载；在系统里新增、替换、改名、换归属、删除，微盘跟着变。微盘出任何问题都不影响在系统里上传和查看。

**Architecture:** 系统（R2）是唯一的源头，微盘是单向镜像，由应用自己建的空间承接。镜像全部在 Worker 里做：队列消息触发一次「排空」，排空时逐份资料对账（该在微盘哪个目录、叫什么名字，和记录的现状比），需要的话上传、改名、移动或删除。所有微盘调用走现有的 bridge 代理 `/wecom/proxy`，不改 bridge。非专业版企业每月只有 1000 次微盘调用，所以每一次调用都计数，到预算就停。

**Tech Stack:** Hono + D1 + KV + R2 + Queue（`packages/api`）、Vue 3 + Element Plus（`packages/web`）、Vitest、`node:sqlite` 测试夹具、内存里的假微盘。

**Spec:** `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`（8.4、9 的最后一行、10 的「微盘镜像暂停」、11 的资料接口、17 第 16 条、20、附录和附录里的「2026-11-12 实测」）

**前置：** 阶段 4A 已上线（`doc_file`、`doc_share`，迁移 0097）。微盘探测 2026-11-12 在生产上跑通：应用「恒越百川小程序（手机版）」能建空间、建目录、直传、分块上传、列目录、删除；分块上传的累计 SHA1 是小端；企业不是专业版。沿用：`fetchWeComAccessToken`、`fetchViaBridgeStrict`、`sha1-state.ts`、`getSystemConfig` / `setSystemConfig`、`publishEvent`、`guarded`、`WarehouseError`、`requireHuman`、`requireDocAdmin`、`requireSettingsManager`、`createWarehouseHarness`、`fake-r2.ts`。

## Global Constraints

- 迁移 `0099_warehouse_wedrive_mirror.sql`：给 `doc_file` 加镜像用的列（`ALTER TABLE ... ADD COLUMN`），建 `wedrive_folder` 表。不动别的。迁移先于合并执行，需要 owner 同意。
- **不改 `bridge/`。** 微盘调用一律经现有的 `/wecom/proxy`。
- **每一次微盘调用都经过 `WedriveClient`**，在那里计数、认错误码。业务代码不直接拼微盘地址。
- 每月调用预算：KV 键 `wedrive:calls:<北京年月>` 记本月已用次数；到 `warehouse.wedrive_monthly_budget`（默认 900）就暂停，不再发任何微盘请求；碰到 640019、640035 也暂停。暂停后只有人点「恢复」才继续。
- 没初始化、镜像开关关着、暂停中：不发任何微盘请求，资料的镜像状态保持 `pending`。
- 微盘是单向镜像：系统里的上传、改、删接口不等微盘，也不因为微盘失败而失败。触发镜像的那一步出错只记日志。
- 一次只有一个镜像在跑（数据库里的锁），避免两个任务同时建同一个目录。
- 分块固定 2 MiB（2097152 字节）。`block_sha`：前面每块是「到这块末尾为止的 SHA1 内部状态」，5 个寄存器各按小端写成十六进制；最后一块是整个文件的标准 SHA1。
- 分块上传一律带 `skip_push_card: true`。直传接口没有这个参数，所以**空间对全公司开放之后不再用直传**。
- 权限：初始化空间、开关镜像、恢复、对全公司开放是 `requireSettingsManager`（经理和超管）；「重新同步」是 `requireDocAdmin`；写接口先过 `requireHuman`。智能体令牌没有任何镜像接口。
- 单个路由、service、视图文件不超过 400 行。不用 `as any`、`@ts-ignore`。不改已有对象，返回新对象。
- 测试里不许真的调企微：用 `test/helpers/fake-wedrive.ts`。用到 `node:sqlite` 的测试包在 `describe.skipIf(!hasSqlite)` 里。
- 提交信息格式 `<type>: <description>`，不加 AI 署名。分支 `feat/warehouse-phase4b-wedrive-mirror`（已从 `origin/main` 的 `30b14f08` 切出），开 PR，不直接推 `main`。

**和设计稿不一样、或设计稿没写死、本计划定下的地方（有不同意见先改这里）：**

1. **不在 bridge 上加上传接口，镜像全在 Worker 里做。** 设计稿 8.4 和第 17 节第 16 条原来打算让 bridge 下载文件再传微盘、传完回调 Worker。探测证明 Worker 经现有代理就能分块上传，所以省掉 bridge 的新代码、部署和回调。代价：单个文件太大时 Worker 一次跑不完，所以有下一条。
2. **超过 `warehouse.wedrive_mirror_max_mb`（默认 200）的文件不镜像**，状态记 `skipped`，原因「超过镜像大小上限」。现有文件最大 36 MB。Worker 一次调用的 CPU 时间和对外请求数都有上限，200 MB 的文件要 100 个分片、整份算两遍摘要；要把上限调高，先在生产上拿一个大文件实测。
3. **调用预算**（见上）。文档写明免费版每企业每月 1000 次。估算首次迁入约 150 个文件要 400 到 450 次。
4. **两段式开放。** 先建一个没有成员的空间，把现有资料镜像进去（这时小文件用直传，一个文件一次调用，没有人会收到卡片）；管理员确认无误后点「对全公司开放」，这时才把公司根部门加为只能下载的成员。开放之后所有文件都走分块上传并带 `skip_push_card`（小文件 3 次调用），免得每传一份资料全公司收一张卡片。直传接口会不会推卡片文档没写，没有实测过，所以按会推处理。
5. 直传只用于不超过 7 MiB 的文件（文档写的上限 10M 没说是文件大小还是 base64 之后的大小，7 MiB 两种算法都不超）。直传超时就改用分块再试。
6. 目录：`<设备类别>/<设备编号 设备名称>/`，归到类别的在 `<设备类别>/通用/`，通用资料在根下的 `通用/`；设备没有类别时在 `未分类/` 下。目录缓存按「哪个类别、哪台设备」记，不按路径记；设备改名或换类别后，下次镜像它的资料时把目录改名或移过去。
7. 微盘里的文件名是 `<标题>.<扩展名>`。同一个目录里重名时由我们自己加「（2）」「（3）」，不依赖微盘的重名处理（没实测过）。
8. 替换：新版本传上去，旧版本在微盘里的那一份删掉。删除：微盘里的也删掉。历史版本只在系统里。
9. 对账式的镜像：任何触发都只是说「去对一下这份资料」。上传成功但没来得及记下文件 ID（超时、被中断）时，下一次先在目标目录里按名字和大小找，找到就认领，不重复上传。
10. 一次排空最多处理 25 份、250 MB 或 4 分钟，还有剩的就再发一条消息接着跑。每份资料最多试 5 次；每小时的定时任务把 `pending`、失败未满 5 次的、`syncing` 超过 30 分钟的重新排上。
11. 暂停时给超管发一条企微通知（`super_admin` 对应标签里的人）；通知发不出去只记日志。
12. 镜像状态列和「重新同步」只给库管和资料管理员看。

## Review Focus

1. **调用预算和限额。** 到预算、或企微返回 640019、640035 时立刻停，之后不再发请求；恢复后从没做完的接着做，已经镜像好的不重传。Task 3、6。
2. **上传成功但没记下来。** 传完之后、写库之前被打断，再跑一次不会在微盘里出现两份。Task 5。
3. **两个触发同时到。** 只有一个在跑；持锁的那个被杀掉后，锁过期能接着跑，不会永远卡住。Task 6。
4. **微盘出问题不拖累系统。** 微盘超时、报错、没初始化、暂停时，上传、改、删资料的接口照常成功，资料在 Web 和小程序上照常能看。Task 6、7。
5. **分块的边界。** 文件正好 2 MiB、正好是 2 MiB 的整数倍、只有 1 字节、刚过直传上限：`block_sha` 的个数和内容都对，假微盘按真实规则核对。Task 2、3。

---

### Task 1: 迁移 0099 和镜像设置

**Files:**
- Create: `packages/api/migrations/0099_warehouse_wedrive_mirror.sql`
- Modify: `packages/api/src/types/wh.ts`
- Create: `packages/api/src/services/wedrive/settings.ts`
- Test: `packages/api/test/wedrive-schema.test.ts`、`packages/api/test/wedrive-settings.test.ts`

**Interfaces:**
- Produces（表）：
  - `doc_file` 新列：`mirror_status TEXT NOT NULL DEFAULT 'pending' CHECK (mirror_status IN ('pending','syncing','synced','failed','skipped'))`、`mirror_error TEXT`、`mirror_attempts INTEGER NOT NULL DEFAULT 0`、`mirror_started_at TEXT`、`mirrored_at TEXT`、`wedrive_fileid TEXT`、`wedrive_name TEXT`、`wedrive_folder_key TEXT`。索引 `idx_doc_file_mirror_status`。
  - `wedrive_folder`：`folder_key TEXT PRIMARY KEY`（`general`、`uncategorized`、`category:<id>`、`category-general:<id>`、`device:<id>`）、`fileid TEXT NOT NULL`、`name TEXT NOT NULL`、`parent_key TEXT`（根下的为空）、`created_at`、`updated_at`。
- Produces（`types/wh.ts`）：`DocMirrorStatus`；`DocFile` 加上面 8 个字段；`WedriveFolder`。
- Produces（`services/wedrive/settings.ts`）：

```ts
export interface WedriveSettings {
  space_id: string | null;
  enabled: boolean;
  /** 空间已经对全公司开放（开放后不再用直传） */
  space_open: boolean;
  /** 不为空就是暂停中，值是原因 */
  paused_reason: string | null;
  mirror_max_bytes: number;   // warehouse.wedrive_mirror_max_mb，默认 200
  monthly_budget: number;     // warehouse.wedrive_monthly_budget，默认 900
}
export const getWedriveSettings: (env: Env) => Promise<WedriveSettings>;
export const saveWedriveSetting: (env: Env, patch: Partial<Pick<WedriveSettings, "space_id" | "enabled" | "space_open" | "paused_reason">>, userid: string) => Promise<WedriveSettings>;
/** 北京时间的年月，如 "2026-11" */
export const callMonth: (now: Date) => string;
export const getCallCount: (env: Env, now: Date) => Promise<number>;
/** 加一并返回加完之后的数；KV 键保留 70 天 */
export const addCall: (env: Env, now: Date) => Promise<number>;
/** 现在能不能发微盘请求：已初始化、开着、没暂停 */
export const mirrorActive: (settings: WedriveSettings) => boolean;
```

  配置键都以 `warehouse.wedrive_` 开头：`space_id`、`enabled`（`"1"` 为开）、`space_open`、`paused_reason`、`mirror_max_mb`、`monthly_budget`。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("0099 镜像字段", () => {
  it("doc_file 有 8 个镜像字段，老资料默认是 pending、0 次", () => {});
  it("mirror_status 只认五种值", () => {
    expect(() => h.database.prepare("UPDATE doc_file SET mirror_status = 'done'").run()).toThrow(/CHECK/);
  });
  it("wedrive_folder 的 folder_key 不能重复", () => {});
});
describe.skipIf(!hasSqlite)("镜像设置", () => {
  it("什么都没配：没初始化、关着、没开放、没暂停，上限 200 MB，预算 900", async () => {
    expect(await getWedriveSettings(env)).toEqual({
      space_id: null, enabled: false, space_open: false, paused_reason: null,
      mirror_max_bytes: 200 * 1024 * 1024, monthly_budget: 900
    });
  });
  it("mirrorActive：三个条件缺一个都是 false", () => {});
  it("调用次数按北京时间的月份记；跨月从 0 开始", async () => {
    expect(callMonth(new Date("2026-11-30T16:00:00Z"))).toBe("2026-12");
    expect(await addCall(env, at("2026-11-12T00:00:00Z"))).toBe(1);
    expect(await addCall(env, at("2026-11-12T00:00:00Z"))).toBe(2);
    expect(await getCallCount(env, at("2026-12-01T00:00:00Z"))).toBe(0);
  });
  it("上限和预算配成乱七八糟的值时用默认值", async () => {});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/wedrive-schema.test.ts test/wedrive-settings.test.ts`
Expected: FAIL，`no such column: mirror_status`、找不到模块

- [ ] **Step 3: 写迁移、类型、设置**

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm test -- test/wedrive-schema.test.ts test/wedrive-settings.test.ts test/doc-library-schema.test.ts && node scripts/check-migration-numbers.mjs && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/migrations/0099_warehouse_wedrive_mirror.sql packages/api/src/types/wh.ts packages/api/src/services/wedrive/settings.ts packages/api/test/wedrive-schema.test.ts packages/api/test/wedrive-settings.test.ts
git commit -m "feat: 微盘镜像的字段和设置（迁移 0099）"
```

---

### Task 2: 能续算的 SHA1 和分块摘要

**Files:**
- Modify: `packages/api/src/services/sha1-state.ts`
- Create: `packages/api/src/services/wedrive/block-sha.ts`
- Test: `packages/api/src/services/sha1-state.test.ts`（加用例）、`packages/api/test/wedrive-block-sha.test.ts`

**Interfaces:**
- Produces（`sha1-state.ts`，原有的 `sha1StateHex` 不变）：

```ts
export interface Sha1Stream {
  /** 可以分很多次喂，每次任意长度 */
  update(bytes: Uint8Array): void;
  /** 到目前为止的内部状态；已喂的总长度必须是 64 的倍数 */
  stateHex(wordEndian: "big" | "little"): string;
  /** 标准 SHA1（加结尾填充）；不改变这个对象，之后还能接着喂 */
  digestHex(): string;
}
export const createSha1Stream: () => Sha1Stream;
```

- Produces（`block-sha.ts`）：

```ts
export const WEDRIVE_BLOCK_BYTES = 2 * 1024 * 1024;
export interface BlockShaResult { block_sha: string[]; sha1: string; size: number }
/** 把整个文件流过一遍，算出 file_upload_init 要的 block_sha 和整文件 SHA1。内存里只留一小段。 */
export const computeBlockSha: (stream: ReadableStream<Uint8Array>) => Promise<BlockShaResult>;
/** 把流切成正好 2 MiB 一块（最后一块可以小）依次交给 onBlock */
export const forEachBlock: (stream: ReadableStream<Uint8Array>, onBlock: (block: Uint8Array, index: number) => Promise<void>) => Promise<void>;
```

- [ ] **Step 1: 写失败的测试**

```ts
it("digestHex 和 Web Crypto 的 SHA-1 一致：空、1 字节、55、56、63、64、65 字节、3 MiB", async () => {});
it("分多次喂和一次喂结果一样（切在任意位置）", () => {});
it("stateHex 和原来的 sha1StateHex 一致", () => {
  const bytes = pattern(128);
  const s = createSha1Stream(); s.update(bytes);
  expect(s.stateHex("little")).toBe(sha1StateHex(bytes, "little"));
});
it("digestHex 之后还能接着喂", () => {});
it("长度不是 64 的倍数时取状态报错", () => {});

// wedrive-block-sha.test.ts
it("3 MiB：两块，第一块是 2 MiB 处的小端状态，第二块是整文件 SHA1", async () => {
  const bytes = pattern(3 * MiB);
  const result = await computeBlockSha(streamOf(bytes, 70_000));
  expect(result.block_sha).toEqual([sha1StateHex(bytes.subarray(0, 2 * MiB), "little"), await sha1Hex(bytes)]);
  expect(result.size).toBe(3 * MiB);
});
it("1 字节、正好 2 MiB：只有一块，就是整文件 SHA1", async () => {});
it("正好 4 MiB：两块，不会多出一个空块", async () => {});
it("forEachBlock：不管流怎么切，每块正好 2 MiB，最后一块是余下的", async () => {});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- src/services/sha1-state.test.ts test/wedrive-block-sha.test.ts`
Expected: FAIL，`createSha1Stream` 不存在

- [ ] **Step 3: 实现。** `createSha1Stream` 复用文件里现成的 `compress`，自己攒不满 64 字节的尾巴；`digestHex` 在状态的副本上做填充。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm test -- src/services/sha1-state.test.ts test/wedrive-block-sha.test.ts src/services/wedrive-probe.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/sha1-state.ts packages/api/src/services/sha1-state.test.ts packages/api/src/services/wedrive/block-sha.ts packages/api/test/wedrive-block-sha.test.ts
git commit -m "feat: 能续算的 SHA1 和微盘分块摘要"
```

---

### Task 3: 微盘客户端和假微盘

**Files:**
- Create: `packages/api/src/services/wedrive/client.ts`
- Modify: `packages/api/src/services/wecom-approval-push.ts`（`fetchViaBridgeStrict` 的 options 加可选的 `timeoutMs`，默认还是 6000）
- Create: `packages/api/test/helpers/fake-wedrive.ts`
- Test: `packages/api/test/wedrive-client.test.ts`

**Interfaces:**
- Consumes: `WeComCaller`（`services/wedrive-probe.ts` 里已有的类型，搬到 `client.ts` 导出，探测改成从这里引）；Task 1 的 `addCall`、`getCallCount`；Task 2 的 `computeBlockSha`、`forEachBlock`。
- Produces（`client.ts`）：

```ts
export class WedriveError extends Error { errcode: number | null; apiName: string }
/** 企微说超限了（640019、640035），或者本月预算用完了 */
export class WedriveQuotaError extends WedriveError {}
export interface WedriveItem { fileid: string; file_name: string; file_size: number; file_type: number; sha: string | null }
export interface WedriveClient {
  createSpace(name: string): Promise<string>;                                   // space_create，不带成员
  openSpaceToCompany(spaceId: string): Promise<void>;                           // space_acl_add，根部门 1，auth 1
  createFolder(spaceId: string, parentId: string, name: string): Promise<string>;
  listFolder(spaceId: string, folderId: string): Promise<WedriveItem[]>;        // 翻完所有页
  rename(fileId: string, newName: string): Promise<void>;
  move(fileId: string, newParentId: string): Promise<void>;                     // replace: false
  remove(fileIds: string[]): Promise<void>;
  /** 直传；只许在空间没开放时用 */
  uploadDirect(spaceId: string, parentId: string, name: string, bytes: Uint8Array): Promise<string>;
  /** 分块上传；open 给两次流（第一次算摘要，第二次传内容） */
  uploadChunked(spaceId: string, parentId: string, name: string, size: number, open: () => Promise<ReadableStream<Uint8Array>>): Promise<string>;
}
export const DIRECT_UPLOAD_MAX_BYTES = 7 * 1024 * 1024;
export const createWedriveClient: (env: Env, deps?: { call?: WeComCaller; now?: () => Date; budget?: number }) => WedriveClient;
```

  - 每次调用前：本月已用次数 ≥ 预算就抛 `WedriveQuotaError`（不发请求）；发之后 `addCall`。
  - 回包 `errcode` 不是 0 抛 `WedriveError`；640019、640035 抛 `WedriveQuotaError`。
  - 传分片的调用超时用 20 秒，其余 6 秒；某一片失败重试 2 次。
  - `uploadChunked`：`file_upload_init` 带 `skip_push_card: true`；回包里有 `fileid`（秒传）就直接返回。
- Produces（`fake-wedrive.ts`）：`createFakeWedrive()` 返回 `{ call, tree(), calls, failNext(apiName, errcode), cards }`。它在内存里维护空间和文件树，并且**按真实规则核对**：`file_upload_init` 的 `block_sha` 个数要等于按 2 MiB 切出来的块数；每一片到了就续算 SHA1，和声明的小端状态比，不对回 640049；`file_upload_finish` 时整文件 SHA1 要等于最后一项；直传超过 10 MB 回错；同一个目录里重名时自动改成 `名字(1)`（模拟最坏情况）；带了 `skip_push_card` 的不记卡片，没带的记一张。

- [ ] **Step 1: 写失败的测试**

```ts
describe("微盘客户端", () => {
  it("建空间、建目录、直传、列目录、改名、移动、删除，每次调用都记了数", async () => {
    // ……最后 expect(await getCallCount(env, now)).toBe(7)
  });
  it("分块上传 5 MiB：init、3 片、finish，共 5 次调用；假微盘核对过每一片的摘要", async () => {});
  it("分块上传只有 1 字节、正好 2 MiB、正好 4 MiB 都能成", async () => {});
  it("分块上传带了 skip_push_card，不产生卡片；直传会产生一张", async () => {});
  it("某一片第一次失败、重试成功：文件完整", async () => {});
  it("init 命中秒传：不再传分片", async () => {});
  it("企微返回 640019：抛 WedriveQuotaError", async () => {});
  it("本月已经用到预算：不发请求就抛 WedriveQuotaError，调用次数不再加", async () => {
    // 预算 3，先用掉 3 次
    await expect(client.createFolder("s", "s", "x")).rejects.toBeInstanceOf(WedriveQuotaError);
    expect(fake.calls).toHaveLength(3);
  });
  it("别的 errcode：抛 WedriveError，带上接口名和错误码", async () => {});
  it("listFolder 超过一页时翻完", async () => {});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/wedrive-client.test.ts`
Expected: FAIL，找不到模块

- [ ] **Step 3: 实现假微盘和客户端**

请求体照探测里跑通的写（`services/wedrive-probe.ts`）和文档：`space_create { space_name }`；`space_acl_add { spaceid, auth_info: [{ type: 2, departmentid: 1, auth: 1 }] }`；`file_create { spaceid, fatherid, file_type: 1, file_name }`；`file_list { spaceid, fatherid, sort_type: 1, start, limit: 1000 }`（按 `has_more`、`next_start` 翻页）；`file_rename { fileid, new_name }`；`file_move { fatherid, replace: false, fileid: [id] }`；`file_delete { fileid: [ids] }`；`file_upload { spaceid, fatherid, file_name, file_base64_content }`；`file_upload_init { spaceid, fatherid, file_name, size, block_sha, skip_push_card: true }`；`file_upload_part { upload_key, index, file_base64_content }`；`file_upload_finish { upload_key }`。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm test -- test/wedrive-client.test.ts src/services/wedrive-probe.test.ts src/routes/admin-wedrive-probe.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/wedrive/client.ts packages/api/src/services/wecom-approval-push.ts packages/api/src/services/wedrive-probe.ts packages/api/test/helpers/fake-wedrive.ts packages/api/test/wedrive-client.test.ts
git commit -m "feat: 微盘客户端（计数、限额、分块上传）和测试用的假微盘"
```

---

### Task 4: 目录

**Files:**
- Create: `packages/api/src/services/wedrive/folders.ts`
- Test: `packages/api/test/wedrive-folders.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `WedriveClient`；`wedrive_folder` 表。
- Produces：

```ts
export interface FolderTarget { key: string; name: string; parentKey: string | null }
/** 这份资料该放的目录，从里到外的一串（最后一个是根下的那一层） */
export const folderChainFor: (doc: { device_id: number | null; device_category_id: number | null }, lookup: FolderLookup) => FolderTarget[];
export interface FolderLookup {
  device(id: number): { device_code: string; name: string; category_id: number | null } | null;
  category(id: number): { name: string } | null;
}
/** 微盘里不能用的字符换成全角或去掉，首尾空白去掉，最长 80 个字 */
export const safeFolderName: (name: string) => string;
/** 保证这一串目录在微盘里存在、名字和位置都对，返回最里面那个的 fileid 和 key */
export const ensureFolder: (env: Env, client: WedriveClient, spaceId: string, chain: FolderTarget[]) => Promise<{ fileid: string; key: string }>;
```

  - 目录名：类别用类别名；设备用「编号 名称」；`通用`、`未分类` 是固定的字。
  - `ensureFolder` 从外到里：缓存里没有就 `createFolder` 并记下；有但名字不一样就 `rename`；有但上一级不一样就 `move`；都一样就不发请求。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("微盘目录", () => {
  it("单台设备的资料：类别 / 编号 名称", () => {
    expect(folderChainFor({ device_id: 3, device_category_id: null }, lookup)).toEqual([
      { key: "category:9", name: "顶管机", parentKey: null },
      { key: "device:3", name: "SB-0003 唐兴 NSPD1200", parentKey: "category:9" }
    ]);
  });
  it("归到类别的：类别 / 通用；通用资料：通用；设备没有类别：未分类 / 设备", () => {});
  it("第一次：逐层建目录并记下；第二次：一个请求都不发", async () => {
    await ensureFolder(env, client, "s", chain);
    const before = fake.calls.length;
    await ensureFolder(env, client, "s", chain);
    expect(fake.calls.length).toBe(before);
  });
  it("设备改了名：目录改名，不新建", async () => {});
  it("设备换了类别：目录移到新类别下面", async () => {});
  it("目录名里的斜杠、冒号、换行被换掉；太长的截断", () => {
    expect(safeFolderName(" a/b:c\n")).toBe("a／b：c");
  });
  it("建到一半失败：已经建好的那几层留在缓存里，下次从断的地方接着建", async () => {});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/wedrive-folders.test.ts`
Expected: FAIL，找不到模块

- [ ] **Step 3: 实现**

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm test -- test/wedrive-folders.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/wedrive/folders.ts packages/api/test/wedrive-folders.test.ts
git commit -m "feat: 微盘目录（按类别和设备，改名换类别跟着动）"
```

---

### Task 5: 对一份资料做镜像

**Files:**
- Create: `packages/api/src/services/wedrive/mirror-doc.ts`
- Test: `packages/api/test/wedrive-mirror-doc.test.ts`

**Interfaces:**
- Consumes: Task 1 到 4。
- Produces：

```ts
export type MirrorOutcome = "synced" | "skipped" | "removed" | "unchanged";
/**
 * 把一份资料在微盘里的样子对到应该的样子。出错就抛（WedriveQuotaError 原样抛），由调用方记失败。
 * 调用方已经把这一行标成 syncing。
 */
export const reconcileDoc: (env: Env, client: WedriveClient, settings: WedriveSettings, docId: number) => Promise<MirrorOutcome>;
/** 微盘里的文件名：标题 + 原文件的扩展名，去掉不能用的字符 */
export const wedriveFileName: (title: string, fileName: string) => string;
```

  - 应该的样子：资料没删、是最新版 → 该在目录 F 里、名字 N；已删除或被替换 → 不该在微盘里。
  - 该在而没有 `wedrive_fileid`：先看目标目录的缓存目录里有没有别的活着的资料用了同一个名字（查库，不查微盘），有就加「（2）」「（3）」；`mirror_attempts > 0` 时（上次可能传到一半）先 `listFolder` 按名字和大小找，找到就认领；否则上传。空间没开放且不超过 `DIRECT_UPLOAD_MAX_BYTES` 用直传，直传失败（不是限额）就改分块；其余用分块。超过 `mirror_max_bytes` 记 `skipped`，`mirror_error` 写「超过镜像大小上限」。
  - 该在、已有 `wedrive_fileid`：名字不一样 `rename`，目录不一样 `move`，都一样返回 `unchanged`。
  - 不该在而有 `wedrive_fileid`：`remove`，清掉三个 `wedrive_` 字段，返回 `removed`。
  - 成功后写 `mirror_status = 'synced'`、`mirrored_at`、`mirror_error = NULL`（`skipped` 另记）。R2 里文件不存在时抛普通错误，文字「文件不在存储里」。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("对一份资料做镜像", () => {
  it("新资料：建目录、上传，记下文件 ID、名字、目录，状态 synced", async () => {
    expect(await reconcile(docId)).toBe("synced");
    expect(fake.tree()).toEqual({ "顶管机": { "SB-0003 唐兴 NSPD1200": { "出厂合格证.pdf": 10 } } });
    expect(row(docId)).toMatchObject({ mirror_status: "synced", wedrive_name: "出厂合格证.pdf", wedrive_folder_key: "device:3" });
  });
  it("没开放时小文件用直传（1 次调用）；开放后同样的文件走分块（3 次）并且不产生卡片", async () => {});
  it("超过 7 MiB 的走分块；假微盘核对了摘要", async () => {});
  it("直传超时：改用分块传成", async () => {});
  it("超过镜像上限：skipped，写明原因，一个微盘请求都没发", async () => {});
  it("改了标题：微盘里改名，不重传", async () => {});
  it("换了归属：微盘里移到新目录", async () => {});
  it("被替换：旧的那份从微盘删掉；新的那份上传", async () => {});
  it("删除：从微盘删掉，三个字段清空", async () => {});
  it("同一个目录里两份资料标题一样：第二份叫「标题（2）.pdf」", async () => {});
  it("上次传完没记下来（attempts > 0，微盘里已经有同名同大小的）：认领它，不再上传", async () => {
    // 先让假微盘里有这个文件，库里 wedrive_fileid 为空、mirror_attempts = 1
    expect(await reconcile(docId)).toBe("synced");
    expect(fake.calls.filter((c) => c.api.startsWith("file_upload"))).toHaveLength(0);
  });
  it("什么都没变：unchanged，不发请求", async () => {});
  it("限额错误原样抛出，状态不在这里改", async () => {});
  it("R2 里没有这个文件：抛错，文字是「文件不在存储里」", async () => {});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/wedrive-mirror-doc.test.ts`
Expected: FAIL，找不到模块

- [ ] **Step 3: 实现。** 文件内容从 `env.FILES.get(file_key)` 取流；分块上传的 `open` 每次重新 `get` 一遍。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/api && npm test -- test/wedrive-mirror-doc.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/wedrive/mirror-doc.ts packages/api/test/wedrive-mirror-doc.test.ts
git commit -m "feat: 把一份资料对到微盘（上传、改名、移动、删除、认领）"
```

---

### Task 6: 排队、加锁、补跑、暂停

**Files:**
- Create: `packages/api/src/services/wedrive/mirror-run.ts`
- Modify: `packages/api/src/services/event-bus.ts`（事件类型加 `WAREHOUSE_DOC_MIRROR`）
- Modify: `packages/api/src/queue-handler.ts`（收到这个事件调 `runMirrorDrain`）
- Modify: `packages/api/src/scheduled.ts`（每小时那一批里调 `requeueStaleMirrors`，放在每日摘要后面、`Promise.all` 前面）
- Modify: `packages/api/src/services/doc-library/upload.ts`、`file.ts`（写库成功后 `markForMirror`）
- Test: `packages/api/test/wedrive-mirror-run.test.ts`；改 `packages/api/src/scheduled.test.ts`

**Interfaces:**
- Produces：

```ts
/** 把这些资料标成待镜像并触发一次排空。永不抛出。镜像没开时只标记不触发。 */
export const markForMirror: (env: Env, docIds: number[]) => Promise<void>;
export interface DrainResult { processed: number; failed: number; remaining: number; stopped: "done" | "budget" | "locked" | "inactive" | "paused" }
export const runMirrorDrain: (env: Env, deps?: { client?: WedriveClient; now?: () => Date; maxDocs?: number; maxBytes?: number; maxMs?: number }) => Promise<DrainResult>;
/** 定时任务用：把卡住的、失败未满 5 次的重新标成 pending，有待办就触发一次排空。永不抛出。 */
export const requeueStaleMirrors: (env: Env, now: Date) => Promise<number>;
export const MIRROR_MAX_ATTEMPTS = 5;
```

  - 锁：`system_config` 里的 `warehouse.wedrive_lock_until`（ISO 时间）。抢锁是一条带条件的写（原值为空或早于现在才写成「现在 + 10 分钟」，看影响行数）；抢不到返回 `locked`。排空中每处理完一份续一次锁，结束时清掉。
  - 排空：`mirrorActive` 为假返回 `inactive`（已初始化但暂停返回 `paused`）。按 id 从小到大取 `pending` 的，逐份：标 `syncing`、`mirror_attempts + 1`、记 `mirror_started_at` → `reconcileDoc` → 成功。普通错误：`mirror_status = 'failed'`、`mirror_error` 写前 200 个字，接着做下一份。`WedriveQuotaError`：这一份退回 `pending`（次数减回去），把 `paused_reason` 设成「本月微盘接口调用次数用完了」或企微的原话，通知超管，停下返回 `paused`。
  - 到了份数、字节数或时间的上限：返回 `budget`；`remaining > 0` 时再发一条 `WAREHOUSE_DOC_MIRROR`。
  - `markForMirror`：把这些行的 `mirror_status` 改成 `pending`、`mirror_attempts = 0`、`mirror_error = NULL`；镜像开着才 `publishEvent`。替换时新旧两份都要标。
  - `requeueStaleMirrors`：`syncing` 且 `mirror_started_at` 早于 30 分钟前的、`failed` 且 `mirror_attempts < 5` 的，改回 `pending`。
  - 通知超管：`parseRoleTagMapping(env.WECOM_ROLE_TAG_MAPPING 那个配置)` 取 `super_admin` 的标签，`listUsersInTag` 取人，发一条文本消息「微盘镜像已暂停：<原因>。到 库房 → 设置 里处理。」。实施时照 `services/wecom-role.ts` 现有的用法取配置；取不到人或发送失败只 `console.error`。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("镜像排空", () => {
  it("三份待镜像的资料：都传上去，processed 3，remaining 0", async () => {});
  it("没初始化、开关关着：inactive，不发请求；暂停中：paused", async () => {});
  it("有人持锁：locked，不动任何资料", async () => {});
  it("锁过期了（上一个被杀掉）：能抢到，接着跑", async () => {});
  it("跑完把锁清掉；中途抛了意料之外的错也清掉", async () => {});
  it("其中一份失败：记 failed 和原因，后面的照常做", async () => {});
  it("做到一半限额用完：这一份退回 pending、次数不算，设上暂停原因，通知超管一次，后面的不做", async () => {
    expect(result.stopped).toBe("paused");
    expect((await getWedriveSettings(env)).paused_reason).toContain("调用次数");
    expect(notified).toEqual([["admin1", "admin2"]]);
  });
  it("恢复之后再跑：已经 synced 的不重传，只做剩下的", async () => {});
  it("一次最多 2 份（maxDocs: 2）：返回 budget，remaining 1，又发了一条消息", async () => {});
  it("markForMirror：标成 pending 并发一条消息；镜像没开时只标不发；发消息失败不抛", async () => {});
  it("requeueStaleMirrors：卡了 31 分钟的 syncing、试过 2 次的 failed 回到 pending；试满 5 次的不动；29 分钟的不动", async () => {});
});
describe.skipIf(!hasSqlite)("资料的写操作会触发镜像", () => {
  it("上传完成：新资料是 pending，发了消息", async () => {});
  it("替换：新旧两份都被标成 pending", async () => {});
  it("改标题、删除：这份被标成 pending", async () => {});
  it("触发镜像那一步抛错：上传、改、删的接口照常成功", async () => {});
});
```

`scheduled.test.ts` 加一条：小时批次调用了 `requeueStaleMirrors`，别的任务出错时也照样调用。

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/wedrive-mirror-run.test.ts src/scheduled.test.ts`
Expected: FAIL，找不到模块

- [ ] **Step 3: 实现并接上队列、定时任务、资料的三个写操作**

- [ ] **Step 4: 运行确认通过，跑 API 全套**

Run: `cd packages/api && npm test && npm run typecheck && npm run lint`
Expected: 全部通过（资料库原有的用例一条不改就该通过：镜像没开时写操作只多改一个字段）

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/services/wedrive/mirror-run.ts packages/api/src/services/event-bus.ts packages/api/src/queue-handler.ts packages/api/src/scheduled.ts packages/api/src/scheduled.test.ts packages/api/src/services/doc-library/upload.ts packages/api/src/services/doc-library/file.ts packages/api/test/wedrive-mirror-run.test.ts
git commit -m "feat: 微盘镜像的排队、加锁、补跑和限额暂停"
```

---

### Task 7: 接口

**Files:**
- Create: `packages/api/src/routes/doc-library-wedrive.ts`
- Create: `packages/api/src/services/wedrive/admin.ts`
- Modify: `packages/api/src/index.ts`（挂在 `/api/v1/doc-library`，放在 `docLibraryRoutes` 前面）
- Modify: `packages/api/src/services/doc-library/query.ts`（列表和详情的行带上 `mirror_status`、`mirror_error`、`mirrored_at`）
- Modify: `packages/api/test/warehouse-permission-matrix.test.ts` 或新建 `packages/api/test/wedrive-routes.test.ts`
- Test: `packages/api/test/wedrive-routes.test.ts`

**Interfaces:**
- Produces（都在 `/api/v1/doc-library` 下）：

| 方法和路径 | 权限 | 做什么 |
|---|---|---|
| `GET /wedrive/status` | 库管、资料管理员、经理、超管 | `WedriveStatus` |
| `POST /wedrive/setup` | 经理、超管 | 建空间（没有成员），记下空间 ID，把镜像打开，触发一次排空 |
| `PUT /wedrive/settings` | 经理、超管 | `{ enabled?: boolean, resume?: true }`：开关镜像；`resume` 清掉暂停原因并触发排空 |
| `POST /wedrive/open` | 经理、超管 | 把空间对全公司开放（根部门只能下载）；还有没镜像完的资料时 409 |
| `POST /wedrive/retry-failed` | 经理、超管 | 把 `failed` 的全部标回 `pending`（次数清零）并触发排空 |
| `POST /file/:id/remirror` | 库管、资料管理员 | 把这一份标回 `pending` 并触发 |

```ts
export interface WedriveStatus {
  initialized: boolean; enabled: boolean; space_open: boolean; paused_reason: string | null;
  counts: { pending: number; syncing: number; synced: number; failed: number; skipped: number };
  calls_this_month: number; monthly_budget: number; mirror_max_mb: number;
}
```

  - `counts` 只数应该在微盘里的资料（没删、最新版）。
  - `setup` 已经初始化过时 409「微盘空间已经建过了」。建空间失败时把企微的错误码和原话带回去（例如没有权限时的 48002），状态码 502。
  - `open`：已经开放过 409；`counts.pending + counts.syncing > 0` 时 409「还有 N 份资料没镜像完，等它们完成再开放」。

- [ ] **Step 1: 写失败的测试**

```ts
describe.skipIf(!hasSqlite)("微盘镜像接口", () => {
  it("没初始化时的状态：initialized false，各数字是 0，待镜像的是全部最新资料的份数", async () => {});
  it("初始化：建了一个没有成员的空间「设备资料库」，镜像打开，开始排空", async () => {
    expect(fake.calls[0]).toMatchObject({ api: "space_create", body: { space_name: "设备资料库" } });
  });
  it("再初始化一次：409", async () => {});
  it("企微不让建（48002）：502，带上错误码，没记下空间 ID", async () => {});
  it("关掉镜像后上传资料：不发微盘请求；再打开：补上", async () => {});
  it("暂停后 resume：清掉原因，接着做", async () => {});
  it("对全公司开放：调了 space_acl_add（根部门、只能下载）；还有没镜像完的时 409", async () => {});
  it("重新同步一份；全部重试失败的", async () => {});
  it("权限：操作员都是 403；资料管理员能看状态、能重新同步一份，不能初始化、开关、开放；智能体身份 403", async () => {});
  it("资料列表的行里有 mirror_status", async () => {});
});
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/api && npm test -- test/wedrive-routes.test.ts`
Expected: FAIL，路径 404

- [ ] **Step 3: 实现**

- [ ] **Step 4: 运行确认通过，跑 API 全套**

Run: `cd packages/api && npm test && npm run typecheck && npm run lint`
Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add packages/api/src/routes/doc-library-wedrive.ts packages/api/src/services/wedrive/admin.ts packages/api/src/index.ts packages/api/src/services/doc-library/query.ts packages/api/test/wedrive-routes.test.ts
git commit -m "feat: 微盘镜像的接口（初始化、开关、开放、重试）"
```

---

### Task 8: Web

**Files:**
- Create: `packages/web/src/api/wh/wedrive.ts`
- Create: `packages/web/src/views/wh/settings/components/WedriveMirrorCard.vue`
- Create: `packages/web/src/views/wh/settings/wedrive-view.ts`
- Modify: `packages/web/src/views/wh/settings/index.vue`（放上这张卡片）
- Modify: `packages/web/src/api/wh/doc-library-types.ts`（`DocFileRow` 加三个镜像字段）
- Modify: `packages/web/src/views/wh/doc-library/doc-view.ts`、`components/DocTable.vue`、`index.vue`（「微盘」一列和「重新同步」）
- Test: `packages/web/src/views/wh/settings/wedrive-view.test.ts`；`doc-view.test.ts` 加用例

**Interfaces:**
- Produces（`wedrive-view.ts`，纯函数）：

```ts
/** 卡片顶上的一句话和颜色 */
export const mirrorHeadline: (status: WedriveStatus) => { text: string; type: "info" | "success" | "warning" | "danger" };
/** 现在该显示哪些按钮 */
export const mirrorActions: (status: WedriveStatus, canManage: boolean) => { setup: boolean; toggle: "on" | "off" | null; resume: boolean; open: boolean; retryFailed: boolean };
/** 资料列表里「微盘」那一列 */
export const mirrorTag: (row: Pick<DocFileRow, "mirror_status" | "mirror_error" | "is_latest">) => { text: string; type: "success" | "info" | "warning" | "danger"; tip: string } | null;
```

  - `mirrorHeadline`：没初始化「还没有建微盘空间」；暂停「已暂停：<原因>」（红）；关着「镜像已关闭」；有失败「N 份没传上去」（橙）；有待传「正在镜像，还有 N 份」；都好了「微盘和系统一致」（绿）。
  - `mirrorTag`：旧版本返回 `null`；`synced`「已同步」、`pending` 和 `syncing`「等待同步」、`failed`「没传上去」（提示里是原因）、`skipped`「不镜像」（提示里是原因）。
- 卡片上的东西：那一句话；各状态的份数；本月调用次数「已用 a / 预算 b（企业每月上限 1000 次）」；单个文件的镜像上限；按钮「初始化微盘空间」「开启 / 关闭镜像」「恢复镜像」「全部重试」「对全公司开放」。「对全公司开放」前有确认框：「开放后，全公司的人都能在企业微信的微盘里看到『设备资料库』并下载里面的文件。」

- [ ] **Step 1: 写失败的测试**（`mirrorHeadline` 的六种情况、`mirrorActions` 在没初始化、已开启、暂停、已开放、不是经理时各出哪些按钮、`mirrorTag` 的五种状态和旧版本）

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/web && npm test -- src/views/wh/settings/wedrive-view.test.ts`
Expected: FAIL，找不到模块

- [ ] **Step 3: 实现视图函数，通过后写接口封装、卡片、列表里的列**

- [ ] **Step 4: 在浏览器里看一遍。** 本地没有真微盘：起 `api` 和 `web`，确认卡片在「没初始化」状态下显示正确、点「初始化」得到后端的错误提示而不是白屏；用直接改本地库的办法造出暂停、有失败、已同步几种状态，各看一眼。资料库列表里「微盘」一列和「重新同步」只有库管和资料管理员看得到。

- [ ] **Step 5: 检查并提交**

Run: `cd packages/web && npm test && npm run typecheck && npm run build`
Expected: 通过

```bash
git add packages/web/src/api/wh/wedrive.ts packages/web/src/api/wh/doc-library-types.ts packages/web/src/views/wh/settings packages/web/src/views/wh/doc-library
git commit -m "feat: Web 上的微盘镜像设置和资料的同步状态"
```

---

### Task 9: 文档

**Files:**
- Modify: `docs/superpowers/specs/2026-11-11-warehouse-rebuild-design.md`、`doc/UI设计文档.md`、`doc/开发记录.md`（只追加）、`CLAUDE.md`

- 设计稿：8.4 按实际做法改写（Worker 里做、两段式开放、调用预算、镜像上限）；第 17 节第 16 条改掉；第 21 节加「阶段 4B」（状态、本计划开头的 12 条加执行时的 Ruling），并把阶段 5 的状态改成已上线（PR #30，`30b14f08`，迁移 0098，API `4664e8be`）。
- UI 文档：库房设置页的「微盘镜像」卡片；资料库列表的「微盘」列。
- 开发记录：追加一条，先补记阶段 5 上线，再写 4B 的内容、验证、没验证的（真微盘上的行为都没验证：单块的分块上传、改名、移动、把部门加为成员、直传会不会推卡片）、上线顺序。
- `CLAUDE.md`：Backend 里加一句镜像在 `services/wedrive/`，所有微盘调用走 `WedriveClient`，每月 1000 次上限。

- [ ] **Step 1: 写文档** - [ ] **Step 2: 提交** `git commit -m "docs: 库房阶段 4B 的设计记录、页面说明和开发记录"`

---

### Task 10: 上线（每一步需要 owner）

整分支审查和修复做完之后，停下来问 owner。

- [ ] **Step 1: 推分支、开 PR。** 说明里写清楚：有迁移 0099；合并后镜像是关的，线上没有可见变化，直到有人点「初始化微盘空间」。
- [ ] **Step 2: 跑生产迁移 0099**（先 `migrations list` 确认只有这一条），合并，健康检查。
- [ ] **Step 3: 第一次真跑，一步一看。** owner 或经理在「库房 → 设置」点「初始化微盘空间」。看：空间建出来了没有；先只有一两份资料时，它们有没有出现在对的目录里、能不能打开；调用次数涨了多少。这一步会第一次在真微盘上用到单块的分块上传（如果空间已开放）、建多层目录。**哪一步的行为和假微盘不一样，停下来改，不要硬跑完 150 份。**
- [ ] **Step 4: 导入现有资料**（4A 的「按文件夹导入」），等镜像跑完，在企业微信的微盘里抽查几份。
- [ ] **Step 5: 对全公司开放。** 之后传一份新资料，确认没有人收到卡片；改一份的标题、删一份，确认微盘里跟着变。
