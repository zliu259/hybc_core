/**
 * 微盘里的目录：<设备类别>/<设备编号 设备名称>/，归到类别的在 <设备类别>/通用/，通用资料在根下的 通用/。
 * 建过的目录记在 wedrive_folder 里，按「哪个类别、哪台设备」记，不按路径记：
 * 设备改名或换类别后，下次镜像它的资料时把同一个目录改名或移过去，不新建。
 */
import type { Env } from "../../types/env";
import type { WedriveFolder } from "../../types/wh";
import { WedriveError, type WedriveClient } from "./client";

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

/**
 * 建一个目录。企微明确拒绝了（有错误码）就是没建上，直接抛。
 * 超时这类说不清的：可能其实建上了，先看一眼，有同名的目录就用它，免得微盘里出现两个。
 */
const createOrAdoptFolder = async (
  client: WedriveClient,
  spaceId: string,
  parentId: string,
  name: string
): Promise<string> => {
  try {
    return await client.createFolder(spaceId, parentId, name);
  } catch (error) {
    if (error instanceof WedriveError) throw error;
    const existing = (await client.listFolder(spaceId, parentId)).find(
      (item) => item.file_type === FILE_TYPE_FOLDER && item.file_name === name
    );
    return existing ? existing.fileid : client.createFolder(spaceId, parentId, name);
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
    const existing = await cachedFolder(env, target.key);
    const now = nowIso();
    if (!existing) {
      const fileid = await createOrAdoptFolder(client, spaceId, parentId, target.name);
      await env.DB.prepare(
        `INSERT INTO wedrive_folder (folder_key, fileid, name, parent_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(target.key, fileid, target.name, target.parentKey, now, now)
        .run();
      last = { fileid, key: target.key };
    } else {
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
    }
    parentId = last.fileid;
  }
  return last;
};
