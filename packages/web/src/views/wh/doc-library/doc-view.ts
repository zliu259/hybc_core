/** 设备资料库页面用的纯函数：怎么预览、大小怎么写、有效期和归属怎么显示、能做哪些操作。 */
import type {
  DocFileQuery,
  DocFileRow,
  DocValidity
} from "@/api/wh/doc-library-types";
import type { WarehouseCapabilities } from "@/api/wh/types";

export type PreviewKind = "pdf" | "image" | "video" | "download";

/** 浏览器能直接显示的图片。HEIC 多数浏览器显示不了，SVG 可能带脚本，都走下载。 */
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/bmp"
]);

export const previewKind = (contentType: string): PreviewKind => {
  const type = String(contentType ?? "").toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (IMAGE_TYPES.has(type)) return "image";
  if (type.startsWith("video/")) return "video";
  return "download";
};

const SIZE_UNITS = ["B", "KB", "MB", "GB"] as const;

/** 980 B、1.5 KB、1.2 MB、1.5 GB：最多一位小数。 */
export const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const scaled = SIZE_UNITS.reduce(
    (state, unit, index) => {
      if (state.done) return state;
      const rounded = Math.round(state.value * 10) / 10;
      const last = index === SIZE_UNITS.length - 1;
      return rounded < 1024 || last
        ? { value: rounded, unit, done: true }
        : { value: state.value / 1024, unit, done: false };
    },
    { value: bytes, unit: "B" as string, done: false }
  );
  return `${scaled.value} ${scaled.unit}`;
};

export interface ValidityTag {
  text: string;
  type: "danger" | "warning";
}

export const validityTag = (validity: DocValidity): ValidityTag | null => {
  if (validity === "expired") return { text: "已过期", type: "danger" };
  if (validity === "soon") return { text: "30 天内到期", type: "warning" };
  return null;
};

type OwnerFields = Pick<
  DocFileRow,
  "scope" | "device_code" | "device_name" | "category_name"
>;

/** 归属：哪台设备、哪个设备类别，或者通用。 */
export const ownerText = (row: OwnerFields): string => {
  if (row.scope === "device") {
    return (
      [row.device_code, row.device_name].filter(Boolean).join(" ") || "设备"
    );
  }
  if (row.scope === "category") {
    return row.category_name ? `类别：${row.category_name}` : "类别";
  }
  return "通用";
};

export interface DocActions {
  canEdit: boolean;
  canDelete: boolean;
  canReplace: boolean;
  canShare: boolean;
}

/** 改、删、替换、对外链接都要资料管理员；被替换的旧版本只能看。 */
export const docActions = (
  row: Pick<DocFileRow, "is_latest">,
  caps: Pick<WarehouseCapabilities, "is_doc_admin"> | null
): DocActions => {
  const allowed = Boolean(caps?.is_doc_admin) && row.is_latest;
  return {
    canEdit: allowed,
    canDelete: allowed,
    canReplace: allowed,
    canShare: allowed
  };
};

export type DocTreeSelection =
  | { kind: "all" }
  | { kind: "general" }
  | { kind: "category"; categoryId: number }
  | { kind: "device"; deviceId: number };

type TreeFilter = Pick<
  DocFileQuery,
  "scope" | "device_category_id" | "device_id"
>;

/** 点目录树的一项 → 列表的筛选条件。 */
export const treeSelection = (node: DocTreeSelection): TreeFilter => {
  if (node.kind === "general") return { scope: "general" };
  if (node.kind === "category") {
    return { device_category_id: String(node.categoryId) };
  }
  if (node.kind === "device") return { device_id: String(node.deviceId) };
  return {};
};
