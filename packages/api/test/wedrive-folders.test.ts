import { beforeEach, describe, expect, it } from "vitest";

import { createWedriveClient } from "../src/services/wedrive/client";
import {
  ensureFolder,
  folderChainFor,
  loadFolderChain,
  safeFolderName
} from "../src/services/wedrive/folders";
import { createFakeWedrive } from "./helpers/fake-wedrive";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 微盘里的目录：设备类别 / 设备编号 设备名称；归到类别的在 类别 / 通用；通用资料在根下的 通用。

const lookup = {
  device: (id) =>
    ({
      3: { device_code: "SB-0003", name: "唐兴 NSPD1200", category_id: 9 },
      4: { device_code: "SB-0004", name: "发电机", category_id: null }
    })[id] ?? null,
  category: (id) => ({ 9: { name: "顶管机" }, 10: { name: "通用" } })[id] ?? null
};

describe("folderChainFor", () => {
  it("单台设备的资料：类别 / 编号 名称", () => {
    expect(folderChainFor({ device_id: 3, device_category_id: null }, lookup)).toEqual([
      { key: "category:9", name: "顶管机", parentKey: null },
      { key: "device:3", name: "SB-0003 唐兴 NSPD1200", parentKey: "category:9" }
    ]);
  });

  it("归到类别的：类别 / 通用", () => {
    expect(folderChainFor({ device_id: null, device_category_id: 9 }, lookup)).toEqual([
      { key: "category:9", name: "顶管机", parentKey: null },
      { key: "category-general:9", name: "通用", parentKey: "category:9" }
    ]);
  });

  it("通用资料：根下的 通用", () => {
    expect(folderChainFor({ device_id: null, device_category_id: null }, lookup)).toEqual([
      { key: "general", name: "通用", parentKey: null }
    ]);
  });

  it("设备没有类别：未分类 / 设备", () => {
    expect(folderChainFor({ device_id: 4, device_category_id: null }, lookup)).toEqual([
      { key: "uncategorized", name: "未分类", parentKey: null },
      { key: "device:4", name: "SB-0004 发电机", parentKey: "uncategorized" }
    ]);
  });

  it("设备或类别查不到了：放到 通用", () => {
    const general = [{ key: "general", name: "通用", parentKey: null }];
    expect(folderChainFor({ device_id: 99, device_category_id: null }, lookup)).toEqual(general);
    expect(folderChainFor({ device_id: null, device_category_id: 99 }, lookup)).toEqual(general);
  });

  it("类别正好叫「通用」「未分类」：目录名加上（类别），不和根下固定的那两个撞", () => {
    expect(folderChainFor({ device_id: null, device_category_id: 10 }, lookup)[0]).toEqual({
      key: "category:10",
      name: "通用（类别）",
      parentKey: null
    });
  });
});

describe("safeFolderName", () => {
  it("斜杠、冒号、换行被换掉，首尾空白去掉", () => {
    expect(safeFolderName(" a/b:c\n")).toBe("a／b：c");
    expect(safeFolderName('x\\y*z?"<>|')).toBe("x＼y＊z？＂＜＞｜");
  });

  it("太长的截到 80 个字；空的叫 未命名", () => {
    expect(safeFolderName("长".repeat(100))).toHaveLength(80);
    expect(safeFolderName("  \n ")).toBe("未命名");
  });
});

describe.skipIf(!hasSqlite)("ensureFolder", () => {
  let h;
  let fake;
  let client;
  let spaceId;
  const chain = [
    { key: "category:9", name: "顶管机", parentKey: null },
    { key: "device:3", name: "SB-0003 唐兴 NSPD1200", parentKey: "category:9" }
  ];
  /** 已经建好的目录（只开了个头、还没拿到文件夹 ID 的不算） */
  const cached = () =>
    h.database
      .prepare(
        "SELECT folder_key, name, parent_key FROM wedrive_folder WHERE fileid <> '' ORDER BY folder_key"
      )
      .all();

  beforeEach(async () => {
    h = createWarehouseHarness();
    fake = createFakeWedrive();
    client = createWedriveClient(h.env, { call: fake.call, budget: 900 });
    spaceId = await client.createSpace("设备资料库");
  });

  it("第一次：逐层建目录并记下；第二次：一个请求都不发", async () => {
    const result = await ensureFolder(h.env, client, spaceId, chain);
    expect(fake.tree()).toEqual({ 顶管机: { "SB-0003 唐兴 NSPD1200": {} } });
    expect(result.key).toBe("device:3");
    expect(fake.nodes.get(result.fileid).file_name).toBe("SB-0003 唐兴 NSPD1200");
    expect(cached()).toEqual([
      { folder_key: "category:9", name: "顶管机", parent_key: null },
      { folder_key: "device:3", name: "SB-0003 唐兴 NSPD1200", parent_key: "category:9" }
    ]);
    const before = fake.calls.length;
    const again = await ensureFolder(h.env, client, spaceId, chain);
    expect(again).toEqual(result);
    expect(fake.calls.length).toBe(before);
  });

  it("同一个类别下再来一台设备：类别目录不重建", async () => {
    await ensureFolder(h.env, client, spaceId, chain);
    await ensureFolder(h.env, client, spaceId, [
      chain[0],
      { key: "device:5", name: "SB-0005 另一台", parentKey: "category:9" }
    ]);
    expect(fake.callsTo("file_create")).toHaveLength(3);
    expect(Object.keys(fake.tree()["顶管机"])).toEqual(["SB-0003 唐兴 NSPD1200", "SB-0005 另一台"]);
  });

  it("设备改了名：目录改名，不新建", async () => {
    const first = await ensureFolder(h.env, client, spaceId, chain);
    const renamed = await ensureFolder(h.env, client, spaceId, [
      chain[0],
      { ...chain[1], name: "SB-0003 唐兴 NSPD1200（大修后）" }
    ]);
    expect(renamed.fileid).toBe(first.fileid);
    expect(fake.tree()).toEqual({ 顶管机: { "SB-0003 唐兴 NSPD1200（大修后）": {} } });
    expect(fake.callsTo("file_rename")).toHaveLength(1);
    expect(cached()[1].name).toBe("SB-0003 唐兴 NSPD1200（大修后）");
  });

  it("设备换了类别：目录移到新类别下面，里面的东西跟着走", async () => {
    const first = await ensureFolder(h.env, client, spaceId, chain);
    await client.uploadDirect(spaceId, first.fileid, "合格证.pdf", new Uint8Array(5));
    const moved = await ensureFolder(h.env, client, spaceId, [
      { key: "category:12", name: "泥水泵", parentKey: null },
      { ...chain[1], parentKey: "category:12" }
    ]);
    expect(moved.fileid).toBe(first.fileid);
    expect(fake.tree()).toEqual({
      顶管机: {},
      泥水泵: { "SB-0003 唐兴 NSPD1200": { "合格证.pdf": 5 } }
    });
    expect(cached().find((row) => row.folder_key === "device:3").parent_key).toBe("category:12");
  });

  it("建到一半失败：已经建好的那一层留在缓存里，下次从断的地方接着建", async () => {
    fake.failNext("file_create", 640003);
    // 第一层就失败：什么都没记
    await expect(ensureFolder(h.env, client, spaceId, chain)).rejects.toThrow("640003");
    expect(cached()).toEqual([]);
    // 这次第一层成、第二层失败
    await ensureFolder(h.env, client, spaceId, [chain[0]]);
    fake.failNext("file_create", 640003);
    await expect(ensureFolder(h.env, client, spaceId, chain)).rejects.toThrow("640003");
    expect(cached().map((row) => row.folder_key)).toEqual(["category:9"]);
    const creates = fake.callsTo("file_create").length;
    await ensureFolder(h.env, client, spaceId, chain);
    // 只补建了设备那一层
    expect(fake.callsTo("file_create").length).toBe(creates + 1);
  });

  it("建目录其实建上了、只是答复丢了：这一趟抛出；下一趟认领那个目录，不建第二个", async () => {
    fake.failNext("file_create", "lost");
    await expect(ensureFolder(h.env, client, spaceId, chain)).rejects.toThrow("timeout");
    expect(fake.callsTo("file_create")).toHaveLength(1);
    const result = await ensureFolder(h.env, client, spaceId, chain);
    expect(fake.tree()).toEqual({ 顶管机: { "SB-0003 唐兴 NSPD1200": {} } });
    // 类别那一层是认领的，只新建了设备那一层
    expect(fake.callsTo("file_create")).toHaveLength(2);
    expect(fake.callsTo("file_list")).toHaveLength(1);
    expect(fake.nodes.get(result.fileid).file_name).toBe("SB-0003 唐兴 NSPD1200");
    expect(cached().map((row) => row.folder_key)).toEqual(["category:9", "device:3"]);
  });

  it("建目录超时、确实没建上：这一趟抛出；下一趟先看一眼，没有再建", async () => {
    fake.failNext("file_create", "timeout");
    await expect(ensureFolder(h.env, client, spaceId, chain)).rejects.toThrow("timeout");
    await ensureFolder(h.env, client, spaceId, chain);
    expect(fake.tree()).toEqual({ 顶管机: { "SB-0003 唐兴 NSPD1200": {} } });
    expect(fake.callsTo("file_list")).toHaveLength(1);
  });

  it("第一次建目录不列目录（省一次调用）", async () => {
    await ensureFolder(h.env, client, spaceId, chain);
    expect(fake.callsTo("file_list")).toHaveLength(0);
  });

  it("企微明确拒绝建目录（有错误码）：直接抛；下一趟也不用先列目录", async () => {
    fake.failNext("file_create", 640003);
    await expect(ensureFolder(h.env, client, spaceId, chain)).rejects.toThrow("640003");
    await ensureFolder(h.env, client, spaceId, chain);
    expect(fake.callsTo("file_list")).toHaveLength(0);
  });

  it("loadFolderChain：从库里查设备和类别，拼出目录", async () => {
    const category = h.seed.category("顶管机");
    const device = h.seed.device({
      device_code: "SB-0003",
      name: "唐兴 NSPD1200",
      category_id: category
    });
    expect(await loadFolderChain(h.env, { device_id: device, device_category_id: null })).toEqual([
      { key: `category:${category}`, name: "顶管机", parentKey: null },
      { key: `device:${device}`, name: "SB-0003 唐兴 NSPD1200", parentKey: `category:${category}` }
    ]);
    expect(await loadFolderChain(h.env, { device_id: null, device_category_id: null })).toEqual([
      { key: "general", name: "通用", parentKey: null }
    ]);
  });
});
