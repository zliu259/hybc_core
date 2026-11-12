/** 资料库的可调参数：上传大小上限存在 system_config，给前端的配置从这里出。 */
import type { Env } from "../../types/env";
import { getSystemConfig } from "../system-config";
import { DOC_CATEGORIES, DOC_CATEGORY_LABELS, DOC_EXTENSIONS, DOC_PART_SIZE } from "./file-types";

const KEY_MAX_MB = "warehouse.doc_max_mb";
const KEY_MAX_MB_MINIAPP = "warehouse.doc_max_mb_miniapp";
const DEFAULT_MAX_MB = 2048;
const DEFAULT_MAX_MB_MINIAPP = 200;
const MB = 1024 * 1024;

export interface DocLibraryConfig {
  part_size: number;
  /** Web 和服务端的上限 */
  max_bytes: number;
  /** 小程序的上限（手机上读大文件慢，流量也贵） */
  max_bytes_miniapp: number;
  categories: { key: string; label: string }[];
  extensions: readonly string[];
}

const megabytes = (raw: string | null, fallback: number): number => {
  const parsed = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const getDocLibraryConfig = async (env: Env): Promise<DocLibraryConfig> => {
  const [web, miniapp] = await Promise.all([
    getSystemConfig(env, KEY_MAX_MB),
    getSystemConfig(env, KEY_MAX_MB_MINIAPP)
  ]);
  return {
    part_size: DOC_PART_SIZE,
    max_bytes: megabytes(web, DEFAULT_MAX_MB) * MB,
    max_bytes_miniapp: megabytes(miniapp, DEFAULT_MAX_MB_MINIAPP) * MB,
    categories: DOC_CATEGORIES.map((key) => ({ key, label: DOC_CATEGORY_LABELS[key] })),
    extensions: DOC_EXTENSIONS
  };
};
