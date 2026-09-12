const { request } = require("../../utils/request");
const {
  buildSectionProgressInsight,
} = require("../../utils/project-section-progress");

const today = () => new Date().toISOString().slice(0, 10);

const sectionStatusText = {
  planning: "规划中",
  preparing: "筹备中",
  active: "施工中",
  completing: "收尾中",
  archived: "已归档",
  normal: "正常",
  paused: "暂停",
  blocked: "受阻",
  done: "完成",
};

const reportStatusText = {
  draft: "草稿",
  submitted: "已提交",
  approved: "已审核",
  rejected: "已驳回",
};

const shiftText = {
  day: "白班",
  night: "夜班",
};

const deviationText = {
  left: "左偏",
  right: "右偏",
  high: "高",
  low: "低",
};

const trendGroupDefinitions = [
  { label: "进度", value: "progress" },
  { label: "设备", value: "equipment" },
  { label: "偏差", value: "deviation" },
];

const trendSeriesDefinitions = {
  progress: [
    {
      key: "cumulativeFootageM",
      name: "累计顶进",
      unit: "m",
      digits: 1,
      color: "#2f6f6d",
    },
    {
      key: "footageM",
      name: "本班顶进",
      unit: "m",
      digits: 1,
      color: "#c58a3a",
    },
    {
      key: "completedPipeCount",
      name: "完成管节",
      unit: "节",
      digits: 0,
      color: "#6672a7",
    },
  ],
  equipment: [
    {
      key: "chamberPressureMpa",
      name: "泥仓压力",
      unit: "MPa",
      digits: 2,
      color: "#2f6f6d",
    },
    {
      key: "cutterFrequencyHz",
      name: "刀盘频率",
      unit: "Hz",
      digits: 0,
      color: "#b66b3d",
    },
    {
      key: "cutterCurrentA",
      name: "刀盘电流",
      unit: "A",
      digits: 0,
      color: "#5b6fa8",
    },
  ],
  deviation: [
    {
      key: "horizontalDeviationMm",
      name: "水平偏差",
      unit: "mm",
      digits: 0,
      color: "#3f7f72",
    },
    {
      key: "verticalDeviationMm",
      name: "高程偏差",
      unit: "mm",
      digits: 0,
      color: "#b35f49",
    },
  ],
};

const emptyTrendPanel = () => ({
  summaryItems: [],
  groupOptions: trendGroupDefinitions.map((item) => ({
    ...item,
    active: item.value === "progress",
  })),
  chartSeries: [],
  chartData: { categories: [], series: [] },
  chartOpts: {},
  recentRows: [],
  hasRows: false,
});

const formatDeviation = (item) => {
  const horizontalDirection =
    item.horizontal_deviation_direction || item.deviation_direction || "";
  const horizontalValue =
    item.horizontal_deviation_mm === null ||
    item.horizontal_deviation_mm === undefined
      ? item.deviation_value_mm
      : item.horizontal_deviation_mm;
  const parts = [
    horizontalDirection &&
    horizontalValue !== null &&
    horizontalValue !== undefined
      ? `${deviationText[horizontalDirection] || horizontalDirection}${horizontalValue}mm`
      : "",
    item.vertical_deviation_direction &&
    item.vertical_deviation_mm !== null &&
    item.vertical_deviation_mm !== undefined
      ? `${deviationText[item.vertical_deviation_direction] || item.vertical_deviation_direction}${item.vertical_deviation_mm}mm`
      : "",
  ].filter(Boolean);
  return parts.length ? parts.join("，") : "-";
};

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatTrendNumber = (value, suffix = "", digits = 1) => {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return "-";
  return `${numeric.toFixed(digits)}${suffix}`;
};

const formatEstimateDays = (value) => {
  const numeric = toFiniteNumber(value);
  return numeric === null ? "-" : `${numeric}天`;
};

const formatTrendDeviation = (row) => {
  const parts = [
    typeof row.horizontalDeviationMm === "number"
      ? `水平${row.horizontalDeviationMm > 0 ? "+" : ""}${row.horizontalDeviationMm}mm`
      : "",
    typeof row.verticalDeviationMm === "number"
      ? `高程${row.verticalDeviationMm > 0 ? "+" : ""}${row.verticalDeviationMm}mm`
      : "",
  ].filter(Boolean);
  return parts.length ? parts.join("，") : "-";
};

const buildUchartsConfig = (rows, activeGroup) => {
  const definitions = trendSeriesDefinitions[activeGroup] || [];
  const categories = rows.map((row) =>
    String(row.label || "").replace(" ", "\n"),
  );
  const series = definitions
    .map((config) => {
      const data = rows.map((row) => toFiniteNumber(row[config.key]));
      if (!data.some((value) => value !== null)) return null;
      return {
        name: config.name,
        data,
        legendShape: "line",
      };
    })
    .filter(Boolean);

  return {
    chartData: {
      categories,
      series,
    },
    chartOpts: {
      color: definitions.map((item) => item.color),
      padding: [12, 12, 6, 8],
      dataLabel: false,
      dataPointShape: true,
      enableScroll: false,
      legend: {
        show: true,
        position: "bottom",
        lineHeight: 18,
        fontSize: 10,
        fontColor: "#5c667a",
      },
      xAxis: {
        disableGrid: true,
        fontColor: "#7b8798",
        fontSize: 10,
        boundaryGap: "justify",
      },
      yAxis: {
        gridType: "dash",
        dashLength: 3,
        splitNumber: 4,
        fontColor: "#7b8798",
        fontSize: 10,
      },
      extra: {
        line: {
          type: "curve",
          width: 2,
          activeType: "hollow",
        },
      },
    },
  };
};

Page({
  data: {
    loading: false,
    initialized: false,
    projectId: 0,
    sectionId: 0,
    readonly: true,
    section: null,
    operatorLogs: [],
    breakthroughReports: [],
    activeTrendGroup: "progress",
    trendPanel: emptyTrendPanel(),
    breakthroughDialogVisible: false,
    editingBreakthroughId: 0,
    breakthroughSubmitting: false,
    breakthroughForm: {
      report_date: today(),
      breakthrough_m: "",
      summary: "",
      detail: "",
    },
  },

  onLoad(query) {
    const projectId = Number(query.projectId || 0);
    const sectionId = Number(query.sectionId || 0);
    const readonly = String(query.readonly || "1") === "1";
    this.setData({ projectId, sectionId, readonly, initialized: true });
    this.loadData();
  },

  onShow() {
    if (this.data.initialized) {
      this.loadData();
    }
  },

  toSectionStatus(status) {
    return sectionStatusText[status] || "未知";
  },

  toReportStatus(status) {
    return reportStatusText[status] || "未知";
  },

  buildTrendPanel(section, operatorLogs, activeGroup) {
    if (!section) return emptyTrendPanel();
    const group = trendSeriesDefinitions[activeGroup]
      ? activeGroup
      : "progress";
    const insight = buildSectionProgressInsight(
      section.section_length,
      operatorLogs || [],
    );
    const summary = insight.summary;
    const chartConfig = buildUchartsConfig(insight.trendRows, group);

    return {
      summaryItems: [
        {
          label: "剩余里程",
          value: formatTrendNumber(summary.remainingM, "m"),
          sub: `总长 ${formatTrendNumber(summary.sectionLengthM, "m")}`,
          accent: false,
        },
        {
          label: "历史日均",
          value: formatTrendNumber(summary.averageDailyFootageM, "m/天"),
          sub: `有效施工 ${summary.activeDays} 天`,
          accent: false,
        },
        {
          label: "近三日日均",
          value: formatTrendNumber(summary.recentDailyFootageM, "m/天"),
          sub: "最近有顶进记录日期",
          accent: false,
        },
        {
          label: "预计剩余",
          value: formatEstimateDays(summary.estimatedDaysRemaining),
          sub: "近三日优先，历史日均兜底",
          accent: true,
        },
      ],
      groupOptions: trendGroupDefinitions.map((item) => ({
        ...item,
        active: item.value === group,
      })),
      chartSeries: chartConfig.chartData.series,
      chartData: chartConfig.chartData,
      chartOpts: chartConfig.chartOpts,
      recentRows: insight.recentRows.map((row) => ({
        id: row.id,
        label: row.label,
        cumulativeFootageText: formatTrendNumber(row.cumulativeFootageM, "m"),
        footageText: formatTrendNumber(row.footageM, "m"),
        pipeText: formatTrendNumber(row.completedPipeCount, "节", 0),
        pressureText: formatTrendNumber(row.chamberPressureMpa, "MPa", 2),
        frequencyText: formatTrendNumber(row.cutterFrequencyHz, "Hz", 0),
        deviationText: formatTrendDeviation(row),
      })),
      hasRows: insight.trendRows.length > 0,
    };
  },

  async loadData() {
    if (!this.data.projectId || !this.data.sectionId) return;
    this.setData({ loading: true });
    try {
      const [sectionsRes, operatorRes, breakthroughRes] = await Promise.all([
        request({
          method: "GET",
          path: `/api/v1/project/${this.data.projectId}/sections`,
        }),
        request({
          method: "GET",
          path: `/api/v1/log/operator?project_id=${this.data.projectId}&section_id=${this.data.sectionId}&page=1&pageSize=200`,
        }),
        request({
          method: "GET",
          path: `/api/v1/survey/breakthrough?project_id=${this.data.projectId}&section_id=${this.data.sectionId}`,
        }),
      ]);

      const section = (
        Array.isArray(sectionsRes.data) ? sectionsRes.data : []
      ).find((item) => Number(item.id) === Number(this.data.sectionId));

      const operatorLogs = (
        Array.isArray(operatorRes.data) ? operatorRes.data : []
      )
        .slice()
        .sort((a, b) =>
          String(b.log_date || "").localeCompare(String(a.log_date || "")),
        )
        .map((item) => ({
          ...item,
          shiftText: shiftText[item.shift] || item.shift || "-",
          deviationText: formatDeviation(item),
        }));

      const breakthroughReports = (
        Array.isArray(breakthroughRes.data) ? breakthroughRes.data : []
      )
        .slice()
        .sort((a, b) =>
          String(b.report_date || "").localeCompare(
            String(a.report_date || ""),
          ),
        )
        .map((item) => ({
          ...item,
          statusText: this.toReportStatus(item.status),
        }));

      this.setData({
        section: section
          ? {
              ...section,
              statusText: this.toSectionStatus(section.status),
              pipeText:
                section.pipe_model ||
                (section.pipe_diameter_mm
                  ? `DN${section.pipe_diameter_mm}`
                  : "-"),
              slopeText:
                section.design_slope === null ||
                section.design_slope === undefined
                  ? "-"
                  : `${section.design_slope}%`,
              jackingMethodText: section.jacking_method || "-",
            }
          : null,
        operatorLogs,
        breakthroughReports,
        trendPanel: this.buildTrendPanel(
          section,
          operatorLogs,
          this.data.activeTrendGroup,
        ),
      });
    } catch (error) {
      wx.showToast({ title: "加载标段失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  goCreateOperatorLog() {
    if (this.data.readonly) {
      this.showReadonlyTip();
      return;
    }
    wx.navigateTo({
      url: `/pages/operator-log/index?projectId=${this.data.projectId}&sectionId=${this.data.sectionId}`,
    });
  },

  onTrendGroupChange(e) {
    const group = e.currentTarget.dataset.group || "progress";
    this.setData({
      activeTrendGroup: group,
      trendPanel: this.buildTrendPanel(
        this.data.section,
        this.data.operatorLogs,
        group,
      ),
    });
  },

  goEditOperatorLog(e) {
    if (this.data.readonly) {
      this.showReadonlyTip();
      return;
    }
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({
      url: `/pages/operator-log/index?id=${id}&projectId=${this.data.projectId}&sectionId=${this.data.sectionId}`,
    });
  },

  openCreateBreakthrough() {
    if (this.data.readonly) {
      this.showReadonlyTip();
      return;
    }
    this.setData({
      breakthroughDialogVisible: true,
      editingBreakthroughId: 0,
      breakthroughForm: {
        report_date: today(),
        breakthrough_m: "",
        summary: "",
        detail: "",
      },
    });
  },

  openEditBreakthrough(e) {
    if (this.data.readonly) {
      this.showReadonlyTip();
      return;
    }
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    const row = (this.data.breakthroughReports || []).find(
      (item) => Number(item.id) === id,
    );
    if (!row) return;
    this.setData({
      breakthroughDialogVisible: true,
      editingBreakthroughId: id,
      breakthroughForm: {
        report_date: row.report_date || today(),
        breakthrough_m:
          row.breakthrough_m === null || row.breakthrough_m === undefined
            ? ""
            : String(row.breakthrough_m),
        summary: row.summary || "",
        detail: row.detail || "",
      },
    });
  },

  closeBreakthroughDialog() {
    this.setData({ breakthroughDialogVisible: false });
  },

  onBreakthroughDateChange(e) {
    this.setData({ "breakthroughForm.report_date": e.detail.value });
  },

  onBreakthroughInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`breakthroughForm.${key}`]: e.detail.value });
  },

  async submitBreakthrough() {
    if (this.data.readonly) {
      this.showReadonlyTip();
      return;
    }
    if (this.data.breakthroughSubmitting) return;
    const form = this.data.breakthroughForm || {};
    if (!form.report_date) {
      wx.showToast({ title: "请填写报告日期", icon: "none" });
      return;
    }

    this.setData({ breakthroughSubmitting: true });
    wx.showLoading({ title: "提交中...", mask: true });
    try {
      const payload = {
        project_id: this.data.projectId,
        section_id: this.data.sectionId,
        report_date: form.report_date,
        breakthrough_m:
          form.breakthrough_m === "" ? undefined : Number(form.breakthrough_m),
        summary: form.summary || "",
        detail: form.detail || "",
        status: "submitted",
      };
      if (this.data.editingBreakthroughId > 0) {
        await request({
          method: "PUT",
          path: `/api/v1/survey/breakthrough/${this.data.editingBreakthroughId}`,
          data: payload,
        });
      } else {
        await request({
          method: "POST",
          path: "/api/v1/survey/breakthrough",
          data: payload,
        });
      }

      this.setData({ breakthroughDialogVisible: false });
      wx.hideLoading();
      wx.showToast({
        title: this.data.editingBreakthroughId > 0 ? "更新成功" : "创建成功",
        icon: "success",
      });
      await this.loadData();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: (error && error.message) || "保存失败",
        icon: "none",
      });
    } finally {
      this.setData({ breakthroughSubmitting: false });
    }
  },

  showReadonlyTip() {
    wx.showToast({ title: "只读模式：非参与者不可执行写操作", icon: "none" });
  },
});
