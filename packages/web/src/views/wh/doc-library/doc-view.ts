/** 设备资料库页面用的纯函数：怎么预览、大小怎么写、有效期和归属怎么显示、能做哪些操作。 */
import type {
  DocCategory,
  DocFileQuery,
  DocFileRow,
  DocScope,
  DocShareRow,
  DocTree,
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

export interface DocTreeNode {
  key: string;
  label: string;
  /** 这一项自己的资料数；设备类别只数归到类别本身的，不含下面各台设备的 */
  count: number;
  selection: DocTreeSelection;
  children?: DocTreeNode[];
}

/** 目录树：全部、通用，然后是各设备类别，类别下面挂有资料的设备。 */
export const buildTreeNodes = (tree: DocTree | null): DocTreeNode[] => [
  {
    key: "all",
    label: "全部",
    count: tree?.total ?? 0,
    selection: { kind: "all" }
  },
  {
    key: "general",
    label: "通用",
    count: tree?.general ?? 0,
    selection: { kind: "general" }
  },
  ...(tree?.categories ?? []).map(category => ({
    key: `category-${category.category_id}`,
    label: category.category_name,
    count: category.own,
    selection: {
      kind: "category" as const,
      categoryId: category.category_id
    },
    children: category.devices.map(device => ({
      key: `device-${device.device_id}`,
      label: `${device.device_code} ${device.name}`,
      count: device.count,
      selection: { kind: "device" as const, deviceId: device.device_id }
    }))
  }))
];

/** 表单里选的归属：某台设备、某类设备，或者通用。 */
export interface DocOwner {
  kind: DocScope;
  deviceId: number | null;
  categoryId: number | null;
}

export const GENERAL_OWNER: DocOwner = {
  kind: "general",
  deviceId: null,
  categoryId: null
};

export const ownerOfRow = (
  row: Pick<DocFileRow, "scope" | "device_id" | "device_category_id">
): DocOwner => ({
  kind: row.scope,
  deviceId: row.scope === "device" ? row.device_id : null,
  categoryId: row.scope === "category" ? row.device_category_id : null
});

/** 接口要的两个字段：只带选中那一种，另一种清空。 */
export const ownerInput = (
  owner: DocOwner
): { device_id: number | null; device_category_id: number | null } => ({
  device_id: owner.kind === "device" ? owner.deviceId : null,
  device_category_id: owner.kind === "category" ? owner.categoryId : null
});

export const ownerProblem = (owner: DocOwner): string => {
  if (owner.kind === "device" && owner.deviceId === null) return "请选择设备";
  if (owner.kind === "category" && owner.categoryId === null) {
    return "请选择设备类别";
  }
  return "";
};

/** 和后端 services/doc-library/file-types.ts 的 DOC_CATEGORY_LABELS 一致。 */
const DOC_CATEGORY_LABELS: Record<DocCategory, string> = {
  cert: "合格证",
  report: "检测报告",
  params: "技术参数",
  manual: "说明书",
  maintenance: "保养维修",
  other: "其他"
};

export const docCategoryLabel = (category: DocCategory): string =>
  DOC_CATEGORY_LABELS[category] ?? DOC_CATEGORY_LABELS.other;

const SCOPE_SECTIONS: readonly { scope: DocScope; label: string }[] = [
  { scope: "device", label: "这台设备的" },
  { scope: "category", label: "这类设备的" },
  { scope: "general", label: "通用的" }
];

export interface DocScopeGroup {
  scope: DocScope;
  label: string;
  rows: DocFileRow[];
}

/** 一台设备适用的资料分三段显示；段内顺序用接口给的（已经按要干的活排过）。 */
export const groupDocsByScope = (
  rows: readonly DocFileRow[]
): DocScopeGroup[] =>
  SCOPE_SECTIONS.map(section => ({
    ...section,
    rows: rows.filter(row => row.scope === section.scope)
  })).filter(group => group.rows.length > 0);

export const shareStatus = (
  share: Pick<DocShareRow, "active" | "revoked_at">
): { text: string; type: "success" | "info" } => {
  if (share.active) return { text: "有效", type: "success" };
  return { text: share.revoked_at ? "已作废" : "已过期", type: "info" };
};
