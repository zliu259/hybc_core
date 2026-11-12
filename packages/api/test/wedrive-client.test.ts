import { beforeEach, describe, expect, it } from "vitest";

import {
  createWedriveClient,
  DIRECT_UPLOAD_MAX_BYTES,
  WedriveError,
  WedriveQuotaError
} from "../src/services/wedrive/client";
import { getCallCount } from "../src/services/wedrive/settings";
import { createFakeWedrive } from "./helpers/fake-wedrive";
import { createWarehouseHarness } from "./helpers/warehouse-harness";
import { hasSqlite } from "./helpers/sqlite-d1";

// 微盘客户端：每次调用都计数、认限额、分块上传的摘要要过得了假微盘的核对。

const MiB = 1024 * 1024;
const NOW = new Date("2026-11-12T03:00:00.000Z");
const pattern = (length, seed = 5) =>
  new Uint8Array(length).map((_, index) => (index * 31 + seed) % 251);
const streamOf = (bytes, chunkSize = 300_000) => {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    }
  });
};

describe.skipIf(!hasSqlite)("微盘客户端", () => {
  let h;
  let fake;
  let client;
  let spaceId;

  const make = (budget = 900) =>
    createWedriveClient(h.env, { call: fake.call, now: () => NOW, budget });
  const used = () => getCallCount(h.env, NOW);
  const chunked = (name, bytes, parent = spaceId) =>
    client.uploadChunked(spaceId, parent, name, bytes.length, async () => streamOf(bytes));

  beforeEach(async () => {
    h = createWarehouseHarness();
    fake = createFakeWedrive();
    client = make();
    spaceId = await client.createSpace("设备资料库");
  });

  it("建空间不带成员；之后才把公司根部门加为只能下载", async () => {
    expect(fake.calls[0]).toEqual({ api: "space_create", body: { space_name: "设备资料库" } });
    expect(fake.spaces.get(spaceId).members).toEqual([]);
    await client.openSpaceToCompany(spaceId);
    expect(fake.spaces.get(spaceId).members).toEqual([{ type: 2, departmentid: 1, auth: 1 }]);
  });

  it("建目录、直传、列目录、改名、移动、删除，每次调用都记了数", async () => {
    const folder = await client.createFolder(spaceId, spaceId, "顶管机");
    const other = await client.createFolder(spaceId, spaceId, "通用");
    const fileId = await client.uploadDirect(spaceId, folder, "合格证.pdf", pattern(1000));
    expect(await client.listFolder(spaceId, folder)).toEqual([
      {
        fileid: fileId,
        file_name: "合格证.pdf",
        file_size: 1000,
        file_type: 2,
        sha: expect.any(String)
      }
    ]);
    await client.rename(fileId, "出厂合格证.pdf");
    await client.move(fileId, other);
    expect(fake.tree()).toEqual({ 顶管机: {}, 通用: { "出厂合格证.pdf": 1000 } });
    await client.remove([fileId]);
    expect(fake.tree()).toEqual({ 顶管机: {}, 通用: {} });
    // 建空间 1 + 建目录 2 + 直传 1 + 列目录 1 + 改名 1 + 移动 1 + 删除 1
    expect(await used()).toBe(8);
    expect(fake.calls).toHaveLength(8);
    expect(fake.callsTo("file_move")[0].body).toEqual({
      fatherid: other,
      replace: false,
      fileid: [fileId]
    });
  });

  it("分块上传 5 MiB：init、3 片、finish，共 5 次调用；假微盘核对过每一片的摘要", async () => {
    const bytes = pattern(5 * MiB);
    const before = await used();
    const fileId = await chunked("说明书.pdf", bytes);
    expect(fake.nodes.get(fileId)).toMatchObject({ file_name: "说明书.pdf", file_size: 5 * MiB });
    expect((await used()) - before).toBe(5);
    expect(fake.callsTo("file_upload_part").map((item) => item.body.index)).toEqual([1, 2, 3]);
    expect(fake.callsTo("file_upload_init")[0].body).toMatchObject({
      size: 5 * MiB,
      skip_push_card: true
    });
    expect(fake.callsTo("file_upload_init")[0].body.block_sha).toHaveLength(3);
  });

  it.each([1, 2 * MiB, 4 * MiB, 2 * MiB + 1])("分块上传 %i 字节也能成", async (length) => {
    const fileId = await chunked("a.bin", pattern(length));
    expect(fake.nodes.get(fileId).file_size).toBe(length);
  });

  it("分块上传带了 skip_push_card，不产生卡片；直传会产生一张", async () => {
    await chunked("大的.pdf", pattern(3 * MiB));
    expect(fake.cards).toEqual([]);
    await client.uploadDirect(spaceId, spaceId, "小的.pdf", pattern(10));
    expect(fake.cards).toEqual(["小的.pdf"]);
  });

  it("某一片第一次超时、重试成功：文件完整", async () => {
    fake.failNext("file_upload_part", "timeout");
    const bytes = pattern(3 * MiB);
    const fileId = await chunked("a.bin", bytes);
    expect(fake.nodes.get(fileId).file_size).toBe(3 * MiB);
    // 多发了一次分片
    expect(fake.callsTo("file_upload_part")).toHaveLength(3);
  });

  it("某一片连着失败三次：抛出，不发 finish", async () => {
    fake.failNext("file_upload_part", "timeout", 3);
    await expect(chunked("a.bin", pattern(3 * MiB))).rejects.toThrow("timeout");
    expect(fake.callsTo("file_upload_finish")).toHaveLength(0);
  });

  it("init 命中秒传：不再传分片", async () => {
    const bytes = pattern(3 * MiB);
    const first = await chunked("a.bin", bytes);
    fake.instantShas.add(fake.nodes.get(first).sha);
    const before = fake.callsTo("file_upload_part").length;
    const second = await chunked("b.bin", bytes);
    expect(second).not.toBe(first);
    expect(fake.callsTo("file_upload_part")).toHaveLength(before);
  });

  it("文件实际大小和说的不一样：不发 init 就报错", async () => {
    await expect(
      client.uploadChunked(spaceId, spaceId, "a.bin", 100, async () => streamOf(pattern(99)))
    ).rejects.toThrow("文件大小和记录的不一样");
    expect(fake.callsTo("file_upload_init")).toHaveLength(0);
  });

  it("直传超过上限的文件：不发请求就报错", async () => {
    await expect(
      client.uploadDirect(spaceId, spaceId, "a.bin", pattern(DIRECT_UPLOAD_MAX_BYTES + 1))
    ).rejects.toThrow("直传");
    expect(fake.callsTo("file_upload")).toHaveLength(0);
  });

  it.each([640019, 640035])("企微返回 %i：抛 WedriveQuotaError", async (errcode) => {
    fake.failNext("file_create", errcode);
    const error = await client.createFolder(spaceId, spaceId, "x").catch((e) => e);
    expect(error).toBeInstanceOf(WedriveQuotaError);
    expect(error).toMatchObject({ errcode, apiName: "file_create" });
  });

  it("本月已经用到预算：不发请求就抛 WedriveQuotaError，调用次数不再加", async () => {
    client = make(3);
    // 建空间已经用了 1 次，再用 2 次
    await client.createFolder(spaceId, spaceId, "a");
    await client.createFolder(spaceId, spaceId, "b");
    expect(await used()).toBe(3);
    await expect(client.createFolder(spaceId, spaceId, "c")).rejects.toBeInstanceOf(
      WedriveQuotaError
    );
    expect(fake.calls).toHaveLength(3);
    expect(await used()).toBe(3);
  });

  it("另一个客户端接着用同一个月的次数", async () => {
    await client.createFolder(spaceId, spaceId, "a");
    const second = make(3);
    await second.createFolder(spaceId, spaceId, "b");
    await expect(second.createFolder(spaceId, spaceId, "c")).rejects.toBeInstanceOf(
      WedriveQuotaError
    );
  });

  it("别的 errcode：抛 WedriveError（不是限额），带上接口名和错误码", async () => {
    fake.failNext("file_rename", 640003);
    const error = await client.rename("nope", "x").catch((e) => e);
    expect(error).toBeInstanceOf(WedriveError);
    expect(error).not.toBeInstanceOf(WedriveQuotaError);
    expect(error).toMatchObject({ errcode: 640003, apiName: "file_rename" });
    expect(error.message).toContain("640003");
  });

  it("失败的调用也算一次（企微那边多半已经记了）", async () => {
    const before = await used();
    fake.failNext("file_create", 640003);
    await client.createFolder(spaceId, spaceId, "x").catch(() => {});
    expect((await used()) - before).toBe(1);
  });

  it("listFolder 超过一页时翻完", async () => {
    fake = createFakeWedrive({ listPageSize: 2 });
    client = make();
    spaceId = await client.createSpace("设备资料库");
    for (const name of ["a", "b", "c", "d", "e"]) await client.createFolder(spaceId, spaceId, name);
    const items = await client.listFolder(spaceId, spaceId);
    expect(items.map((item) => item.file_name)).toEqual(["a", "b", "c", "d", "e"]);
    expect(fake.callsTo("file_list").map((item) => item.body.start)).toEqual([0, 2, 4]);
  });
});
