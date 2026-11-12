/** 设备资料的视图模型：怎么打开、大小和有效期怎么写、列表行、按归属分组、详情。都是纯函数。 */

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;
const MB = 1024 * 1024;
/** 文档超过这么大，打开前先问一句（手机流量） */
const OPEN_CONFIRM_BYTES = 50 * MB;

/** 和后端 services/doc-library/file-types.ts 的 DOC_CATEGORY_LABELS 一致。 */
const DOC_CATEGORY_LABELS = {
  cert: "合格证",
  report: "检测报告",
  params: "技术参数",
  manual: "说明书",
  maintenance: "保养维修",
  other: "其他"
};

/** 全库浏览时的页签：先放平时最常找的。 */
const DOC_CATEGORY_TABS = [
  { key: "", label: "全部" },
  ...["manual", "params", "cert", "report", "maintenance", "other"].map((key) => ({
    key,
    label: DOC_CATEGORY_LABELS[key]
  }))
];

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];
const VIDEO_EXTENSIONS = ["mp4", "mov"];
/** wx.openDocument 认的类型 */
const DOCUMENT_EXTENSIONS = ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"];

const extensionOf = (fileName) => {
  const name = String(fileName || "");
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
};

/**
 * 手机上怎么打开：图片预览、视频在页面里放、文档下载后用系统打开；其余（压缩包、图纸、HEIC…）请到电脑上看。
 * 先看扩展名，没有扩展名再看类型。
 * @param {string | null | undefined} contentType
 * @param {string | null | undefined} fileName
 * @returns {"image" | "video" | "document" | "unsupported"}
 */
const openKind = (contentType, fileName) => {
  const extension = extensionOf(fileName);
  if (extension) {
    if (IMAGE_EXTENSIONS.includes(extension)) return "image";
    if (VIDEO_EXTENSIONS.includes(extension)) return "video";
    if (DOCUMENT_EXTENSIONS.includes(extension)) return "document";
    return "unsupported";
  }
  const type = String(contentType || "").toLowerCase();
  if (type === "application/pdf") return "document";
  if (["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"].includes(type)) return "image";
  if (type === "video/mp4" || type === "video/quicktime") return "video";
  return "unsupported";
};

/** wx.openDocument 的 fileType；认不出来不传，让系统自己判断。 */
const documentType = (fileName) => {
  const extension = extensionOf(fileName);
  return DOCUMENT_EXTENSIONS.includes(extension) ? extension : "";
};

const SIZE_UNITS = ["B", "KB", "MB", "GB"];

/**
 * 980 B、1.5 KB、1.2 MB、1.5 GB：最多一位小数。
 * @param {unknown} bytes
 * @returns {string}
 */
const formatFileSize = (bytes) => {
  const size = Number(bytes);
  if (bytes === null || bytes === undefined || !Number.isFinite(size) || size < 0) return "—";
  const scaled = SIZE_UNITS.reduce(
    (state, unit, index) => {
      if (state.done) return state;
      const rounded = Math.round(state.value * 10) / 10;
      return rounded < 1024 || index === SIZE_UNITS.length - 1
        ? { value: rounded, unit, done: true }
        : { value: state.value / 1024, unit, done: false };
    },
    { value: size, unit: "B", done: false }
  );
  return `${scaled.value} ${scaled.unit}`;
};

/** @param {string} validity expired | soon | ok | none */
const validityText = (validity) => {
  if (validity === "expired") return "已过期";
  if (validity === "soon") return "30 天内到期";
  return "";
};

const ownerText = (doc) => {
  if (doc.scope === "device") {
    return [doc.device_code, doc.device_name].filter(Boolean).join(" ") || "设备";
  }
  if (doc.scope === "category") return doc.category_name ? `类别：${doc.category_name}` : "类别";
  return "通用";
};

const categoryLabel = (key) => DOC_CATEGORY_LABELS[key] || DOC_CATEGORY_LABELS.other;

/** ISO 时间 → 北京时间的日期 "YYYY-MM-DD"。 */
const formatDate = (iso) => {
  const time = iso ? new Date(iso).getTime() : Number.NaN;
  return Number.isNaN(time) ? "" : new Date(time + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
};

/**
 * 列表里的一行。
 * @param {object} doc GET /doc-library/file 或 /for-device 的一项
 */
const toDocRow = (doc) => ({
  id: doc.id,
  title: doc.title,
  categoryLabel: categoryLabel(doc.doc_category),
  ownerText: ownerText(doc),
  sizeText: formatFileSize(doc.file_size),
  validityText: validityText(doc.validity),
  expired: doc.validity === "expired",
  soon: doc.validity === "soon"
});

const SCOPE_SECTIONS = [
  { scope: "device", label: "这台设备" },
  { scope: "category", label: "这类设备" },
  { scope: "general", label: "通用" }
];

/**
 * 一台设备适用的资料分三段；空的段不要，段内顺序用接口给的。
 * @param {object[] | null | undefined} docs GET /doc-library/for-device/:id 的 data
 * @returns {{ scope: string, label: string, rows: ReturnType<typeof toDocRow>[] }[]}
 */
const groupForDevice = (docs) => {
  const list = Array.isArray(docs) ? docs : [];
  return SCOPE_SECTIONS.map((section) => ({
    ...section,
    rows: list.filter((doc) => doc.scope === section.scope).map(toDocRow)
  })).filter((group) => group.rows.length > 0);
};

/**
 * 只列前几条（任务页上的「适用资料」）；一条都没有返回 null，整段不显示。
 * @param {object[] | null | undefined} docs
 * @param {number} limit
 * @returns {{ rows: ReturnType<typeof toDocRow>[], total: number, more: boolean } | null}
 */
const previewDocs = (docs, limit) => {
  const list = Array.isArray(docs) ? docs : [];
  if (list.length === 0) return null;
  return { rows: list.slice(0, limit).map(toDocRow), total: list.length, more: list.length > limit };
};

const uploadTextOf = (doc, toUserName) =>
  [toUserName(doc.uploaded_by_userid), formatDate(doc.created_at)].filter(Boolean).join(" ");

/**
 * 详情页。
 * @param {object} doc GET /doc-library/file/:id 的 data（带 history）
 * @param {(userid: string) => string} toUserName
 */
const buildDocDetail = (doc, toUserName) => {
  const kind = openKind(doc.content_type, doc.file_name);
  const sizeBytes = Number(doc.file_size) || 0;
  return {
    id: doc.id,
    title: doc.title,
    fileName: doc.file_name,
    categoryLabel: categoryLabel(doc.doc_category),
    ownerText: ownerText(doc),
    sizeText: formatFileSize(doc.file_size),
    sizeBytes,
    uploadText: uploadTextOf(doc, toUserName),
    validUntil: doc.valid_until || "",
    validityText: validityText(doc.validity),
    expired: doc.validity === "expired",
    soon: doc.validity === "soon",
    isLatest: Boolean(doc.is_latest),
    kind,
    // 图片和视频是边看边取的，只有要整个下载的文档才问
    needConfirm: kind === "document" && sizeBytes > OPEN_CONFIRM_BYTES,
    history: (Array.isArray(doc.history) ? doc.history : []).map((old) => ({
      id: old.id,
      fileName: old.file_name,
      sizeText: formatFileSize(old.file_size),
      uploadText: uploadTextOf(old, toUserName)
    }))
  };
};

module.exports = {
  DOC_CATEGORY_TABS,
  OPEN_CONFIRM_BYTES,
  buildDocDetail,
  documentType,
  formatFileSize,
  groupForDevice,
  openKind,
  previewDocs,
  toDocRow,
  validityText
};
