export const statusLabel = (v: string): string => {
  const m: Record<string, string> = {
    active: "启用",
    inactive: "停用",
    draft: "草稿",
    pending: "待处理",
    pending_approval: "待审批",
    in_progress: "进行中",
    approved: "已通过",
    rejected: "已驳回",
    completed: "已完成",
    cancelled: "已取消",
    withdrawn: "已撤回",
    processing: "处理中",
    recorded: "已登记",
    partially_recorded: "部分登记",
    supplement: "补充中",
    verified: "已核验",
    audited: "已审核",
    paid: "已支付",
    partial_paid: "部分支付",
    overdue: "逾期",
    planning: "规划中",
    preparing: "准备中",
    completing: "收尾中",
    archived: "已归档",
    deleted: "已删除",
    submitted: "已提交",
    signed: "已签署",
    registered: "已登记",
    voided: "已作废",
    processed: "已处理",
    received: "已收件",
    batched: "已成批",
    unregistered: "未登记",
    terminated: "已终止",
    pending_review: "待审查",
    idle: "闲置",
    using: "使用中",
    repair: "维修中",
    scrapped: "已报废"
  };
  return m[v] ?? v;
};

export const ownershipTypeLabel = (v: string): string => {
  const m: Record<string, string> = {
    company_owned: "公司车辆",
    employee_owned: "员工车辆"
  };
  return m[v] ?? v;
};

export const contractTypeLabel = (v: string): string => {
  const m: Record<string, string> = {
    labor: "人工",
    machine: "机械",
    machinery: "机械",
    general: "总包",
    material: "材料",
    other: "其他"
  };
  return m[v] ?? v;
};

export const channelLabel = (v: string): string => {
  const m: Record<string, string> = {
    bank_transfer: "对公转账",
    transfer: "对公转账",
    physical: "实物信封",
    electronic: "电子发票",
    cash: "现金",
    bill: "票据",
    other: "其他"
  };
  return m[v] ?? v;
};

export const precheckStatusLabel = (v: string): string => {
  const m: Record<string, string> = {
    pending: "待检查",
    pass: "通过",
    approved: "通过",
    warning: "警告",
    fail: "未通过",
    rejected: "驳回",
    supplement: "补充中",
    skipped: "已跳过"
  };
  return m[v] ?? v;
};

export const pdfStatusLabel = (v: string): string => {
  const m: Record<string, string> = {
    none: "未生成",
    pending: "待生成",
    generating: "生成中",
    completed: "已生成",
    ready: "已生成",
    failed: "生成失败"
  };
  return m[v] ?? v;
};

export const aiAuditStatusLabel = (v: string): string => {
  const m: Record<string, string> = {
    none: "未触发",
    pending: "待审",
    pass: "通过",
    warning: "警告",
    fail: "未通过",
    completed: "已完成",
    failed: "失败",
    skipped: "已跳过",
    error: "出错"
  };
  return m[v] ?? v;
};

export const fileCategoryLabel = (v: string): string => {
  const m: Record<string, string> = {
    contract: "合同",
    photo: "照片",
    document: "文档",
    report: "报告",
    invoice: "发票",
    receipt: "收据",
    other: "其他"
  };
  return m[v] ?? v;
};

export const helpdeskCategoryLabel = (v: string): string => {
  const m: Record<string, string> = {
    bug: "缺陷",
    feature: "功能建议",
    question: "咨询",
    feedback: "反馈",
    other: "其他"
  };
  return m[v] ?? v;
};
