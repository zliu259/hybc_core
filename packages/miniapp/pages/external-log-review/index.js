const { request } = require("../../utils/request");

const shiftText = {
  day: "白班",
  night: "夜班"
};

const statusText = {
  pending_ai_review: "AI审计中",
  needs_manual_review: "需人工复核",
  ai_approved: "AI低风险",
  approved_auto: "AI自动通过",
  approved_manual: "人工通过",
  rejected: "已驳回"
};

const riskText = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
  unknown: "未知"
};

const safeParseObject = (value) => {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const stripHtml = (value) => String(value || "").replace(/<[^>]+>/g, "").trim();

Page({
  data: {
    projectId: 0,
    loading: false,
    actionBusy: false,
    rows: []
  },

  onLoad(query) {
    const projectId = Number(query.projectId || 0);
    this.setData({ projectId });
    this.loadRows();
  },

  onShow() {
    if (this.data.projectId) {
      this.loadRows();
    }
  },

  mapRow(item) {
    const operatorPayload = safeParseObject(item.operator_log_payload_json);
    const projectPayload = safeParseObject(item.project_log_payload_json);
    const aiReview = safeParseObject(item.ai_review_result_json);
    const issues = Array.isArray(aiReview.issues)
      ? aiReview.issues
          .map((issue) => {
            if (typeof issue === "string") return { severity: "info", message: issue };
            if (!issue || typeof issue !== "object") return null;
            return {
              severity: issue.severity || "info",
              message: issue.message || issue.summary || issue.reason || ""
            };
          })
          .filter((issue) => issue && issue.message)
      : [];
    return {
      id: Number(item.id),
      submitterName: item.submitter_name || "-",
      submitterCompany: item.submitter_company || "-",
      submitterPhone: item.submitter_phone || "-",
      sectionText: `${item.section_code || "-"} ${item.section_name || ""}`.trim(),
      logDate: item.log_date || "-",
      shiftText: shiftText[item.shift] || item.shift || "-",
      statusText: statusText[item.review_status] || item.review_status || "-",
      scoreText: item.ai_review_score === null || item.ai_review_score === undefined ? "-" : String(item.ai_review_score),
      riskText: riskText[item.ai_review_risk_level] || item.ai_review_risk_level || "-",
      aiSummary: item.ai_review_summary || "AI未返回摘要",
      issues,
      operatorSummary:
        operatorPayload.enabled === false
          ? "未填写工作段日志"
          : [
              operatorPayload.weather ? `天气：${operatorPayload.weather}` : "",
              `本班下管：${Number(operatorPayload.completed_pipe_count || 0)}`,
              `累计下管：${Number(operatorPayload.cumulative_pipe_count || 0)}`,
              operatorPayload.footage_m ? `进尺：${operatorPayload.footage_m}m` : "",
              operatorPayload.issue_summary ? `问题：${operatorPayload.issue_summary}` : "",
              operatorPayload.remark ? `备注：${operatorPayload.remark}` : ""
            ]
              .filter(Boolean)
              .join(" · "),
      projectSummary:
        projectPayload.enabled === false
          ? "未填写项目日志"
          : [
              projectPayload.title || "",
              stripHtml(projectPayload.detail_html || projectPayload.detail || ""),
              projectPayload.risk_note ? `风险：${projectPayload.risk_note}` : ""
            ]
              .filter(Boolean)
              .join(" · ")
    };
  },

  async loadRows() {
    if (!this.data.projectId || this.data.loading) return;
    this.setData({ loading: true });
    try {
      const res = await request({
        method: "GET",
        path: `/api/v1/project/${this.data.projectId}/external-log-submissions?status=needs_manual_review&page=1&pageSize=50`
      });
      const rows = Array.isArray(res.data) ? res.data.map((item) => this.mapRow(item)) : [];
      this.setData({ rows });
    } catch (error) {
      this.setData({ rows: [] });
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  confirmReview(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    const action = e.currentTarget.dataset.action;
    if (!id || !["approve", "reject"].includes(action)) return;
    wx.showModal({
      title: action === "approve" ? "确认放行" : "确认驳回",
      content: action === "approve" ? "放行后将写入正式项目/施工日志。" : "驳回后该外部日志不会写入正式日志。",
      confirmText: action === "approve" ? "放行" : "驳回",
      confirmColor: action === "approve" ? "#1677ff" : "#d93026",
      success: (res) => {
        if (res.confirm) {
          this.reviewSubmission(id, action);
        }
      }
    });
  },

  async reviewSubmission(id, action) {
    if (this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    try {
      await request({
        method: "POST",
        path: `/api/v1/project/${this.data.projectId}/external-log-submissions/${id}/review`,
        data: {
          action,
          comment: action === "approve" ? "小程序复核放行外部日志" : "小程序复核驳回外部日志"
        }
      });
      wx.showToast({ title: action === "approve" ? "已放行" : "已驳回", icon: "success" });
      await this.loadRows();
    } catch (error) {
      wx.showToast({ title: error.message || "操作失败", icon: "none" });
    } finally {
      this.setData({ actionBusy: false });
    }
  }
});
