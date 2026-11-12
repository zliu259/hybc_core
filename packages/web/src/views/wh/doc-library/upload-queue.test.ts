import { describe, expect, it, vi } from "vitest";

import {
  createDocUploadQueue,
  type QueueDeps,
  type UploadItemState
} from "./upload-queue";

const blob = (size: number) => new Blob([new Uint8Array(size)]);
const item = (key: string, size = 20) => ({
  key,
  file: blob(size),
  name: `${key}.pdf`,
  meta: { title: key, doc_category: "manual" as const }
});
const networkError = () => new Error("Network Error");
const httpError = (status: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    response: { status, data: { error: { message } } }
  });

type Api = Pick<QueueDeps, "init" | "putPart" | "complete" | "abort">;

/** 默认都成功的一组接口替身（都是 vi.fn，可以数调用次数）；每个文件一个令牌，分片大小 8。 */
const makeDeps = (patch: Partial<Api> = {}) => {
  let nextId = 100;
  const init: Api["init"] = async input => ({
    upload_token: `tok-${input.file_name}`,
    part_size: 8,
    part_count: Math.ceil(input.file_size / 8)
  });
  const putPart: Api["putPart"] = async (_token, partNumber) => ({
    part_number: partNumber,
    etag: `e${partNumber}`
  });
  const complete: Api["complete"] = async () => {
    nextId += 1;
    return { id: nextId };
  };
  const abort: Api["abort"] = async () => undefined;
  return {
    init: vi.fn(patch.init ?? init),
    putPart: vi.fn(patch.putPart ?? putPart),
    complete: vi.fn(patch.complete ?? complete),
    abort: vi.fn(patch.abort ?? abort),
    retryDelayMs: 0
  };
};
const statusOf = (items: UploadItemState[]) =>
  Object.fromEntries(items.map(entry => [entry.key, entry.status]));

describe("createDocUploadQueue", () => {
  it("三个文件、同时最多传两个，全部传完后汇总数字对", async () => {
    let active = 0;
    let peak = 0;
    const deps = makeDeps({
      putPart: vi.fn(async (_token: string, partNumber: number) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 2));
        active -= 1;
        return { part_number: partNumber, etag: `e${partNumber}` };
      })
    });
    const seen: number[] = [];
    const queue = createDocUploadQueue({
      ...deps,
      onChange: items =>
        seen.push(items.filter(entry => entry.status === "uploading").length)
    });
    queue.add([item("a"), item("b"), item("c")]);
    expect(statusOf(queue.items())).toEqual({
      a: "waiting",
      b: "waiting",
      c: "waiting"
    });
    await queue.start();

    expect(peak).toBe(2);
    expect(Math.max(...seen)).toBe(2);
    expect(statusOf(queue.items())).toEqual({
      a: "done",
      b: "done",
      c: "done"
    });
    expect(queue.summary()).toEqual({
      total: 3,
      done: 3,
      failed: 0,
      waiting: 0,
      uploading: 0
    });
    expect(deps.complete).toHaveBeenCalledTimes(3);
    expect(queue.items().map(entry => entry.docId)).toEqual([101, 102, 103]);
  });

  it("完成请求带上令牌、分片清单和这份资料的信息", async () => {
    const deps = makeDeps();
    const queue = createDocUploadQueue(deps);
    queue.add([
      {
        key: "a",
        file: blob(20),
        name: "合格证.pdf",
        meta: {
          title: "合格证",
          doc_category: "cert",
          device_id: 3,
          device_category_id: null,
          valid_until: "2027-01-01",
          supersedes_id: 9
        }
      }
    ]);
    await queue.start();
    expect(deps.complete).toHaveBeenCalledWith({
      upload_token: "tok-合格证.pdf",
      parts: [
        { part_number: 1, etag: "e1" },
        { part_number: 2, etag: "e2" },
        { part_number: 3, etag: "e3" }
      ],
      title: "合格证",
      doc_category: "cert",
      device_id: 3,
      device_category_id: null,
      valid_until: "2027-01-01",
      supersedes_id: 9
    });
  });

  it("进度是已经传完的字节数，传完等于文件大小", async () => {
    const deps = makeDeps();
    const progress: number[] = [];
    const queue = createDocUploadQueue({
      ...deps,
      onChange: items => progress.push(items[0].sentBytes)
    });
    queue.add([item("a", 20)]);
    expect(queue.items()[0]).toMatchObject({ size: 20, sentBytes: 0 });
    await queue.start();
    expect([...new Set(progress)]).toEqual([0, 8, 16, 20]);
  });

  it("一个文件某一片一直传不上：它失败并写明原因，另外两个照常传完", async () => {
    const deps = makeDeps({
      putPart: vi.fn(async (token: string, partNumber: number) => {
        if (token === "tok-b.pdf") throw networkError();
        return { part_number: partNumber, etag: `e${partNumber}` };
      })
    });
    const queue = createDocUploadQueue(deps);
    queue.add([item("a"), item("b"), item("c")]);
    await queue.start();
    expect(statusOf(queue.items())).toEqual({
      a: "done",
      b: "failed",
      c: "done"
    });
    expect(queue.items()[1].error).toBe("第 1 片上传失败");
    expect(queue.summary()).toMatchObject({ done: 2, failed: 1 });
  });

  it("失败的点重试后能传完", async () => {
    let broken = true;
    const deps = makeDeps({
      putPart: vi.fn(async (_token: string, partNumber: number) => {
        if (broken) throw networkError();
        return { part_number: partNumber, etag: `e${partNumber}` };
      })
    });
    const queue = createDocUploadQueue(deps);
    queue.add([item("a")]);
    await queue.start();
    expect(queue.items()[0].status).toBe("failed");

    broken = false;
    await queue.retry("a");
    expect(queue.items()[0]).toMatchObject({
      status: "done",
      error: "",
      sentBytes: 20
    });
    expect(deps.init).toHaveBeenCalledTimes(2);
  });

  it("完成请求第一次超时、重试成功：分片不重传，只记一条", async () => {
    let calls = 0;
    const deps = makeDeps({
      complete: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw networkError();
        return { id: 7 };
      })
    });
    const queue = createDocUploadQueue(deps);
    queue.add([item("a")]);
    await queue.start();
    expect(queue.items()[0]).toMatchObject({
      status: "failed",
      error: "网络不通或超时，点重试再试一次"
    });
    const partsSent = deps.putPart.mock.calls.length;

    await queue.retry("a");
    expect(queue.items()[0]).toMatchObject({ status: "done", docId: 7 });
    expect(deps.putPart.mock.calls.length).toBe(partsSent);
    expect(deps.init).toHaveBeenCalledTimes(1);
    expect(deps.complete).toHaveBeenCalledTimes(2);
    expect(deps.complete.mock.calls[1]).toEqual(deps.complete.mock.calls[0]);
  });

  it("完成请求被服务端拒绝（上传已失效）：显示服务端的话，重试时从头传", async () => {
    let calls = 0;
    const deps = makeDeps({
      complete: vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw httpError(403, "上传已失效，请重新上传");
        return { id: 8 };
      })
    });
    const queue = createDocUploadQueue(deps);
    queue.add([item("a")]);
    await queue.start();
    expect(queue.items()[0]).toMatchObject({
      status: "failed",
      error: "上传已失效，请重新上传"
    });
    await queue.retry("a");
    expect(queue.items()[0].status).toBe("done");
    expect(deps.init).toHaveBeenCalledTimes(2);
  });

  it("取消还在排队的：它不会开始，从清单里拿掉", async () => {
    const deps = makeDeps();
    const queue = createDocUploadQueue({ ...deps, concurrency: 1 });
    queue.add([item("a"), item("b")]);
    queue.cancel("b");
    await queue.start();
    expect(queue.items().map(entry => entry.key)).toEqual(["a"]);
    expect(deps.init).toHaveBeenCalledTimes(1);
    expect(deps.init.mock.calls[0][0].file_name).toBe("a.pdf");
  });

  it("取消正在传的：放弃这次上传并拿掉，排队的接着传", async () => {
    const holder: { queue?: ReturnType<typeof createDocUploadQueue> } = {};
    const deps = makeDeps({
      putPart: vi.fn(
        async (token: string, partNumber: number, _blob: Blob, signal) => {
          if (token === "tok-a.pdf" && partNumber === 1) {
            holder.queue?.cancel("a");
            if (signal?.aborted) throw new Error("aborted");
          }
          return { part_number: partNumber, etag: `e${partNumber}` };
        }
      )
    });
    const queue = createDocUploadQueue({ ...deps, concurrency: 1 });
    holder.queue = queue;
    queue.add([item("a"), item("b")]);
    await queue.start();
    expect(statusOf(queue.items())).toEqual({ b: "done" });
    expect(deps.abort).toHaveBeenCalledWith("tok-a.pdf");
    expect(deps.complete).toHaveBeenCalledTimes(1);
  });

  it("传完的不能取消也不会被重试；不认识的 key 不出错", async () => {
    const deps = makeDeps();
    const queue = createDocUploadQueue(deps);
    queue.add([item("a")]);
    await queue.start();
    queue.cancel("a");
    await queue.retry("a");
    queue.cancel("nope");
    await queue.retry("nope");
    expect(statusOf(queue.items())).toEqual({ a: "done" });
    expect(deps.complete).toHaveBeenCalledTimes(1);
  });

  it("传的过程中又加进来的文件也会传；key 重复的不重复加", async () => {
    const deps = makeDeps();
    const queue = createDocUploadQueue(deps);
    queue.add([item("a")]);
    const running = queue.start();
    queue.add([item("a"), item("b")]);
    await running;
    await queue.start();
    expect(statusOf(queue.items())).toEqual({ a: "done", b: "done" });
    expect(deps.complete).toHaveBeenCalledTimes(2);
  });

  it("clearFinished 只留下没传完的", async () => {
    const deps = makeDeps({
      putPart: vi.fn(async (token: string, partNumber: number) => {
        if (token === "tok-b.pdf") throw networkError();
        return { part_number: partNumber, etag: `e${partNumber}` };
      })
    });
    const queue = createDocUploadQueue(deps);
    queue.add([item("a"), item("b")]);
    await queue.start();
    queue.clearFinished();
    expect(statusOf(queue.items())).toEqual({ b: "failed" });
  });
});
