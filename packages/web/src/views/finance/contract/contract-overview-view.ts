import type { Contract, ContractOverview, ExecutionBand } from "@/api/contract";
import { formatMoney } from "../shared/format";
import { CONTRACT_STATUS_LABELS } from "./contract-detail-view";

export type BandMeta = {
  band: ExecutionBand;
  label: string;
  hint: string;
  color: string;
  /** 这一档没有合同时不列出来 */
  hideWhenEmpty?: boolean;
};

export type BandSegment = BandMeta & { count: number };

const BAND_COLORS: Record<ExecutionBand, string> = {
  normal: "#56708a",
  warning: "#d4820f",
  critical: "#b8322a",
  not_started: "#b9ad98",
  collecting: "#56708a",
  settled: "#5b7f63",
  over: "#6f1616",
  unpriced: "#d8cfbe"
};

/** 已终止的合同不再有风险，进度条不用风险色 */
const ENDED_COLOR = "#c9bda6";

const UNPRICED_META: BandMeta = {
  band: "unpriced",
  label: "未定总额",
  hint: "单价合同，算不出比例",
  color: BAND_COLORS.unpriced,
  hideWhenEmpty: true
};

const OUTBOUND_BANDS: readonly BandMeta[] = [
  {
    band: "normal",
    label: "正常",
    hint: "已付不到 80%",
    color: BAND_COLORS.normal
  },
  {
    band: "warning",
    label: "接近额度",
    hint: "已付 80%–95%",
    color: BAND_COLORS.warning
  },
  {
    band: "critical",
    label: "即将付满",
    hint: "已付超过 95%",
    color: BAND_COLORS.critical
  },
  {
    band: "settled",
    label: "已付清",
    hint: "已付等于合同额",
    color: BAND_COLORS.settled
  },
  {
    band: "over",
    label: "超付",
    hint: "已付超过合同额",
    color: BAND_COLORS.over
  },
  UNPRICED_META
];

const INBOUND_BANDS: readonly BandMeta[] = [
  {
    band: "not_started",
    label: "未到账",
    hint: "一笔都没到",
    color: BAND_COLORS.not_started
  },
  {
    band: "collecting",
    label: "回款中",
    hint: "到账一部分",
    color: BAND_COLORS.collecting
  },
  {
    band: "settled",
    label: "已收齐",
    hint: "到账等于合同额",
    color: BAND_COLORS.settled
  },
  {
    band: "over",
    label: "超收",
    hint: "到账超过合同额",
    color: BAND_COLORS.over,
    hideWhenEmpty: true
  },
  UNPRICED_META
];

const countOf = (overview: ContractOverview, band: ExecutionBand): number =>
  overview.execution.bands.find(item => item.band === band)?.count ?? 0;

export const buildBandSegments = (overview: ContractOverview): BandSegment[] =>
  (overview.direction === "inbound" ? INBOUND_BANDS : OUTBOUND_BANDS)
    .map(meta => ({ ...meta, count: countOf(overview, meta.band) }))
    .filter(item => item.count > 0 || !item.hideWhenEmpty);

/** 页面最上面那句话：这批合同现在要不要操心。 */
export const buildOverviewHeadline = (
  overview: ContractOverview,
  scoped = false
): string => {
  const { direction, execution } = overview;
  if (execution.count === 0) {
    if (scoped) return "这个筛选范围内没有在执行的合同";
    return direction === "inbound"
      ? "还没有在执行的收款合同"
      : "还没有在执行的付款合同";
  }
  if (direction === "inbound") {
    const open =
      countOf(overview, "not_started") + countOf(overview, "collecting");
    return open === 0
      ? "在执行的收款合同都已收齐"
      : `还有 ¥${formatMoney(execution.remaining_amount)} 没到账，涉及 ${open} 份合同`;
  }
  const near = countOf(overview, "warning") + countOf(overview, "critical");
  const over = countOf(overview, "over");
  if (near > 0 && over > 0) {
    return `${near} 份合同快付到合同额，${over} 份已经超付`;
  }
  if (near > 0) return `${near} 份合同快付到合同额`;
  if (over > 0) return `${over} 份合同已经超付`;
  return "在执行的合同都还有余量";
};

export type OverviewFigure = { label: string; value: string };

const money = (value: number): string => `¥${formatMoney(value)}`;

export const buildOverviewFigures = ({
  direction,
  execution
}: ContractOverview): OverviewFigure[] => {
  const shared = [
    { label: "在执行", value: `${execution.count} 份` },
    { label: "合同总额", value: money(execution.total_amount) }
  ];
  return direction === "inbound"
    ? [
        ...shared,
        { label: "已开票", value: money(execution.invoiced_amount) },
        { label: "已到账", value: money(execution.done_amount) },
        { label: "未到账", value: money(execution.remaining_amount) }
      ]
    : [
        ...shared,
        { label: "已付", value: money(execution.done_amount) },
        { label: "未付", value: money(execution.remaining_amount) }
      ];
};

export type ContractGauge = {
  doneLabel: string;
  done: number;
  total: number;
  /** 总额不大于 0 时算不出比例，为 null，不画进度条 */
  percent: number | null;
  fillWidth: number;
  color: string;
  /** 额度刻度，只有付款合同有 */
  ticks: number[];
  note: { label: string; amount: number; alarm: boolean } | null;
  /** 收款合同叠在进度条底下的已开票 */
  invoiced: { amount: number; width: number } | null;
};

const OUTBOUND_TICKS = [80, 95];

/** 向下取整到一位小数：差一点没付清时不能显示成 100%。 */
const toPercent = (done: number, total: number): number =>
  Math.floor((done * 1000) / total) / 10;

const toWidth = (done: number, total: number): number =>
  Math.min(100, Math.max(0, toPercent(done, total)));

export const buildContractGauge = (row: Contract): ContractGauge => {
  const inbound = row.direction === "inbound";
  const done = inbound ? row.received_amount : row.paid_amount;
  const total = row.total_amount;
  const ended = row.status === "terminated";
  const band = row.execution_band ?? "normal";
  const shared = {
    doneLabel: inbound ? "已到账" : "已付",
    done,
    total,
    color: ended ? ENDED_COLOR : BAND_COLORS[band],
    ticks: inbound ? [] : OUTBOUND_TICKS,
    invoiced: inbound
      ? {
          amount: row.invoiced_amount,
          width: total > 0 ? toWidth(row.invoiced_amount, total) : 0
        }
      : null
  };
  if (total <= 0) {
    return { ...shared, percent: null, fillWidth: 0, note: null };
  }
  const settled = band === "settled";
  const percent = settled ? 100 : toPercent(done, total);
  return {
    ...shared,
    percent,
    fillWidth: Math.min(100, Math.max(0, percent)),
    note:
      band === "over"
        ? {
            label: inbound ? "超收" : "超付",
            amount: done - total,
            alarm: !ended
          }
        : {
            label: inbound ? "未到账" : "剩余",
            amount: settled ? 0 : Math.max(0, total - done),
            alarm: false
          }
  };
};

export type StatusTab = { value: string; label: string; count: number };

const STATUS_ORDER = [
  "draft",
  "pending_review",
  "pending_approval",
  "active",
  "completed",
  "terminated"
];

export const visibleStatusTabs = (
  counts: Readonly<Record<string, number>>,
  current: string
): StatusTab[] =>
  STATUS_ORDER.filter(
    value => (counts[value] ?? 0) > 0 || value === current
  ).map(value => ({
    value,
    label: CONTRACT_STATUS_LABELS[value] ?? value,
    count: counts[value] ?? 0
  }));
