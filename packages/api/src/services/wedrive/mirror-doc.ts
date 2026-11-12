/**
 * 把一份资料在微盘里的样子对到应该的样子（对账）。
 * 应该的样子只看库里这一行：没删、是最新版 → 该在某个目录里、叫某个名字；已删除或被替换 → 不该在微盘里。
 * 任何触发（新增、改名、换归属、替换、删除、重试）都走这一个函数，所以重复触发是安全的。
 */
import type { Env } from "../../types/env";
import type { DocFile } from "../../types/wh";
import { extensionOf } from "../doc-library/file-types";
import { IS_LATEST } from "../doc-library/query";
import {
  DIRECT_UPLOAD_MAX_BYTES,
  WedriveError,
  WedriveQuotaError,
  type WedriveClient
} from "./client";
import { ensureFolder, loadFolderChain, safeFolderName } from "./folders";
import type { WedriveSettings } from "./settings";

export type MirrorOutcome = "synced" | "skipped" | "removed" | "unchanged";

export const SKIPPED_TOO_LARGE = "超过镜像大小上限";
const FILE_TYPE_FOLDER = 1;
const nowIso = () => new Date().toISOString();

/** 微盘里的文件名：标题 + 原文件的扩展名，去掉不能用的字符。 */
export const wedriveFileName = (title: string, fileName: string): string => {
  const base = safeFolderName(title);
  const extension = extensionOf(fileName);
  if (!extension || base.toLowerCase().endsWith(`.${extension}`)) return base;
  return `${base}.${extension}`;
};

/** "a.pdf" + 2 → "a（2）.pdf" */
const numbered = (name: string, n: number): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}（${n}）${name.slice(dot)}` : `${name}（${n}）`;
};

/** 现在的名字是不是「想要的名字」或它加了（n）的样子：是的话就不用改名 */
const isVariantOf = (current: string, wanted: string): boolean => {
  if (current === wanted) return true;
  const dot = wanted.lastIndexOf(".");
  const stem = dot > 0 ? wanted.slice(0, dot) : wanted;
  const ext = dot > 0 ? wanted.slice(dot) : "";
  if (!current.startsWith(`${stem}（`) || !current.endsWith(`）${ext}`)) return false;
  const middle = current.slice(stem.length + 1, current.length - ext.length - 1);
  return /^\d+$/.test(middle);
};

/**
 * 在目标目录里给这份资料定一个不重名的名字。重名由我们自己加（2）（3），不依赖微盘怎么处理重名（没实测过）。
 * 只看库里记着的名字，不去列微盘的目录。
 */
const pickName = async (
  env: Env,
  doc: DocFile,
  folderKey: string,
  wanted: string
): Promise<string> => {
  if (
    doc.wedrive_name &&
    doc.wedrive_folder_key === folderKey &&
    isVariantOf(doc.wedrive_name, wanted)
  ) {
    return doc.wedrive_name;
  }
  const rows = await env.DB.prepare(
    `SELECT wedrive_name FROM doc_file
      WHERE wedrive_folder_key = ? AND wedrive_name IS NOT NULL AND id <> ?`
  )
    .bind(folderKey, doc.id)
    .all<{ wedrive_name: string }>();
  const taken = new Set((rows.results ?? []).map((row) => row.wedrive_name));
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) {
    if (!taken.has(numbered(wanted, n))) return numbered(wanted, n);
  }
};

/**
 * 记下这份资料在微盘里的样子。状态只在这一行还是 syncing 时才改成 synced：
 * 对的过程中有人又改了它（被重新标成 pending）的话，文件 ID 照记，状态留给下一轮。
 */
const markSynced = async (
  env: Env,
  docId: number,
  mirror: { fileid: string | null; name: string | null; folderKey: string | null }
): Promise<void> => {
  const now = nowIso();
  await env.DB.prepare(
    `UPDATE doc_file
        SET mirror_status = CASE WHEN mirror_status = 'syncing' THEN 'synced' ELSE mirror_status END,
            mirror_error = CASE WHEN mirror_status = 'syncing' THEN NULL ELSE mirror_error END,
            mirrored_at = ?, wedrive_fileid = ?, wedrive_name = ?, wedrive_folder_key = ?
      WHERE id = ?`
  )
    .bind(now, mirror.fileid, mirror.name, mirror.folderKey, docId)
    .run();
};

/** 上传之前先记下打算放哪、叫什么（文件 ID 还空着）：传完没来得及记的话，下次按这个去找。 */
const recordUploadIntent = async (
  env: Env,
  docId: number,
  name: string,
  folderKey: string
): Promise<void> => {
  await env.DB.prepare(
    "UPDATE doc_file SET wedrive_fileid = NULL, wedrive_name = ?, wedrive_folder_key = ? WHERE id = ?"
  )
    .bind(name, folderKey, docId)
    .run();
};

const openObject = async (env: Env, fileKey: string): Promise<R2ObjectBody> => {
  const object = await env.FILES.get(fileKey);
  if (!object) throw new Error("文件不在存储里");
  return object;
};

/** 目标目录里有没有同名同大小的文件（上次传成了但没来得及记下来）。 */
const findUploaded = async (
  client: WedriveClient,
  spaceId: string,
  folderId: string,
  name: string,
  size: number
): Promise<string | null> => {
  const items = await client.listFolder(spaceId, folderId);
  const match = items.find(
    (item) =>
      item.file_type !== FILE_TYPE_FOLDER && item.file_name === name && item.file_size === size
  );
  return match ? match.fileid : null;
};

const upload = async (
  env: Env,
  client: WedriveClient,
  settings: WedriveSettings,
  doc: DocFile,
  spaceId: string,
  folderId: string,
  name: string
): Promise<string> => {
  const size = Number(doc.file_size);
  const chunked = () =>
    client.uploadChunked(
      spaceId,
      folderId,
      name,
      size,
      async () => (await openObject(env, doc.file_key)).body
    );
  // 空间开放之后不用直传：直传没法不给成员推卡片
  if (settings.space_open || size > DIRECT_UPLOAD_MAX_BYTES) return chunked();
  const bytes = new Uint8Array(await (await openObject(env, doc.file_key)).arrayBuffer());
  try {
    return await client.uploadDirect(spaceId, folderId, name, bytes);
  } catch (error) {
    if (error instanceof WedriveQuotaError) throw error;
    // 企微明确拒绝了（有错误码）：文件肯定没传上，直接改分块。
    // 超时这类说不清的：可能其实传上了，先看一眼，免得微盘里出现两份。
    if (!(error instanceof WedriveError)) {
      const existing = await findUploaded(client, spaceId, folderId, name, size);
      if (existing) return existing;
    }
    return chunked();
  }
};

/**
 * 库里没有文件 ID、但留着「打算放哪、叫什么」：上次开始传过。去那个目录里按名字和大小找，找到就是它。
 * 没开始传过的（两项都空）不找，省一次调用。
 */
const findFromIntent = async (
  env: Env,
  client: WedriveClient,
  spaceId: string,
  doc: DocFile
): Promise<string | null> => {
  if (!doc.wedrive_name || !doc.wedrive_folder_key) return null;
  const folder = await env.DB.prepare("SELECT fileid FROM wedrive_folder WHERE folder_key = ?")
    .bind(doc.wedrive_folder_key)
    .first<{ fileid: string }>();
  if (!folder) return null;
  return findUploaded(client, spaceId, folder.fileid, doc.wedrive_name, Number(doc.file_size));
};

/**
 * 出错就抛（WedriveQuotaError 原样抛），由调用方记失败。调用方已经把这一行标成 syncing。
 */
export const reconcileDoc = async (
  env: Env,
  client: WedriveClient,
  settings: WedriveSettings,
  docId: number
): Promise<MirrorOutcome> => {
  const doc = await env.DB.prepare(
    `SELECT f.*, (${IS_LATEST}) AS is_latest FROM doc_file f WHERE f.id = ?`
  )
    .bind(docId)
    .first<DocFile & { is_latest: number }>();
  if (!doc || !settings.space_id) return "unchanged";
  const spaceId = settings.space_id;

  // 这份资料现在在微盘里的文件：记着的，或者上次传完没来得及记的
  const fileId = doc.wedrive_fileid ?? (await findFromIntent(env, client, spaceId, doc));

  const shouldExist = doc.deleted_at === null && Number(doc.is_latest) === 1;
  if (!shouldExist) {
    if (fileId) await client.remove([fileId]);
    await markSynced(env, doc.id, { fileid: null, name: null, folderKey: null });
    return fileId ? "removed" : "unchanged";
  }

  if (!fileId && Number(doc.file_size) > settings.mirror_max_bytes) {
    await env.DB.prepare(
      `UPDATE doc_file SET mirror_status = 'skipped', mirror_error = ?,
              wedrive_name = NULL, wedrive_folder_key = NULL
        WHERE id = ? AND mirror_status = 'syncing'`
    )
      .bind(SKIPPED_TOO_LARGE, doc.id)
      .run();
    return "skipped";
  }

  const folder = await ensureFolder(env, client, spaceId, await loadFolderChain(env, doc));
  const name = await pickName(env, doc, folder.key, wedriveFileName(doc.title, doc.file_name));

  if (fileId) {
    const renamed = doc.wedrive_name !== name;
    const moved = doc.wedrive_folder_key !== folder.key;
    if (renamed) await client.rename(fileId, name);
    if (moved) await client.move(fileId, folder.fileid);
    await markSynced(env, doc.id, { fileid: fileId, name, folderKey: folder.key });
    return renamed || moved || !doc.wedrive_fileid ? "synced" : "unchanged";
  }

  await recordUploadIntent(env, doc.id, name, folder.key);
  const uploaded = await upload(env, client, settings, doc, spaceId, folder.fileid, name);
  await markSynced(env, doc.id, { fileid: uploaded, name, folderKey: folder.key });
  return "synced";
};
