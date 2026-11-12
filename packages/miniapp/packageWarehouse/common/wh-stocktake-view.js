/**
 * 盘点页的视图模型：文字、筛选、校验、录完一行之后的本地更新。纯函数，不碰接口。
 * 规则和 Web 的 views/wh/stocktake/stocktake-view.ts 保持一致。
 */

/** 物资一次最多出这么多行；再多就让人输关键字缩小范围（一次 setData 太大手机会卡） */
const MAX_MATERIAL_ROWS = 60;
const MAX_COUNT = 1000000;
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

const SCOPE_OPTIONS = [
  { key: "all", label: "物资和设备都盘", hint: "物资逐条录实盘数，设备逐台扫码" },
  { key: "material", label: "只盘物资", hint: "只录物资的实盘数" },
  { key: "device", label: "只盘设备", hint: "只核对在库的设备" }
];

const FILTER_OPTIONS = [
  { key: "all", label: "全部" },
  { key: "uncounted", label: "没盘" },
  { key: "diff", label: "有差额" }
];

const SCOPE_LABELS = { all: "全部", material: "物资", device: "设备" };
const STATUS_LABELS = { counting: "盘点中", done: "已完成", cancelled: "已取消" };
const STATUS_THEME = { counting: "primary", done: "success", cancelled: "default" };

const count = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

/**
 * 输入框里的字 → 要存的数；空是 null（清掉）；不合规返回错误文字。
 * @param {unknown} text
 * @returns {{ value: number | null } | { error: string }}
 */
const parseCount = (text) => {
  const trimmed = String(text === undefined || text === null ? "" : text).trim();
  if (!trimmed) return { value: null };
  if (trimmed.startsWith("-") && PLAIN_NUMBER.test(trimmed.slice(1))) {
    return { error: "实盘数不能是负数" };
  }
  if (!PLAIN_NUMBER.test(trimmed)) return { error: "请填数字" };
  if ((trimmed.split(".")[1] || "").length > 3) return { error: "最多 3 位小数" };
  const value = Number(trimmed);
  return value > MAX_COUNT ? { error: "数字太大了" } : { value };
};

/**
 * 完成前确认里的几句话；没有可说的那一句不出现。
 * @param {object} detail
 * @returns {string[]}
 */
const completeSummary = (detail) => {
  const diff = count(detail.material_diff);
  const counted = count(detail.material_counted);
  const uncounted = count(detail.material_total) - counted;
  const missing = count(detail.device_missing);
  const unexpected = count(detail.device_unexpected);
  return [
    diff > 0 ? `${diff} 条物资有差额，会出一张盘点调整单` : "",
    counted > 0 && diff === 0 ? "账面和实盘一致，不出调整单" : "",
    uncounted > 0 ? `还有 ${uncounted} 条物资没盘，这些不动` : "",
    missing > 0 ? `${missing} 台在库设备没找到，会在时间线上记「盘点未找到」` : "",
    count(detail.device_expected) > 0 && missing === 0 ? "设备都找到了" : "",
    unexpected > 0 ? `${unexpected} 台扫到了但账上不在库，记得补返库单` : ""
  ].filter(Boolean);
};

const diffText = (diff) => {
  if (diff === null || diff === undefined) return "";
  if (Number(diff) === 0) return "一致";
  return Number(diff) > 0 ? `+${diff}` : String(diff);
};

const toMaterialRow = (line) => {
  const counted = line.counted_qty !== null && line.counted_qty !== undefined;
  const diff = counted ? Number(line.diff) : 0;
  return {
    id: line.id,
    title: [line.name, line.spec].filter(Boolean).join(" "),
    sub: [line.material_code, line.storage_note].filter(Boolean).join(" · "),
    // 录过的行显示当时记下的账面数，差额就是按它算的
    bookText: `账面 ${counted ? line.book_qty : line.current_qty} ${line.unit}`,
    countText: counted ? `实盘 ${line.counted_qty}` : "没盘",
    counted,
    diffText: counted ? diffText(line.diff) : "",
    diffClass: diff < 0 ? "stocktake-loss" : diff > 0 ? "stocktake-gain" : "",
    note: line.note || ""
  };
};

const deviceStatus = (line, status) => {
  if (line.found === 1) {
    if (line.expected === 0 && line.location === "project") {
      // 项目名可能很长：小标签里只写「账上在项目」，项目名另起一行
      return {
        text: "账上在项目",
        theme: "warning",
        hint: `账上在「${line.project_name || "项目"}」，记得补返库单`
      };
    }
    if (line.expected === 0 && line.location === "scrapped") {
      return { text: "账上已报废", theme: "warning" };
    }
    return { text: "已找到", theme: "success" };
  }
  if (line.found === 0) return { text: "没找到", theme: "danger" };
  // 已完成的盘点里还空着的，是盘点期间已经出库、所以没被记成没找到的
  return { text: status === "done" ? "盘点期间已出库" : "没扫到", theme: "default" };
};

const toDeviceRow = (line, status) => {
  const state = deviceStatus(line, status);
  return {
    id: line.id,
    deviceId: line.device_id,
    code: line.device_code,
    name: line.alias ? `${line.device_name}（${line.alias}）` : line.device_name,
    statusText: state.text,
    statusTheme: state.theme,
    hint: state.hint || "",
    note: line.note || ""
  };
};

/**
 * 点一台设备能做什么。账上不在库、扫到才加进来的，只能清掉标记。
 * @param {object | null} line
 * @returns {{ key: "found" | "missing" | "clear", label: string }[]}
 */
const deviceActions = (line) => {
  if (!line) return [];
  return [
    line.found !== 1 ? { key: "found", label: "找到了" } : null,
    line.expected === 1 && line.found !== 0 ? { key: "missing", label: "没找到" } : null,
    line.found !== null && line.found !== undefined ? { key: "clear", label: "清掉标记" } : null
  ].filter(Boolean);
};

const filterMaterialLines = (lines, filter, keyword) => {
  const needle = String(keyword || "")
    .trim()
    .toLowerCase();
  return lines.filter((line) => {
    const counted = line.counted_qty !== null && line.counted_qty !== undefined;
    if (filter === "uncounted" && counted) return false;
    if (filter === "diff" && (!counted || Number(line.diff) === 0)) return false;
    if (!needle) return true;
    return [line.name, line.spec, line.material_code].some((text) =>
      String(text || "")
        .toLowerCase()
        .includes(needle)
    );
  });
};

/**
 * @param {object | null} detail GET /api/v1/warehouse/stocktake/:id 的 data
 * @param {{ isKeeper: boolean, filter: string, keyword: string, tab: string }} options
 */
const buildStocktakeView = (detail, options) => {
  if (!detail) return null;
  const materials = Array.isArray(detail.material_lines) ? detail.material_lines : [];
  const devices = Array.isArray(detail.device_lines) ? detail.device_lines : [];
  const tabs = [
    detail.scope !== "device"
      ? { key: "material", label: `物资 ${count(detail.material_counted)}/${count(detail.material_total)}` }
      : null,
    detail.scope !== "material"
      ? { key: "device", label: `设备 ${count(detail.device_found)}/${count(detail.device_expected)}` }
      : null
  ].filter(Boolean);
  const filtered = filterMaterialLines(materials, options.filter, options.keyword);
  const counting = detail.status === "counting";
  const adjustText =
    detail.status !== "done"
      ? ""
      : detail.adjust_doc_no
        ? `调整单 ${detail.adjust_doc_no}`
        : "没有差额，没出调整单";
  return {
    header: {
      no: detail.stocktake_no,
      scopeLabel: SCOPE_LABELS[detail.scope] || "",
      statusLabel: STATUS_LABELS[detail.status] || "",
      statusTheme: STATUS_THEME[detail.status] || "default",
      adjustText
    },
    tabs,
    activeTab: tabs.some((tab) => tab.key === options.tab) ? options.tab : tabs[0] ? tabs[0].key : "",
    materialRows: filtered.slice(0, MAX_MATERIAL_ROWS).map(toMaterialRow),
    materialCount: filtered.length,
    materialMore: Math.max(filtered.length - MAX_MATERIAL_ROWS, 0),
    deviceRows: devices.map((line) => toDeviceRow(line, detail.status)),
    canEdit: Boolean(options.isKeeper) && counting,
    readOnlyNotice: counting && !options.isKeeper ? "盘点由库管录入，这里只能看" : "",
    summaryLines: completeSummary(detail)
  };
};

const isCounted = (line) => line.counted_qty !== null && line.counted_qty !== undefined;

/** 录完一行后的新详情：换掉那一行，重算已盘数和差额数。不改传进来的对象。 */
const withMaterialLine = (detail, line) => {
  const lines = detail.material_lines.map((item) => (item.id === line.id ? line : item));
  return {
    ...detail,
    material_lines: lines,
    material_total: lines.length,
    material_counted: lines.filter(isCounted).length,
    material_diff: lines.filter((item) => isCounted(item) && Number(item.diff) !== 0).length
  };
};

/** 标记一台设备后的新详情：换掉或加上那一行（按编号排），重算台数。口径和后端一样。 */
const withDeviceLine = (detail, line) => {
  const exists = detail.device_lines.some((item) => item.id === line.id);
  const lines = exists
    ? detail.device_lines.map((item) => (item.id === line.id ? line : item))
    : [...detail.device_lines, line].sort((a, b) =>
        String(a.device_code) < String(b.device_code) ? -1 : String(a.device_code) > String(b.device_code) ? 1 : 0
      );
  const expected = lines.filter((item) => item.expected === 1);
  return {
    ...detail,
    device_lines: lines,
    device_expected: expected.length,
    device_found: expected.filter((item) => item.found === 1).length,
    device_missing: expected.filter(
      (item) => item.found === 0 || ((item.found === null || item.found === undefined) && item.location === "warehouse")
    ).length,
    device_unexpected: lines.filter((item) => item.expected === 0 && item.found === 1).length
  };
};

module.exports = {
  MAX_MATERIAL_ROWS,
  SCOPE_OPTIONS,
  FILTER_OPTIONS,
  buildStocktakeView,
  parseCount,
  completeSummary,
  deviceActions,
  withMaterialLine,
  withDeviceLine
};
