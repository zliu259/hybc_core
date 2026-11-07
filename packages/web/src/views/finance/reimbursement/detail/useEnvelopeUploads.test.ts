import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { addEnvelopeAttachments } from "@/api/reimbursement";
import { createUploadSignature } from "@/api/upload";
import { useEnvelopeUploads } from "./useEnvelopeUploads";

vi.mock("@/api/upload", () => ({
  createUploadSignature: vi.fn(async (data: { fileName: string }) => ({
    data: {
      key: `reimbursement/${data.fileName}`,
      uploadUrl: `/upload/${data.fileName}`
    }
  })),
  resolveUploadUrl: (url: string) => `https://api.test${url}`
}));

vi.mock("@/api/reimbursement", () => ({
  addEnvelopeAttachments: vi.fn(async () => ({ data: { attachment_ids: [1] } }))
}));

vi.mock("@/utils/auth", () => ({
  formatToken: (token: string) => `Bearer ${token}`,
  getToken: () => ({ accessToken: "token" })
}));

class FakeXhr {
  static instances: FakeXhr[] = [];
  upload: {
    onprogress?: (event: {
      lengthComputable: boolean;
      loaded: number;
      total: number;
    }) => void;
  } = {};
  status = 0;
  onload?: () => void;
  onerror?: () => void;
  url = "";
  body: unknown;
  headers: Record<string, string> = {};
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }
  send(body: unknown) {
    this.body = body;
    FakeXhr.instances.push(this);
  }
  succeed() {
    this.status = 200;
    this.onload?.();
  }
  failWith(status: number) {
    this.status = status;
    this.onload?.();
  }
  breakNetwork() {
    this.onerror?.();
  }
}

const flush = async () => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
};

const file = (name: string, size = 10) => {
  const created = new File(["x"], name, { type: "application/pdf" });
  Object.defineProperty(created, "size", { value: size });
  return created;
};

const setup = (
  overrides: Partial<Parameters<typeof useEnvelopeUploads>[0]> = {}
) => {
  const ensureEnvelopeId = vi.fn(async () => 7);
  const onBound = vi.fn(async () => {});
  const uploads = useEnvelopeUploads({
    ensureEnvelopeId,
    onBound,
    ...overrides
  });
  return { uploads, ensureEnvelopeId, onBound };
};

describe("useEnvelopeUploads", () => {
  beforeEach(() => {
    FakeXhr.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    vi.mocked(addEnvelopeAttachments).mockClear();
    vi.mocked(createUploadSignature).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("同时最多 3 个", async () => {
    const { uploads } = setup();
    uploads.addFiles([
      file("1.pdf"),
      file("2.pdf"),
      file("3.pdf"),
      file("4.pdf"),
      file("5.pdf")
    ]);
    await flush();
    expect(FakeXhr.instances).toHaveLength(3);
    expect(uploads.items.value.map(item => item.status)).toEqual([
      "uploading",
      "uploading",
      "uploading",
      "waiting",
      "waiting"
    ]);
    FakeXhr.instances[0].succeed();
    await flush();
    expect(FakeXhr.instances).toHaveLength(4);
  });

  it("一个失败其余继续，uploadingCount 到全部结束才为 0", async () => {
    const { uploads } = setup();
    uploads.addFiles([file("1.pdf"), file("2.pdf")]);
    await flush();
    expect(uploads.uploadingCount.value).toBe(2);
    FakeXhr.instances[0].breakNetwork();
    await flush();
    expect(uploads.uploadingCount.value).toBe(1);
    expect(uploads.hasFailed.value).toBe(true);
    FakeXhr.instances[1].succeed();
    await flush();
    expect(uploads.uploadingCount.value).toBe(0);
    expect(uploads.items.value.map(item => item.name)).toEqual(["1.pdf"]);
    expect(uploads.items.value[0].status).toBe("failed");
    expect(uploads.items.value[0].error).toBeTruthy();
  });

  it("HTTP 失败也算失败", async () => {
    const { uploads } = setup();
    uploads.addFiles([file("1.pdf")]);
    await flush();
    FakeXhr.instances[0].failWith(500);
    await flush();
    expect(uploads.hasFailed.value).toBe(true);
    expect(addEnvelopeAttachments).not.toHaveBeenCalled();
  });

  it("retry 只重传失败的", async () => {
    const { uploads } = setup();
    uploads.addFiles([file("1.pdf"), file("2.pdf")]);
    await flush();
    FakeXhr.instances[0].breakNetwork();
    FakeXhr.instances[1].succeed();
    await flush();
    expect(FakeXhr.instances).toHaveLength(2);

    uploads.retry(uploads.items.value[0].localId);
    await flush();
    expect(FakeXhr.instances).toHaveLength(3);
    expect(FakeXhr.instances[2].url).toContain("1.pdf");
    FakeXhr.instances[2].succeed();
    await flush();
    expect(uploads.items.value).toEqual([]);
    expect(uploads.hasFailed.value).toBe(false);
  });

  it("相同文件名和大小跳过", async () => {
    const { uploads } = setup();
    const first = uploads.addFiles([
      file("1.pdf", 10),
      file("1.pdf", 10),
      file("1.pdf", 20)
    ]);
    expect(first.skipped).toEqual(["1.pdf"]);
    expect(uploads.items.value).toHaveLength(2);
  });

  it("和已有附件相同的也跳过", () => {
    const { uploads } = setup({
      existingFiles: () => [{ name: "1.pdf", size: 10 }]
    });
    const result = uploads.addFiles([file("1.pdf", 10), file("2.pdf", 10)]);
    expect(result.skipped).toEqual(["1.pdf"]);
    expect(uploads.items.value.map(item => item.name)).toEqual(["2.pdf"]);
  });

  it("失败的文件再选一次不算重复", async () => {
    const { uploads } = setup();
    uploads.addFiles([file("1.pdf")]);
    await flush();
    FakeXhr.instances[0].breakNetwork();
    await flush();
    const result = uploads.addFiles([file("1.pdf")]);
    expect(result.skipped).toEqual([]);
    expect(uploads.items.value).toHaveLength(1);
  });

  it("后缀不对当场拒绝且不上传", async () => {
    const { uploads } = setup();
    const result = uploads.addFiles([
      file("a.heic"),
      file("A.PDF"),
      file("noext")
    ]);
    expect(result.rejected).toEqual([
      { name: "a.heic", message: "a.heic：只支持 PDF、JPG、PNG" },
      { name: "noext", message: "noext：只支持 PDF、JPG、PNG" }
    ]);
    await flush();
    expect(FakeXhr.instances).toHaveLength(1);
    expect(uploads.items.value.map(item => item.name)).toEqual(["A.PDF"]);
  });

  it("大于 20MB 当场拒绝", () => {
    const { uploads } = setup();
    const result = uploads.addFiles([
      file("大.pdf", 20 * 1024 * 1024 + 1),
      file("正好.pdf", 20 * 1024 * 1024)
    ]);
    expect(result.rejected).toEqual([
      { name: "大.pdf", message: "大.pdf：不能超过 20MB" }
    ]);
    expect(uploads.items.value.map(item => item.name)).toEqual(["正好.pdf"]);
  });

  it("多个文件同时开始也只建一个草稿", async () => {
    let created = 0;
    let release: (id: number) => void = () => {};
    const pending = new Promise<number>(resolve => {
      release = resolve;
    });
    const { uploads } = setup({
      ensureEnvelopeId: () => {
        created += 1;
        return pending;
      }
    });
    uploads.addFiles([file("1.pdf"), file("2.pdf"), file("3.pdf")]);
    await flush();
    FakeXhr.instances.forEach(xhr => xhr.succeed());
    await flush();
    expect(created).toBe(1);
    release(7);
    await flush();
    expect(addEnvelopeAttachments).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(addEnvelopeAttachments).mock.calls.every(call => call[0] === 7)
    ).toBe(true);
  });

  it("建草稿失败后重试会再建", async () => {
    const ensureEnvelopeId = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("建不了"))
      .mockResolvedValue(7);
    const { uploads } = setup({ ensureEnvelopeId });
    uploads.addFiles([file("1.pdf")]);
    await flush();
    FakeXhr.instances[0].succeed();
    await flush();
    expect(uploads.hasFailed.value).toBe(true);
    // 文件已经传上去了，重试只补建草稿和绑定
    uploads.retry(uploads.items.value[0].localId);
    await flush();
    expect(FakeXhr.instances).toHaveLength(1);
    expect(ensureEnvelopeId).toHaveBeenCalledTimes(2);
    expect(uploads.items.value).toEqual([]);
  });

  it("绑定成功后从 items 移除并通知刷新", async () => {
    const { uploads, onBound } = setup();
    uploads.addFiles([file("1.pdf", 123)]);
    await flush();
    FakeXhr.instances[0].succeed();
    await flush();
    expect(addEnvelopeAttachments).toHaveBeenCalledWith(7, [
      { file_key: "reimbursement/1.pdf", file_name: "1.pdf", file_size: 123 }
    ]);
    expect(onBound).toHaveBeenCalledTimes(1);
    expect(uploads.items.value).toEqual([]);
  });

  it("绑定失败算失败，显示服务端的说法", async () => {
    vi.mocked(addEnvelopeAttachments).mockRejectedValueOnce({
      response: { data: { error: { message: "一张报销最多 30 个附件" } } }
    });
    const { uploads } = setup();
    uploads.addFiles([file("1.pdf")]);
    await flush();
    FakeXhr.instances[0].succeed();
    await flush();
    expect(uploads.items.value[0].error).toBe("一张报销最多 30 个附件");
  });

  it("绑定失败后重试不重传，用同一个 file_key，接口才认得出是重试", async () => {
    vi.mocked(addEnvelopeAttachments).mockRejectedValueOnce(new Error("断网"));
    const { uploads } = setup();
    uploads.addFiles([file("1.pdf")]);
    await flush();
    FakeXhr.instances[0].succeed();
    await flush();
    expect(uploads.hasFailed.value).toBe(true);

    uploads.retry(uploads.items.value[0].localId);
    await flush();
    expect(FakeXhr.instances).toHaveLength(1);
    expect(createUploadSignature).toHaveBeenCalledTimes(1);
    expect(addEnvelopeAttachments).toHaveBeenCalledTimes(2);
    const keys = vi
      .mocked(addEnvelopeAttachments)
      .mock.calls.map(call => call[1][0].file_key);
    expect(keys[0]).toBe(keys[1]);
    expect(uploads.items.value).toEqual([]);
  });

  it("通知刷新失败不把上传算失败", async () => {
    const { uploads } = setup({
      onBound: vi.fn(async () => {
        throw new Error("刷新失败");
      })
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    uploads.addFiles([file("1.pdf")]);
    await flush();
    FakeXhr.instances[0].succeed();
    await flush();
    expect(uploads.items.value).toEqual([]);
    errorSpy.mockRestore();
  });

  it("进度跟着 XHR 走", async () => {
    const { uploads } = setup();
    uploads.addFiles([file("1.pdf")]);
    await flush();
    FakeXhr.instances[0].upload.onprogress?.({
      lengthComputable: true,
      loaded: 5,
      total: 10
    });
    expect(uploads.items.value[0].progress).toBe(50);
  });

  it("轮询刷新不影响进度", async () => {
    const { uploads, onBound } = setup();
    uploads.addFiles([file("1.pdf"), file("2.pdf")]);
    await flush();
    FakeXhr.instances[0].upload.onprogress?.({
      lengthComputable: true,
      loaded: 4,
      total: 10
    });
    const before = uploads.items.value.map(item => ({ ...item }));
    // 外部刷新详情只会改 detail，不经过这里
    await flush();
    expect(uploads.items.value.map(item => ({ ...item }))).toEqual(before);
    expect(onBound).not.toHaveBeenCalled();
  });

  it("dismiss 去掉失败的文件", async () => {
    const { uploads } = setup();
    uploads.addFiles([file("1.pdf")]);
    await flush();
    FakeXhr.instances[0].breakNetwork();
    await flush();
    uploads.dismiss(uploads.items.value[0].localId);
    expect(uploads.items.value).toEqual([]);
    expect(uploads.hasFailed.value).toBe(false);
  });
});
