/** 上传设备资料用的纯函数：切片、按片上传带重试、猜资料类别、文件夹导入时的分组和设备匹配。 */
import type {
  DocCategory,
  DocLibraryConfig,
  DocUploadInit,
  DocUploadedPart
} from "@/api/wh/doc-library-types";

import { formatFileSize } from "./doc-view";

const TITLE_MAX = 120;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const CANCELLED = "已取消";

export interface PartRange {
  partNumber: number;
  start: number;
  end: number;
}

/** 按固定大小切片；最后一片是剩下的，正好整除时不多出空片。 */
export const splitParts = (size: number, partSize: number): PartRange[] => {
  if (!(size > 0) || !(partSize > 0)) return [];
  return Array.from({ length: Math.ceil(size / partSize) }, (_, index) => ({
    partNumber: index + 1,
    start: index * partSize,
    end: Math.min(size, (index + 1) * partSize)
  }));
};

export interface UploadDeps {
  init: (input: {
    file_name: string;
    file_size: number;
  }) => Promise<DocUploadInit>;
  putPart: (
    token: string,
    partNumber: number,
    blob: Blob,
    signal?: AbortSignal
  ) => Promise<DocUploadedPart>;
  abort: (token: string) => Promise<unknown>;
  /** 每一片最多传几次，默认 3 */
  retries?: number;
  /** 重传前等多久，默认 1 秒 */
  retryDelayMs?: number;
  /** 取消上传 */
  signal?: AbortSignal;
}

export interface UploadedFile {
  upload_token: string;
  parts: DocUploadedPart[];
}

const wait = (ms: number): Promise<void> =>
  ms > 0 ? new Promise(resolve => setTimeout(resolve, ms)) : Promise.resolve();

/**
 * 初始化后一片一片地传。一片失败自动重传，传满次数还不行就放弃这次上传并报「第 N 片上传失败」。
 * onProgress 收到的是已经传完的字节数。返回完成请求要用的令牌和分片清单。
 */
export const uploadFileInParts = async (
  file: Blob,
  name: string,
  deps: UploadDeps,
  onProgress: (sentBytes: number) => void
): Promise<UploadedFile> => {
  const started = await deps.init({ file_name: name, file_size: file.size });
  const token = started.upload_token;
  const retries = Math.max(1, deps.retries ?? DEFAULT_RETRIES);
  const delay = deps.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const cancelled = () => Boolean(deps.signal?.aborted);

  const giveUp = async (message: string): Promise<never> => {
    // 放弃失败也不要紧：没完成的分片上传 R2 会自己清掉
    await deps.abort(token).catch(() => undefined);
    throw new Error(message);
  };

  const sendPart = async (
    piece: PartRange
  ): Promise<DocUploadedPart | null> => {
    const blob = file.slice(piece.start, piece.end);
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        return await deps.putPart(token, piece.partNumber, blob, deps.signal);
      } catch {
        if (cancelled() || attempt === retries) return null;
        await wait(delay);
      }
    }
    return null;
  };

  let parts: DocUploadedPart[] = [];
  for (const piece of splitParts(file.size, started.part_size)) {
    if (cancelled()) return giveUp(CANCELLED);
    const uploaded = await sendPart(piece);
    if (!uploaded) {
      return giveUp(
        cancelled() ? CANCELLED : `第 ${piece.partNumber} 片上传失败`
      );
    }
    parts = [...parts, uploaded];
    onProgress(piece.end);
  }
  return { upload_token: token, parts };
};

const CATEGORY_KEYWORDS: readonly [DocCategory, readonly string[]][] = [
  ["cert", ["合格证"]],
  ["report", ["检测", "报告", "检定"]],
  ["params", ["参数"]],
  ["manual", ["说明书", "手册"]],
  ["maintenance", ["维修", "保养"]]
];

/** 按名字里的关键字猜资料类别，猜不出来是「其他」。 */
export const guessDocCategory = (fileName: string): DocCategory => {
  const text = String(fileName ?? "");
  const hit = CATEGORY_KEYWORDS.find(([, words]) =>
    words.some(word => text.includes(word))
  );
  return hit ? hit[0] : "other";
};

const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 && dot < fileName.length - 1
    ? fileName.slice(dot + 1).toLowerCase()
    : "";
};

/** 文件名去掉扩展名当标题，最长 120 个字。 */
export const titleFromFileName = (fileName: string): string => {
  const name = String(fileName ?? "").trim();
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return stem.slice(0, TITLE_MAX);
};

/** 传之前就能看出来的问题；没有问题返回空串。 */
export const uploadProblem = (
  file: { name: string; size: number },
  config: Pick<DocLibraryConfig, "extensions" | "max_bytes">
): string => {
  const extension = extensionOf(file.name);
  if (!extension) return "不支持没有扩展名的文件";
  if (!config.extensions.includes(extension))
    return `不支持 .${extension} 文件`;
  if (!(file.size > 0)) return "文件是空的";
  if (file.size > config.max_bytes) {
    return `文件超过 ${formatFileSize(config.max_bytes)} 的上限`;
  }
  return "";
};

// ─── 文件夹导入 ──────────────────────────────────────────────

export interface ImportDevice {
  id: number;
  device_code: string;
  name: string;
  alias: string | null;
}
export interface FolderImportFile {
  file: File;
  title: string;
  category: DocCategory;
}
export interface FolderImportGroup {
  /** 文件夹名；空串是不在任何子文件夹里的散文件 */
  folder: string;
  deviceId: number | null;
  matchedBy: "code" | "name" | null;
  files: FolderImportFile[];
}

const JUNK_NAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);
const isJunk = (name: string): boolean =>
  JUNK_NAMES.has(name.toLowerCase()) || name.startsWith("~$");

type DeviceMatch = Pick<FolderImportGroup, "deviceId" | "matchedBy">;
const NO_MATCH: DeviceMatch = { deviceId: null, matchedBy: null };

/**
 * 文件夹名里含设备编号（不分大小写，几个都含时取最长的），或者等于设备名称、现场叫法，就算对上。
 * 名称对上不止一台时不猜，留给人选。
 */
const matchDevice = (
  folder: string,
  devices: readonly ImportDevice[]
): DeviceMatch => {
  const name = folder.trim();
  if (!name) return NO_MATCH;
  const lower = name.toLowerCase();
  const byCode = devices
    .filter(device => {
      const code = device.device_code.trim().toLowerCase();
      return code !== "" && lower.includes(code);
    })
    .sort((a, b) => b.device_code.length - a.device_code.length)[0];
  if (byCode) return { deviceId: byCode.id, matchedBy: "code" };
  const byName = devices.filter(
    device => device.name.trim() === name || device.alias?.trim() === name
  );
  return byName.length === 1
    ? { deviceId: byName[0].id, matchedBy: "name" }
    : NO_MATCH;
};

/** 先看文件名，再由近到远看它所在的各级文件夹名。 */
const categoryFromPath = (
  fileName: string,
  folders: readonly string[]
): DocCategory =>
  [fileName, ...[...folders].reverse()]
    .map(guessDocCategory)
    .find(category => category !== "other") ?? "other";

interface ImportEntry {
  file: File;
  name: string;
  /** 文件所在的各级文件夹，从外到内 */
  dirs: string[];
}

/**
 * 把选中（或拖进来）的一批文件按设备文件夹分组，并试着对上设备。
 * - 选的是总文件夹（下面一个子文件夹一台设备）：按一级子文件夹分组，总文件夹下的散文件归到 folder 为空的一组；
 * - 选的文件夹本身就是一台设备，或者里面只有文件：整个文件夹一组；
 * - 一次拖进来几个文件夹：各自一组。
 * 分组和匹配只是建议，页面上每组都能改设备、改类别或跳过。
 */
export const groupFolderImport = (
  files: readonly { path: string; file: File }[],
  devices: readonly ImportDevice[]
): FolderImportGroup[] => {
  const entries: ImportEntry[] = files
    .map(item => {
      const segments = item.path.replace(/\\/g, "/").split("/").filter(Boolean);
      return {
        file: item.file,
        name: segments[segments.length - 1] ?? item.file.name,
        dirs: segments.slice(0, -1)
      };
    })
    .filter(entry => entry.name !== "" && !isJunk(entry.name));
  if (entries.length === 0) return [];

  const roots = new Set(
    entries.filter(entry => entry.dirs.length > 0).map(entry => entry.dirs[0])
  );
  const singleRoot =
    roots.size === 1 && entries.every(entry => entry.dirs.length > 0);
  const root = singleRoot ? [...roots][0] : "";
  // 只有一个总文件夹、它自己对不上设备、下面还有子文件夹：把它当总文件夹剥掉一层
  const stripRoot =
    singleRoot &&
    matchDevice(root, devices).deviceId === null &&
    entries.some(entry => entry.dirs.length > 1);
  const depth = stripRoot ? 1 : 0;

  const grouped = entries.reduce((map, entry) => {
    const folder = entry.dirs[depth] ?? "";
    const item: FolderImportFile = {
      file: entry.file,
      title: titleFromFileName(entry.name),
      category: categoryFromPath(entry.name, entry.dirs.slice(depth))
    };
    return new Map(map).set(folder, [...(map.get(folder) ?? []), item]);
  }, new Map<string, FolderImportFile[]>());

  return [...grouped.entries()].map(([folder, groupFiles]) => ({
    folder,
    ...matchDevice(folder, devices),
    files: groupFiles
  }));
};
