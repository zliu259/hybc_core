/** 设备资料的视图模型。运行：node packageWarehouse/common/wh-doc-view.test.js */
const assert = require("assert");

const {
  DOC_CATEGORY_TABS,
  OPEN_CONFIRM_BYTES,
  buildDocDetail,
  formatFileSize,
  groupForDevice,
  openKind,
  previewDocs,
  toDocRow,
  validityText
} = require("./wh-doc-view");

const MB = 1024 * 1024;
const doc = (patch = {}) => ({
  id: 1,
  title: "合格证",
  file_name: "合格证.pdf",
  file_size: 1536,
  content_type: "application/pdf",
  doc_category: "cert",
  device_id: null,
  device_category_id: null,
  valid_until: null,
  supersedes_id: null,
  uploaded_by_userid: "liu",
  created_at: "2026-11-12T01:05:00.000Z",
  device_code: null,
  device_name: null,
  category_name: null,
  scope: "general",
  is_latest: true,
  validity: "none",
  ...patch
});

// openKind：图片预览、视频在页面里放、文档用系统打开，其余请到电脑上看
assert.strictEqual(openKind("image/jpeg", "a.jpg"), "image");
assert.strictEqual(openKind("image/png", "a.PNG"), "image");
assert.strictEqual(openKind("video/mp4", "a.mp4"), "video");
assert.strictEqual(openKind("video/quicktime", "a.mov"), "video");
["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx"].forEach((ext) =>
  assert.strictEqual(openKind("application/octet-stream", `文件.${ext}`), "document", ext)
);
assert.strictEqual(openKind("application/pdf", "没有扩展名"), "document");
["zip", "rar", "7z", "dwg", "dxf", "txt", "csv", "ofd", "heic"].forEach((ext) =>
  assert.strictEqual(openKind("application/octet-stream", `文件.${ext}`), "unsupported", ext)
);
assert.strictEqual(openKind("image/heic", "照片.heic"), "unsupported");
assert.strictEqual(openKind("", ""), "unsupported");
assert.strictEqual(openKind(null, undefined), "unsupported");

// 大小
assert.strictEqual(formatFileSize(0), "0 B");
assert.strictEqual(formatFileSize(980), "980 B");
assert.strictEqual(formatFileSize(1536), "1.5 KB");
assert.strictEqual(formatFileSize(1.2 * MB), "1.2 MB");
assert.strictEqual(formatFileSize(1.5 * 1024 * MB), "1.5 GB");
assert.strictEqual(formatFileSize(MB - 1), "1 MB");
assert.strictEqual(formatFileSize("abc"), "—");

// 有效期的说法
assert.strictEqual(validityText("expired"), "已过期");
assert.strictEqual(validityText("soon"), "30 天内到期");
assert.strictEqual(validityText("ok"), "");
assert.strictEqual(validityText("none"), "");

// 列表里的一行
assert.deepStrictEqual(toDocRow(doc()), {
  id: 1,
  title: "合格证",
  categoryLabel: "合格证",
  ownerText: "通用",
  sizeText: "1.5 KB",
  validityText: "",
  expired: false,
  soon: false
});
assert.deepStrictEqual(
  toDocRow(
    doc({
      id: 2,
      scope: "device",
      device_code: "SB-0007",
      device_name: "唐兴",
      doc_category: "report",
      validity: "expired"
    })
  ),
  {
    id: 2,
    title: "合格证",
    categoryLabel: "检测报告",
    ownerText: "SB-0007 唐兴",
    sizeText: "1.5 KB",
    validityText: "已过期",
    expired: true,
    soon: false
  }
);
assert.strictEqual(toDocRow(doc({ scope: "category", category_name: "顶管机" })).ownerText, "类别：顶管机");
assert.strictEqual(toDocRow(doc({ validity: "soon" })).soon, true);
assert.strictEqual(toDocRow(doc({ doc_category: "whatever" })).categoryLabel, "其他");
assert.strictEqual(toDocRow(doc({ scope: "device" })).ownerText, "设备");

// 一台设备的资料分三段：这台设备、这类设备、通用；没有的段不出现，段内顺序不动
const groups = groupForDevice([
  doc({ id: 1, scope: "device" }),
  doc({ id: 2, scope: "general" }),
  doc({ id: 3, scope: "device" })
]);
assert.deepStrictEqual(
  groups.map((group) => [group.scope, group.label, group.rows.map((row) => row.id)]),
  [
    ["device", "这台设备", [1, 3]],
    ["general", "通用", [2]]
  ]
);
assert.deepStrictEqual(
  groupForDevice([doc({ scope: "general" }), doc({ scope: "category" })]).map((group) => group.label),
  ["这类设备", "通用"]
);
assert.deepStrictEqual(groupForDevice([]), []);
assert.deepStrictEqual(groupForDevice(null), []);

// 详情：头部信息、怎么打开、历史版本
const nameOf = (userid) => ({ liu: "刘工" })[userid] || userid;
const detail = buildDocDetail(
  doc({
    id: 5,
    title: "第三方检测报告",
    file_name: "检测报告-新.pdf",
    file_size: 60 * MB,
    doc_category: "report",
    scope: "device",
    device_code: "SB-0002",
    device_name: "唐兴",
    valid_until: "2026-11-30",
    validity: "soon",
    history: [
      doc({ id: 4, file_name: "检测报告-旧.pdf", uploaded_by_userid: "wang", created_at: "2025-10-01T02:00:00.000Z", is_latest: false })
    ]
  }),
  nameOf
);
assert.deepStrictEqual(detail, {
  id: 5,
  title: "第三方检测报告",
  fileName: "检测报告-新.pdf",
  categoryLabel: "检测报告",
  ownerText: "SB-0002 唐兴",
  sizeText: "60 MB",
  sizeBytes: 60 * MB,
  uploadText: "刘工 2026-11-12",
  validUntil: "2026-11-30",
  validityText: "30 天内到期",
  expired: false,
  soon: true,
  isLatest: true,
  kind: "document",
  needConfirm: true,
  history: [{ id: 4, fileName: "检测报告-旧.pdf", sizeText: "1.5 KB", uploadText: "wang 2025-10-01" }]
});
assert.strictEqual(OPEN_CONFIRM_BYTES, 50 * MB);
const small = buildDocDetail(doc({ is_latest: false }), nameOf);
assert.strictEqual(small.needConfirm, false);
assert.strictEqual(small.isLatest, false);
assert.deepStrictEqual(small.history, []);
assert.strictEqual(small.validUntil, "");
// 北京时间的日期：UTC 16 点以后算第二天
assert.strictEqual(buildDocDetail(doc({ created_at: "2026-11-12T16:30:00.000Z" }), nameOf).uploadText, "刘工 2026-11-13");
assert.strictEqual(buildDocDetail(doc({ file_name: "图纸.dwg", content_type: "application/acad" }), nameOf).kind, "unsupported");

// 任务页上只列前几条，多的点「全部」；一条都没有就整段不显示
const seven = Array.from({ length: 7 }, (_, index) => doc({ id: index + 1 }));
const preview = previewDocs(seven, 5);
assert.strictEqual(preview.total, 7);
assert.strictEqual(preview.more, true);
assert.deepStrictEqual(preview.rows.map((row) => row.id), [1, 2, 3, 4, 5]);
assert.strictEqual(preview.rows[0].categoryLabel, "合格证");
assert.deepStrictEqual(previewDocs(seven.slice(0, 5), 5).more, false);
assert.strictEqual(previewDocs([], 5), null);
assert.strictEqual(previewDocs(null, 5), null);

// 资料类别页签：全部加六个类别
assert.deepStrictEqual(
  DOC_CATEGORY_TABS.map((tab) => `${tab.key}:${tab.label}`),
  [":全部", "manual:说明书", "params:技术参数", "cert:合格证", "report:检测报告", "maintenance:保养维修", "other:其他"]
);

console.log("wh-doc-view tests passed");
