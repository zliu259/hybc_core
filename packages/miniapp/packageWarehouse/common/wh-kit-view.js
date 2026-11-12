/**
 * 配套清单页面的视图模型。纯函数。
 * 按钮规则、提交前检查和 Web 的 views/wh/kit/kit-view.ts 逐条对应，改一边要改另一边。
 */
const { formatQty, formatTime, toQty } = require("./wh-format");
const {
  KIT_LINE_KIND_LABELS,
  KIT_SOURCE_LABELS,
  KIT_STATUS_LABELS,
  KIT_STATUS_THEME
} = require("./wh-labels");

const KIT_STATUS_TABS = [
  { key: "", label: "全部" },
  ...["draft", "submitted", "confirmed", "closed"].map((key) => ({
    key,
    label: KIT_STATUS_LABELS[key]
  }))
];

const SOURCE_OPTIONS = ["warehouse", "site_purchase", "rental", "on_site"].map((key) => ({
  key,
  label: KIT_SOURCE_LABELS[key]
}));

/** 和后端 assertCanEditKitFor 同样的规则：库管、经理任何项目；现场负责人只限自己负责的项目。 */
const canEditProject = (managerUserid, viewer) => {
  const caps = viewer && viewer.caps;
  if (!caps) return false;
  const roles = (viewer && viewer.roles) || [];
  if (caps.is_keeper || roles.includes("manager")) return true;
  return (
    Boolean(caps.can_create_kit) &&
    roles.includes("site_manager") &&
    Boolean(managerUserid) &&
    managerUserid === viewer.userid
  );
};

/**
 * @param {{ status: string, project_manager_userid: string | null }} kit
 * @param {{ userid: string, roles: string[], caps: object | null }} viewer
 */
const kitActions = (kit, viewer) => {
  const editor = canEditProject(kit.project_manager_userid, viewer);
  const keeper = Boolean(viewer && viewer.caps && viewer.caps.is_keeper);
  const open = kit.status === "draft" || kit.status === "submitted";
  return {
    canEdit: open && editor,
    canSubmit: kit.status === "draft" && editor,
    canConfirm: kit.status === "submitted" && keeper,
    canDiscard: open && editor,
    canClose: kit.status === "confirmed" && keeper,
    canShip: kit.status === "confirmed" && keeper
  };
};

/**
 * 提交前要先处理的行。
 * @param {{ line_kind: string, material_id: number | null, name_text: string, planned_qty: number }[]} lines
 * @returns {{ index: number, message: string }[]}
 */
const kitLineProblems = (lines) =>
  lines.flatMap((line, index) => {
    const planned = Number(line.planned_qty);
    if (!String(line.name_text || "").trim()) return [{ index, message: "品名不能为空" }];
    if (!Number.isFinite(planned) || planned < 0) return [{ index, message: "数量不对" }];
    if (line.line_kind === "device" && !Number.isInteger(planned)) {
      return [{ index, message: "设备数量必须是整数" }];
    }
    if (line.line_kind === "material" && planned > 0 && !line.material_id) {
      return [{ index, message: `${line.name_text} 还没选规格` }];
    }
    return [];
  });

const plannedOf = (row) => {
  const qty = toQty(row.qty);
  return qty === null ? 0 : qty;
};

/** 页面上可编辑的行直接查问题；数量是输入框里的字符串。 */
const rowProblems = (rows) =>
  kitLineProblems(
    rows.map((row) => ({
      line_kind: row.lineKind,
      material_id: row.materialId,
      name_text: row.nameText,
      planned_qty: plannedOf(row)
    }))
  );

const detailTextOf = (line) => {
  if (line.line_kind === "device") {
    return [line.category_name, line.spec_text].filter(Boolean).join(" · ");
  }
  if (line.line_kind === "material" && line.material_id) {
    return line.material_spec || line.spec_text || "";
  }
  return "";
};

/** 接口的行 → 页面上可编辑的行（qty 是字符串，方便输入框）。 */
const toEditableLines = (lines) =>
  (Array.isArray(lines) ? lines : []).map((line, index) => {
    const specChoices = Array.isArray(line.spec_choices) ? line.spec_choices : [];
    return {
      key: line.id ? `line-${line.id}` : `new-${index}`,
      id: line.id || null,
      section: line.section || "",
      lineKind: line.line_kind,
      deviceCategoryId: line.device_category_id || null,
      materialId: line.material_id || null,
      nameText: line.name_text || "",
      specText: line.spec_text || "",
      unit: line.unit || "",
      // 显示用：清单行没写单位时用物资档案的单位，保存时不写回去
      unitText: line.unit || line.material_unit || "",
      qty: formatQty(line.planned_qty),
      source: line.source,
      note: line.note || "",
      specChoices,
      specLabels: specChoices.map((choice) => choice.spec || "无规格"),
      kindLabel: KIT_LINE_KIND_LABELS[line.line_kind] || "",
      sourceLabel: KIT_SOURCE_LABELS[line.source] || "",
      sourceIndex: Math.max(
        0,
        SOURCE_OPTIONS.findIndex((option) => option.key === line.source)
      ),
      detailText: detailTextOf(line),
      needsSpec: line.line_kind === "material" && !line.material_id
    };
  });

const nullable = (text) => String(text || "").trim() || null;

/** 可编辑的行 → PUT 的 lines。数量清空按 0。 */
const toKitLines = (rows) =>
  rows.map((row) => ({
    section: String(row.section || "").trim(),
    line_kind: row.lineKind,
    device_category_id: row.lineKind === "device" ? row.deviceCategoryId : null,
    material_id: row.lineKind === "material" ? row.materialId : null,
    name_text: String(row.nameText || "").trim(),
    spec_text: nullable(row.specText),
    unit: nullable(row.unit),
    planned_qty: plannedOf(row),
    source: row.source,
    note: nullable(row.note)
  }));

/**
 * 按分节分组，保持第一次出现的顺序；行带上它在整份清单里的下标和问题。
 * @returns {{ section: string, rows: object[], count: number, problemCount: number }[]}
 */
const groupBySection = (rows, problems) => {
  const problemByIndex = new Map((problems || []).map((item) => [item.index, item.message]));
  const groups = new Map();
  rows.forEach((row, index) => {
    const section = String(row.section || "").trim() || "未分节";
    const entry = { ...row, index, problem: problemByIndex.get(index) || "" };
    groups.set(section, [...(groups.get(section) || []), entry]);
  });
  return [...groups].map(([section, list]) => ({
    section,
    rows: list,
    count: list.length,
    problemCount: list.filter((row) => row.problem).length
  }));
};

/** 已确认清单的执行情况：行上显示已发、待发；备忘行留空。 */
const withFulfilment = (rows, fulfilment) => {
  const byId = new Map((Array.isArray(fulfilment) ? fulfilment : []).map((line) => [line.id, line]));
  return rows.map((row) => {
    const line = byId.get(row.id);
    if (!line || row.lineKind === "text") {
      return { ...row, shippedText: "", pendingText: "", done: false };
    }
    return {
      ...row,
      shippedText: formatQty(line.shipped),
      pendingText: formatQty(line.pending),
      done: plannedOf(row) > 0 && Number(line.pending) <= 0 && row.source === "warehouse"
    };
  });
};

/** 新建清单表单的检查。 */
const newKitProblem = (form) => {
  if (!form.projectId) return "请选择项目";
  if (!String(form.title || "").trim()) return "请填写清单标题";
  return "";
};

/** 没确认过就关闭的清单是作废的。 */
const statusLabelOf = (kit) =>
  kit.status === "closed" && !kit.confirmed_at ? "已作废" : KIT_STATUS_LABELS[kit.status] || "";

const toKitListRow = (kit) => ({
  id: kit.id,
  projectName: kit.project_name,
  title: `${kit.kit_no} ${kit.title}`,
  statusLabel: statusLabelOf(kit),
  statusTheme: KIT_STATUS_THEME[kit.status] || "default",
  lineText: `${Number(kit.line_count || 0)} 行`
});

const whoWhen = (userid, time, toUserName) =>
  userid ? `${toUserName(userid)} · ${formatTime(time)}` : "";

const buildKitHeader = (kit, toUserName) => ({
  kitNo: kit.kit_no,
  title: kit.title,
  statusLabel: statusLabelOf(kit),
  statusTheme: KIT_STATUS_THEME[kit.status] || "default",
  projectName: kit.project_name,
  sourceText: kit.template_name
    ? `模板：${kit.template_name}`
    : kit.copied_from_kit_id
      ? "复制的清单"
      : "空白清单",
  submittedText: whoWhen(kit.submitted_by_userid, kit.submitted_at, toUserName),
  confirmedText: whoWhen(kit.confirmed_by_userid, kit.confirmed_at, toUserName),
  remark: kit.remark || "",
  closeReason: kit.close_reason || ""
});

module.exports = {
  KIT_STATUS_TABS,
  SOURCE_OPTIONS,
  canEditProject,
  statusLabelOf,
  kitActions,
  kitLineProblems,
  rowProblems,
  toEditableLines,
  toKitLines,
  groupBySection,
  withFulfilment,
  newKitProblem,
  toKitListRow,
  buildKitHeader
};
