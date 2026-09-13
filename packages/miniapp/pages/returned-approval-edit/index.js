const { request } = require("../../utils/request");
const { orderTypeLabel, workOrderTypeLabel } = require("../../utils/enum-labels");
const { loadUserNameMap } = require("../../utils/user-names");
const { getUserProfile } = require("../../utils/auth");
const {
  RETURNED_APPROVAL_EDIT_BIZ_TYPES,
  canEditReturnedApproval,
  isBizRecordCancelled
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
// 人员字段：渲染为通讯录中文姓名选择器（options 在 loadDetail 拉到通讯录后注入），
// 绝不让用户直面/回填企微拼音 id。
const personField = (key, label) => ({ key, label, type: "select", dynamic: "contacts", options: [] });
const numberField = (key, label) => ({ key, label, type: "number" });
const dateField = (key, label) => ({ key, label, type: "date" });
const textareaField = (key, label, maxlength = 500) => ({ key, label, type: "textarea", maxlength });

// 英文存量合同类型 → 中文（编辑保存时归一）
const CONTRACT_TYPE_CN = {
  labor: "人工",
  machine: "机械",
  machinery: "机械",
  general: "总包",
  material: "材料",
  service: "服务",
  lease: "租赁",
  other: "其他"
};

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
      numberField("contract_id", "关联合同编号"),
      numberField("project_id", "所属项目编号"),
      numberField("payee_id", "收款方编号"),
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
      numberField("payment_entity_id", "付款主体编号"),
      numberField("payment_entity_bank_account_id", "付款账户编号"),
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
      numberField("project_id", "所属项目编号"),
      numberField("from_warehouse_id", "来源仓库编号"),
      numberField("to_warehouse_id", "目标仓库编号"),
      textareaField("remark", "备注")
    ],
    summary: (row) => `${row.order_no || "库房单"} | ${orderTypeLabel(row.order_type, "")}`,
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
      personField("assignee_userid", "执行人"),
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
    summary: (row) => `${row.work_order_no || "库房工单"} | ${workOrderTypeLabel(row.work_order_type, "")}`
  },
  outbound_contract: {
    title: "对外合同",
    getPath: (id) => `/api/v1/contract/${id}`,
    updatePath: (id) => `/api/v1/contract/${id}`,
    submitPath: (id) => `/api/v1/contract/${id}/submit-approval`,
    fields: [
      numberField("project_id", "所属项目编号"),
      numberField("entity_id", "我方主体编号"),
      textField("counterparty", "对方单位"),
      {
        // 全系统写入口径是中文值（web 面板 / 发单台 / 小程序发单台均写中文），
        // 这里保持一致；英文存量值在编辑时顺手归一成中文。
        ...optionField("contract_type", "合同类型", [
          { label: "人工", value: "人工" },
          { label: "机械", value: "机械" },
          { label: "总包", value: "总包" },
          { label: "材料", value: "材料" },
          { label: "服务", value: "服务" },
          { label: "租赁", value: "租赁" },
          { label: "其他", value: "其他" }
        ]),
        normalize: (value) => CONTRACT_TYPE_CN[value] || value
      },
      personField("handler_userid", "经办人"),
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
      numberField("project_id", "所属项目编号"),
      numberField("entity_id", "我方主体编号"),
      textField("counterparty", "对方单位"),
      {
        // 全系统写入口径是中文值（web 面板 / 发单台 / 小程序发单台均写中文），
        // 这里保持一致；英文存量值在编辑时顺手归一成中文。
        ...optionField("contract_type", "合同类型", [
          { label: "人工", value: "人工" },
          { label: "机械", value: "机械" },
          { label: "总包", value: "总包" },
          { label: "材料", value: "材料" },
          { label: "服务", value: "服务" },
          { label: "租赁", value: "租赁" },
          { label: "其他", value: "其他" }
        ]),
        normalize: (value) => CONTRACT_TYPE_CN[value] || value
      },
      personField("handler_userid", "经办人"),
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
      numberField("contract_id", "合同编号"),
      numberField("project_id", "所属项目编号"),
      textField("customer_name", "客户名称"),
      textField("customer_tax_no", "客户税号"),
      optionField("invoice_type", "发票类型", [
        { label: "增值税专用发票", value: "special" },
        { label: "增值税普通发票", value: "normal" },
        { label: "电子发票", value: "electronic" }
      ]),
      textField("invoice_category", "开票类别"),
      numberField("tax_rate", "税率"),
      optionField("currency", "币种", [{ label: "人民币", value: "CNY" }]),
      numberField("amount_without_tax", "不含税金额"),
      numberField("tax_amount_estimated", "预估税额"),
      numberField("amount_with_tax", "含税金额"),
      textField("business_contract_no", "业务合同号"),
      textField("payment_reference", "收款/结算依据"),
      textareaField("items_json", "开票明细（每行一项）", 1200),
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
      const text = value === null || value === undefined ? "" : String(value);
      form[field.key] = typeof field.normalize === "function" ? field.normalize(text) : text;
    });
    return form;
  },

  buildFieldRows(form, config) {
    return config.fields.map((field) => {
      const value = form[field.key] || "";
      if (field.type === "select") {
        let options =
          field.dynamic === "contacts"
            ? this._contactOptions || []
            : Array.isArray(field.options)
              ? field.options
              : [];
        let optionIndex = options.findIndex((option) => option.value === value);
        // 中文原值（存量直接存中文名/中文标签）优先按 label 对齐已有选项，
        // 避免轮盘里出现两个同名行。
        if (value && optionIndex === -1 && /[一-鿿]/.test(value)) {
          optionIndex = options.findIndex((option) => option.label === value);
        }
        // 仍不在选项里（离职人员/未收录存量枚举）时补一项，避免误显示第一项。
        if (value && optionIndex === -1) {
          const currentLabel = /[一-鿿]/.test(value) ? value : "当前值（未识别）";
          options = options.concat([{ label: currentLabel, value }]);
          optionIndex = options.length - 1;
        }
        // 空值：不选中任何项（displayValue 留空走「请选择」占位），轮盘停在首位。
        const hasSelection = Boolean(value) && optionIndex >= 0;
        const pickerIndex = hasSelection ? optionIndex : 0;
        const selected = hasSelection ? options[optionIndex] : null;
        return {
          ...field,
          options,
          value,
          optionLabels: options.map((option) => option.label),
          optionIndex: pickerIndex,
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

      const [userNames, res] = await Promise.all([
        loadUserNameMap(),
        request({ method: "GET", path: config.getPath(this.data.bizId) })
      ]);
      this._contactOptions = Object.keys(userNames)
        .map((uid) => ({ label: userNames[uid], value: uid }))
        .sort((a, b) => a.label.localeCompare(b.label, "zh-Hans-CN"));
      const detail = (res && res.data) || {};
      // 单据已作废时实例可能仍停在 returned（存量僵尸），后端提交会直接拒绝，这里提前说明原因
      if (isBizRecordCancelled(detail)) {
        this.setData({ loading: false, loadError: "该单据已作废，无法编辑重提" });
        return;
      }
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
    if (!key) return;
    // 必须读渲染行的 options：人员字段的选项是通讯录动态注入的，
    // 「当前值（未识别）」补项也只存在于渲染行里，读静态配置会把表单值清空。
    const row = (this.data.fieldRows || []).find((item) => item.key === key);
    const options = row && Array.isArray(row.options) ? row.options : [];
    const selected = options[Number(e.detail.value || 0)];
    if (!selected) return;
    const form = { ...this.data.form, [key]: selected.value };
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
