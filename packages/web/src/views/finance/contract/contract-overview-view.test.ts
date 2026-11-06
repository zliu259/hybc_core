import { describe, expect, it } from "vitest";
import type { Contract, ContractOverview, ExecutionBand } from "@/api/contract";
import {
  buildBandSegments,
  buildContractGauge,
  buildOverviewFigures,
  buildOverviewHeadline,
  visibleStatusTabs
} from "./contract-overview-view";

const overview = (
  direction: Contract["direction"],
  counts: Partial<Record<ExecutionBand, number>>,
  amounts: Partial<ContractOverview["execution"]> = {}
): ContractOverview => {
  const bands = Object.entries(counts).map(([band, count]) => ({
    band: band as ExecutionBand,
    count: count ?? 0,
    total_amount: 0,
    done_amount: 0
  }));
  return {
    direction,
    status_counts: {},
    total_count: 0,
    execution: {
      count: bands.reduce((sum, item) => sum + item.count, 0),
      total_amount: 0,
      done_amount: 0,
      remaining_amount: 0,
      invoiced_amount: 0,
      bands,
      ...amounts
    }
  };
};

const row = (patch: Partial<Contract>): Contract =>
  ({
    direction: "outbound",
    status: "active",
    total_amount: 1000,
    paid_amount: 0,
    invoiced_amount: 0,
    received_amount: 0,
    execution_band: "normal",
    ...patch
  }) as Contract;

describe("buildOverviewHeadline", () => {
  it("付款合同先说要关注的：接近额度和已超付分开说", () => {
    const both = overview("outbound", { warning: 18, critical: 6, over: 3 });
    expect(buildOverviewHeadline(both)).toBe(
      "24 份合同快付到合同额，3 份已经超付"
    );
    expect(buildOverviewHeadline(overview("outbound", { warning: 2 }))).toBe(
      "2 份合同快付到合同额"
    );
    expect(buildOverviewHeadline(overview("outbound", { over: 1 }))).toBe(
      "1 份合同已经超付"
    );
  });

  it("没有要关注的合同时直接说没有，已付清不算风险", () => {
    const calm = overview("outbound", { normal: 40, settled: 5 });
    expect(buildOverviewHeadline(calm)).toBe("在执行的合同都还有余量");
  });

  it("收款合同说还有多少钱没到账", () => {
    const open = overview(
      "inbound",
      { not_started: 2, collecting: 3, settled: 1 },
      { remaining_amount: 1234.5 }
    );
    expect(buildOverviewHeadline(open)).toBe(
      "还有 ¥1,234.50 没到账，涉及 5 份合同"
    );
    expect(buildOverviewHeadline(overview("inbound", { settled: 2 }))).toBe(
      "在执行的收款合同都已收齐"
    );
  });

  it("没有在执行的合同时，区分是筛选造成的还是真的没有", () => {
    expect(buildOverviewHeadline(overview("outbound", {}))).toBe(
      "还没有在执行的付款合同"
    );
    expect(buildOverviewHeadline(overview("inbound", {}))).toBe(
      "还没有在执行的收款合同"
    );
    expect(buildOverviewHeadline(overview("outbound", {}), true)).toBe(
      "这个筛选范围内没有在执行的合同"
    );
  });
});

describe("buildOverviewFigures", () => {
  it("付款合同显示已付和未付，不显示已开票", () => {
    const figures = buildOverviewFigures(
      overview(
        "outbound",
        { normal: 2 },
        { total_amount: 3000, done_amount: 1000, remaining_amount: 2000 }
      )
    );
    expect(figures).toEqual([
      { label: "在执行", value: "2 份" },
      { label: "合同总额", value: "¥3,000.00" },
      { label: "已付", value: "¥1,000.00" },
      { label: "未付", value: "¥2,000.00" }
    ]);
  });

  it("收款合同显示已开票和已到账", () => {
    const figures = buildOverviewFigures(
      overview(
        "inbound",
        { collecting: 1 },
        {
          total_amount: 3000,
          done_amount: 1000,
          remaining_amount: 2000,
          invoiced_amount: 1500
        }
      )
    );
    expect(figures.map(item => item.label)).toEqual([
      "在执行",
      "合同总额",
      "已开票",
      "已到账",
      "未到账"
    ]);
  });
});

describe("buildBandSegments", () => {
  it("付款合同按进度顺序列出，空档保留，这样能看出没有超付", () => {
    const segments = buildBandSegments(overview("outbound", { normal: 5 }));
    expect(segments.map(item => [item.band, item.count])).toEqual([
      ["normal", 5],
      ["warning", 0],
      ["critical", 0],
      ["settled", 0],
      ["over", 0]
    ]);
  });

  it("未定总额只有存在时才列出", () => {
    const segments = buildBandSegments(overview("outbound", { unpriced: 1 }));
    expect(segments.at(-1)).toMatchObject({ band: "unpriced", count: 1 });
  });

  it("收款合同用自己的档位，超收是异常，没有时不列", () => {
    const segments = buildBandSegments(
      overview("inbound", { not_started: 1, collecting: 2 })
    );
    expect(segments.map(item => item.band)).toEqual([
      "not_started",
      "collecting",
      "settled"
    ]);
  });
});

describe("buildContractGauge", () => {
  it("付款合同显示已付、剩余和 80、95 两道刻度", () => {
    const gauge = buildContractGauge(
      row({ paid_amount: 820, execution_band: "warning" })
    );
    expect(gauge).toMatchObject({
      doneLabel: "已付",
      done: 820,
      total: 1000,
      percent: 82,
      fillWidth: 82,
      ticks: [80, 95],
      note: { label: "剩余", amount: 180, alarm: false },
      invoiced: null
    });
  });

  it("百分比向下取整，没付清不能显示成 100%", () => {
    const gauge = buildContractGauge(
      row({ paid_amount: 999.99, execution_band: "critical" })
    );
    expect(gauge.percent).toBe(99.9);
  });

  it("付清时差不足一分也显示 100%", () => {
    const gauge = buildContractGauge(
      row({ paid_amount: 999.996, execution_band: "settled" })
    );
    expect(gauge.percent).toBe(100);
    expect(gauge.note).toEqual({ label: "剩余", amount: 0, alarm: false });
  });

  it("超付时进度条到头，比例和超付额如实显示", () => {
    const gauge = buildContractGauge(
      row({ paid_amount: 1200, execution_band: "over" })
    );
    expect(gauge.percent).toBe(120);
    expect(gauge.fillWidth).toBe(100);
    expect(gauge.note).toEqual({ label: "超付", amount: 200, alarm: true });
  });

  it("单价合同算不出比例，不画进度条", () => {
    const gauge = buildContractGauge(
      row({ total_amount: 0, paid_amount: 500, execution_band: "unpriced" })
    );
    expect(gauge.percent).toBeNull();
    expect(gauge.note).toBeNull();
    expect(gauge.done).toBe(500);
  });

  it("收款合同看到账和开票，不用已付，也没有额度刻度", () => {
    const gauge = buildContractGauge(
      row({
        direction: "inbound",
        paid_amount: 999,
        received_amount: 300,
        invoiced_amount: 500,
        execution_band: "collecting"
      })
    );
    expect(gauge).toMatchObject({
      doneLabel: "已到账",
      done: 300,
      percent: 30,
      ticks: [],
      note: { label: "未到账", amount: 700, alarm: false },
      invoiced: { amount: 500, width: 50 }
    });
  });

  it("已终止的合同不再报警，进度条变灰", () => {
    const active = buildContractGauge(
      row({ paid_amount: 1200, execution_band: "over" })
    );
    const ended = buildContractGauge(
      row({ status: "terminated", paid_amount: 1200, execution_band: "over" })
    );
    expect(ended.color).not.toBe(active.color);
    expect(ended.note?.alarm).toBe(false);
  });

  it("接口还没带档位时（前后端部署有先后）不会报错", () => {
    const gauge = buildContractGauge(
      row({ paid_amount: 100, execution_band: undefined })
    );
    expect(gauge.percent).toBe(10);
  });
});

describe("visibleStatusTabs", () => {
  it("按固定顺序列状态，没有合同的状态不占位置，当前选中的除外", () => {
    const tabs = visibleStatusTabs(
      { active: 5, draft: 2, terminated: 1 },
      "completed"
    );
    expect(tabs.map(item => item.value)).toEqual([
      "draft",
      "active",
      "completed",
      "terminated"
    ]);
    expect(tabs[1]).toEqual({ value: "active", label: "生效中", count: 5 });
    expect(tabs[2].count).toBe(0);
  });
});
