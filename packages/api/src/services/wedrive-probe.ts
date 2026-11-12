/**
 * 企微微盘接口探测：在一个临时空间里走一遍建空间、建目录、直传、列目录、取信息、下载、分块上传、删除、解散，
 * 把每一步的结果报回来。用来回答设计稿里三个没法从文档确认的问题：
 * 有没有月调用上限、分块上传的累积 sha 怎么算、自建应用能不能读成员手建的空间。
 *
 * 任一步失败只记录不抛出；只要临时空间建成了，最后一定尝试解散它。
 */
import type { Env } from "../types/env";
import { sha1StateHex } from "./sha1-state";
import { createBridgeCaller, type WeComCaller, type WeComReply } from "./wedrive/client";

export type { WeComCaller, WeComReply };

type Scalar = string | number | boolean | null;

export interface WedriveProbeStep {
  step: string;
  ok: boolean;
  errcode: number | null;
  errmsg: string | null;
  detail?: Record<string, Scalar>;
}

export interface WedriveProbeReport {
  started_at: string;
  finished_at: string;
  steps: WedriveProbeStep[];
  cleaned_up: boolean;
  api_calls: number;
}

export type DownloadFetcher = (
  url: string,
  cookie: string
) => Promise<{ status: number; length: number }>;

const SMALL_FILE_BYTES = 1024;
const CHUNK_BYTES = 2 * 1024 * 1024;
const BIG_FILE_BYTES = 3 * 1024 * 1024;

const defaultFetchDownload: DownloadFetcher = async (url, cookie) => {
  const response = await fetch(url, { headers: cookie ? { Cookie: cookie } : {} });
  const buffer = await response.arrayBuffer();
  return { status: response.status, length: buffer.byteLength };
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const toHex = (buffer: ArrayBuffer): string =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const patternBytes = (length: number, seed: number): Uint8Array =>
  new Uint8Array(length).map((_, index) => (index * 31 + seed) % 251);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const pickString = (source: unknown, key: string): string | null => {
  const value = asRecord(source)?.[key];
  return typeof value === "string" && value ? value : null;
};

const pickNumber = (source: unknown, key: string): number | null => {
  const value = asRecord(source)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface Outcome {
  reply: WeComReply | null;
  errcode: number | null;
  errmsg: string | null;
}

const succeeded = (outcome: Outcome): boolean => outcome.reply !== null && outcome.errcode === 0;

export const runWedriveProbe = async (
  env: Env,
  options: { foreign_spaceid?: string },
  deps: { call?: WeComCaller; fetchDownload?: DownloadFetcher } = {}
): Promise<WedriveProbeReport> => {
  const call = deps.call ?? createBridgeCaller(env);
  const fetchDownload = deps.fetchDownload ?? defaultFetchDownload;
  const startedAt = new Date().toISOString();
  const steps: WedriveProbeStep[] = [];
  let apiCalls = 0;

  const invoke = async (apiName: string, body: Record<string, unknown>): Promise<Outcome> => {
    apiCalls += 1;
    try {
      const reply = await call(apiName, body);
      return {
        reply,
        errcode: typeof reply.errcode === "number" ? reply.errcode : null,
        errmsg: typeof reply.errmsg === "string" ? reply.errmsg : null
      };
    } catch (error) {
      return { reply: null, errcode: null, errmsg: errorMessage(error) };
    }
  };

  const record = (
    step: string,
    outcome: Outcome,
    ok: boolean,
    detail?: Record<string, Scalar>
  ): boolean => {
    steps.push({
      step,
      ok,
      errcode: outcome.errcode,
      errmsg: outcome.errmsg,
      ...(detail ? { detail } : {})
    });
    return ok;
  };

  const skip = (step: string): void => {
    steps.push({ step, ok: false, errcode: null, errmsg: "skipped" });
  };

  const proInfo = await invoke("mng_pro_info", {});
  record("mng_pro_info", proInfo, succeeded(proInfo), { is_pro: Boolean(proInfo.reply?.is_pro) });

  const capacity = await invoke("mng_capacity", {});
  record("mng_capacity", capacity, succeeded(capacity), {
    total_capacity_for_all: pickNumber(capacity.reply, "total_capacity_for_all"),
    total_capacity_for_vip: pickNumber(capacity.reply, "total_capacity_for_vip")
  });

  const created = await invoke("space_create", {
    space_name: `接口验证-可删除-${startedAt}`,
    space_sub_type: 0
  });
  const spaceId = succeeded(created) ? pickString(created.reply, "spaceid") : null;
  record("space_create", created, spaceId !== null, { spaceid: spaceId });

  let folderId: string | null = null;
  if (spaceId) {
    const folder = await invoke("file_create", {
      spaceid: spaceId,
      fatherid: spaceId,
      file_type: 1,
      file_name: "验证目录"
    });
    folderId = succeeded(folder) ? pickString(folder.reply, "fileid") : null;
    record("file_create", folder, folderId !== null, { fileid: folderId });
  } else {
    skip("file_create");
  }

  let smallFileId: string | null = null;
  if (spaceId && folderId) {
    const upload = await invoke("file_upload", {
      spaceid: spaceId,
      fatherid: folderId,
      file_name: "probe.txt",
      file_base64_content: toBase64(patternBytes(SMALL_FILE_BYTES, 7))
    });
    smallFileId = succeeded(upload) ? pickString(upload.reply, "fileid") : null;
    record("file_upload", upload, smallFileId !== null, { fileid: smallFileId });
  } else {
    skip("file_upload");
  }

  if (spaceId && folderId) {
    const listed = await invoke("file_list", {
      spaceid: spaceId,
      fatherid: folderId,
      sort_type: 1,
      start: 0,
      limit: 100
    });
    const items = asRecord(listed.reply?.file_list)?.item;
    record("file_list", listed, succeeded(listed), {
      count: Array.isArray(items) ? items.length : null
    });
  } else {
    skip("file_list");
  }

  if (smallFileId) {
    const info = await invoke("file_info", { fileid: smallFileId });
    const fileInfo = asRecord(info.reply?.file_info);
    record("file_info", info, succeeded(info), {
      has_sha: Boolean(fileInfo?.sha),
      has_mtime: Boolean(fileInfo?.mtime)
    });
  } else {
    skip("file_info");
  }

  if (smallFileId) {
    const download = await invoke("file_download", { fileid: smallFileId });
    const url = pickString(download.reply, "download_url");
    const cookieName = pickString(download.reply, "cookie_name");
    const cookieValue = pickString(download.reply, "cookie_value");
    if (!succeeded(download) || !url) {
      record("file_download", download, false);
    } else {
      try {
        const withoutCookie = await fetchDownload(url, "");
        const cookie = cookieName && cookieValue ? `${cookieName}=${cookieValue}` : "";
        const withCookie = await fetchDownload(url, cookie);
        record(
          "file_download",
          download,
          withCookie.status === 200 && withCookie.length === SMALL_FILE_BYTES,
          {
            http_status: withCookie.status,
            length: withCookie.length,
            status_without_cookie: withoutCookie.status
          }
        );
      } catch (error) {
        record("file_download", { ...download, errmsg: errorMessage(error) }, false);
      }
    }
  } else {
    skip("file_download");
  }

  const chunkFileIds: string[] = [];
  if (spaceId && folderId) {
    const bigFile = patternBytes(BIG_FILE_BYTES, 13);
    const wholeSha = toHex(await crypto.subtle.digest("SHA-1", bigFile));
    const chunks = [bigFile.subarray(0, CHUNK_BYTES), bigFile.subarray(CHUNK_BYTES)];

    const uploadChunks = async (step: string, endian: "big" | "little"): Promise<boolean> => {
      const init = await invoke("file_upload_init", {
        spaceid: spaceId,
        fatherid: folderId,
        file_name: `probe-chunk-${endian}.bin`,
        size: BIG_FILE_BYTES,
        block_sha: [sha1StateHex(chunks[0], endian), wholeSha],
        skip_push_card: true
      });
      if (!succeeded(init)) return record(step, init, false);
      const instantId = pickString(init.reply, "fileid");
      if (instantId) {
        chunkFileIds.push(instantId);
        return record(step, init, true, { fileid: instantId, instant: true });
      }
      const uploadKey = pickString(init.reply, "upload_key");
      if (!uploadKey) return record(step, init, false);
      for (const [index, chunk] of chunks.entries()) {
        const part = await invoke("file_upload_part", {
          upload_key: uploadKey,
          index: index + 1,
          file_base64_content: toBase64(chunk)
        });
        if (!succeeded(part)) return record(step, part, false, { failed_part: index + 1 });
      }
      const finish = await invoke("file_upload_finish", { upload_key: uploadKey });
      const fileId = succeeded(finish) ? pickString(finish.reply, "fileid") : null;
      if (fileId) chunkFileIds.push(fileId);
      return record(step, finish, fileId !== null, { fileid: fileId });
    };

    const bigOk = await uploadChunks("chunk_upload_big", "big");
    if (!bigOk) await uploadChunks("chunk_upload_little", "little");
  } else {
    skip("chunk_upload_big");
  }

  if (options.foreign_spaceid) {
    const foreign = await invoke("file_list", {
      spaceid: options.foreign_spaceid,
      fatherid: options.foreign_spaceid,
      sort_type: 1,
      start: 0,
      limit: 1
    });
    record("foreign_file_list", foreign, foreign.reply !== null);
  }

  const uploadedIds = [smallFileId, ...chunkFileIds].filter((id): id is string => Boolean(id));
  if (uploadedIds.length > 0) {
    const deleted = await invoke("file_delete", { fileid: uploadedIds });
    record("file_delete", deleted, succeeded(deleted), { count: uploadedIds.length });
  } else {
    skip("file_delete");
  }

  let cleanedUp = false;
  if (spaceId) {
    const dismissed = await invoke("space_dismiss", { spaceid: spaceId });
    cleanedUp = record("space_dismiss", dismissed, succeeded(dismissed));
  } else {
    skip("space_dismiss");
  }

  return {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    steps,
    cleaned_up: cleanedUp,
    api_calls: apiCalls
  };
};
