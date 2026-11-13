import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSystemConfig } from "../src/services/system-config";
import { createWedriveClient, WedriveError } from "../src/services/wedrive/client";
import {
  markForMirror,
  MIRROR_MAX_ATTEMPTS,
  requeueStaleMirrors,
  runMirrorDrain
} from "../src/services/wedrive/mirror-run";
import { getWedriveSettings, saveWedriveSetting } from "../src/services/wedrive/settings";
import { createFakeWedrive } from "./helpers/fake-wedrive";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 镜像的排队和排空：一次只有一个在跑、限额用完就停、被杀掉之后能接着跑、不会传出两份。

const MiB = 1024 * 1024;
const MINUTE = 60_000;
const START = Date.parse("2026-11-12T03:00:00.000Z");

describe.skipIf(!hasSqlite)("镜像排空", () => {
  let h;
  let fake;
  let client;
  let clock;
  let notified;

  const now = () => new Date(clock);
  const notify = async (reason) => {
    notified.push(reason);
  };
  const makeClient = (budget = 900, call = fake.call) =>
    createWedriveClient(h.env, { call, now, budget });
  const drain = (deps = {}) => runMirrorDrain(h.env, { client, now, notify, ...deps });
  const row = (id) => h.database.prepare("SELECT * FROM doc_file WHERE id = ?").get(id);
  const statuses = (ids) => ids.map((id) => row(id).mirror_status);
  const seedDocs = (count, overrides = {}) =>
    Array.from({ length: count }, (_, index) =>
      h.seed.docFile({ title: `资料${index + 1}`, file_name: `f${index + 1}.pdf`, ...overrides })
    );
  const uploads = () => fake.calls.filter((call) => call.api.startsWith("file_upload"));
  const mirrorMessages = () => h.queued.filter((event) => event.type === "WAREHOUSE_DOC_MIRROR");
  const setRow = (id, patch) => {
    const keys = Object.keys(patch);
    h.database
      .prepare(`UPDATE doc_file SET ${keys.map((key) => `${key} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((key) => patch[key]), id);
  };
  /** 一个会卡在指定接口上的客户端：假微盘那边已经处理了，回复要等 release() 才回来 */
  const stallingClient = (api) => {
    let release = () => {};
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const stalled = makeClient(900, async (apiName, body) => {
      const reply = await fake.call(apiName, body);
      if (apiName === api) await gate;
      return reply;
    });
    return { stalled, release };
  };
  /** 把失败的标回待镜像（模拟整点补跑） */
  const saveFailedBackToPending = () => requeueStaleMirrors(h.env, now());
  /** 先补跑一次再排空用：返回空对象，只是为了写在一行里 */
  const requeued = () => {
    h.database
      .prepare("UPDATE doc_file SET mirror_status = 'pending' WHERE mirror_status = 'failed'")
      .run();
    return {};
  };
  /** 一份已经好好地在微盘里的资料该有的样子 */
  const inWedrive = {
    mirror_status: "synced",
    wedrive_fileid: "f.somewhere",
    wedrive_name: "x.pdf",
    wedrive_folder_key: "general",
    mirrored_at: "2099-01-01T00:00:00.000Z"
  };
  const waitForSyncing = (id) =>
    vi.waitFor(() => expect(row(id).mirror_status).toBe("syncing"), { timeout: 2000 });

  beforeEach(async () => {
    h = createWarehouseHarness();
    fake = createFakeWedrive();
    clock = START;
    notified = [];
    client = makeClient();
    const spaceId = await client.createSpace("设备资料库");
    await saveWedriveSetting(h.env, { space_id: spaceId, enabled: true }, "test");
  });

  it("三份待镜像的资料：都传上去，processed 3，remaining 0", async () => {
    const ids = seedDocs(3);
    expect(await drain()).toEqual({ processed: 3, failed: 0, remaining: 0, stopped: "done" });
    expect(statuses(ids)).toEqual(["synced", "synced", "synced"]);
    expect(fake.tree()).toEqual({ 通用: { "资料1.pdf": 10, "资料2.pdf": 10, "资料3.pdf": 10 } });
    expect(ids.map((id) => row(id).mirror_attempts)).toEqual([1, 1, 1]);
  });

  it("没初始化、开关关着：inactive，不发请求；暂停中：paused", async () => {
    const ids = seedDocs(2);
    const before = fake.calls.length;
    await saveWedriveSetting(h.env, { enabled: false }, "test");
    expect(await drain()).toEqual({ processed: 0, failed: 0, remaining: 2, stopped: "inactive" });
    await saveWedriveSetting(h.env, { enabled: true, paused_reason: "手动暂停" }, "test");
    expect(await drain()).toMatchObject({ processed: 0, stopped: "paused" });
    await saveWedriveSetting(h.env, { space_id: null, paused_reason: null }, "test");
    expect(await drain()).toMatchObject({ processed: 0, stopped: "inactive" });
    expect(fake.calls.length).toBe(before);
    expect(statuses(ids)).toEqual(["pending", "pending"]);
  });

  it("有人持锁：locked，不动任何资料；先跑的那个照常做完", async () => {
    const ids = seedDocs(2);
    const { stalled, release } = stallingClient("file_upload");
    const first = drain({ client: stalled });
    await waitForSyncing(ids[0]);
    expect(await drain()).toEqual({ processed: 0, failed: 0, remaining: 1, stopped: "locked" });
    expect(statuses(ids)).toEqual(["syncing", "pending"]);
    release();
    expect(await first).toMatchObject({ processed: 2, stopped: "done" });
    expect(statuses(ids)).toEqual(["synced", "synced"]);
  });

  it("锁过期了（上一个被杀掉）：能抢到，接着跑", async () => {
    const ids = seedDocs(2);
    // 第一个卡死在第一份上，再也不回来
    void drain({ client: stallingClient("file_upload").stalled });
    await waitForSyncing(ids[0]);
    clock += 15 * MINUTE;
    expect(await drain()).toMatchObject({ stopped: "locked" });
    clock += 2 * MINUTE;
    expect(await drain()).toMatchObject({ processed: 1, stopped: "done" });
    expect(statuses(ids)).toEqual(["syncing", "synced"]);
  });

  it("慢的那个回来时锁已经是别人的：做完手上这一份就停，不清别人的锁", async () => {
    const ids = seedDocs(3);
    const slow = stallingClient("file_upload");
    const first = drain({ client: slow.stalled });
    await waitForSyncing(ids[0]);
    clock += 17 * MINUTE;
    // 第二个抢到了锁，卡在第二份上
    const other = stallingClient("file_upload");
    const second = drain({ client: other.stalled });
    await waitForSyncing(ids[1]);
    slow.release();
    expect(await first).toMatchObject({ processed: 1, stopped: "locked" });
    // 锁还在第二个手里
    expect(await drain()).toMatchObject({ stopped: "locked" });
    other.release();
    expect(await second).toMatchObject({ processed: 2, stopped: "done" });
    expect(statuses(ids)).toEqual(["synced", "synced", "synced"]);
  });

  it("跑完把锁清掉；中途抛了意料之外的错也清掉", async () => {
    const ids = seedDocs(2);
    let seen = 0;
    h.hooks.beforeStatement = ({ sql }) => {
      if (!sql.includes("mirror_status = 'pending'") || !sql.includes("ORDER BY")) return;
      seen += 1;
      if (seen === 2) throw new Error("D1 掉线");
    };
    await expect(drain()).rejects.toThrow("D1 掉线");
    h.hooks.beforeStatement = undefined;
    expect(await drain()).toMatchObject({ processed: 1, stopped: "done" });
    expect(await drain()).toMatchObject({ processed: 0, stopped: "done" });
    expect(statuses(ids)).toEqual(["synced", "synced"]);
  });

  it("其中一份失败：记 failed 和原因，后面的照常做", async () => {
    const ids = seedDocs(3);
    h.files.objects.delete(row(ids[1]).file_key);
    expect(await drain()).toEqual({ processed: 2, failed: 1, remaining: 0, stopped: "done" });
    expect(statuses(ids)).toEqual(["synced", "failed", "synced"]);
    expect(row(ids[1])).toMatchObject({ mirror_error: "文件不在存储里", mirror_attempts: 1 });
  });

  it("连着三份因为同一个原因失败（微盘那头连不上）：这一趟停下，剩下的不动，也不再发消息", async () => {
    const ids = seedDocs(6);
    const down = makeClient(900, async () => {
      throw new Error("bridge proxy timeout");
    });
    expect(await drain({ client: down })).toEqual({
      processed: 0,
      failed: 3,
      remaining: 3,
      stopped: "failing"
    });
    expect(statuses(ids)).toEqual(["failed", "failed", "failed", "pending", "pending", "pending"]);
    expect(mirrorMessages()).toHaveLength(0);
    // 好了之后：剩下的照常做（失败的那三份等整点补跑）
    expect(await drain()).toMatchObject({ processed: 3, stopped: "done" });
  });

  it("失败的中间隔着成功的：不算连着，照常做完", async () => {
    const ids = seedDocs(5);
    for (const index of [1, 2, 4]) h.files.objects.delete(row(ids[index]).file_key);
    expect(await drain()).toEqual({ processed: 2, failed: 3, remaining: 0, stopped: "done" });
    expect(statuses(ids)).toEqual(["synced", "failed", "failed", "synced", "failed"]);
  });

  it("连着三份失败但企微给的错误码各不相同：不算同一个原因，不停", async () => {
    const ids = seedDocs(4);
    let n = 0;
    const reject = (apiName) => {
      throw new WedriveError(apiName, 640100 + n, `第 ${n} 种毛病`);
    };
    const flaky = {
      ...client,
      uploadDirect: async (...args) => {
        n += 1;
        if (n <= 3) reject("file_upload");
        return client.uploadDirect(...args);
      },
      // 直传被拒会改用分块：让分块也被同一个错误码拒掉
      uploadChunked: async (...args) => {
        if (n <= 3) reject("file_upload_init");
        return client.uploadChunked(...args);
      }
    };
    expect(await drain({ client: flaky })).toMatchObject({
      processed: 1,
      failed: 3,
      stopped: "done"
    });
    expect(statuses(ids)).toEqual(["failed", "failed", "failed", "synced"]);
  });

  it("企微每次回的原话都不一样（带着不同的 hint），错误码一样：照样算同一个原因，停下", async () => {
    const ids = seedDocs(6);
    fake.failNext("file_create", 60020, 10);
    expect(await drain()).toEqual({ processed: 0, failed: 3, remaining: 3, stopped: "failing" });
    expect(new Set(ids.slice(0, 3).map((id) => row(id).mirror_error)).size).toBe(3);
  });

  it("没有错误码的失败（超时、连不上）原话不一样也算同一个原因", async () => {
    seedDocs(6);
    const texts = ["bridge proxy timeout", "Bridge proxy failed: 504", "fetch failed"];
    let n = 0;
    const down = makeClient(900, async () => {
      n += 1;
      throw new Error(texts[n % 3]);
    });
    expect(await drain({ client: down })).toMatchObject({ failed: 3, stopped: "failing" });
  });

  it("资料自己的毛病（存储里没有这个文件）连着几份也不算微盘出了问题：不停", async () => {
    const ids = seedDocs(5);
    for (const id of ids.slice(0, 4)) h.files.objects.delete(row(id).file_key);
    expect(await drain()).toEqual({ processed: 1, failed: 4, remaining: 0, stopped: "done" });
  });

  it("连着三趟都因为同一个原因停下：暂停，通知超管一次，写上原因；之后一个请求都不发", async () => {
    seedDocs(9);
    const down = makeClient(900, async () => {
      throw new Error("bridge proxy timeout");
    });
    expect((await drain({ client: down })).stopped).toBe("failing");
    expect((await drain({ client: down })).stopped).toBe("failing");
    expect(notified).toEqual([]);
    expect(await drain({ client: down })).toMatchObject({ failed: 3, stopped: "paused" });
    const reason = (await getWedriveSettings(h.env)).paused_reason;
    expect(reason).toContain("连着 3 趟");
    expect(reason).toContain("bridge proxy timeout");
    expect(notified).toEqual([reason]);
    const before = fake.calls.length;
    expect((await drain()).stopped).toBe("paused");
    expect(fake.calls.length).toBe(before);
  });

  it("中间有一趟做成了：从头数，不暂停", async () => {
    seedDocs(3);
    const down = makeClient(900, async () => {
      throw new Error("bridge proxy timeout");
    });
    expect((await drain({ client: down })).stopped).toBe("failing");
    expect((await drain({ client: down, ...requeued() })).stopped).toBe("failing");
    // 好了一阵：做成一份
    seedDocs(1, { title: "新来的" });
    await saveFailedBackToPending();
    expect(await drain()).toMatchObject({ processed: 4, stopped: "done" });
    expect(await getSystemConfig(h.env, "warehouse.wedrive_trip_count")).toBeNull();
    // 又坏了：从 1 数起，两趟还不到暂停
    seedDocs(6, { title: "后来的" });
    expect((await drain({ client: down })).stopped).toBe("failing");
    expect((await drain({ client: down })).stopped).toBe("failing");
    expect((await getWedriveSettings(h.env)).paused_reason).toBeNull();
  });

  it("做到一半镜像被关掉：手上这一份做完就停，不再开始下一份，也不再发消息", async () => {
    const ids = seedDocs(4);
    let uploads = 0;
    const closing = makeClient(900, async (apiName, body) => {
      const reply = await fake.call(apiName, body);
      if (apiName === "file_upload") {
        uploads += 1;
        if (uploads === 1) await saveWedriveSetting(h.env, { enabled: false }, "boss");
      }
      return reply;
    });
    expect(await drain({ client: closing })).toEqual({
      processed: 1,
      failed: 0,
      remaining: 3,
      stopped: "inactive"
    });
    expect(statuses(ids)).toEqual(["synced", "pending", "pending", "pending"]);
    expect(mirrorMessages()).toHaveLength(0);
  });

  it("做到一半被人暂停：同样停下", async () => {
    seedDocs(3);
    let uploads = 0;
    const pausing = makeClient(900, async (apiName, body) => {
      const reply = await fake.call(apiName, body);
      if (apiName === "file_upload") {
        uploads += 1;
        if (uploads === 1) await saveWedriveSetting(h.env, { paused_reason: "先停一下" }, "boss");
      }
      return reply;
    });
    expect(await drain({ client: pausing })).toMatchObject({
      processed: 1,
      remaining: 2,
      stopped: "paused"
    });
  });

  it("先删后传：该从微盘删掉的排在要传的前面，新的那份不会被加上（2）", async () => {
    const [old] = seedDocs(1, { title: "合格证" });
    await drain();
    const fresh = h.seed.docFile({ title: "合格证", file_name: "新.pdf", supersedes_id: old });
    // 新的那份没试过、旧的试过一次：光按次数排的话会先传新的
    setRow(old, { mirror_status: "pending" });
    expect(await drain()).toMatchObject({ processed: 2, stopped: "done" });
    expect(row(fresh).wedrive_name).toBe("合格证.pdf");
    expect(fake.tree()).toEqual({ 通用: { "合格证.pdf": 10 } });
  });

  it("先做没试过的，试过的排在后面", async () => {
    const ids = seedDocs(3);
    setRow(ids[0], { mirror_attempts: 2 });
    expect(await drain({ maxDocs: 2 })).toMatchObject({ processed: 2, remaining: 1 });
    expect(statuses(ids)).toEqual(["pending", "synced", "synced"]);
  });

  it("失败原因太长时只留前 200 个字", async () => {
    const [id] = seedDocs(1);
    const broken = {
      ...client,
      createFolder: async () => {
        throw new Error("错".repeat(500));
      }
    };
    await drain({ client: broken });
    expect(row(id).mirror_error).toBe("错".repeat(200));
  });

  it("做到一半预算用完：这一份退回 pending、次数不算，设上暂停原因，通知超管一次，后面的不做", async () => {
    const ids = seedDocs(4);
    // 建空间 1 次 + 建目录 1 次 + 两份直传 2 次 = 4 次
    client = makeClient(4);
    const result = await drain();
    expect(result).toEqual({ processed: 2, failed: 0, remaining: 2, stopped: "paused" });
    expect(statuses(ids)).toEqual(["synced", "synced", "pending", "pending"]);
    expect(row(ids[2])).toMatchObject({ mirror_attempts: 0, mirror_error: null });
    const reason = (await getWedriveSettings(h.env)).paused_reason;
    expect(reason).toContain("调用次数");
    expect(notified).toEqual([reason]);
    // 暂停之后再来的触发：一个请求都不发，也不再通知
    const before = fake.calls.length;
    expect(await drain()).toMatchObject({ processed: 0, stopped: "paused" });
    expect(fake.calls.length).toBe(before);
    expect(notified).toHaveLength(1);
  });

  it.each([640019, 640035])("企微返回 %i：一样暂停并通知", async (errcode) => {
    const ids = seedDocs(2);
    fake.failNext("file_upload", errcode);
    expect(await drain()).toMatchObject({ processed: 0, remaining: 2, stopped: "paused" });
    expect(statuses(ids)).toEqual(["pending", "pending"]);
    expect((await getWedriveSettings(h.env)).paused_reason).toContain(String(errcode));
    expect((await getWedriveSettings(h.env)).paused_reason).toContain("调用次数");
    expect(notified).toHaveLength(1);
  });

  it("通知发不出去：照样暂停，不抛", async () => {
    seedDocs(1);
    fake.failNext("file_upload", 640019);
    const result = await drain({
      notify: async () => {
        throw new Error("企微挂了");
      }
    });
    expect(result.stopped).toBe("paused");
  });

  it("恢复之后再跑：已经 synced 的不重传，只做剩下的", async () => {
    const ids = seedDocs(4);
    client = makeClient(4);
    await drain();
    expect(uploads()).toHaveLength(2);
    await saveWedriveSetting(h.env, { paused_reason: null }, "liu");
    client = makeClient(900);
    expect(await drain()).toEqual({ processed: 2, failed: 0, remaining: 0, stopped: "done" });
    expect(uploads()).toHaveLength(4);
    expect(statuses(ids)).toEqual(["synced", "synced", "synced", "synced"]);
  });

  it("一次最多 2 份（maxDocs: 2）：返回 budget，remaining 1，又发了一条消息", async () => {
    const ids = seedDocs(3);
    expect(await drain({ maxDocs: 2 })).toEqual({
      processed: 2,
      failed: 0,
      remaining: 1,
      stopped: "budget"
    });
    expect(statuses(ids)).toEqual(["synced", "synced", "pending"]);
    expect(mirrorMessages()).toHaveLength(1);
  });

  it("字节数到了上限（maxBytes）：停下，剩下的下一趟做", async () => {
    seedDocs(3, { file_size: 3 * MiB });
    expect(await drain({ maxBytes: 5 * MiB })).toMatchObject({
      processed: 2,
      remaining: 1,
      stopped: "budget"
    });
    expect(mirrorMessages()).toHaveLength(1);
  });

  it("时间到了上限（maxMs）：停下，剩下的下一趟做", async () => {
    seedDocs(3);
    const slow = makeClient(900, async (apiName, body) => {
      clock += MINUTE;
      return fake.call(apiName, body);
    });
    // 第一份：建目录 + 直传 = 2 分钟；第二份 1 分钟，到 3 分钟时停
    expect(await drain({ client: slow, maxMs: 3 * MINUTE })).toMatchObject({
      processed: 2,
      remaining: 1,
      stopped: "budget"
    });
  });

  it("正好做完、没有剩的：不再发消息", async () => {
    seedDocs(2);
    expect(await drain({ maxDocs: 2 })).toMatchObject({ processed: 2, remaining: 0 });
    expect(mirrorMessages()).toHaveLength(0);
  });

  it("同步的时候这份资料又被改了：不会被标成 synced，接着再对一遍把名字改过来", async () => {
    const [id] = seedDocs(1);
    const { stalled, release } = stallingClient("file_upload");
    const running = drain({ client: stalled });
    await vi.waitFor(() => expect(fake.callsTo("file_upload")).toHaveLength(1), { timeout: 2000 });
    setRow(id, { title: "新标题" });
    await markForMirror(h.env, [id]);
    release();
    expect(await running).toMatchObject({ processed: 2, stopped: "done" });
    expect(row(id)).toMatchObject({ mirror_status: "synced", wedrive_name: "新标题.pdf" });
    expect(fake.tree()).toEqual({ 通用: { "新标题.pdf": 10 } });
    expect(uploads()).toHaveLength(1);
  });

  it("文件已经传上去、还没记下来就被杀掉：补跑时认领，微盘里只有一份", async () => {
    const [id] = seedDocs(1);
    void drain({ client: stallingClient("file_upload").stalled });
    await vi.waitFor(() => expect(fake.callsTo("file_upload")).toHaveLength(1), { timeout: 2000 });
    expect(row(id)).toMatchObject({ mirror_status: "syncing", wedrive_fileid: null });
    clock += 31 * MINUTE;
    expect(await requeueStaleMirrors(h.env, now())).toBe(1);
    expect(await drain()).toMatchObject({ processed: 1, stopped: "done" });
    expect(fake.tree()).toEqual({ 通用: { "资料1.pdf": 10 } });
    expect(uploads()).toHaveLength(1);
    expect(fake.nodes.has(row(id).wedrive_fileid)).toBe(true);
  });

  it("同上，但中间有人改了这份资料（次数被清零）：照样认领，不传第二份", async () => {
    const [id] = seedDocs(1);
    void drain({ client: stallingClient("file_upload").stalled });
    await vi.waitFor(() => expect(fake.callsTo("file_upload")).toHaveLength(1), { timeout: 2000 });
    setRow(id, { title: "改过的标题" });
    await markForMirror(h.env, [id]);
    clock += 17 * MINUTE;
    expect(await drain()).toMatchObject({ processed: 1, stopped: "done" });
    expect(fake.tree()).toEqual({ 通用: { "改过的标题.pdf": 10 } });
    expect(uploads()).toHaveLength(1);
  });

  describe("markForMirror", () => {
    it("标成 pending、次数清零、原因清掉，并发一条消息", async () => {
      const [a, b] = seedDocs(2);
      setRow(a, { mirror_status: "failed", mirror_attempts: 3, mirror_error: "超时" });
      setRow(b, { mirror_status: "synced", mirror_attempts: 1 });
      await markForMirror(h.env, [a, b]);
      for (const id of [a, b]) {
        expect(row(id)).toMatchObject({
          mirror_status: "pending",
          mirror_attempts: 0,
          mirror_error: null
        });
      }
      expect(mirrorMessages()).toHaveLength(1);
    });

    it("镜像没开或暂停中：只标不发", async () => {
      const [id] = seedDocs(1);
      setRow(id, { mirror_status: "synced" });
      await saveWedriveSetting(h.env, { paused_reason: "手动暂停" }, "test");
      await markForMirror(h.env, [id]);
      expect(row(id).mirror_status).toBe("pending");
      expect(mirrorMessages()).toHaveLength(0);
    });

    it("没有要标的：什么都不做", async () => {
      await markForMirror(h.env, []);
      expect(mirrorMessages()).toHaveLength(0);
    });

    it("写库出错、发消息出错都不抛", async () => {
      const [id] = seedDocs(1);
      h.env.EVENT_QUEUE.send = async () => {
        throw new Error("队列挂了");
      };
      await expect(markForMirror(h.env, [id])).resolves.toBeUndefined();
      h.hooks.beforeStatement = () => {
        throw new Error("D1 掉线");
      };
      await expect(markForMirror(h.env, [id])).resolves.toBeUndefined();
    });
  });

  describe("requeueStaleMirrors", () => {
    const minutesAgo = (minutes) => new Date(clock - minutes * MINUTE).toISOString();

    it("卡了 31 分钟的 syncing、试过 2 次的 failed 回到 pending；试满 5 次的不动；29 分钟的不动", async () => {
      const [stuck, fresh, failedTwice, failedOut, done] = seedDocs(5);
      setRow(stuck, { mirror_status: "syncing", mirror_started_at: minutesAgo(31) });
      setRow(fresh, { mirror_status: "syncing", mirror_started_at: minutesAgo(29) });
      setRow(failedTwice, { mirror_status: "failed", mirror_attempts: 2, mirror_error: "超时" });
      setRow(failedOut, {
        mirror_status: "failed",
        mirror_attempts: MIRROR_MAX_ATTEMPTS,
        mirror_error: "超时"
      });
      setRow(done, inWedrive);
      expect(await requeueStaleMirrors(h.env, now())).toBe(2);
      expect(statuses([stuck, fresh, failedTwice, failedOut, done])).toEqual([
        "pending",
        "syncing",
        "pending",
        "failed",
        "synced"
      ]);
      // 次数留着：再失败几次就到 5 次了
      expect(row(failedTwice).mirror_attempts).toBe(2);
      expect(mirrorMessages()).toHaveLength(1);
    });

    it("没有待办：不发消息；本来就有 pending 的：发一条", async () => {
      const [id] = seedDocs(1);
      setRow(id, inWedrive);
      expect(await requeueStaleMirrors(h.env, now())).toBe(0);
      expect(mirrorMessages()).toHaveLength(0);
      setRow(id, { mirror_status: "pending" });
      expect(await requeueStaleMirrors(h.env, now())).toBe(0);
      expect(mirrorMessages()).toHaveLength(1);
    });

    it("镜像没开：照样把卡住的标回来，但不发消息", async () => {
      const [id] = seedDocs(1);
      setRow(id, { mirror_status: "syncing", mirror_started_at: minutesAgo(40) });
      await saveWedriveSetting(h.env, { enabled: false }, "test");
      expect(await requeueStaleMirrors(h.env, now())).toBe(1);
      expect(mirrorMessages()).toHaveLength(0);
    });

    it("同步中断满 5 次的不再重来：记成 failed，写明原因", async () => {
      const [dead, alive] = seedDocs(2);
      setRow(dead, {
        mirror_status: "syncing",
        mirror_attempts: MIRROR_MAX_ATTEMPTS,
        mirror_started_at: minutesAgo(31)
      });
      setRow(alive, {
        mirror_status: "syncing",
        mirror_attempts: MIRROR_MAX_ATTEMPTS - 1,
        mirror_started_at: minutesAgo(31)
      });
      expect(await requeueStaleMirrors(h.env, now())).toBe(1);
      expect(statuses([dead, alive])).toEqual(["failed", "pending"]);
      expect(row(dead).mirror_error).toContain("中断");
    });

    it("对一遍账：写着已同步、其实该删的（删除或被替换的时候没标上）补标成 pending", async () => {
      const [deleted, old, fine] = seedDocs(3);
      setRow(deleted, { ...inWedrive, deleted_at: "2026-11-12T01:00:00.000Z" });
      setRow(old, inWedrive);
      h.seed.docFile({ title: "新版", supersedes_id: old, ...inWedrive });
      setRow(fine, inWedrive);
      expect(await requeueStaleMirrors(h.env, now())).toBe(2);
      expect(statuses([deleted, old, fine])).toEqual(["pending", "pending", "synced"]);
      expect(mirrorMessages()).toHaveLength(1);
    });

    it("对一遍账：写着已同步、该在微盘里却没有文件的（新版被删、上一版又成了最新）补标成 pending", async () => {
      const [restored, gone] = seedDocs(2);
      setRow(restored, { mirror_status: "synced", mirrored_at: "2099-01-01T00:00:00.000Z" });
      // 已删除、微盘里也没有了：这是一致的，不动
      setRow(gone, {
        mirror_status: "synced",
        mirrored_at: "2099-01-01T00:00:00.000Z",
        deleted_at: "2026-11-12T01:00:00.000Z"
      });
      expect(await requeueStaleMirrors(h.env, now())).toBe(1);
      expect(statuses([restored, gone])).toEqual(["pending", "synced"]);
    });

    it("对一遍账：同步之后又改过（改的时候没标上）补标成 pending", async () => {
      const [edited] = seedDocs(1);
      setRow(edited, {
        ...inWedrive,
        mirrored_at: "2026-11-12T01:00:00.000Z",
        updated_at: "2026-11-12T02:00:00.000Z"
      });
      expect(await requeueStaleMirrors(h.env, now())).toBe(1);
      expect(statuses([edited])).toEqual(["pending"]);
    });

    it("出错不抛，返回 0", async () => {
      h.hooks.beforeStatement = () => {
        throw new Error("D1 掉线");
      };
      expect(await requeueStaleMirrors(h.env, now())).toBe(0);
    });
  });
});
