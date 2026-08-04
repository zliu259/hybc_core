const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const {
  wxChooseMessageFile,
  wxChooseLocalFile,
  isMessageFilePickerSupported
} = require("../../utils/wx");

// 与 packageFinance/payment-apply 同款错误处理：企微/微信客户端差异较大，
// 本地文件选择不可用时引导改用会话文件
const extractErrorMessage = (error, fallback = "操作失败") => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error.trim();
  if (error && typeof error === "object") {
    const errMsg = error.errMsg || error.message;
    if (typeof errMsg === "string" && errMsg.trim()) return errMsg.trim();
  }
  return fallback;
};

const isLocalFilePickerUnsupportedError = (error) => {
  const message = extractErrorMessage(error, "").toLowerCase();
  return (
    message.includes("不支持本地文件选择") ||
    message.includes("local file") ||
    message.includes("choosefile")
  );
};

const confirmMessageFileFallback = () =>
  new Promise((resolve) => {
    wx.showModal({
      title: "本地文件不可用",
      content: "当前客户端不支持本地文件选择，是否改为“从会话文件选择”继续？",
      confirmText: "继续选择",
      cancelText: "取消",
      success: (res) => resolve(Boolean(res && res.confirm)),
      fail: () => resolve(false)
    });
  });

/** 选择结果是 {tempFiles:[...]} 包装对象，必须取首个 tempFile（与 payment-apply 一致） */
const pickFirstTempFile = (choose) =>
  choose && Array.isArray(choose.tempFiles) && choose.tempFiles[0]
    ? choose.tempFiles[0]
    : null;

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

const DIRECTION_LABELS = {
  inbound: "收款合同（我方乙方）",
  outbound: "付款合同（我方甲方）"
};

const ALLOWED_EXT = ["docx", "pdf"];

const extOf = (name) => {
  const source = String(name || "").trim();
  if (!source.includes(".")) return "";
  return (source.split(".").pop() || "").toLowerCase();
};

const formatTime = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const bj = new Date(d.getTime() + 8 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${bj.getUTCFullYear()}-${pad(bj.getUTCMonth() + 1)}-${pad(bj.getUTCDate())} ${pad(bj.getUTCHours())}:${pad(bj.getUTCMinutes())}`;
};

Page({
  data: {
    loading: false,
    submitting: false,
    picking: false,
    messagePickerSupported: false,
    list: [],
    total: 0,
    createVisible: false,
    directionOptions: [DIRECTION_LABELS.inbound, DIRECTION_LABELS.outbound],
    directionIndex: 0,
    form: {
      title: "",
      counterparty: ""
    },
    picked: null
  },

  onLoad() {
    // 企微/微信客户端能力不一：仅在支持时展示「从会话选择」入口
    this.setData({ messagePickerSupported: isMessageFilePickerSupported() });
  },

  onShow() {
    this.loadList();
  },

  onPullDownRefresh() {
    this.loadList().finally(() => wx.stopPullDownRefresh());
  },

  async loadList() {
    this.setData({ loading: true });
    try {
      const res = await request({
        method: "GET",
        path: "/api/v1/contract-precheck?page=1&pageSize=30"
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      this.setData({
        list: rows.map((row) => ({
          ...row,
          statusLabel: STATUS_LABELS[row.status] || row.status,
          statusTheme: STATUS_THEMES[row.status] || "default",
          directionLabel: DIRECTION_LABELS[row.direction] || row.direction,
          updatedAtText: formatTime(row.updated_at)
        })),
        total: (res.pagination && res.pagination.total) || rows.length
      });
    } catch (error) {
      wx.showToast({
        title: (error && error.message) || "加载失败",
        icon: "none"
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  openDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/packageTools/contract-precheck-detail/index?id=${id}` });
  },

  openCreate() {
    this.setData({
      createVisible: true,
      directionIndex: 0,
      form: { title: "", counterparty: "" },
      picked: null
    });
  },

  closeCreate() {
    this.setData({ createVisible: false });
  },

  onTitleInput(event) {
    this.setData({ "form.title": event.detail.value });
  },

  onCounterpartyInput(event) {
    this.setData({ "form.counterparty": event.detail.value });
  },

  onDirectionChange(event) {
    this.setData({ directionIndex: Number(event.detail.value) || 0 });
  },

  /** 本地文件选择（与 payment-apply 同规）；客户端不支持时引导改用会话文件 */
  async chooseFile() {
    if (this.data.picking) return;
    this.setData({ picking: true });
    try {
      const choose = await wxChooseLocalFile({
        count: 1,
        extension: [".docx", ".pdf"]
      });
      this.acceptPickedFile(pickFirstTempFile(choose));
    } catch (error) {
      if (isLocalFilePickerUnsupportedError(error) && isMessageFilePickerSupported()) {
        const confirmed = await confirmMessageFileFallback();
        if (!confirmed) {
          wx.showToast({ title: "已取消", icon: "none" });
          return;
        }
        await this.chooseFromMessage();
        return;
      }
      wx.showToast({ title: extractErrorMessage(error, "选择文件失败"), icon: "none" });
    } finally {
      this.setData({ picking: false });
    }
  },

  /** 从微信/企微会话文件选择（对方常直接把合同发到会话里） */
  async chooseFromMessage() {
    if (this.data.picking) return;
    this.setData({ picking: true });
    try {
      const choose = await wxChooseMessageFile({ count: 1, type: "file" });
      this.acceptPickedFile(pickFirstTempFile(choose));
    } catch (error) {
      wx.showToast({ title: extractErrorMessage(error, "选择文件失败"), icon: "none" });
    } finally {
      this.setData({ picking: false });
    }
  },

  acceptPickedFile(file) {
    if (!file || !file.path) return;
    const name = file.name || file.path;
    if (!ALLOWED_EXT.includes(extOf(name))) {
      wx.showToast({ title: "仅支持 .docx 与电子版 .pdf", icon: "none" });
      return;
    }

    const picked = {
      path: file.path,
      name,
      size: Number(file.size) || 0
    };
    const patch = { picked };
    if (!this.data.form.title) {
      patch["form.title"] = name.replace(/\.(docx|pdf)$/i, "").slice(0, 120);
    }
    this.setData(patch);
  },

  async submitCreate() {
    const { picked, form, directionIndex, submitting } = this.data;
    if (submitting) return;
    if (!picked) {
      wx.showToast({ title: "请先选择合同文件", icon: "none" });
      return;
    }
    if (!form.title.trim()) {
      wx.showToast({ title: "请填写合同标题", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "上传中…", mask: true });
    try {
      const uploaded = await uploadFileToR2(picked.path, {
        fileName: picked.name,
        category: "contract-precheck",
        debugContext: "contract-precheck-create"
      });
      wx.showLoading({ title: "提交预审…", mask: true });
      // 不传 contract_text：小程序无 docx/pdf 解析能力，由服务端 runner 提取全文
      const res = await request({
        method: "POST",
        path: "/api/v1/contract-precheck",
        data: {
          title: form.title.trim(),
          direction: directionIndex === 1 ? "outbound" : "inbound",
          counterparty: form.counterparty.trim() || undefined,
          file_key: uploaded.key,
          file_name: picked.name,
          file_size: picked.size
        }
      });
      const created = res.data || res;
      wx.hideLoading();
      this.setData({ createVisible: false });
      wx.showToast({ title: "已提交，AI 审计中", icon: "none" });
      if (created && created.id) {
        wx.navigateTo({
          url: `/packageTools/contract-precheck-detail/index?id=${created.id}`
        });
      }
      this.loadList();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: (error && error.message) || "提交失败",
        icon: "none"
      });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
