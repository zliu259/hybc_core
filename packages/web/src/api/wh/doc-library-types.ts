/** 设备资料库接口的类型，字段与后端 packages/api/src/services/doc-library 的返回一致。 */

export type DocCategory =
  | "cert"
  | "report"
  | "params"
  | "manual"
  | "maintenance"
  | "other";
export type DocScope = "device" | "category" | "general";
export type DocValidity = "expired" | "soon" | "ok" | "none";
/** 这份资料在微盘里的镜像做到哪了 */
export type DocMirrorStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "failed"
  | "skipped";

export interface DocLibraryConfig {
  part_size: number;
  /** Web 和服务端的上限 */
  max_bytes: number;
  max_bytes_miniapp: number;
  categories: { key: DocCategory; label: string }[];
  extensions: readonly string[];
}

export interface DocFileRow {
  id: number;
  title: string;
  file_name: string;
  file_key: string;
  file_size: number;
  content_type: string;
  doc_category: DocCategory;
  /** 归属：单台设备，或整个设备类别；都为空是通用资料 */
  device_id: number | null;
  device_category_id: number | null;
  valid_until: string | null;
  supersedes_id: number | null;
  uploaded_by_userid: string;
  deleted_at: string | null;
  deleted_by_userid: string | null;
  version: number;
  mirror_status: DocMirrorStatus;
  /** 没传上去或不镜像的原因 */
  mirror_error: string | null;
  mirrored_at: string | null;
  created_at: string;
  updated_at: string;
  device_code: string | null;
  device_name: string | null;
  /** 归属的设备类别的名字（不是资料类别） */
  category_name: string | null;
  scope: DocScope;
  /** 有没有被新版本替换 */
  is_latest: boolean;
  validity: DocValidity;
}
export interface DocFileDetail extends DocFileRow {
  /** 它替换掉的旧版，新的在前 */
  history: DocFileRow[];
}

export interface DocTree {
  total: number;
  general: number;
  categories: {
    category_id: number;
    category_name: string;
    /** 归到这个类别本身的资料数 */
    own: number;
    devices: {
      device_id: number;
      device_code: string;
      name: string;
      count: number;
    }[];
  }[];
}

export interface DocFileQuery {
  device_id?: string | number;
  device_category_id?: string | number;
  scope?: "general";
  doc_category?: DocCategory;
  /** expiring：30 天内到期和已过期的 */
  validity?: "expiring";
  keyword?: string;
  /** "1"：连被替换的旧版本一起列 */
  include_history?: "1";
  page?: number;
  pageSize?: number;
}

/** 标题、资料类别、归属、有效期：上传完成和修改资料共用 */
export interface DocMetaInput {
  title: string;
  doc_category: DocCategory;
  device_id?: number | null;
  device_category_id?: number | null;
  valid_until?: string | null;
}

export interface DocUploadInit {
  upload_token: string;
  part_size: number;
  part_count: number;
}
export interface DocUploadedPart {
  part_number: number;
  etag: string;
}
export interface CompleteDocUploadInput extends DocMetaInput {
  upload_token: string;
  parts: DocUploadedPart[];
  /** 替换：旧文件的 id */
  supersedes_id?: number;
}

export interface DocFileUrl {
  url: string;
  expires_at: string;
  file_name: string;
  content_type: string;
  file_size: number;
  /** 能不能直接在页面里显示（PDF、图片、视频） */
  inline: boolean;
}

export interface DocShareRow {
  id: number;
  token: string;
  doc_file_id: number;
  expires_at: string;
  created_by_userid: string;
  revoked_at: string | null;
  access_count: number;
  created_at: string;
  url: string;
  /** 没作废、没过期 */
  active: boolean;
}
