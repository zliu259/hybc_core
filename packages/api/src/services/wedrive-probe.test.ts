import { describe, expect, it } from "vitest";

import type { Env } from "../types/env";
import { runWedriveProbe, type WeComCaller } from "./wedrive-probe";

type Reply = { errcode: number; errmsg: string } & Record<string, unknown>;

const OK_REPLIES: Record<string, Record<string, unknown>> = {
  mng_pro_info: { is_pro: false },
  mng_capacity: { total_capacity_for_all: 107374182400, total_capacity_for_vip: 0 },
  space_create: { spaceid: "s.mine" },
  file_create: { fileid: "d.folder" },
  file_upload: { fileid: "f.small" },
  file_list: { has_more: false, file_list: { item: [{ fileid: "f.small" }] } },
  file_info: { file_info: { fileid: "f.small", sha: "abc", mtime: 1700000000 } },
  file_download: {
    download_url: "https://download.example/f",
    cookie_name: "c",
    cookie_value: "v"
  },
  file_upload_init: { upload_key: "key-1" },
  file_upload_part: {},
  file_upload_finish: { fileid: "f.big" },
  file_delete: {},
  space_dismiss: {}
};

const okCaller: WeComCaller = async (apiName) => ({
  errcode: 0,
  errmsg: "ok",
  ...(OK_REPLIES[apiName] ?? {})
});

const failOn = (
  target: string,
  errcode: number,
  options: { times?: number; whenSpace?: string } = {}
): WeComCaller => {
  let failures = 0;
  return async (apiName, body) => {
    const spaceMatches = options.whenSpace === undefined || body.spaceid === options.whenSpace;
    const underLimit = options.times === undefined || failures < options.times;
    if (apiName === target && spaceMatches && underLimit) {
      failures += 1;
      return { errcode, errmsg: `fail ${errcode}` } as Reply;
    }
    return okCaller(apiName, body);
  };
};

const recording =
  (calls: string[], inner: WeComCaller): WeComCaller =>
  async (apiName, body) => {
    calls.push(apiName);
    return inner(apiName, body);
  };

const fetchDownload = async () => ({ status: 200, length: 1024 });
const env = {} as Env;

describe("runWedriveProbe", () => {
  it("全部成功时按固定顺序执行并清理", async () => {
    const report = await runWedriveProbe(env, {}, { call: okCaller, fetchDownload });
    expect(report.steps.map((step) => step.step)).toEqual([
      "mng_pro_info",
      "mng_capacity",
      "space_create",
      "file_create",
      "file_upload",
      "file_list",
      "file_info",
      "file_download",
      "chunk_upload_big",
      "file_delete",
      "space_dismiss"
    ]);
    expect(report.steps.every((step) => step.ok)).toBe(true);
    expect(report.cleaned_up).toBe(true);
    expect(report.api_calls).toBeGreaterThanOrEqual(14);
  });

  it("记录下载结果，包括不带 cookie 时的状态", async () => {
    const seen: string[] = [];
    const report = await runWedriveProbe(
      env,
      {},
      {
        call: okCaller,
        fetchDownload: async (_url, cookie) => {
          seen.push(cookie);
          return cookie ? { status: 200, length: 1024 } : { status: 403, length: 0 };
        }
      }
    );
    expect(seen).toEqual(["", "c=v"]);
    expect(report.steps.find((step) => step.step === "file_download")).toMatchObject({
      ok: true,
      detail: { http_status: 200, length: 1024, status_without_cookie: 403 }
    });
  });

  it("中间一步失败仍然解散空间", async () => {
    const report = await runWedriveProbe(
      env,
      {},
      { call: failOn("file_upload", 640019), fetchDownload }
    );
    expect(report.steps.find((step) => step.step === "file_upload")).toMatchObject({
      ok: false,
      errcode: 640019
    });
    expect(report.steps.at(-1)).toMatchObject({ step: "space_dismiss", ok: true });
    expect(report.cleaned_up).toBe(true);
  });

  it("调用抛出异常时只记录，不中断后面的步骤", async () => {
    const throwing: WeComCaller = async (apiName, body) => {
      if (apiName === "file_list") throw new Error("bridge response 504");
      return okCaller(apiName, body);
    };
    const report = await runWedriveProbe(env, {}, { call: throwing, fetchDownload });
    expect(report.steps.find((step) => step.step === "file_list")).toMatchObject({
      ok: false,
      errcode: null,
      errmsg: "bridge response 504"
    });
    expect(report.cleaned_up).toBe(true);
  });

  it("big 端序分块失败时再试 little", async () => {
    const report = await runWedriveProbe(
      env,
      {},
      { call: failOn("file_upload_finish", 640030, { times: 1 }), fetchDownload }
    );
    const names = report.steps.map((step) => step.step);
    expect(names).toContain("chunk_upload_little");
    expect(report.steps.find((step) => step.step === "chunk_upload_big")).toMatchObject({
      ok: false,
      errcode: 640030
    });
    expect(report.steps.find((step) => step.step === "chunk_upload_little")).toMatchObject({
      ok: true
    });
  });

  it("分块上传的中间块报中间状态，最后一块报整个文件的 SHA1", async () => {
    const bodies: Record<string, unknown>[] = [];
    const capture: WeComCaller = async (apiName, body) => {
      if (apiName === "file_upload_init") bodies.push(body);
      return okCaller(apiName, body);
    };
    await runWedriveProbe(env, {}, { call: capture, fetchDownload });
    expect(bodies[0]).toMatchObject({ size: 3 * 1024 * 1024, skip_push_card: true });
    const blockSha = bodies[0].block_sha as string[];
    expect(blockSha).toHaveLength(2);
    expect(blockSha[0]).toMatch(/^[0-9a-f]{40}$/);
    expect(blockSha[1]).toMatch(/^[0-9a-f]{40}$/);
    expect(blockSha[0]).not.toBe(blockSha[1]);
  });

  it("建空间失败时不调用后续写接口，也不解散", async () => {
    const calls: string[] = [];
    const report = await runWedriveProbe(
      env,
      {},
      { call: recording(calls, failOn("space_create", 60020)), fetchDownload }
    );
    expect(calls).toEqual(["mng_pro_info", "mng_capacity", "space_create"]);
    expect(report.cleaned_up).toBe(false);
    expect(report.steps.find((step) => step.step === "space_dismiss")).toMatchObject({
      ok: false,
      errmsg: "skipped"
    });
  });

  it("传了外部空间时记录它的 errcode", async () => {
    const report = await runWedriveProbe(
      env,
      { foreign_spaceid: "s.x" },
      { call: failOn("file_list", 640008, { whenSpace: "s.x" }), fetchDownload }
    );
    expect(report.steps.find((step) => step.step === "foreign_file_list")).toMatchObject({
      ok: true,
      errcode: 640008
    });
  });
});
