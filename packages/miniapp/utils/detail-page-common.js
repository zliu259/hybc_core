/**
 * 付款详情、合同详情共用的页面逻辑：AI 审查区、审批流程区的状态，以及折叠开关。
 * 这些区块的 WXML 在 templates/detail-cards.wxml，字段名要和模板一致。
 */
const { buildAiReportViewModel } = require("./ai-review");
const {
  buildAiPanel,
  buildNodeNameMap,
  buildTimelineNodes,
  buildWaitText,
  extractStopReason,
  formatBeijingTime,
  groupTimelineRounds,
  shouldExpandFlow
} = require("./approval-detail-view");

const QUERY_ROLES = ["super_admin", "finance", "manager"];
const NO_AI = { latest: null, earlier: [] };

const canAccessQuery = (roles) => roles.some((role) => QUERY_ROLES.indexOf(role) >= 0);

const INITIAL_DETAIL_CARD_DATA = {
  remarkEditsOpen: false,
  // AI 审查
  aiVisible: false,
  ai: NO_AI,
  aiPassedOpen: false,
  aiEarlierOpen: false,
  aiReportTitle: "",
  aiReportOpen: false,
  aiBizReport: null,
  detailAuditView: null,
  // 审批流程
  waitText: "",
  stopReasonText: "",
  stopIsReturned: false,
  stopIsClosed: false,
  timelineNodes: [],
  earlierRounds: [],
  flowRoundLabel: "",
  flowOpenRound: 0,
  flowCollapsed: true,
  showApprovalLink: false,
  approvalUnavailable: false
};

/**
 * @param {object} params
 * @param {object | null} params.approval GET /approval/:id；只对参与人开放，取不到时是 null
 * @param {unknown} params.source 业务单上的 AI 报告
 * @param {string} params.status 报告状态
 * @param {"payment" | "contract"} params.kind
 * @param {string} params.reportTitle
 */
const buildAiState = ({ approval, source, status, kind, reportTitle }) => {
  const ai = approval
    ? buildAiPanel(approval.ai_gate_reviews, buildNodeNameMap(approval), formatBeijingTime)
    : NO_AI;
  const hasReport = Boolean(source) || Boolean(status && status !== "none");
  return {
    ai,
    aiVisible: Boolean(ai.latest) || hasReport,
    aiPassedOpen: false,
    aiEarlierOpen: false,
    aiBizReport: buildAiReportViewModel(source, kind, status),
    aiReportTitle: hasReport ? reportTitle : "",
    // 有关卡结论时报告折叠；没有时报告就是唯一内容，直接展开
    aiReportOpen: !ai.latest
  };
};

/**
 * @param {object} params
 * @param {object | null} params.approval
 * @param {number} params.instanceId 业务单上的审批实例 id，0 表示没提审
 * @param {Record<string, string>} params.userNames
 * @param {boolean} params.fromApproval 从审批详情过来的不再链回去
 * @param {string} [params.bizRemark] 业务单备注，存量作废只记在这里
 */
const buildApprovalState = ({ approval, instanceId, userNames, fromApproval, bizRemark }) => {
  const usable = Boolean(approval && approval.instance);
  const links = {
    // 审批详情只对参与人和超管开放，取不到时跳过去也打不开
    showApprovalLink: usable && !fromApproval,
    approvalUnavailable: Boolean(instanceId) && !usable
  };
  if (!usable) {
    return {
      ...links,
      waitText: "",
      stopReasonText: "",
      stopIsReturned: false,
      stopIsClosed: false,
      timelineNodes: [],
      earlierRounds: [],
      flowRoundLabel: "",
      flowOpenRound: 0,
      flowCollapsed: true
    };
  }
  const { instance } = approval;
  const ctx = {
    user: (id) => (id && userNames[id]) || "未匹配",
    formatTime: formatBeijingTime
  };
  const allNodes = buildTimelineNodes(approval, ctx);
  const rounds = groupTimelineRounds(allNodes, approval);
  return {
    ...links,
    waitText: buildWaitText(instance, approval.nodes),
    stopReasonText: extractStopReason(allNodes, approval, bizRemark, ctx),
    stopIsReturned: instance.status === "returned",
    stopIsClosed: instance.status === "cancelled" || instance.status === "withdrawn",
    timelineNodes: rounds.currentNodes,
    earlierRounds: rounds.earlier,
    flowRoundLabel: rounds.roundLabel,
    flowOpenRound: 0,
    flowCollapsed: !shouldExpandFlow(instance.status, rounds.currentNodes)
  };
};

/** 展开到 Page({...}) 里的折叠开关 */
const DETAIL_CARD_TOGGLES = {
  toggleAiPassed() {
    this.setData({ aiPassedOpen: !this.data.aiPassedOpen });
  },
  toggleAiReport() {
    this.setData({ aiReportOpen: !this.data.aiReportOpen });
  },
  toggleAiEarlier() {
    this.setData({ aiEarlierOpen: !this.data.aiEarlierOpen });
  },
  toggleRemarkEdits() {
    this.setData({ remarkEditsOpen: !this.data.remarkEditsOpen });
  },
  toggleFlowCollapse() {
    this.setData({ flowCollapsed: !this.data.flowCollapsed });
  },
  toggleFlowRound(e) {
    const round = Number(e.currentTarget.dataset.round) || 0;
    this.setData({ flowOpenRound: this.data.flowOpenRound === round ? 0 : round });
  }
};

module.exports = {
  canAccessQuery,
  INITIAL_DETAIL_CARD_DATA,
  buildAiState,
  buildApprovalState,
  DETAIL_CARD_TOGGLES
};
