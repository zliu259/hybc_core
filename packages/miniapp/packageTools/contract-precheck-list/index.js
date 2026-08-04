const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxChooseMessageFile, wxChooseLocalFile } = require("../../utils/wx");

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

  /** 优先从会话选文件（对方多用微信/企微发合同），失败再退到本地文件 */
  async chooseFile() {
    let file = null;
    try {
      file = await wxChooseMessageFile({ count: 1, type: "file" });
    } catch (messageError) {
      try {
        file = await wxChooseLocalFile({ count: 1, extension: ALLOWED_EXT });
      } catch (localError) {
        wx.showToast({
          title: (messageError && messageError.message) || (localError && localError.message) || "选择文件失败",
          icon: "none"
        });
        return;
      }
    }
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
