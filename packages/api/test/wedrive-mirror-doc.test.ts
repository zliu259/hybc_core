import { beforeEach, describe, expect, it } from "vitest";

import { createWedriveClient, WedriveQuotaError } from "../src/services/wedrive/client";
import { reconcileDoc, wedriveFileName } from "../src/services/wedrive/mirror-doc";
import { createFakeWedrive } from "./helpers/fake-wedrive";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 把一份资料在微盘里的样子对到应该的样子：该在哪个目录、叫什么名字、该不该在。

const MiB = 1024 * 1024;

describe("wedriveFileName", () => {
  it("标题加原文件的扩展名；标题里已经带了扩展名就不重复加", () => {
    expect(wedriveFileName("出厂合格证", "IMG_0023.PDF")).toBe("出厂合格证.pdf");
    expect(wedriveFileName("出厂合格证.pdf", "a.pdf")).toBe("出厂合格证.pdf");
    expect(wedriveFileName("没有扩展名的", "README")).toBe("没有扩展名的");
  });

  it("标题里不能用的字符被换掉", () => {
    expect(wedriveFileName("DN1200/1500 说明书", "x.docx")).toBe("DN1200／1500 说明书.docx");
  });
});

describe.skipIf(!hasSqlite)("对一份资料做镜像", () => {
  let h;
  let fake;
  let client;
  let settings;
  let categoryId;
  let deviceId;

  const row = (id) => h.database.prepare("SELECT * FROM doc_file WHERE id = ?").get(id);
  /** 调用方（排空）的约定：先把这一行标成 syncing 再调 reconcileDoc */
  const reconcile = (id, patch = {}) => {
    h.database.prepare("UPDATE doc_file SET mirror_status = 'syncing' WHERE id = ?").run(id);
    return reconcileDoc(h.env, client, { ...settings, ...patch }, id);
  };
  const uploadCalls = () => fake.calls.filter((call) => call.api.startsWith("file_upload"));
  const seedDoc = (overrides = {}) =>
    h.seed.docFile({
      title: "出厂合格证",
      file_name: "合格证.pdf",
      doc_category: "cert",
      device_id: deviceId,
      ...overrides
    });
  /** 模拟「上次已经开始传了、没记下文件 ID」：库里只留着打算放哪、叫什么 */
  const markUploadStarted = (id, name = "出厂合格证.pdf") =>
    h.database
      .prepare("UPDATE doc_file SET wedrive_name = ?, wedrive_folder_key = ? WHERE id = ?")
      .run(name, `device:${deviceId}`, id);
  const deviceFolderId = () =>
    h.database
      .prepare("SELECT fileid FROM wedrive_folder WHERE folder_key = ?")
      .get(`device:${deviceId}`).fileid;

  beforeEach(async () => {
    h = createWarehouseHarness();
    fake = createFakeWedrive();
    client = createWedriveClient(h.env, { call: fake.call, budget: 900 });
    const spaceId = await client.createSpace("设备资料库");
    settings = {
      space_id: spaceId,
      enabled: true,
      space_open: false,
      paused_reason: null,
      mirror_max_bytes: 100 * MiB,
      monthly_budget: 900
    };
    categoryId = h.seed.category("顶管机");
    deviceId = h.seed.device({
      device_code: "SB-0003",
      name: "唐兴 NSPD1200",
      category_id: categoryId
    });
  });

  it("新资料：建目录、上传，记下文件 ID、名字、目录，状态 synced", async () => {
    const id = seedDoc();
    expect(await reconcile(id)).toBe("synced");
    expect(fake.tree()).toEqual({ 顶管机: { "SB-0003 唐兴 NSPD1200": { "出厂合格证.pdf": 10 } } });
    const saved = row(id);
    expect(saved).toMatchObject({
      mirror_status: "synced",
      mirror_error: null,
      wedrive_name: "出厂合格证.pdf",
      wedrive_folder_key: `device:${deviceId}`
    });
    expect(fake.nodes.get(saved.wedrive_fileid).file_name).toBe("出厂合格证.pdf");
    expect(saved.mirrored_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("没开放时小文件用直传（1 次调用）；开放后同样的文件走分块（3 次）并且不产生卡片", async () => {
    const first = seedDoc({ title: "A" });
    await reconcile(first);
    expect(uploadCalls().map((call) => call.api)).toEqual(["file_upload"]);
    const cardsBefore = fake.cards.length;

    const second = seedDoc({ title: "B" });
    await reconcile(second, { space_open: true });
    expect(uploadCalls().map((call) => call.api)).toEqual([
      "file_upload",
      "file_upload_init",
      "file_upload_part",
      "file_upload_finish"
    ]);
    expect(fake.cards.length).toBe(cardsBefore);
  });

  it("超过 7 MiB 的走分块；假微盘核对了摘要", async () => {
    const id = seedDoc({ title: "说明书", file_name: "说明书.pdf", file_size: 8 * MiB });
    expect(await reconcile(id)).toBe("synced");
    expect(fake.callsTo("file_upload")).toHaveLength(0);
    expect(fake.callsTo("file_upload_part")).toHaveLength(4);
    expect(fake.nodes.get(row(id).wedrive_fileid).file_size).toBe(8 * MiB);
  });

  it("直传超时：先看微盘里有没有，没有就改用分块传成", async () => {
    const id = seedDoc();
    fake.failNext("file_upload", "timeout");
    expect(await reconcile(id)).toBe("synced");
    expect(fake.callsTo("file_list")).toHaveLength(1);
    expect(fake.callsTo("file_upload_finish")).toHaveLength(1);
    expect(Object.keys(fake.tree()["顶管机"]["SB-0003 唐兴 NSPD1200"])).toEqual(["出厂合格证.pdf"]);
  });

  it("直传被企微拒绝（不是超时）：直接改用分块，不用先列目录", async () => {
    const id = seedDoc();
    fake.failNext("file_upload", 640047);
    expect(await reconcile(id)).toBe("synced");
    expect(fake.callsTo("file_list")).toHaveLength(0);
    expect(fake.callsTo("file_upload_finish")).toHaveLength(1);
  });

  it("超过镜像上限：skipped，写明原因，一个微盘请求都没发", async () => {
    const id = seedDoc({ file_size: 2 * MiB });
    const before = fake.calls.length;
    expect(await reconcile(id, { mirror_max_bytes: MiB })).toBe("skipped");
    expect(row(id)).toMatchObject({
      mirror_status: "skipped",
      mirror_error: "超过镜像大小上限",
      wedrive_fileid: null
    });
    expect(fake.calls.length).toBe(before);
  });

  it("改了标题：微盘里改名，不重传", async () => {
    const id = seedDoc();
    await reconcile(id);
    const uploads = uploadCalls().length;
    h.database
      .prepare("UPDATE doc_file SET title = '出厂合格证（2026 复检）' WHERE id = ?")
      .run(id);
    expect(await reconcile(id)).toBe("synced");
    expect(uploadCalls().length).toBe(uploads);
    expect(fake.callsTo("file_rename")).toHaveLength(1);
    expect(Object.keys(fake.tree()["顶管机"]["SB-0003 唐兴 NSPD1200"])).toEqual([
      "出厂合格证（2026 复检）.pdf"
    ]);
    expect(row(id).wedrive_name).toBe("出厂合格证（2026 复检）.pdf");
  });

  it("换了归属：微盘里移到新目录", async () => {
    const id = seedDoc();
    await reconcile(id);
    h.database
      .prepare("UPDATE doc_file SET device_id = NULL, device_category_id = ? WHERE id = ?")
      .run(categoryId, id);
    expect(await reconcile(id)).toBe("synced");
    expect(fake.tree()).toEqual({
      顶管机: { "SB-0003 唐兴 NSPD1200": {}, 通用: { "出厂合格证.pdf": 10 } }
    });
    expect(row(id).wedrive_folder_key).toBe(`category-general:${categoryId}`);
    expect(fake.callsTo("file_move")).toHaveLength(1);
  });

  it("被替换：旧的那份从微盘删掉；新的那份上传", async () => {
    const oldId = seedDoc({ title: "合格证 2024" });
    await reconcile(oldId);
    const newId = seedDoc({ title: "合格证 2026", supersedes_id: oldId });
    expect(await reconcile(oldId)).toBe("removed");
    expect(await reconcile(newId)).toBe("synced");
    expect(Object.keys(fake.tree()["顶管机"]["SB-0003 唐兴 NSPD1200"])).toEqual([
      "合格证 2026.pdf"
    ]);
    expect(row(oldId)).toMatchObject({
      mirror_status: "synced",
      wedrive_fileid: null,
      wedrive_name: null,
      wedrive_folder_key: null
    });
  });

  it("删除：从微盘删掉，三个字段清空", async () => {
    const id = seedDoc();
    await reconcile(id);
    h.database
      .prepare("UPDATE doc_file SET deleted_at = '2026-11-12T00:00:00.000Z' WHERE id = ?")
      .run(id);
    expect(await reconcile(id)).toBe("removed");
    expect(fake.tree()).toEqual({ 顶管机: { "SB-0003 唐兴 NSPD1200": {} } });
    expect(row(id)).toMatchObject({
      wedrive_fileid: null,
      wedrive_name: null,
      mirror_status: "synced"
    });
  });

  it("删除一份从来没镜像过的：什么请求都不发", async () => {
    const id = seedDoc({ deleted_at: "2026-11-12T00:00:00.000Z" });
    const before = fake.calls.length;
    expect(await reconcile(id)).toBe("unchanged");
    expect(fake.calls.length).toBe(before);
    expect(row(id).mirror_status).toBe("synced");
  });

  it("同一个目录里两份资料标题一样：第二份叫「标题（2）.pdf」，第三份叫（3）", async () => {
    const ids = [seedDoc(), seedDoc(), seedDoc()];
    for (const id of ids) await reconcile(id);
    expect(ids.map((id) => row(id).wedrive_name)).toEqual([
      "出厂合格证.pdf",
      "出厂合格证（2）.pdf",
      "出厂合格证（3）.pdf"
    ]);
    // 再对一遍：名字不变，不发请求
    const before = fake.calls.length;
    for (const id of ids) expect(await reconcile(id)).toBe("unchanged");
    expect(fake.calls.length).toBe(before);
  });

  it("上传之前先记下打算放哪、叫什么；传失败了这两项也留着", async () => {
    const id = seedDoc();
    fake.failNext("file_upload", 640003);
    fake.failNext("file_upload_init", 640003);
    await expect(reconcile(id)).rejects.toThrow("640003");
    expect(row(id)).toMatchObject({
      wedrive_fileid: null,
      wedrive_name: "出厂合格证.pdf",
      wedrive_folder_key: `device:${deviceId}`
    });
  });

  it("上次传完没记下来（微盘里已经有同名同大小的）：认领它，不再上传", async () => {
    const id = seedDoc();
    // 目录已经在了，文件也在微盘里了，但库里没记下文件 ID
    await reconcile(seedDoc({ title: "别的资料" }));
    const orphan = fake.putFile(settings.space_id, deviceFolderId(), "出厂合格证.pdf", 10);
    markUploadStarted(id);
    const uploads = uploadCalls().length;
    expect(await reconcile(id)).toBe("synced");
    expect(uploadCalls().length).toBe(uploads);
    expect(row(id)).toMatchObject({ wedrive_fileid: orphan, mirror_status: "synced" });
  });

  it("上次开始传过，但微盘里那个同名文件大小不一样：不认领，照常上传", async () => {
    const id = seedDoc();
    await reconcile(seedDoc({ title: "别的资料" }));
    const other = fake.putFile(settings.space_id, deviceFolderId(), "出厂合格证.pdf", 999);
    markUploadStarted(id);
    expect(await reconcile(id)).toBe("synced");
    expect(row(id).wedrive_fileid).not.toBe(other);
  });

  it("上次传完没记下来，之后标题又改了：按原来的名字找到它，认领后改名，不传第二份", async () => {
    const id = seedDoc();
    await reconcile(seedDoc({ title: "别的资料" }));
    const orphan = fake.putFile(settings.space_id, deviceFolderId(), "出厂合格证.pdf", 10);
    markUploadStarted(id);
    h.database.prepare("UPDATE doc_file SET title = '新标题' WHERE id = ?").run(id);
    const uploads = uploadCalls().length;
    expect(await reconcile(id)).toBe("synced");
    expect(uploadCalls().length).toBe(uploads);
    expect(row(id)).toMatchObject({ wedrive_fileid: orphan, wedrive_name: "新标题.pdf" });
    expect(fake.nodes.get(orphan).file_name).toBe("新标题.pdf");
  });

  it("上次传完没记下来，之后这份资料被删了：在微盘里找到并删掉", async () => {
    const id = seedDoc();
    await reconcile(seedDoc({ title: "别的资料" }));
    const orphan = fake.putFile(settings.space_id, deviceFolderId(), "出厂合格证.pdf", 10);
    markUploadStarted(id);
    h.database
      .prepare("UPDATE doc_file SET deleted_at = '2026-11-12T00:00:00.000Z' WHERE id = ?")
      .run(id);
    expect(await reconcile(id)).toBe("removed");
    expect(fake.nodes.has(orphan)).toBe(false);
    expect(row(id)).toMatchObject({ wedrive_fileid: null, wedrive_name: null });
  });

  it("第一次试的时候不列目录（省一次调用）", async () => {
    await reconcile(seedDoc());
    expect(fake.callsTo("file_list")).toHaveLength(0);
  });

  it("对的过程中这一行又被标成了 pending（有人改了它）：文件 ID 照记，状态不改成 synced", async () => {
    const id = seedDoc();
    h.database.prepare("UPDATE doc_file SET mirror_status = 'syncing' WHERE id = ?").run(id);
    const racing = {
      ...client,
      uploadDirect: async (...args) => {
        const fileId = await client.uploadDirect(...args);
        h.database.prepare("UPDATE doc_file SET mirror_status = 'pending' WHERE id = ?").run(id);
        return fileId;
      }
    };
    expect(await reconcileDoc(h.env, racing, settings, id)).toBe("synced");
    expect(row(id).mirror_status).toBe("pending");
    expect(fake.nodes.has(row(id).wedrive_fileid)).toBe(true);
  });

  it("什么都没变：unchanged，不发请求", async () => {
    const id = seedDoc();
    await reconcile(id);
    const before = fake.calls.length;
    expect(await reconcile(id)).toBe("unchanged");
    expect(fake.calls.length).toBe(before);
  });

  it("已经镜像过的文件后来超过了上限（上限被调小）：留着不动", async () => {
    const id = seedDoc({ file_size: 2 * MiB });
    await reconcile(id);
    expect(await reconcile(id, { mirror_max_bytes: MiB })).toBe("unchanged");
    expect(row(id).mirror_status).toBe("synced");
  });

  it("限额错误原样抛出，状态不在这里改", async () => {
    const id = seedDoc();
    h.database.prepare("UPDATE doc_file SET mirror_status = 'syncing' WHERE id = ?").run(id);
    fake.failNext("file_create", 640019);
    await expect(reconcile(id)).rejects.toBeInstanceOf(WedriveQuotaError);
    expect(row(id)).toMatchObject({ mirror_status: "syncing", wedrive_fileid: null });
  });

  it("R2 里没有这个文件：抛错，文字是「文件不在存储里」", async () => {
    const id = seedDoc();
    h.files.objects.delete(row(id).file_key);
    await expect(reconcile(id)).rejects.toThrow("文件不在存储里");
  });

  it("资料不存在：unchanged", async () => {
    expect(await reconcile(99999)).toBe("unchanged");
  });
});
