import { describe, expect, it } from "vitest";

import type { Env } from "../../types/env";
import {
  ALLOWED_ATTACHMENT_EXTENSIONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_ENVELOPE,
  REIMBURSEMENT_KEY_PREFIX,
  validateNewAttachments
} from "./attachment-rules";

const KEY = "reimbursement/1-a.pdf";

const createEnv = (options: { activeKeys?: string[]; sizes?: Record<string, number> } = {}) => {
  const sizes = options.sizes ?? {};
  return {
    FILES: {
      async head(key: string) {
        if (key in sizes) return { size: sizes[key] };
        return key.startsWith("missing") || key.includes("/missing") ? null : { size: 100 };
      }
    },
    DB: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: (options.activeKeys ?? []).map((file_key) => ({ file_key })) })
        })
      })
    }
  } as unknown as Env;
};

const expectRejected = (
  result: Awaited<ReturnType<typeof validateNewAttachments>>,
  message: string
) => {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.message).toContain(message);
};

describe("报销附件规则", () => {
  it("常量和设计一致", () => {
    expect(MAX_ATTACHMENTS_PER_ENVELOPE).toBe(30);
    expect(MAX_ATTACHMENT_BYTES).toBe(20 * 1024 * 1024);
    expect(ALLOWED_ATTACHMENT_EXTENSIONS).toEqual(["pdf", "jpg", "jpeg", "png"]);
    expect(REIMBURSEMENT_KEY_PREFIX).toBe("reimbursement/");
  });

  it.each(["a.pdf", "A.PDF", "a.JPG", "a.jpeg", "发票.2026.10.png"])("接受 %s", async (file_name) => {
    const result = await validateNewAttachments(createEnv(), 1, [{ file_key: KEY, file_name }]);
    expect(result.ok).toBe(true);
  });

  it.each([
    ["a.heic", "只支持 PDF、JPG、PNG"],
    ["a.webp", "只支持 PDF、JPG、PNG"],
    ["noext", "只支持 PDF、JPG、PNG"],
    ["发票.pdf.exe", "只支持 PDF、JPG、PNG"]
  ])("拒绝 %s", async (file_name, message) => {
    const result = await validateNewAttachments(createEnv(), 1, [{ file_key: KEY, file_name }]);
    expectRejected(result, message);
    expectRejected(result, file_name);
  });

  it("没有文件名时按 key 判断后缀", async () => {
    expect((await validateNewAttachments(createEnv(), 1, [{ file_key: KEY }])).ok).toBe(true);
    expectRejected(
      await validateNewAttachments(createEnv(), 1, [{ file_key: "reimbursement/1-a.heic" }]),
      "只支持 PDF、JPG、PNG"
    );
  });

  it("超过 20MB 拒绝", async () => {
    const env = createEnv({ sizes: { [KEY]: MAX_ATTACHMENT_BYTES + 1 } });
    expectRejected(await validateNewAttachments(env, 1, [{ file_key: KEY, file_name: "大.pdf" }]), "大.pdf：不能超过 20MB");
  });

  it("正好 20MB 接受", async () => {
    const env = createEnv({ sizes: { [KEY]: MAX_ATTACHMENT_BYTES } });
    expect((await validateNewAttachments(env, 1, [{ file_key: KEY, file_name: "a.pdf" }])).ok).toBe(true);
  });

  it("第 31 个拒绝", async () => {
    const activeKeys = Array.from({ length: 30 }, (_, index) => `reimbursement/old-${index}.pdf`);
    expectRejected(
      await validateNewAttachments(createEnv({ activeKeys }), 1, [{ file_key: KEY, file_name: "a.pdf" }]),
      "一张报销最多 30 个附件"
    );
  });

  it("第 30 个接受", async () => {
    const activeKeys = Array.from({ length: 29 }, (_, index) => `reimbursement/old-${index}.pdf`);
    expect((await validateNewAttachments(createEnv({ activeKeys }), 1, [{ file_key: KEY, file_name: "a.pdf" }])).ok).toBe(true);
  });

  it("重试已绑定的文件不算新增", async () => {
    const activeKeys = Array.from({ length: 29 }, (_, index) => `reimbursement/old-${index}.pdf`);
    const result = await validateNewAttachments(createEnv({ activeKeys: [...activeKeys, KEY] }), 1, [
      { file_key: KEY, file_name: "a.pdf" }
    ]);
    expect(result.ok).toBe(true);
  });

  it("一次带太多也拒绝，同一请求里的重复只算一个", async () => {
    const many = Array.from({ length: 31 }, (_, index) => ({ file_key: `reimbursement/${index}.pdf`, file_name: `${index}.pdf` }));
    expectRejected(await validateNewAttachments(createEnv(), 1, many), "一张报销最多 30 个附件");
    const repeated = Array.from({ length: 31 }, () => ({ file_key: KEY, file_name: "a.pdf" }));
    const result = await validateNewAttachments(createEnv(), 1, repeated);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attachments).toHaveLength(1);
  });

  it("新建时不查已有附件", async () => {
    const result = await validateNewAttachments(createEnv({ activeKeys: ["x"] }), null, [{ file_key: KEY, file_name: "a.pdf" }]);
    expect(result.ok).toBe(true);
  });

  it("key 前缀不对拒绝", async () => {
    expectRejected(
      await validateNewAttachments(createEnv(), 1, [{ file_key: "contract/x.pdf", file_name: "x.pdf" }]),
      "x.pdf：文件地址不对"
    );
  });

  it("key 为空拒绝", async () => {
    expectRejected(await validateNewAttachments(createEnv(), 1, [{ file_key: "  ", file_name: "x.pdf" }]), "x.pdf：文件地址不对");
  });

  it("R2 里不存在拒绝", async () => {
    expectRejected(
      await validateNewAttachments(createEnv(), 1, [{ file_key: "reimbursement/missing.pdf", file_name: "没传.pdf" }]),
      "没传.pdf：文件没有传上来"
    );
  });

  it("用实际大小，不信客户端", async () => {
    const env = createEnv({ sizes: { [KEY]: 100 } });
    const result = await validateNewAttachments(env, 1, [{ file_key: KEY, file_name: "a.pdf", file_size: 1 }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attachments[0].file_size).toBe(100);
  });
});
