/**
 * 全站报错文案的中文化出口。
 *
 * 背景：页面里几乎所有失败分支都写成 `error.message || "中文兜底"`，只要
 * error.message 非空就直接进 toast。而 message 的三个来源全是英文：
 *   1. 后端 body.error.message（api 侧仍有 250+ 条英文文案）；
 *   2. request.js 自造的 `Request failed (500)`；
 *   3. 微信基础库的 errMsg（`request:fail timeout` 等）。
 * 与其逐个改 90 多处调用点，这里统一把 message 收敛成中文，request.js /
 * auth.js 在抛错前过一遍即可，页面代码零改动。
 *
 * 匹配顺序：本身含中文 → 整句精确表 → 句式规则（含名词表替换）→ HTTP 状态兜底。
 * 任何一步都不会把英文原文吐给用户；原文保留在 error.__rawMessage 供排查。
 */

const CJK_RE = /[一-鿿]/;

const hasChinese = (text) => CJK_RE.test(String(text || ""));

const normalizeKey = (text) =>
  String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.。!！]+$/, "")
    .toLowerCase();

/**
 * 英文业务名词 → 中文。供 `X not found` / `X is required` 这类句式规则做替换，
 * 覆盖不到的名词会让整条规则失效，从而落到 HTTP 状态兜底（仍是中文）。
 */
const NOUN_LABELS = {
  "amount change record": "合同金额变更记录",
  "application": "申请",
  "asset": "资产",
  "attachment": "附件",
  "approval instance": "审批单",
  "asset type": "资产类型",
  "asset_type_id": "资产类型",
  "bank account": "银行账户",
  "batch": "报销批次",
  "breakthrough report": "贯通报告",
  "configuration": "系统配置",
  "contract": "合同",
  "contract_id": "关联合同",
  "core asset": "核心设备",
  "core_asset_id": "核心设备",
  "entity": "我方主体",
  "envelope": "报销信封",
  "envelope_id or envelope_uuid": "报销信封识别号",
  "envelope_ids": "报销信封",
  "envelope_uuid": "信封识别号",
  "event": "事件",
  "external submission": "外部填报记录",
  "file": "文件",
  "file_key": "文件标识",
  "fuel card": "油卡",
  "fuel_card_id": "油卡",
  "inventory row": "库存记录",
  "invoice": "发票",
  "invoice request": "开票申请",
  "manager log": "管理员日志",
  "notification": "通知",
  "operator log": "操作员日志",
  "payee": "收款方",
  "payment bank account": "付款银行账户",
  "payment entity": "付款主体",
  "payment request": "付款申请",
  "pending assignee task": "待办任务",
  "pending task": "待办任务",
  "plan": "计划",
  "project": "项目",
  "project file": "项目文件",
  "project_id": "所属项目",
  "receipt": "收款记录",
  "receipt refund": "收款退款记录",
  "rental term": "租赁期",
  "rental_term_id": "租赁期",
  "rule policy": "规则策略",
  "section": "标段",
  "site survey": "现场勘查记录",
  "stock order": "出入库单",
  "stocktake line": "盘点明细",
  "stocktake task": "盘点任务",
  "tracked_asset_id": "在册资产",
  "vehicle": "车辆",
  "vehicle_id": "车辆",
  "voice stt task": "语音识别任务",
  // 表单字段名（`X is required` 用）
  "applicant_userid": "申请人",
  "application id": "申请编号",
  "application_id": "申请编号",
  "attachmentid": "附件",
  "attachments_json": "附件",
  "bank_slips_json": "银行回单",
  "bind_userid": "绑定人",
  "card_no": "卡号",
  "counted_qty": "盘点数量",
  "detail": "详情内容",
  "edit_note": "修改说明",
  "event_type": "事件类型",
  "file_name and file_key": "文件名与文件标识",
  "file_key and file_name": "文件标识与文件名",
  "from_warehouse_id": "来源仓库",
  "issue_date": "开票日期",
  "latest_card_balance": "最新卡内余额",
  "mileage_km": "行驶里程",
  "paid_at": "付款时间",
  "payment_entity_bank_account_id": "付款账户",
  "payment_entity_id": "付款主体",
  "payment_method": "付款方式",
  "payment_reference": "付款凭证号",
  "policy_name": "策略名称",
  "project_name": "项目名称",
  "reason": "原因",
  "receipt_id": "收款记录",
  "received_date": "收款日期",
  "report_type": "报表类型",
  "target_node_key": "目标节点",
  "task_id": "任务",
  "text": "内容",
  "title": "标题",
  "to_userid": "接收人",
  "url": "链接地址",
  "payee_id": "收款方",
  "warehouse_id": "仓库",
  "to_warehouse_id": "目标仓库",
  "quantity": "数量",
  "items": "明细",
  "item_name": "物品名称",
  "item_kind": "明细类型",
  "order_type": "单据类型",
  "invoice_type": "发票类型",
  "invoice_category": "发票种类",
  "counterparty_name": "对方单位名称",
  "counterparty_tax_no": "对方单位税号",
  "relation_type": "关联关系类型",
  "left_asset_type_id": "左侧资产类型",
  "right_asset_type_id": "右侧资产类型",
  "task_title": "任务标题",
  "planned_date": "计划日期",
  "start_date": "开始日期",
  "due_date": "到期日期",
  "log_date": "日志日期",
  "shift": "班次",
  "report_date": "报表日期",
  "survey_date": "勘查日期",
  "type_code": "类型编码",
  "type_name": "类型名称",
  "warehouse_code": "仓库编码",
  "warehouse_name": "仓库名称",
  "current_plate_no": "当前车牌号",
  "requested_amount": "申请金额",
  "vehicle_mileage_km": "车辆里程",
  "amount": "金额",
  "amount_with_tax": "含税金额",
  "amount_without_tax": "不含税金额",
  "tax_amount_estimated": "预估税额",
  "tax_rate": "税率",
  "doc_type": "文档类型",
  "receiver_account_id": "收款账户",
  "bank_name": "开户行",
  "account_name": "账户名称",
  "account_no": "账号",
  "asset_name": "资产名称",
  "issue_index": "问题序号",
  "notification id": "通知编号",
  "rule policy id": "规则策略编号",
  "fuel card id": "油卡编号",
  "match_type": "匹配类型",
  "match_score": "匹配分值"
};

/**
 * 把中文报错里夹带的英文字段名换成中文（后端偶有「issue_index 无效」这种混排）。
 * 只做整 token 精确匹配，单号/流水号一类未知 token 原样保留。
 */
const replaceFieldTokens = (text) =>
  String(text || "").replace(/[A-Za-z][A-Za-z0-9_]*/g, (token) => {
    const key = token.toLowerCase();
    return Object.prototype.hasOwnProperty.call(NOUN_LABELS, key) ? NOUN_LABELS[key] : token;
  });

const nounLabel = (raw) => {
  const key = normalizeKey(raw);
  if (!key) return "";
  if (Object.prototype.hasOwnProperty.call(NOUN_LABELS, key)) return NOUN_LABELS[key];
  return "";
};

/** 整句精确匹配表（键为 normalizeKey 后的小写形式） */
const EXACT_MESSAGES = {
  // ── 通用鉴权/权限 ──
  forbidden: "没有权限执行该操作",
  unauthorized: "登录已过期，请重新登录",
  "missing authorization header": "登录已过期，请重新登录",
  "invalid bearer token": "登录状态无效，请重新登录",
  "session expired": "登录已过期，请重新登录",
  "refresh session expired": "登录会话已过期，请重新登录",
  "invalid refresh token": "登录状态已失效，请重新登录",
  "missing refreshtoken": "登录状态已失效，请重新登录",
  "missing wecom code": "未获取到企业微信登录凭证，请重新发起登录",
  "missing wecom miniapp code": "未获取到企业微信登录凭证，请重新发起登录",
  wechat_oauth_config_missing: "企业微信登录未配置完成，请联系管理员",
  "invalid api key": "接口密钥无效",
  "no permission to upload attachment on this approval": "没有权限在该审批单上传附件",
  "no permission to urge this approval": "没有权限催办该审批单",
  "only applicant or super_admin can resubmit": "只有申请人或超级管理员可以重新提交",
  "only super_admin can force approve": "只有超级管理员可以强制通过",
  "only super_admin can force change approver": "只有超级管理员可以强制改签审批人",
  "only super_admin can update batch payee_id": "只有超级管理员可以修改批次收款方",
  "only finance/manager roles can create internal payees": "只有财务或管理岗可以新建内部收款方",
  "super admin must enable edit mode for privileged modification":
    "超级管理员需先开启编辑模式才能进行特权修改",
  "edit_note is required for privileged modification": "特权修改必须填写修改说明",

  // ── 并发/重复提交 ──
  "submission already in progress": "上一次提交仍在处理中，请勿重复提交",
  "approval submission already in progress": "审批提交仍在处理中，请勿重复提交",
  "approval instance already in progress": "该审批单已在流转中",
  "batch creation already in progress": "批次创建仍在处理中，请勿重复提交",
  "contract submission already in progress": "合同提交仍在处理中，请勿重复提交",
  "electronic upload already in progress": "电子票据上传仍在处理中，请稍候",
  "mark-paid operation already in progress": "标记付款仍在处理中，请勿重复提交",
  "payment creation already in progress": "付款单创建仍在处理中，请勿重复提交",
  "payment registration already in progress": "付款登记仍在处理中，请勿重复提交",
  "payment request submission already in progress": "付款申请提交仍在处理中，请勿重复提交",
  "reimbursement create already in progress": "报销单创建仍在处理中，请勿重复提交",
  "silent review rerun already in progress": "复核重跑仍在处理中，请稍候",
  "split already in progress": "拆单仍在处理中，请勿重复提交",
  "request already issued": "该请求已提交过，请勿重复操作",

  // ── 乐观锁/状态漂移 ──
  "application status changed; please reload and retry": "申请状态已变更，请刷新后重试",
  "notification status changed; please reload and retry": "通知状态已变更，请刷新后重试",
  "envelope changed concurrently; please refresh and retry": "报销信封已被他人修改，请刷新后重试",

  // ── 报销 ──
  "applicant cannot precheck their own reimbursement envelope": "不能预审本人提交的报销信封",
  "applicant cannot verify their own reimbursement envelope": "不能核验本人提交的报销信封",
  "cancelled envelope cannot be prechecked": "已作废的报销信封无法预审",
  "duplicate audit is mandatory before precheck approval": "预审通过前必须先完成查重",
  "electronic reimbursement cannot bind preferred envelope uuid":
    "电子发票通道的报销单不能绑定实体信封识别号",
  "envelope channel cannot be changed after creation": "报销通道创建后不可更改",
  "envelope channel mismatch; cannot bind": "报销通道不一致，无法绑定",
  "envelope is already cancelled": "该报销信封已作废",
  "envelope is not part of this batch": "该报销信封不属于当前批次",
  "envelope not registered to applicant yet": "该报销信封尚未登记到申请人名下",
  "envelope already belongs to a batch": "该报销信封已归入其它批次",
  "envelope already linked to an approval instance": "该报销信封已关联审批单",
  "invalid reimbursement channel": "报销通道无效",
  "only physical envelopes support uuid rebind": "只有实体信封支持换绑识别号",
  "physical envelope must be bound with a valid scanned uuid before submit":
    "提交前请先扫码或录入有效的信封识别号",
  "physical reimbursement uuid must be a valid uuid format": "信封识别号格式不正确",
  "physical reimbursement requires envelope uuid input or scan before create":
    "实体信封报销需先扫码或录入信封识别号",
  "target uuid is already occupied by an active envelope": "目标信封识别号已被其它在用信封占用",
  "target uuid is attached to an envelope with active attachments":
    "目标信封识别号下已有附件，无法换绑",
  "envelope_uuid must be a valid uuid": "信封识别号格式不正确",
  "only draft batch can submit approval": "只有草稿状态的批次才能提交审批",
  "only approved batch can be marked as paid": "只有审批通过的批次才能标记付款",
  "batch is no longer approved": "该批次已不是审批通过状态",
  "batch is no longer in draft status": "该批次已不是草稿状态",
  "at least one attachment is required before submit": "提交前至少需要上传一张附件",

  // ── 付款/合同/收款 ──
  "amount change only allowed on active contracts": "只有生效中的合同才能发起金额变更",
  "only pending amount changes can be submitted": "只有待提交的金额变更才能提交",
  "only draft requests can be submitted": "只有草稿状态的申请才能提交",
  "only approved requests can be marked as paid": "只有审批通过的申请才能标记付款",
  "only cancelled payment requests can be reactivated": "只有已作废的付款申请才能重新启用",
  "payment request is already cancelled": "该付款申请已作废",
  "payment request is no longer approved": "该付款申请已不是审批通过状态",
  "payment_method is required before approval submission": "提交审批前请先选择付款方式",
  "payment bank account does not belong to payment entity": "所选付款账户不属于该付款主体",
  "selected account does not belong to selected entity": "所选账户不属于所选主体",
  "please select an active controlled receipt account": "请选择一个启用中的受控收款账户",
  "payee linked_userid does not match applicant_userid": "收款方绑定的人员与申请人不一致",
  "payee linked_userid does not match batch applicant": "收款方绑定的人员与批次申请人不一致",
  "payee_id must reference an internal payee": "只能选择内部收款方",
  "only draft/pending_review contracts can be submitted": "只有草稿或待审查的合同才能提交",
  "only outbound/inbound contracts can submit this approval flow":
    "只有对外或收款合同可以走该审批流程",
  "invoice can only bind inbound contract": "发票只能关联收款合同",
  "invoice request can only bind inbound contract": "开票申请只能关联收款合同",
  "receipt can only bind inbound contract": "收款记录只能关联收款合同",
  "only recorded receipt can initiate refund": "只有已登记的收款记录才能发起退款",
  "no refundable amount remaining": "已无可退金额",
  "cancelled refund cannot upload bank slips": "已作废的退款单不能上传银行回单",
  "refund_mode must be full or partial": "退款方式只能是全额或部分",
  "already voided": "该记录已作废",
  "cannot edit a voided record": "已作废的记录不可编辑",
  "only pending or needs_info applications can be voided": "只有待处理或待补充资料的申请可以作废",
  "application is already cancelled": "该申请已作废",

  // ── 库房/资产 ──
  "all stocktake lines must have counted_qty": "所有盘点明细都必须填写盘点数量",
  "completed stocktake cannot add new lines": "已完成的盘点任务不能再新增明细",
  "stocktake task already completed": "该盘点任务已完成",
  "only approved stock order can execute": "只有审批通过的出入库单才能执行",
  "only draft stock order can be edited": "只有草稿状态的出入库单才能编辑",
  "only draft stock order can submit approval": "只有草稿状态的出入库单才能提交审批",
  "asset already has active rental term": "该资产已有进行中的租赁期",
  "asset lines require tracked asset type": "在册资产明细必须选择在册类资产类型",
  "consumable lines require untracked asset type": "耗材明细必须选择非在册类资产类型",
  "only tracked asset type can create tracked asset": "只有在册类资产类型才能建立在册资产",
  "rental term already returned": "该租赁期已归还",
  "rental term overdue; outbound blocked": "存在逾期未归还的租赁期，已禁止出库",
  "rental_mode must be lease_in or lease_out": "租赁方式只能是租入或租出",
  "ownership_type must be owned or leased_in": "权属类型只能是自有或租入",
  "item_kind must be asset or consumable": "明细类型只能是资产或耗材",
  "scope must be company or warehouse": "盘点范围只能是全公司或指定仓库",
  "warehouse scope requires warehouse_id": "按仓库盘点时必须选择仓库",
  "plan has no items": "该计划下没有明细",
  "items must not be empty": "请至少添加一条明细",
  "item quantity must be > 0": "明细数量必须大于 0",
  "counted_qty must be >= 0": "盘点数量不能为负数",

  // ── 项目/日志 ──
  "archived projects cannot generate public log links": "已归档项目无法生成外部填报链接",
  "invalid link status": "链接状态无效",
  "no allowed log types selected": "请至少选择一种可填报的日志类型",
  "at least one log type is required": "请至少选择一种日志类型",
  "at most 12 photos are allowed": "最多只能上传 12 张照片",
  "project_kind must be internal or external": "项目类型只能是内部或外部",
  "invalid review action": "复核动作无效",
  "result must be verified or mismatch": "核验结果只能是一致或不一致",

  // ── 审批 ──
  "invalid return type": "退回类型无效",
  "target_node_key is required for return_to": "退回指定节点时必须选择目标节点",
  "override_status must be none/requested/approved": "豁免状态取值无效",
  "override approve requires override_reason and override_risk_acknowledged=1":
    "豁免通过必须填写豁免理由并确认风险",
  "action must be approved/supplement/rejected": "操作类型无效",
  "action must be request/approve/reject": "操作类型无效",

  // ── 上传 ──
  "invalid file key": "文件标识无效",
  "invalid upload key": "上传标识无效",
  "invalid upload signature": "上传签名无效，请重新上传",
  "invalid upload signature params": "上传签名参数无效，请重新上传",
  "upload url expired": "上传链接已过期，请重新上传",
  "missing url": "缺少链接地址",

  // ── 其它 ──
  "invalid status": "状态无效",
  "invalid id": "编号无效",
  "invalid taskid": "任务编号无效",
  "no updates provided": "没有需要更新的内容",
  "severity is invalid": "严重程度取值无效",
  "policy_type is invalid": "策略类型无效",
  "target_type is invalid": "目标类型无效",
  "fuel card is not bound to current user": "该油卡未绑定到当前用户",
  "fuel_card_id is invalid or inactive": "所选油卡无效或已停用",
  "config_json must be valid json": "配置内容格式不正确",
  "properties_json must be valid json": "属性内容格式不正确",
  "property_schema must be valid json": "属性模板格式不正确",
  "count must be between 1 and 200": "数量必须在 1 到 200 之间",
  "bank_name/account_name/account_no are required": "请填写开户行、账户名称与账号",
  "attachments_json must be a non-empty attachment array": "请至少上传一个附件",
  "bank_slips_json must be a non-empty attachment array": "请至少上传一张银行回单",
  "item_name or asset_type_id is required": "请填写物品名称或选择资产类型",
  "latest_card_balance is required when status is processed": "标记为已通过时必须填写最新卡内余额",
  "receiver_account_id is invalid or not active": "所选收款账户无效或已停用",
  "only failed or skipped notifications can be retried": "只有发送失败或已跳过的通知才能重试",
  "no available api endpoint": "暂时无法连接服务器，请检查网络后重试",
  "no available login endpoint": "登录服务暂不可用，请稍后重试",
  "wx.login failed": "未获取到企业微信登录凭证，请重新发起登录",
  "failed to send wecom result template card": "企业微信通知发送失败",
  "failed to send agent confirm template card": "企业微信确认卡片发送失败"
};

/**
 * 句式规则。命中后用名词表把主语换成中文；名词表查不到就整条规则放弃，
 * 交给 HTTP 状态兜底，避免拼出「envelope_uuid不存在」这种半中半英。
 */
const PATTERN_RULES = [
  {
    re: /^(.+?) not found or inactive$/i,
    build: (m) => {
      const noun = nounLabel(m[1]);
      return noun ? `${noun}不存在或已停用` : "";
    }
  },
  {
    re: /^(.+?) (?:not found|does not exist)$/i,
    build: (m) => {
      const noun = nounLabel(m[1]);
      return noun ? `${noun}不存在` : "";
    }
  },
  {
    re: /^(.+?) not found in this project$/i,
    build: (m) => {
      const noun = nounLabel(m[1]);
      return noun ? `当前项目下找不到该${noun}` : "";
    }
  },
  {
    // "warehouse_id, asset_type_id, quantity are required" 这类多字段必填
    re: /^(.+?(?:[,/]| and ).+?) (?:is |are )required$/i,
    build: (m) => {
      const parts = m[1].split(/\s*(?:[,/]|\band\b)\s*/).filter(Boolean);
      const labels = parts.map((part) => nounLabel(part));
      return labels.every(Boolean) ? `请填写${labels.join("、")}` : "";
    }
  },
  {
    re: /^(.+?) (?:is |are )?required(?: before .+)?$/i,
    build: (m) => {
      const noun = nounLabel(m[1]);
      return noun ? `请填写${noun}` : "";
    }
  },
  {
    re: /^(.+?) must be a positive integer$/i,
    build: (m) => {
      const noun = nounLabel(m[1]);
      if (!noun) return "";
      return /编号$/.test(noun) ? `${noun}必须是正整数` : `${noun}编号必须是正整数`;
    }
  },
  {
    re: /^(.+?) must be > 0(?: for .+)?$/i,
    build: (m) => {
      const noun = nounLabel(m[1]) || (normalizeKey(m[1]).indexOf("amount") > -1 ? "金额" : "");
      return noun ? `${noun}必须大于 0` : "";
    }
  },
  {
    re: /^(.+?) must be (?:a non-negative number|>= 0)$/i,
    build: (m) => {
      const noun = nounLabel(m[1]) || (normalizeKey(m[1]).indexOf("amount") > -1 ? "金额" : "");
      return noun ? `${noun}不能为负数` : "";
    }
  },
  {
    re: /^invalid (.+)$/i,
    build: (m) => {
      const noun = nounLabel(m[1]);
      return noun ? `${noun}无效` : "";
    }
  },
  {
    re: /already in progress$/i,
    build: () => "上一次操作仍在处理中，请勿重复提交"
  },
  {
    re: /please (?:reload|refresh) and retry$/i,
    build: () => "数据已被他人修改，请刷新后重试"
  }
];

/** HTTP 状态兜底：走到这一步说明前面都没命中，只能给通用中文提示 */
const STATUS_FALLBACKS = {
  400: "提交的内容不符合要求，请检查后重试",
  401: "登录已过期，请重新登录",
  403: "没有权限执行该操作",
  404: "请求的数据不存在或已被删除",
  405: "该操作不被支持",
  409: "数据已被他人修改，请刷新后重试",
  413: "上传内容过大，请压缩后重试",
  415: "不支持的文件格式",
  422: "提交的内容不符合要求，请检查后重试",
  429: "操作过于频繁，请稍后再试",
  500: "服务器开小差了，请稍后重试",
  502: "服务暂时不可用，请稍后重试",
  503: "服务暂时不可用，请稍后重试",
  504: "服务器响应超时，请稍后重试"
};

const statusFallback = (statusCode) => {
  const code = Number(statusCode);
  if (Object.prototype.hasOwnProperty.call(STATUS_FALLBACKS, code)) {
    return STATUS_FALLBACKS[code];
  }
  if (code >= 500) return "服务暂时不可用，请稍后重试";
  if (code >= 400) return "提交的内容不符合要求，请检查后重试";
  return "操作失败，请稍后重试";
};

/**
 * 把任意来源的报错文案收敛成中文。
 * @param {string} rawMessage 原始文案（可能是中文、英文或空）
 * @param {number|string} [statusCode] HTTP 状态码，用于兜底
 * @returns {string} 一定是中文
 */
const localizeErrorMessage = (rawMessage, statusCode) => {
  const raw = String(rawMessage == null ? "" : rawMessage).trim();
  if (!raw) return statusFallback(statusCode);
  // 后端已经返回中文的直接用；中英混排（如「issue_index 无效」）先把字段名换成中文
  if (hasChinese(raw)) return replaceFieldTokens(raw);

  const key = normalizeKey(raw);
  if (Object.prototype.hasOwnProperty.call(EXACT_MESSAGES, key)) {
    return EXACT_MESSAGES[key];
  }

  for (let i = 0; i < PATTERN_RULES.length; i += 1) {
    const rule = PATTERN_RULES[i];
    const matched = raw.match(rule.re);
    if (matched) {
      const built = rule.build(matched);
      if (built) return built;
    }
  }

  return statusFallback(statusCode);
};

/**
 * 微信基础库网络层 errMsg → 中文。
 * errMsg 形如 `request:fail timeout` / `request:fail -102:net::ERR_CONNECTION_REFUSED`，
 * 直接进 toast 就是一串英文，且对现场同事毫无意义。
 */
const localizeNetworkErrorMessage = (rawErrMsg) => {
  const msg = String(rawErrMsg == null ? "" : rawErrMsg);
  const lower = msg.toLowerCase();

  if (lower.indexOf("url not in domain list") > -1) {
    return "请求域名未加入小程序合法域名，请在企业微信管理后台补充服务器域名";
  }
  if (lower.indexOf("ssl") > -1 || lower.indexOf("certificate") > -1 || lower.indexOf("cert") > -1) {
    return "服务器证书校验失败，请联系管理员检查证书有效期与域名";
  }
  if (lower.indexOf("tls") > -1) {
    return "安全连接握手失败，请联系管理员检查服务器配置";
  }
  if (lower.indexOf("timeout") > -1 || lower.indexOf("timed out") > -1) {
    return "请求超时，请检查网络后重试";
  }
  if (lower.indexOf("abort") > -1) {
    return "请求已被中断，请重试";
  }
  if (
    lower.indexOf("connection_refused") > -1 ||
    lower.indexOf("connection refused") > -1 ||
    lower.indexOf("econnrefused") > -1
  ) {
    return "无法连接服务器，请稍后重试";
  }
  if (
    lower.indexOf("name_not_resolved") > -1 ||
    lower.indexOf("address_unreachable") > -1 ||
    lower.indexOf("internet_disconnected") > -1 ||
    lower.indexOf("network_changed") > -1 ||
    lower.indexOf("net::") > -1
  ) {
    return "网络连接不可用，请检查网络后重试";
  }
  if (lower.indexOf("cancel") > -1) {
    return "已取消操作";
  }
  if (lower.indexOf("auth deny") > -1 || lower.indexOf("permission") > -1) {
    return "操作未获授权，请在企业微信中开启对应权限后重试";
  }
  if (lower.indexOf("not support") > -1 || lower.indexOf("unsupported") > -1) {
    return "当前客户端不支持该操作，请升级企业微信后重试";
  }
  // request:fail 明确是网络层；其余 xxx:fail 是选文件/录音一类端能力失败
  if (lower.indexOf("request:fail") > -1 || lower.indexOf("uploadfile:fail") > -1) {
    return "网络请求失败，请检查网络后重试";
  }
  if (lower.indexOf("fail") > -1) {
    return "操作失败，请稍后重试";
  }
  if (hasChinese(msg)) return msg;
  return "网络请求失败，请检查网络后重试";
};

/**
 * 企业微信登录链路的报错（服务端会把 WeCom 返回的英文原样带出来）。
 * 命中已知错误码时给出可操作的中文指引，其余走通用中文化。
 */
const localizeLoginErrorMessage = (rawMessage) => {
  const raw = String(rawMessage == null ? "" : rawMessage).trim();
  const lower = raw.toLowerCase();
  if (lower.indexOf("api forbidden") > -1 || lower.indexOf("e=48002") > -1) {
    return "企业微信接口无访问权限。请在企业微信管理后台检查：应用密钥、应用与小程序的关联、应用可见范围、企业可信地址。";
  }
  if (lower.indexOf("invalid code") > -1 || lower.indexOf("e=40029") > -1) {
    return "企业微信登录凭证已失效。登录凭证为一次性且有效期很短，请重新发起登录。";
  }
  if (lower.indexOf("40001") > -1 || lower.indexOf("invalid credential") > -1) {
    return "企业微信应用凭证无效，请联系管理员检查应用密钥配置。";
  }
  if (!raw) return "企业微信登录失败，请稍后重试";
  return localizeErrorMessage(raw, 401);
};

/**
 * 取错误对象里的**原始**英文文案。中文化会抹掉 `chooseFile:fail cancel` 这类
 * 特征串，而「是否用户取消」「客户端是否支持本地选择」这些分支判定依赖它们，
 * 所以判定一律走这里，展示才走 localize*。
 */
const rawErrorText = (error) => {
  if (!error) return "";
  if (typeof error === "string") return error;
  const candidates = [
    error.__rawErrMsg,
    error.__rawMessage,
    error.errMsg,
    error.message
  ];
  for (let i = 0; i < candidates.length; i += 1) {
    if (typeof candidates[i] === "string" && candidates[i].trim()) {
      return candidates[i].trim();
    }
  }
  return "";
};

module.exports = {
  localizeErrorMessage,
  rawErrorText,
  localizeNetworkErrorMessage,
  localizeLoginErrorMessage,
  hasChinese
};
