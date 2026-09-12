const { request } = require("../../utils/request");
const { statusLabel, contractDirectionLabel, severityLabel } = require("../../utils/enum-labels");

const STATUS_LABELS = {
  draft: "待预审",
  reviewing: "AI审计中",
  passed: "预审通过",
  reviewed: "存在明显错误",
  review_failed: "审计失败",
  signed: "已确认签署",
  transferred: "已转入合同"
};

const STATUS_THEMES = {
  draft: "default",
  reviewing: "warning",
  passed: "success",
  reviewed: "danger",
  review_failed: "danger",
  signed: "primary",
  transferred: "success"
};

const SEVERITY_LABELS = { critical: "明显错误", major: "重要", minor: "提示" };
const SEVERITY_THEMES = { critical: "danger", major: "warning", minor: "default" };
const OVERALL_LABELS = {
  pass: "未见问题",
  minor: "轻微问题",
  major: "重要问题",
  critical: "存在明显错误"
};
const OVERALL_THEMES = {
  pass: "success",
  minor: "default",
  major: "warning",
  critical: "danger"
};
const DIMENSION_LABELS = {
  subject_signing: "主体与签署要件",
  clause_completeness: "条款完整性",
  amount_payment: "金额与支付",
  liability_balance: "权责对等",
  invalid_terms: "无效条款红线",
  stance_risk: "我方立场风险"
};
const DIRECTION_LABELS = {
  inbound: "收款合同（我方乙方）",
  outbound: "付款合同（我方甲方）"
};

const POLL_INTERVAL_MS = 3000;
const POLL_MAX = 120;

const parseJson = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

Page({
  data: {
    id: 0,
    loading: false,
    acting: false,
    detail: null,
    statusLabel: "",
    statusTheme: "default",
    directionLabel: "",
    result: null,
    overallLabel: "",
    overallTheme: "default",
    issues: [],
    ruleFindings: [],
    adoptedIndexes: [],
    opinionText: "",
    canReview: false,
    canConfirmSign: false,
    isReviewing: false
  },

  onLoad(options) {
    const id = Number(options && options.id);
    if (!Number.isFinite(id) || id <= 0) {
      wx.showToast({ title: "参数错误", icon: "none" });
      return;
    }
    this.pollGeneration = 0;
    this.setData({ id });
    this.loadDetail();
  },

  onUnload() {
    // 停止在途轮询，避免页面销毁后继续请求
    this.pollGeneration += 1;
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh());
  },

  async loadDetail() {
    const generation = ++this.pollGeneration;
    this.setData({ loading: true });
    try {
      const res = await request({
        method: "GET",
        path: `/api/v1/contract-precheck/${this.data.id}`
      });
      if (generation !== this.pollGeneration) return;
      this.applyDetail(res.data || res);
      if ((res.data || res).status === "reviewing") {
        this.pollUntilDone(generation);
      }
    } catch (error) {
      wx.showToast({
        title: (error && error.message) || "加载失败",
        icon: "none"
      });
    } finally {
      if (generation === this.pollGeneration) this.setData({ loading: false });
    }
  },

  /** 只轮询回填，不重复入队；页面卸载或重新加载即失效 */
  async pollUntilDone(generation) {
    for (let i = 0; i < POLL_MAX; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (generation !== this.pollGeneration) return;
      try {
        const res = await request({
          method: "GET",
          path: `/api/v1/contract-precheck/${this.data.id}`
        });
        if (generation !== this.pollGeneration) return;
        const detail = res.data || res;
        this.applyDetail(detail);
        if (detail.status !== "reviewing") {
          wx.showToast({
            title: detail.status === "review_failed" ? "AI 审计失败" : "AI 审计完成",
            icon: "none"
          });
          return;
        }
      } catch {
        // 单次失败继续重试
      }
    }
  },

  applyDetail(detail) {
    if (!detail) return;
    const result = parseJson(detail.review_result_json);
    const adoptedRaw = parseJson(detail.adopted_json);
    const adoptedIndexes = Array.isArray(adoptedRaw)
      ? adoptedRaw
          .map((item) => (item && typeof item.issue_index === "number" ? item.issue_index : null))
          .filter((value) => value !== null)
      : [];

    const issues = ((result && result.issues) || []).map((issue, index) => ({
      ...issue,
      index,
      severityLabel: SEVERITY_LABELS[issue.severity] || severityLabel(issue.severity),
      severityTheme: SEVERITY_THEMES[issue.severity] || "default",
      dimensionLabel: DIMENSION_LABELS[issue.dimension] || "其他维度",
      adopted: adoptedIndexes.indexOf(index) >= 0
    }));

    const ruleFindings = ((result && result.rule_findings) || []).map((finding) => ({
      ...finding,
      levelLabel: finding.level === "red" ? "明显错误" : "关注",
      levelTheme: finding.level === "red" ? "danger" : "warning"
    }));

    this.setData({
      detail,
      statusLabel: STATUS_LABELS[detail.status] || statusLabel(detail.status),
      statusTheme: STATUS_THEMES[detail.status] || "default",
      directionLabel: DIRECTION_LABELS[detail.direction] || contractDirectionLabel(detail.direction),
      result,
      overallLabel: (result && OVERALL_LABELS[result.overall]) || "",
      overallTheme: (result && OVERALL_THEMES[result.overall]) || "default",
      issues,
      ruleFindings,
      adoptedIndexes,
      opinionText: this.buildOpinionText(detail.title, issues, ruleFindings),
      isReviewing: detail.status === "reviewing",
      canReview: ["passed", "reviewed", "review_failed", "signed", "draft"].indexOf(detail.status) >= 0,
      canConfirmSign: detail.status === "passed"
    });
  },

  buildOpinionText(title, issues, ruleFindings) {
    const lines = [`《${title || "合同"}》合同修改意见清单`, ""];
    let seq = 0;
    issues.forEach((issue) => {
      seq += 1;
      lines.push(`${seq}. 【${issue.severityLabel}】${issue.problem}`);
      if (issue.quote) lines.push(`   原文：${issue.quote}`);
      if (issue.suggestion) lines.push(`   建议修改为：${issue.suggestion}`);
      lines.push("");
    });
    ruleFindings.forEach((finding) => {
      seq += 1;
      const basis = finding.legal_basis ? `（依据：${finding.legal_basis}）` : "";
      lines.push(`${seq}. 【${finding.levelLabel}】${finding.reason}${basis}`);
      if (finding.text) lines.push(`   原文：${finding.text}`);
      lines.push("");
    });
    if (seq === 0) lines.push("（无修改意见）");
    return lines.join("\n").replace(/\s+$/, "");
  },

  copyOpinions() {
    wx.setClipboardData({
      data: this.data.opinionText,
      success: () => {
        wx.showToast({ title: "已复制，可发给对方", icon: "none" });
      }
    });
  },

  async toggleAdopt(event) {
    if (this.data.acting) return;
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    const adopted = this.data.adoptedIndexes.indexOf(index) < 0;
    this.setData({ acting: true });
    try {
      await request({
        method: "POST",
        path: `/api/v1/contract-precheck/${this.data.id}/adopt`,
        data: { issue_index: index, adopted }
      });
      await this.loadDetail();
    } catch (error) {
      wx.showToast({
        title: (error && error.message) || "操作失败",
        icon: "none"
      });
    } finally {
      this.setData({ acting: false });
    }
  },

  rerunReview() {
    wx.showModal({
      title: "重新预审",
      content: "用当前文件重新执行 AI 预审（约 1-2 分钟），是否继续？",
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ acting: true });
        try {
          await request({
            method: "POST",
            path: `/api/v1/contract-precheck/${this.data.id}/review`,
            data: {}
          });
          wx.showToast({ title: "已发起复审", icon: "none" });
          this.loadDetail();
        } catch (error) {
          wx.showToast({
            title: (error && error.message) || "复审发起失败",
            icon: "none"
          });
        } finally {
          this.setData({ acting: false });
        }
      }
    });
  },

  confirmSigned() {
    wx.showModal({
      title: "确认签署",
      content: "确认已与对方就修改意见完成沟通并完成合同签署？确认后可在网页端转入合同台账发起审批。",
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ acting: true });
        try {
          await request({
            method: "POST",
            path: `/api/v1/contract-precheck/${this.data.id}/confirm-signed`,
            data: {}
          });
          wx.showToast({ title: "已确认签署", icon: "none" });
          this.loadDetail();
        } catch (error) {
          wx.showToast({
            title: (error && error.message) || "确认失败",
            icon: "none"
          });
        } finally {
          this.setData({ acting: false });
        }
      }
    });
  }
});
