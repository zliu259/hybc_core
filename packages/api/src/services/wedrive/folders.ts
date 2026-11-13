/**
 * 微盘里的目录：<设备类别>/<设备编号 设备名称>/，归到类别的在 <设备类别>/通用/，通用资料在根下的 通用/。
 * 建过的目录记在 wedrive_folder 里，按「哪个类别、哪台设备」记，不按路径记：
 * 设备改名或换类别后，下次镜像它的资料时把同一个目录改名或移过去，不新建。
 */
import type { Env } from "../../types/env";
import type { WedriveFolder } from "../../types/wh";
import { WedriveError, WedriveQuotaError, type WedriveClient } from "./client";

const isQuota = (error: unknown): boolean => error instanceof WedriveQuotaError;

export interface FolderTarget {
  key: string;
  name: string;
  /** 上一级的 key；直接在空间根下的是 null */
  parentKey: string | null;
}

export interface FolderLookup {
  device(id: number): { device_code: string; name: string; category_id: number | null } | null;
  category(id: number): { name: string } | null;
}

const GENERAL_NAME = "通用";
const UNCATEGORIZED_NAME = "未分类";
const GENERAL: FolderTarget = { key: "general", name: GENERAL_NAME, parentKey: null };
const UNCATEGORIZED: FolderTarget = {
  key: "uncategorized",
  name: UNCATEGORIZED_NAME,
  parentKey: null
};
const MAX_NAME_LENGTH = 80;
/** 文件系统里常见的不能用的字符，换成全角的 */
const UNSAFE_CHARS: Record<string, string> = {
  "/": "／",
  "\\": "＼",
  ":": "：",
  "*": "＊",
  "?": "？",
  '"': "＂",
  "<": "＜",
  ">": "＞",
  "|": "｜"
};

/** 目录名和文件名里不能用的字符换成全角，控制字符去掉，首尾空白去掉，最长 80 个字。 */
export const safeFolderName = (name: string): string => {
  const cleaned = [...name]
    .filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)
    .map((char) => UNSAFE_CHARS[char] ?? char)
    .join("")
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return cleaned || "未命名";
};

const categoryTarget = (id: number, name: string): FolderTarget => {
  const safe = safeFolderName(name);
  // 类别正好叫「通用」「未分类」时，别和根下固定的那两个目录撞名
  const clash = safe === GENERAL_NAME || safe === UNCATEGORIZED_NAME;
  return { key: `category:${id}`, name: clash ? `${safe}（类别）` : safe, parentKey: null };
};

/** 这份资料该放的目录，从外到里的一串（第一个在空间根下，最后一个就是放文件的地方）。 */
export const folderChainFor = (
  doc: { device_id: number | null; device_category_id: number | null },
  lookup: FolderLookup
): FolderTarget[] => {
  if (doc.device_id !== null) {
    const device = lookup.device(doc.device_id);
    if (!device) return [GENERAL];
    const category = device.category_id === null ? null : lookup.category(device.category_id);
    const parent =
      category && device.category_id !== null
        ? categoryTarget(device.category_id, category.name)
        : UNCATEGORIZED;
    return [
      parent,
      {
        key: `device:${doc.device_id}`,
        name: safeFolderName(`${device.device_code} ${device.name}`),
        parentKey: parent.key
      }
    ];
  }
  if (doc.device_category_id !== null) {
    const category = lookup.category(doc.device_category_id);
    if (!category) return [GENERAL];
    const parent = categoryTarget(doc.device_category_id, category.name);
    return [
      parent,
      {
        key: `category-general:${doc.device_category_id}`,
        name: GENERAL_NAME,
        parentKey: parent.key
      }
    ];
  }
  return [GENERAL];
};

/** 从库里查出这份资料的设备和类别，拼出目录。 */
export const loadFolderChain = async (
  env: Env,
  doc: { device_id: number | null; device_category_id: number | null }
): Promise<FolderTarget[]> => {
  const device =
    doc.device_id === null
      ? null
      : await env.DB.prepare("SELECT device_code, name, category_id FROM device WHERE id = ?")
          .bind(doc.device_id)
          .first<{ device_code: string; name: string; category_id: number | null }>();
  const categoryId = device ? device.category_id : doc.device_category_id;
  const category =
    categoryId === null || categoryId === undefined
      ? null
      : await env.DB.prepare("SELECT name FROM device_category WHERE id = ?")
          .bind(categoryId)
          .first<{ name: string }>();
  return folderChainFor(doc, {
    device: () => device ?? null,
    category: () => category ?? null
  });
};

const nowIso = () => new Date().toISOString();

const cachedFolder = (env: Env, key: string): Promise<WedriveFolder | null> =>
  env.DB.prepare("SELECT * FROM wedrive_folder WHERE folder_key = ?")
    .bind(key)
    .first<WedriveFolder>();

const FILE_TYPE_FOLDER = 1;
/** 记了打算建、还没拿到文件夹 ID 的目录，fileid 先存空串 */
const NOT_CREATED = "";

const setFolderId = async (env: Env, key: string, fileid: string): Promise<void> => {
  await env.DB.prepare("UPDATE wedrive_folder SET fileid = ?, updated_at = ? WHERE folder_key = ?")
    .bind(fileid, nowIso(), key)
    .run();
};

/**
 * 把一个目录在微盘里建出来，返回它的 ID。
 * 先在库里记下「打算建」（fileid 空着），再去建：建上了但没收到答复的话，这一趟直接抛出；
 * 下一趟看到这条「打算建」，先在上一级目录里按名字找，找到就用它，免得微盘里出现两个同名目录。
 * 不在同一趟里马上重建：超时的那次请求可能晚一点才落地。
 */
const createFolder = async (
  env: Env,
  client: WedriveClient,
  spaceId: string,
  parentId: string,
  target: FolderTarget,
  intended: WedriveFolder | null
): Promise<string> => {
  if (!intended) {
    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO wedrive_folder (folder_key, fileid, name, parent_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(target.key, NOT_CREATED, target.name, target.parentKey, now, now)
      .run();
  }
  const name = intended ? intended.name : target.name;
  const landed = intended
    ? (await client.listFolder(spaceId, parentId)).find(
        (item) => item.file_type === FILE_TYPE_FOLDER && item.file_name === name
      )
    : undefined;
  if (landed) {
    await setFolderId(env, target.key, landed.fileid);
    return landed.fileid;
  }
  try {
    const fileid = await client.createFolder(spaceId, parentId, name);
    await setFolderId(env, target.key, fileid);
    return fileid;
  } catch (error) {
    // 企微明确拒绝了（有错误码）或者请求根本没发（预算用完）：肯定没建上，下次不用再去找
    if (error instanceof WedriveError && (error.errcode !== null || isQuota(error))) {
      await env.DB.prepare("DELETE FROM wedrive_folder WHERE folder_key = ? AND fileid = ?")
        .bind(target.key, NOT_CREATED)
        .run();
    }
    throw error;
  }
};

/**
 * 保证这一串目录在微盘里存在、名字和位置都对，返回最里面那个的 fileid 和 key。
 * 每建好或改好一层就记一层：中途失败时，下次从断的地方接着做。
 */
export const ensureFolder = async (
  env: Env,
  client: WedriveClient,
  spaceId: string,
  chain: readonly FolderTarget[]
): Promise<{ fileid: string; key: string }> => {
  if (chain.length === 0) throw new Error("ensureFolder: empty chain");
  let parentId = spaceId;
  let last = { fileid: spaceId, key: "" };
  for (const target of chain) {
    const cached = await cachedFolder(env, target.key);
    const existing: WedriveFolder =
      cached && cached.fileid !== NOT_CREATED
        ? cached
        : {
            folder_key: target.key,
            fileid: await createFolder(env, client, spaceId, parentId, target, cached),
            name: cached ? cached.name : target.name,
            parent_key: cached ? cached.parent_key : target.parentKey,
            created_at: "",
            updated_at: ""
          };
    const now = nowIso();
    if (existing.name !== target.name) {
      await client.rename(existing.fileid, target.name);
      await env.DB.prepare(
        "UPDATE wedrive_folder SET name = ?, updated_at = ? WHERE folder_key = ?"
      )
        .bind(target.name, now, target.key)
        .run();
    }
    if ((existing.parent_key ?? null) !== target.parentKey) {
      await client.move(existing.fileid, parentId);
      await env.DB.prepare(
        "UPDATE wedrive_folder SET parent_key = ?, updated_at = ? WHERE folder_key = ?"
      )
        .bind(target.parentKey, now, target.key)
        .run();
    }
    last = { fileid: existing.fileid, key: target.key };
    parentId = last.fileid;
  }
  return last;
};
