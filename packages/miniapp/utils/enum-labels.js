/**
 * 小程序端英文枚举 → 中文文案的统一出口。
 *
 * 后端所有枚举字段存的都是英文码（status/contract_type/refund_mode/…），页面
 * 若直接 `{{item.xxx}}` 渲染，现场同事看到的就是 `pending_approval`、`full`
 * 这类英文。各页此前是各写各的小 map，漏一个键就漏出英文，这里统一收口。
 *
 * 口径与 packages/web/src/utils/enum-labels.ts 对齐；查不到的取值一律回落到
 * 中文占位（默认「未知」），绝不把英文原码透给用户——原码对使用者没有意义，
 * 真出现漏配是我们要补表，不是让用户去认英文。
 */

const CJK_RE = /[一-鿿]/;

/**
 * 安全查表。枚举值来自网络响应，属于不可信字符串：直接 `table[key]` 会命中
 * `constructor`/`toString` 这类原型键拿到函数，setData 之后整行渲染空白。
 */
const lookup = (table, key) => {
  if (typeof key !== "string" || !key) return "";
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : "";
};

/**
 * 统一兜底：命中表 → 中文；本身就是中文（后端字典字段如付款类别）→ 原样；
 * 其余（英文码 / 空）→ 中文占位。
 */
const toLabel = (table, value, fallback = "未知") => {
  if (value === null || value === undefined || value === "") return fallback;
  const raw = String(value).trim();
  if (!raw) return fallback;
  const hit = lookup(table, raw);
  if (hit) return hit;
  if (CJK_RE.test(raw)) return raw;
  return fallback;
};

/** 通用状态（覆盖项目 / 合同 / 付款 / 审批 / 报销 / 库房各域） */
const STATUS_LABELS = {
  active: "生效中",
  inactive: "已停用",
  draft: "草稿",
  pending: "待处理",
  pending_review: "待审查",
  pending_approval: "待审批",
  in_progress: "进行中",
  assigned: "待开始",
  running: "执行中",
  approved: "已审批",
  rejected: "已驳回",
  returned: "已退回",
  completed: "已完成",
  cancelled: "已作废",
  withdrawn: "已撤回",
  processing: "处理中",
  processed: "已处理",
  recorded: "已登记",
  partially_recorded: "部分登记",
  supplement: "待补充",
  needs_info: "待补充资料",
  verified: "已核验",
  audited: "已审核",
  paid: "已付款",
  partial_paid: "部分付款",
  overdue: "已逾期",
  planning: "规划中",
  preparing: "准备中",
  completing: "收尾中",
  archived: "已归档",
  deleted: "已删除",
  submitted: "已提交",
  signed: "已签署",
  registered: "已登记",
  voided: "已作废",
  received: "已收件",
  batched: "已成批",
  unregistered: "未登记",
  terminated: "已终止",
  reversed: "已冲销",
  skipped: "已跳过",
  transferred: "已转签",
  failed: "已失败",
  timeout: "已超时",
  expired: "已过期",
  none: "未开始",
  idle: "闲置",
  using: "使用中",
  repair: "维修中",
  scrapped: "已报废",
  executed: "已执行",
  executing: "执行中",
  closed: "已关闭",
  open: "进行中"
};

/** 合同类型 */
const CONTRACT_TYPE_LABELS = {
  labor: "人工",
  machine: "机械",
  machinery: "机械",
  general: "总包",
  material: "材料",
  service: "服务",
  lease: "租赁",
  other: "其他"
};

/** 合同方向 */
const CONTRACT_DIRECTION_LABELS = {
  outbound: "对外付款合同",
  inbound: "对外收款合同"
};

/** 合同金额变更类型 */
const AMOUNT_CHANGE_TYPE_LABELS = {
  increase: "增加",
  decrease: "减少",
  adjust: "调整"
};

/** 付款方式（后端存量同时有英文码与中文原文） */
const PAYMENT_METHOD_LABELS = {
  bank_transfer: "对公转账",
  transfer: "对公转账",
  cash: "现金",
  bill: "票据",
  check: "支票",
  other: "其他"
};

/**
 * 付款类别。sys_dict 里 payment_category 的 dict_value 是英文
 * （special_approval/admin_fee/…），Web 与小程序表单又直接存中文 dict_label，
 * 两种形态都要认，否则查询页会出现 `labor_fee` 这样的英文。
 */
const PAYMENT_CATEGORY_LABELS = {
  special_approval: "特殊审批",
  admin_fee: "行政费",
  labor_fee: "劳务费",
  machinery_fee: "机械费",
  material_fee: "材料费",
  subcontract_fee: "分包费",
  other_fee: "其他费用"
};

/** 报销通道 */
const REIMBURSEMENT_CHANNEL_LABELS = {
  physical: "实物信封",
  electronic: "电子发票"
};

/** 报销附件类型 */
const ATTACHMENT_TYPE_LABELS = {
  invoice: "发票",
  receipt: "凭证",
  contract: "合同",
  photo: "照片",
  document: "文档",
  report: "报告",
  other: "其他"
};

/** 收款退款方式 */
const REFUND_MODE_LABELS = {
  full: "全额退款",
  partial: "部分退款"
};

/** 风险等级（重复票据检查、AI 风控等复用） */
const RISK_LEVEL_LABELS = {
  high: "高风险",
  medium: "中风险",
  low: "低风险",
  warning: "需关注",
  normal: "正常",
  none: "无风险"
};

/** 报销查重命中方式 */
const DUPLICATE_MATCH_TYPE_LABELS = {
  exact: "完全重复",
  fuzzy: "疑似重复",
  invoice_no_date: "发票号与日期重复",
  qr_hash: "发票二维码重复",
  attachment_file_key: "附件文件重复"
};

/** 问题严重程度（AI 审查/预审问题列表） */
const SEVERITY_LABELS = {
  critical: "严重",
  major: "重要",
  minor: "提示",
  blocker: "阻断",
  high: "严重",
  medium: "重要",
  low: "提示",
  warn: "提示",
  warning: "提示",
  info: "提示",
  fail: "严重",
  error: "严重"
};

/** 资产文档类型 */
const DOC_TYPE_LABELS = {
  manual: "操作手册",
  certificate: "合格证",
  inspection: "检查记录",
  contract: "合同文件",
  image: "图片资料",
  invoice: "发票",
  other: "其他"
};

/** 出入库单据类型 */
const ORDER_TYPE_LABELS = {
  inbound: "入库",
  outbound: "出库",
  transfer: "调拨",
  scrap: "报废出库",
  return: "退库"
};

/** 库房资产工单类型 */
const WORK_ORDER_TYPE_LABELS = {
  inspection: "检查",
  maintenance: "维护",
  servicing: "保养",
  modification: "改装",
  scrapping: "报废"
};

/** 优先级 */
const PRIORITY_LABELS = {
  urgent: "紧急",
  high: "高",
  normal: "普通",
  medium: "普通",
  low: "低"
};

/** 明细类型（盘点 / 出入库） */
const ITEM_KIND_LABELS = {
  asset: "在册资产",
  consumable: "耗材"
};

/** 盘点范围 */
const STOCKTAKE_SCOPE_LABELS = {
  company: "全公司",
  warehouse: "指定仓库"
};

/** 权属类型 */
const OWNERSHIP_TYPE_LABELS = {
  owned: "自有",
  company_owned: "公司车辆",
  employee_owned: "员工车辆",
  leased_in: "租入"
};

/** 审批业务类型（approval_instance.biz_type） */
const BIZ_TYPE_LABELS = {
  payment_request: "付款审批",
  reimbursement_batch: "报销审批",
  stock_order: "出入库审批",
  warehouse_asset_work_order: "库房工单审批",
  outbound_contract: "对外合同审批",
  inbound_contract: "收款合同审批",
  invoice_request: "开票审批",
  receipt_refund: "退款审批",
  contract_amount_change: "合同金额变更审批",
  fuel_application: "油卡额度审批",
  vehicle_maintenance: "车辆保养审批"
};

/** 审批动作 */
const APPROVAL_ACTION_LABELS = {
  approve: "通过",
  approved: "通过",
  reject: "驳回",
  rejected: "驳回",
  return: "退回",
  return_initiator: "退回发起人",
  return_prev: "退回上一节点",
  return_to: "退回指定节点",
  transfer: "转签",
  withdraw: "撤回",
  cancel: "取消",
  submit: "提交",
  resubmit: "重新提交",
  urge: "催办",
  supplement: "要求补充"
};

/** 审批节点类型 */
const APPROVAL_NODE_TYPE_LABELS = {
  sequential: "顺序审批",
  countersign: "会签",
  or_sign: "或签",
  ai_gate: "AI 关卡",
  auto: "自动通过",
  cc: "抄送"
};

/** 角色 */
const ROLE_LABELS = {
  super_admin: "超级管理员",
  manager: "管理岗",
  site_manager: "项目负责人",
  operator: "操作员",
  finance: "财务",
  office: "办公室",
  warehouse_keeper: "库管员"
};

const statusLabel = (value, fallback) => toLabel(STATUS_LABELS, value, fallback);
const contractTypeLabel = (value, fallback) => toLabel(CONTRACT_TYPE_LABELS, value, fallback);
const contractDirectionLabel = (value, fallback) =>
  toLabel(CONTRACT_DIRECTION_LABELS, value, fallback);
const amountChangeTypeLabel = (value, fallback) =>
  toLabel(AMOUNT_CHANGE_TYPE_LABELS, value, fallback);
const paymentMethodLabel = (value, fallback) => toLabel(PAYMENT_METHOD_LABELS, value, fallback);
const paymentCategoryLabel = (value, fallback) => toLabel(PAYMENT_CATEGORY_LABELS, value, fallback);
const reimbursementChannelLabel = (value, fallback) =>
  toLabel(REIMBURSEMENT_CHANNEL_LABELS, value, fallback);
const attachmentTypeLabel = (value, fallback = "其他") =>
  toLabel(ATTACHMENT_TYPE_LABELS, value, fallback);
const refundModeLabel = (value, fallback) => toLabel(REFUND_MODE_LABELS, value, fallback);
const riskLevelLabel = (value, fallback) => toLabel(RISK_LEVEL_LABELS, value, fallback);
const severityLabel = (value, fallback = "提示") => toLabel(SEVERITY_LABELS, value, fallback);
const duplicateMatchTypeLabel = (value, fallback = "查重结果") =>
  toLabel(DUPLICATE_MATCH_TYPE_LABELS, value, fallback);
const docTypeLabel = (value, fallback = "其他") => toLabel(DOC_TYPE_LABELS, value, fallback);
const orderTypeLabel = (value, fallback) => toLabel(ORDER_TYPE_LABELS, value, fallback);
const workOrderTypeLabel = (value, fallback = "任务") =>
  toLabel(WORK_ORDER_TYPE_LABELS, value, fallback);
const priorityLabel = (value, fallback = "普通") => toLabel(PRIORITY_LABELS, value, fallback);
const itemKindLabel = (value, fallback) => toLabel(ITEM_KIND_LABELS, value, fallback);
const stocktakeScopeLabel = (value, fallback) => toLabel(STOCKTAKE_SCOPE_LABELS, value, fallback);
const ownershipTypeLabel = (value, fallback) => toLabel(OWNERSHIP_TYPE_LABELS, value, fallback);
const bizTypeLabel = (value, fallback = "审批事项") => toLabel(BIZ_TYPE_LABELS, value, fallback);

/**
 * biz_summary 汉化。存量审批摘要由后端拼装，库房侧拼了英文枚举
 * （如 "WO-20260101-001 | inbound"）；新数据已改中文，这里治存量：
 * 只做整 token 精确替换，单号（含数字/连字符）原样保留。
 */
const BIZ_SUMMARY_TOKEN_LABELS = {
  inbound: "入库",
  outbound: "出库",
  transfer: "调拨",
  scrap: "报废出库",
  return: "退库",
  inspection: "检查",
  maintenance: "维护",
  servicing: "保养",
  modification: "改装",
  scrapping: "报废"
};

const humanizeBizSummary = (text) => {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) return "";
  return raw.replace(/[A-Za-z_]+/g, (token) => {
    const key = token.toLowerCase();
    return Object.prototype.hasOwnProperty.call(BIZ_SUMMARY_TOKEN_LABELS, key)
      ? BIZ_SUMMARY_TOKEN_LABELS[key]
      : token;
  });
};
const approvalActionLabel = (value, fallback = "-") =>
  toLabel(APPROVAL_ACTION_LABELS, value, fallback);
const approvalNodeTypeLabel = (value, fallback = "审批节点") =>
  toLabel(APPROVAL_NODE_TYPE_LABELS, value, fallback);
const roleLabel = (value, fallback = "未知角色") => toLabel(ROLE_LABELS, value, fallback);

/**
 * 审批节点标识（node_key）是流程模板里的自定义英文键（如 ai_gate_contract），
 * 没有固定枚举可查。展示时优先用后端给的节点名，其次按节点类型给中文，
 * 最后才落到「审批节点」——任何情况下都不把 node_key 本身摆到界面上。
 */
const approvalNodeLabel = (node) => {
  const source = node && typeof node === "object" ? node : {};
  const name = String(source.node_name || source.name || source.title || "").trim();
  if (name && CJK_RE.test(name)) return name;
  const typed = lookup(APPROVAL_NODE_TYPE_LABELS, String(source.node_type || "").trim());
  if (typed) return typed;
  return "审批节点";
};

/** 文件大小：后端给的是字节数，`123456 bytes` 对使用者没有意义 */
const fileSizeLabel = (bytes) => {
  const size = Number(bytes);
  if (!isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} 字节`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * AI 关卡节点上受理人是真人的任务 = AI 拦截转人工的兜底复核任务：
 * pending 提示等待人工复核，已处理时在原动作前加「人工复核 ·」。
 */
const aiGateHumanReviewActionLabel = (nodeType, task, baseActionLabel) => {
  if (nodeType !== "ai_gate" || !task || task.assignee_userid === "AI_GATE") return baseActionLabel;
  if (task.status === "pending") return "AI 拦截，等待人工复核";
  // 作废（超管控制台代办、撤回/取消实例）与转签都没写 action，拼成「人工复核 · -」等于谎称有人复核过
  if (task.status === "cancelled") return "人工复核任务已作废";
  if (task.status === "transferred") return "人工复核 · 已转签";
  return `人工复核 · ${baseActionLabel}`;
};

module.exports = {
  toLabel,
  statusLabel,
  contractTypeLabel,
  contractDirectionLabel,
  amountChangeTypeLabel,
  paymentMethodLabel,
  paymentCategoryLabel,
  reimbursementChannelLabel,
  attachmentTypeLabel,
  refundModeLabel,
  riskLevelLabel,
  severityLabel,
  duplicateMatchTypeLabel,
  docTypeLabel,
  orderTypeLabel,
  workOrderTypeLabel,
  priorityLabel,
  itemKindLabel,
  stocktakeScopeLabel,
  ownershipTypeLabel,
  bizTypeLabel,
  humanizeBizSummary,
  approvalActionLabel,
  aiGateHumanReviewActionLabel,
  approvalNodeTypeLabel,
  approvalNodeLabel,
  roleLabel,
  fileSizeLabel,
  STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  ATTACHMENT_TYPE_LABELS
};
