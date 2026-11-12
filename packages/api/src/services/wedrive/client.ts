/**
 * 微盘客户端。所有微盘调用都从这里走：每一次都计数（非专业版企业每月只有 1000 次），
 * 认出限额类的错误，分块上传按实测过的规则算摘要。业务代码不直接拼微盘地址。
 * 调用经现有的 bridge 代理发出（企微要求固定 IP）。
 */
import type { Env } from "../../types/env";
import { fetchWeComAccessToken } from "../wecom-api";
import { fetchViaBridgeStrict } from "../wecom-approval-push";
import { computeBlockSha, forEachBlock } from "./block-sha";
import { countCall, getWedriveSettings } from "./settings";

export type WeComReply = { errcode: number; errmsg: string } & Record<string, unknown>;
export type WeComCaller = (
  apiName: string,
  body: Record<string, unknown>,
  options?: { timeoutMs?: number }
) => Promise<WeComReply>;

export class WedriveError extends Error {
  constructor(
    readonly apiName: string,
    readonly errcode: number | null,
    message: string
  ) {
    super(message);
    this.name = "WedriveError";
  }
}

/** 企微说超限了（640019、640035），或者本月预算用完了。碰到它要停下整个镜像。 */
export class WedriveQuotaError extends WedriveError {
  constructor(apiName: string, errcode: number | null, message: string) {
    super(apiName, errcode, message);
    this.name = "WedriveQuotaError";
  }
}

/**
 * 这份资料自己的文件有问题（存储里没有、大小对不上），和微盘那一头没关系。
 * 排空用它区分：这种失败连着几份也不说明微盘出了问题。
 */
export class SourceFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceFileError";
  }
}

export interface WedriveItem {
  fileid: string;
  file_name: string;
  file_size: number;
  file_type: number;
  sha: string | null;
}

export interface WedriveClient {
  /** 建一个没有成员的空间，返回 spaceid */
  createSpace(name: string): Promise<string>;
  /** 把公司根部门加为只能下载的成员 */
  openSpaceToCompany(spaceId: string): Promise<void>;
  createFolder(spaceId: string, parentId: string, name: string): Promise<string>;
  /** 列出一个目录下的全部内容（翻完所有页） */
  listFolder(spaceId: string, folderId: string): Promise<WedriveItem[]>;
  rename(fileId: string, newName: string): Promise<void>;
  move(fileId: string, newParentId: string): Promise<void>;
  remove(fileIds: string[]): Promise<void>;
  /** 直传：一次调用，但没法不推卡片，只许在空间还没开放时用 */
  uploadDirect(spaceId: string, parentId: string, name: string, bytes: Uint8Array): Promise<string>;
  /** 分块上传。open 会被调两次：第一次算摘要，第二次传内容 */
  uploadChunked(
    spaceId: string,
    parentId: string,
    name: string,
    size: number,
    open: () => Promise<ReadableStream<Uint8Array>>
  ): Promise<string>;
}

/** 直传的上限。文档写「10M」但没说是文件大小还是 base64 之后的大小，7 MiB 两种算法都不超 */
export const DIRECT_UPLOAD_MAX_BYTES = 7 * 1024 * 1024;

const QUOTA_ERRCODES = new Set([640019, 640035]);
const ROOT_DEPARTMENT_ID = 1;
/** 成员权限：1 是只能下载（4「可预览」要专业版，7 是管理员） */
const AUTH_DOWNLOAD_ONLY = 1;
const FILE_TYPE_FOLDER = 1;
const LIST_PAGE_SIZE = 1000;
const PART_TIMEOUT_MS = 20_000;
/** 一个分片最多发几次 */
const PART_ATTEMPTS = 3;

/** 经 bridge 代理调企微的微盘接口。 */
export const createBridgeCaller =
  (env: Env): WeComCaller =>
  async (apiName, body, options) => {
    const token = await fetchWeComAccessToken(env);
    return fetchViaBridgeStrict<WeComReply>(
      env,
      `https://qyapi.weixin.qq.com/cgi-bin/wedrive/${apiName}?access_token=${encodeURIComponent(token)}`,
      { method: "POST", body, ...(options?.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) }
    );
  };

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const pickString = (source: unknown, key: string): string | null => {
  const value = asRecord(source)?.[key];
  return typeof value === "string" && value ? value : null;
};

const toItem = (raw: unknown): WedriveItem | null => {
  const fileid = pickString(raw, "fileid");
  const name = pickString(raw, "file_name");
  if (!fileid || name === null) return null;
  const record = asRecord(raw) ?? {};
  return {
    fileid,
    file_name: name,
    file_size: Number(record.file_size ?? 0),
    file_type: Number(record.file_type ?? 0),
    sha: pickString(raw, "sha")
  };
};

export const createWedriveClient = (
  env: Env,
  deps: { call?: WeComCaller; now?: () => Date; budget?: number } = {}
): WedriveClient => {
  const call = deps.call ?? createBridgeCaller(env);
  const now = deps.now ?? (() => new Date());
  let budget: number | null = deps.budget ?? null;

  const invoke = async (
    apiName: string,
    body: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<WeComReply> => {
    if (budget === null) budget = (await getWedriveSettings(env)).monthly_budget;
    // 发之前就记：请求超时的时候，企微那边多半已经算了一次。到了预算就不记也不发。
    if ((await countCall(env, now(), budget)) === null) {
      throw new WedriveQuotaError(apiName, null, "本月微盘接口调用次数已经用到预算");
    }
    const reply = await call(apiName, body, options);
    if (reply.errcode !== 0) {
      const message = `微盘接口 ${apiName} 返回 ${reply.errcode}：${String(reply.errmsg ?? "").slice(0, 120)}`;
      throw QUOTA_ERRCODES.has(reply.errcode)
        ? new WedriveQuotaError(apiName, reply.errcode, message)
        : new WedriveError(apiName, reply.errcode, message);
    }
    return reply;
  };

  const requireString = (reply: WeComReply, key: string, apiName: string): string => {
    const value = pickString(reply, key);
    if (!value) throw new WedriveError(apiName, null, `微盘接口 ${apiName} 没有返回 ${key}`);
    return value;
  };

  /** 传一个分片；超时或一般错误重试，限额错误直接抛 */
  const uploadPart = async (uploadKey: string, index: number, content: string): Promise<void> => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await invoke(
          "file_upload_part",
          { upload_key: uploadKey, index, file_base64_content: content },
          { timeoutMs: PART_TIMEOUT_MS }
        );
        return;
      } catch (error) {
        if (error instanceof WedriveQuotaError || attempt >= PART_ATTEMPTS) throw error;
      }
    }
  };

  return {
    createSpace: async (name) =>
      requireString(await invoke("space_create", { space_name: name }), "spaceid", "space_create"),

    openSpaceToCompany: async (spaceId) => {
      await invoke("space_acl_add", {
        spaceid: spaceId,
        auth_info: [{ type: 2, departmentid: ROOT_DEPARTMENT_ID, auth: AUTH_DOWNLOAD_ONLY }]
      });
    },

    createFolder: async (spaceId, parentId, name) =>
      requireString(
        await invoke("file_create", {
          spaceid: spaceId,
          fatherid: parentId,
          file_type: FILE_TYPE_FOLDER,
          file_name: name
        }),
        "fileid",
        "file_create"
      ),

    listFolder: async (spaceId, folderId) => {
      let items: WedriveItem[] = [];
      let start = 0;
      for (;;) {
        const reply = await invoke("file_list", {
          spaceid: spaceId,
          fatherid: folderId,
          sort_type: 1,
          start,
          limit: LIST_PAGE_SIZE
        });
        const raw = asRecord(reply.file_list)?.item;
        const page = (Array.isArray(raw) ? raw : []).flatMap((entry) => {
          const item = toItem(entry);
          return item ? [item] : [];
        });
        items = [...items, ...page];
        const next = Number(reply.next_start);
        if (reply.has_more !== true || !Number.isInteger(next) || next <= start) return items;
        start = next;
      }
    },

    rename: async (fileId, newName) => {
      await invoke("file_rename", { fileid: fileId, new_name: newName });
    },

    move: async (fileId, newParentId) => {
      await invoke("file_move", { fatherid: newParentId, replace: false, fileid: [fileId] });
    },

    remove: async (fileIds) => {
      if (fileIds.length === 0) return;
      await invoke("file_delete", { fileid: [...fileIds] });
    },

    uploadDirect: async (spaceId, parentId, name, bytes) => {
      if (bytes.length > DIRECT_UPLOAD_MAX_BYTES) {
        throw new Error("文件太大，不能用直传");
      }
      return requireString(
        await invoke(
          "file_upload",
          {
            spaceid: spaceId,
            fatherid: parentId,
            file_name: name,
            file_base64_content: toBase64(bytes)
          },
          { timeoutMs: PART_TIMEOUT_MS }
        ),
        "fileid",
        "file_upload"
      );
    },

    uploadChunked: async (spaceId, parentId, name, size, open) => {
      // 第一遍：算出每一块的累积摘要（init 时就要全部交上去）
      const digest = await computeBlockSha(await open());
      if (digest.size !== size) throw new SourceFileError("文件大小和记录的不一样");
      const init = await invoke("file_upload_init", {
        spaceid: spaceId,
        fatherid: parentId,
        file_name: name,
        size,
        block_sha: digest.block_sha,
        skip_push_card: true
      });
      // 命中秒传：微盘里已经有一样内容的文件，直接给了 fileid
      const instant = pickString(init, "fileid");
      if (instant) return instant;
      const uploadKey = requireString(init, "upload_key", "file_upload_init");
      // 第二遍：按 2 MiB 一块依次传
      await forEachBlock(await open(), (block, index) =>
        uploadPart(uploadKey, index + 1, toBase64(block))
      );
      return requireString(
        await invoke("file_upload_finish", { upload_key: uploadKey }),
        "fileid",
        "file_upload_finish"
      );
    }
  };
};
