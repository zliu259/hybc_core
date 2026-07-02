const { request } = require("../../utils/request");
const { getUserProfile } = require("../../utils/auth");
const {
  RETURNED_APPROVAL_EDIT_BIZ_TYPES,
  canEditReturnedApproval
} = require("../../utils/returned-approval");

const numberOrUndefined = (value) => {
  const text = String(value ?? "").trim();
  if (!text) return undefined;
  const number = Number(text);
  return Number.isFinite(number) ? number : undefined;
};

const stringOrUndefined = (value) => {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
};

const optionField = (key, label, options) => ({
  key,
  label,
  type: "select",
  options
});

const textField = (key, label) => ({ key, label, type: "text" });
const numberField = (key, label) => ({ key, label, type: "number" });
const dateField = (key, label) => ({ key, label, type: "date" });
const textareaField = (key, label, maxlength = 500) => ({ key, label, type: "textarea", maxlength });

const paymentMethodOptions = [
  { label: "对公转账", value: "对公转账" },
  { label: "现金", value: "现金" },
  { label: "票据", value: "票据" },
  { label: "其他", value: "其他" }
];

const CONFIGS = {
  payment_request: {
    title: "付款申请",
    getPath: (id) => `/api/v1/payment/${id}`,
    updatePath: (id) => `/api/v1/payment/${id}`,
    submitPath: (id) => `/api/v1/payment/${id}/submit-approval`,
    fields: [
      numberField("contract_id", "关联合同ID"),
      numberField("project_id", "所属项目ID"),
      numberField("payee_id", "收款方ID"),
      dateField("expected_payment_date", "预计付款日"),
      optionField("category", "付款类别", [
        { label: "特殊审批", value: "特殊审批" },
        { label: "行政费", value: "行政费" },
        { label: "劳务费", value: "劳务费" },
        { label: "机械费", value: "机械费" },
        { label: "材料费", value: "材料费" },
        { label: "其他费用", value: "其他费用" }
      ]),
      numberField("amount", "申请金额"),
      textareaField("content", "付款内容"),
      optionField("payment_method", "付款方式", paymentMethodOptions),
      textareaField("remark", "备注")
    ],
    summary: (row) => `${row.serial_no || "付款申请"} | ${row.content || ""} | ${row.amount || ""}`
  },
  reimbursement_batch: {
    title: "报销批次",
    getPath: (id) => `/api/v1/reimbursement/batch/${id}`,
    updatePath: (id) => `/api/v1/reimbursement/batch/${id}/payout-plan`,
    submitPath: (id) => `/api/v1/reimbursement/batch/${id}/submit-approval`,
    fields: [
      optionField("payment_method", "支付方式", [
        { label: "可后续补充", value: "" },
        { label: "对公转账", value: "transfer" },
        { label: "现金", value: "cash" },
        { label: "票据", value: "bill" },
        { label: "其他", value: "other" }
      ]),
      numberField("payment_entity_id", "付款主体ID"),
      numberField("payment_entity_bank_account_id", "付款账户ID"),
      textField("payment_account", "付款账户说明")
    ],
    summary: (row) => `${row.batch_no || "报销批次"} | ${row.total_amount || ""}`
  },
  stock_order: {
    title: "库房出入库单",
    getPath: (id) => `/api/v1/warehouse/stock-order/${id}`,
    updatePath: (id) => `/api/v1/warehouse/stock-order/${id}`,
    submitPath: (id) => `/api/v1/warehouse/stock-order/${id}/submit-approval`,
    fields: [
      optionField("order_type", "单据类型", [
        { label: "入库", value: "inbound" },
        { label: "出库", value: "outbound" },
        { label: "调拨", value: "transfer" }
      ]),
      numberField("project_id", "所属项目ID"),
      numberField("from_warehouse_id", "来源仓库ID"),
      numberField("to_warehouse_id", "目标仓库ID"),
      textareaField("remark", "备注")
    ],
    summary: (row) => `${row.order_no || "库房单"} | ${row.order_type || ""}`,
    buildItems: (row) =>
      (Array.isArray(row.items) ? row.items : []).map((item) => ({
        id: item.id || `${item.asset_type_id || item.tracked_asset_id}`,
        asset_type_id: item.asset_type_id,
        tracked_asset_id: item.tracked_asset_id,
        title: item.type_name || item.asset_type_name || item.asset_type_id || item.tracked_asset_id || "明细",
        quantity: String(item.quantity ?? "")
      }))
  },
  warehouse_asset_work_order: {
    title: "库房工单",
    getPath: (id) => `/api/v1/warehouse/work-order/${id}`,
    updatePath: (id) => `/api/v1/warehouse/work-order/${id}`,
    submitPath: (id) => `/api/v1/warehouse/work-order/${id}/submit-approval`,
    fields: [
      textField("assignee_userid", "执行人UserID"),
      optionField("priority", "优先级", [
        { label: "紧急", value: "urgent" },
        { label: "高", value: "high" },
        { label: "普通", value: "normal" },
        { label: "低", value: "low" }
      ]),
      dateField("scheduled_date", "计划日期"),
      numberField("required_photo_count", "要求照片数"),
      textareaField("remark", "备注")
    ],
    summary: (row) => `${row.work_order_no || "库房工单"} | ${row.work_order_type || ""}`
  },
  outbound_contract: {
    title: "对外合同",
    getPath: (id) => `/api/v1/contract/${id}`,
    updatePath: (id) => `/api/v1/contract/${id}`,
    submitPath: (id) => `/api/v1/contract/${id}/submit-approval`,
    fields: [
      numberField("project_id", "所属项目ID"),
      numberField("entity_id", "我方主体ID"),
      textField("counterparty", "对方单位"),
      textField("contract_type", "合同类型"),
      textField("handler_userid", "经办人UserID"),
      dateField("contract_date", "合同日期"),
      numberField("total_amount", "合同金额"),
      textareaField("remark", "备注")
    ],
    summary: (row) => `${row.contract_no || "合同"} | ${row.counterparty || ""}`
  },
  inbound_contract: {
    title: "收款合同",
    getPath: (id) => `/api/v1/contract/${id}`,
    updatePath: (id) => `/api/v1/contract/${id}`,
    submitPath: (id) => `/api/v1/contract/${id}/submit-approval`,
    fields: [
      numberField("project_id", "所属项目ID"),
      numberField("entity_id", "我方主体ID"),
      textField("counterparty", "对方单位"),
      textField("contract_type", "合同类型"),
      textField("handler_userid", "经办人UserID"),
      dateField("contract_date", "合同日期"),
      numberField("total_amount", "合同金额"),
      textareaField("remark", "备注")
    ],
    summary: (row) => `${row.contract_no || "合同"} | ${row.counterparty || ""}`
  },
  invoice_request: {
    title: "开票申请",
    getPath: (id) => `/api/v1/receipt/invoice-request/${id}`,
    updatePath: (id) => `/api/v1/receipt/invoice-request/${id}`,
    submitPath: (id) => `/api/v1/receipt/invoice-request/${id}/submit-approval`,
    fields: [
      numberField("contract_id", "合同ID"),
      numberField("project_id", "所属项目ID"),
      textField("customer_name", "客户名称"),
      textField("customer_tax_no", "客户税号"),
      textField("invoice_type", "发票类型"),
      textField("invoice_category", "开票类别"),
      numberField("tax_rate", "税率"),
      textField("currency", "币种"),
      numberField("amount_without_tax", "不含税金额"),
      numberField("tax_amount_estimated", "预估税额"),
      numberField("amount_with_tax", "含税金额"),
      textField("business_contract_no", "业务合同号"),
      textField("payment_reference", "收款/结算依据"),
      textareaField("items_json", "开票明细JSON", 1200),
      textareaField("remark", "备注")
    ],
    summary: (row) => `${row.request_no || "开票申请"} | ${row.customer_name || ""} | ${row.amount_with_tax || ""}`
  }
};

Page({
  data: {
    approvalId: 0,
    bizType: "",
    bizId: 0,
    pageTitle: "退回申请编辑",
    summaryText: "",
    loading: true,
    saving: false,
    submitting: false,
    loadError: "",
    detail: null,
    form: {},
    fieldRows: [],
    itemRows: []
  },

  onLoad(options) {
    const approvalId = Number((options && options.approvalId) || 0);
    const bizType = decodeURIComponent(String((options && options.bizType) || ""));
    const bizId = Number((options && options.bizId) || 0);
    if (!approvalId || !bizId || !RETURNED_APPROVAL_EDIT_BIZ_TYPES.includes(bizType)) {
      this.setData({ loading: false, loadError: "退回申请参数无效" });
      return;
    }
    this.setData({ approvalId, bizType, bizId });
    this.loadDetail();
  },

  getConfig() {
    return CONFIGS[this.data.bizType];
  },

  buildForm(detail, config) {
    const form = {};
    config.fields.forEach((field) => {
      const value = detail[field.key];
      form[field.key] = value === null || value === undefined ? "" : String(value);
    });
    return form;
  },

  buildFieldRows(form, config) {
    return config.fields.map((field) => {
      const value = form[field.key] || "";
      if (field.type === "select") {
        const options = Array.isArray(field.options) ? field.options : [];
        const optionIndex = Math.max(0, options.findIndex((option) => option.value === value));
        const selected = options[optionIndex] || null;
        return {
          ...field,
          value,
          optionLabels: options.map((option) => option.label),
          optionIndex,
          displayValue: selected ? selected.label : ""
        };
      }
      return { ...field, value, displayValue: value };
    });
  },

  refreshFieldRows() {
    const config = this.getConfig();
    if (!config) return;
    this.setData({ fieldRows: this.buildFieldRows(this.data.form, config) });
  },

  async loadDetail() {
    const config = this.getConfig();
    if (!config) {
      this.setData({ loading: false, loadError: "暂不支持该业务类型编辑" });
      return;
    }
    this.setData({ loading: true, loadError: "", pageTitle: config.title });
    try {
      const approvalRes = await request({ method: "GET", path: `/api/v1/approval/${this.data.approvalId}` });
      const instance = approvalRes && approvalRes.data ? approvalRes.data.instance : null;
      const profile = getUserProfile() || {};
      const userId = String(profile.username || profile.id || "").trim();
      if (
        !canEditReturnedApproval(instance, userId) ||
        String(instance.biz_type || "") !== this.data.bizType ||
        Number(instance.biz_id || 0) !== Number(this.data.bizId)
      ) {
        this.setData({ loading: false, loadError: "当前退回申请不可编辑" });
        return;
      }

      const res = await request({ method: "GET", path: config.getPath(this.data.bizId) });
      const detail = (res && res.data) || {};
      const form = this.buildForm(detail, config);
      const itemRows = typeof config.buildItems === "function" ? config.buildItems(detail) : [];
      this.setData({
        detail,
        form,
        itemRows,
        summaryText: config.summary(detail),
        fieldRows: this.buildFieldRows(form, config),
        loading: false
      });
    } catch (error) {
      this.setData({
        loading: false,
        loadError: error.message || "申请加载失败"
      });
    }
  },

  onInputField(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const form = { ...this.data.form, [key]: e.detail.value || "" };
    this.setData({ form }, () => this.refreshFieldRows());
  },

  onDateField(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    const form = { ...this.data.form, [key]: e.detail.value || "" };
    this.setData({ form }, () => this.refreshFieldRows());
  },

  onSelectField(e) {
    const key = e.currentTarget.dataset.key;
    const config = this.getConfig();
    if (!key || !config) return;
    const field = config.fields.find((item) => item.key === key);
    const options = field && Array.isArray(field.options) ? field.options : [];
    const selected = options[Number(e.detail.value || 0)] || options[0];
    const form = { ...this.data.form, [key]: selected ? selected.value : "" };
    this.setData({ form }, () => this.refreshFieldRows());
  },

  onItemQuantityInput(e) {
    const index = Number(e.currentTarget.dataset.index || -1);
    if (index < 0) return;
    const itemRows = this.data.itemRows.slice();
    if (!itemRows[index]) return;
    itemRows[index] = { ...itemRows[index], quantity: e.detail.value || "" };
    this.setData({ itemRows });
  },

  buildPayload() {
    const config = this.getConfig();
    const payload = {};
    if (!config) return payload;
    config.fields.forEach((field) => {
      const raw = this.data.form[field.key];
      if (field.type === "number") {
        const value = numberOrUndefined(raw);
        if (value !== undefined) payload[field.key] = value;
        return;
      }
      const value = stringOrUndefined(raw);
      if (value !== undefined || field.key === "payment_method") payload[field.key] = value || "";
    });
    if (this.data.bizType === "stock_order") {
      payload.items = this.data.itemRows.map((item) => ({
        asset_type_id: numberOrUndefined(item.asset_type_id),
        tracked_asset_id: numberOrUndefined(item.tracked_asset_id),
        quantity: Number(item.quantity || 0)
      }));
    }
    return payload;
  },

  async saveDraft() {
    const config = this.getConfig();
    if (!config || this.data.saving) return false;
    this.setData({ saving: true });
    try {
      await request({
        method: "PUT",
        path: config.updatePath(this.data.bizId),
        data: this.buildPayload()
      });
      wx.showToast({ title: "已保存", icon: "success" });
      await this.loadDetail();
      return true;
    } catch (error) {
      wx.showToast({ title: error.message || "保存失败", icon: "none" });
      return false;
    } finally {
      this.setData({ saving: false });
    }
  },

  async saveAndSubmit() {
    const config = this.getConfig();
    if (!config || this.data.submitting) return;
    this.setData({ submitting: true });
    try {
      const saved = await this.saveDraft();
      if (!saved) return;
      await request({
        method: "POST",
        path: config.submitPath(this.data.bizId),
        data: {
          biz_summary: config.summary(this.data.detail || {}),
          ...this.buildPayload()
        }
      });
      wx.showToast({ title: "已重新提交", icon: "success" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
    } catch (error) {
      wx.showToast({ title: error.message || "重新提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
