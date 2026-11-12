/** 盘点页面的纯函数：文字、筛选、校验、录完一行之后的本地更新。不碰接口。 */
import type {
  StocktakeDetail,
  StocktakeDeviceLineRow,
  StocktakeMaterialLineRow,
  StocktakeRow,
  StocktakeScope,
  StocktakeStatus
} from "@/api/wh/stocktake-types";

export const SCOPE_LABELS: Record<StocktakeScope, string> = {
  material: "物资",
  device: "设备",
  all: "全部"
};

export const STATUS_LABELS: Record<StocktakeStatus, string> = {
  counting: "盘点中",
  done: "已完成",
  cancelled: "已取消"
};

export const STATUS_TAG: Record<
  StocktakeStatus,
  "primary" | "success" | "info"
> = {
  counting: "primary",
  done: "success",
  cancelled: "info"
};

export type MaterialFilter = "all" | "uncounted" | "diff";

export const MATERIAL_FILTER_LABELS: Record<MaterialFilter, string> = {
  all: "全部",
  uncounted: "没盘的",
  diff: "有差额的"
};

const MAX_COUNT = 1_000_000;
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;

/** 类别清单，按出现顺序去重（行已经按类别排好）。 */
export const materialCategories = (
  lines: readonly StocktakeMaterialLineRow[]
): string[] => [...new Set(lines.map(line => line.category))];

export const filterMaterialLines = (
  lines: readonly StocktakeMaterialLineRow[],
  filter: MaterialFilter,
  keyword: string,
  category = ""
): StocktakeMaterialLineRow[] => {
  const needle = keyword.trim().toLowerCase();
  return lines.filter(line => {
    if (filter === "uncounted" && line.counted_qty !== null) return false;
    if (filter === "diff" && (line.diff === null || line.diff === 0)) {
      return false;
    }
    if (category && line.category !== category) return false;
    if (!needle) return true;
    return [line.name, line.spec, line.material_code].some(text =>
      (text ?? "").toLowerCase().includes(needle)
    );
  });
};

/** "+0.5"、"-2"、"一致"、""（没录） */
export const diffText = (
  line: Pick<StocktakeMaterialLineRow, "diff">
): string => {
  if (line.diff === null) return "";
  if (line.diff === 0) return "一致";
  return line.diff > 0 ? `+${line.diff}` : String(line.diff);
};

/** 输入框里的字 → 要存的数；空串是 null（清掉）；不合规返回错误文字。 */
export const parseCount = (
  text: string
): { value: number | null } | { error: string } => {
  const trimmed = text.trim();
  if (!trimmed) return { value: null };
  if (trimmed.startsWith("-") && PLAIN_NUMBER.test(trimmed.slice(1))) {
    return { error: "实盘数不能是负数" };
  }
  if (!PLAIN_NUMBER.test(trimmed)) return { error: "请填数字" };
  const decimals = trimmed.split(".")[1] ?? "";
  if (decimals.length > 3) return { error: "最多 3 位小数" };
  const value = Number(trimmed);
  if (value > MAX_COUNT) return { error: "数字太大了" };
  return { value };
};

export interface DeviceStatusTag {
  text: string;
  type: "success" | "danger" | "warning" | "info";
}

export const deviceLineStatus = (
  line: StocktakeDeviceLineRow,
  status: StocktakeStatus
): DeviceStatusTag => {
  if (line.found === 1) {
    if (line.expected === 0 && line.location === "project") {
      return {
        text: `账上在「${line.project_name ?? "项目"}」`,
        type: "warning"
      };
    }
    if (line.expected === 0 && line.location === "scrapped") {
      return { text: "账上已报废", type: "warning" };
    }
    return { text: "已找到", type: "success" };
  }
  if (line.found === 0) return { text: "没找到", type: "danger" };
  // 已完成的盘点里还空着的：盘点期间出库了，或者这次没盘设备。两种都没有被记成没找到
  return status === "done"
    ? { text: "没标记", type: "info" }
    : { text: "没扫到", type: "info" };
};

/** 完成前确认里的几句话；没有可说的那一句不出现。 */
export const completeSummary = (detail: StocktakeRow): string[] => {
  const uncounted = detail.material_total - detail.material_counted;
  const lines = [
    detail.material_diff > 0
      ? `${detail.material_diff} 条物资有差额，会出一张盘点调整单`
      : "",
    detail.material_counted > 0 && detail.material_diff === 0
      ? "账面和实盘一致，不出调整单"
      : "",
    uncounted > 0 ? `还有 ${uncounted} 条物资没盘，这些不动` : "",
    detail.device_missing > 0
      ? `${detail.device_missing} 台在库设备没找到，会在时间线上记「盘点未找到」`
      : "",
    detail.device_expected > 0 &&
    detail.device_missing === 0 &&
    detail.device_found > 0
      ? "设备都找到了"
      : "",
    // 一台都没标记（多半是选了「全部」但只盘了物资）：完成时不会给设备记「没找到」
    detail.device_expected > 0 &&
    detail.device_missing === 0 &&
    detail.device_found === 0 &&
    detail.device_unexpected === 0
      ? "设备一台都没标记，这次不记设备的盘点结果"
      : "",
    detail.device_unexpected > 0
      ? `${detail.device_unexpected} 台扫到了但账上不在库，记得补返库单`
      : ""
  ];
  return lines.filter(Boolean);
};

/** 列表里的进度："6 / 10"；这次盘点不含这一类时是 "-"。 */
export const progressText = (
  row: StocktakeRow,
  kind: "material" | "device"
): string => {
  const [done, total] =
    kind === "material"
      ? [row.material_counted, row.material_total]
      : [row.device_found, row.device_expected];
  return total > 0 ? `${done} / ${total}` : "-";
};

const materialSummary = (lines: readonly StocktakeMaterialLineRow[]) => ({
  material_total: lines.length,
  material_counted: lines.filter(line => line.counted_qty !== null).length,
  material_diff: lines.filter(line => line.diff !== null && line.diff !== 0)
    .length
});

/**
 * 和后端的口径一样：盘点中，账上在库、没标记找到、现在仍在库的算「会被记成没找到」；
 * 但一台设备都还没标记时是 0（这种盘点完成时不记设备）。
 */
const deviceSummary = (lines: readonly StocktakeDeviceLineRow[]) => {
  const expected = lines.filter(line => line.expected === 1);
  const anyMarked = lines.some(line => line.found !== null);
  return {
    device_expected: expected.length,
    device_found: expected.filter(line => line.found === 1).length,
    device_missing: expected.filter(
      line =>
        line.found === 0 ||
        (anyMarked && line.found === null && line.location === "warehouse")
    ).length,
    device_unexpected: lines.filter(
      line => line.expected === 0 && line.found === 1
    ).length
  };
};

/** 录完一行后的新详情：换掉那一行，重算已盘数和差额数。不改传进来的对象。 */
export const applyMaterialLine = (
  detail: StocktakeDetail,
  line: StocktakeMaterialLineRow
): StocktakeDetail => {
  const lines = detail.material_lines.map(item =>
    item.id === line.id ? line : item
  );
  return { ...detail, material_lines: lines, ...materialSummary(lines) };
};

/** 标记一台设备后的新详情：换掉或加上那一行（按编号排），重算台数。 */
export const applyDeviceLine = (
  detail: StocktakeDetail,
  line: StocktakeDeviceLineRow
): StocktakeDetail => {
  const exists = detail.device_lines.some(item => item.id === line.id);
  const lines = exists
    ? detail.device_lines.map(item => (item.id === line.id ? line : item))
    : [...detail.device_lines, line].sort((a, b) =>
        a.device_code.localeCompare(b.device_code)
      );
  return { ...detail, device_lines: lines, ...deviceSummary(lines) };
};
