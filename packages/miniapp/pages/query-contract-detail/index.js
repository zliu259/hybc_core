const { request, buildUrl } = require("../../utils/request");
const { getUserProfile, getToken } = require("../../utils/auth");

const canAccessQuery = (roles) => {
  return roles.includes("super_admin") || roles.includes("finance") || roles.includes("manager");
};

const statusText = (status) => {
  const map = {
    draft: "草稿",
    pending_review: "待审查",
    pending_approval: "待审批",
    active: "生效中",
    completed: "已完成",
    terminated: "已终止"
  };
  return map[status] || "未知";
};

const statusTheme = (status) => {
  const map = {
    draft: "primary",
    pending_review: "warning",
    pending_approval: "warning",
    active: "success",
    completed: "success",
    terminated: "danger",
    rejected: "danger",
    cancelled: "danger"
  };
  return map[status] || "warning";
};

const amountChangeStatusText = (status) => {
  const map = {
    pending_approval: "待审批",
    approved: "已审批",
    rejected: "已驳回",
    cancelled: "已取消"
  };
  return map[status] || statusText(status);
};

const paymentStatusText = (status) => {
  const map = {
    draft: "草稿",
    pending_approval: "待审批",
    approved: "已审批",
    paid: "已付款",
    rejected: "已拒绝",
    cancelled: "已废止"
  };
  return map[status] || "未知";
};

const receiptStatusText = (status) => {
  const map = {
    recorded: "已登记",
    reversed: "已冲销",
    deleted: "已删除"
  };
  return map[status] || "未知";
};

const isImageFile = (name) => {
  const lower = String(name || "").toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].some((ext) => lower.endsWith(ext));
};

const inferDocumentType = (name) => {
  const lower = String(name || "").toLowerCase();
  const map = {
    ".pdf": "pdf",
    ".doc": "doc",
    ".docx": "docx",
    ".xls": "xls",
    ".xlsx": "xlsx",
    ".ppt": "ppt",
    ".pptx": "pptx",
    ".txt": "txt"
  };
  const matched = Object.keys(map).find((ext) => lower.endsWith(ext));
  return matched ? map[matched] : "";
};

const buildPersistentFilePath = (fileName) => {
  const userDataPath = (wx.env && wx.env.USER_DATA_PATH) || "";
  if (!userDataPath) return "";
  const docType = inferDocumentType(fileName);
  const suffix = docType ? `.${docType}` : "";
  return `${userDataPath}/hybc-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`;
};

const inferFileName = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "附件";
  const cleaned = raw.split("?")[0].split("#")[0];
  const segments = cleaned.split("/").filter(Boolean);
  const last = segments.length ? segments[segments.length - 1] : raw;
  try {
    return decodeURIComponent(last) || "附件";
  } catch {
    return last || "附件";
  }
};

const parseAttachments = (raw) => {
  if (!raw) return [];
  let source = raw;
  if (typeof raw === "string") {
    try {
      source = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      if (typeof item === "string") {
        const raw = item.trim();
        if (!raw) return null;
        const isUrl = /^https?:\/\//i.test(raw) || raw.startsWith("/");
        return {
          file_key: isUrl ? "" : raw,
          file_name: inferFileName(raw),
          file_url: isUrl ? raw : ""
        };
      }
      if (!item || typeof item !== "object") return null;
      const fileKey = item.file_key || item.key || "";
      const fileUrl = item.file_url || item.url || "";
      if (!fileKey && !fileUrl) return null;
      return {
        file_key: fileKey,
        file_name: item.file_name || item.name || inferFileName(fileKey || fileUrl),
        file_size: item.file_size || item.size || 0,
        file_url: fileUrl
      };
    })
    .filter(Boolean);
};

const resolveAttachmentUrl = (fileUrl, fileKey) => {
  if (fileUrl) {
    if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
    if (fileUrl.startsWith("/")) return buildUrl(fileUrl);
    return buildUrl(`/${fileUrl}`);
  }
  if (!fileKey) return "";
  return buildUrl(`/api/v1/upload/object/${encodeURIComponent(fileKey)}`);
};

const directionText = (direction) => {
  return direction === "inbound" ? "收款合同" : "付款合同";
};

const formatAmount = (amount) => {
  const numeric = Number(amount || 0);
  return numeric.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

Page({
  data: {
    id: 0,
    loading: false,
    detail: null,
    userNameMap: {},
    projectNameMap: {}
  },

  async onLoad(options) {
    const id = Number((options && options.id) || 0);
    if (!id) {
      wx.showToast({ title: "参数错误", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
      return;
    }
    this.setData({ id });
  },

  async onShow() {
    const profile = getUserProfile() || {};
    const roles = Array.isArray(profile.roles) ? profile.roles : [];
    if (!canAccessQuery(roles)) {
      wx.showToast({ title: "当前角色无查询权限", icon: "none" });
      setTimeout(() => wx.navigateBack({ delta: 1 }), 300);
      return;
    }
    await Promise.all([this.loadUserMap(), this.loadProjectMap()]);
    await this.loadDetail();
  },

  async loadUserMap() {
    try {
      const res = await request({ method: "GET", path: "/api/v1/auth/wecom/contacts" });
      const users = res && res.data && Array.isArray(res.data.users) ? res.data.users : [];
      const userNameMap = {};
      users.forEach((item) => {
        if (item && item.userid) userNameMap[item.userid] = item.name || item.userid;
      });
      this.setData({ userNameMap });
    } catch {
      this.setData({ userNameMap: {} });
    }
  },

  async loadProjectMap() {
    try {
      const res = await request({ method: "GET", path: "/api/v1/project?page=1&pageSize=500" });
      const rows = Array.isArray(res.data) ? res.data : [];
      const projectNameMap = {};
      rows.forEach((item) => {
        const pid = Number(item.id || 0);
        if (!pid) return;
        projectNameMap[pid] = item.project_name || item.project_code || `项目#${pid}`;
      });
      this.setData({ projectNameMap });
    } catch {
      this.setData({ projectNameMap: {} });
    }
  },

  formatUserName(userid) {
    if (!userid) return "-";
    const name = this.data.userNameMap[userid];
    return name || "-";
  },

  formatProjectName(projectId) {
    const id = Number(projectId || 0);
    if (!id) return "-";
    return this.data.projectNameMap[id] || `项目#${id}`;
  },

  async loadDetail() {
    if (!this.data.id || this.data.loading) return;
    this.setData({ loading: true });
    try {
      const res = await request({ method: "GET", path: `/api/v1/contract/${this.data.id}` });
      const item = (res && res.data) || {};
      const detail = {
        id: item.id,
        contractNo: item.contract_no || "-",
        directionText: directionText(item.direction),
        statusText: statusText(item.status),
        statusTheme: statusTheme(item.status),
        isLegacy: Boolean(item.legacy_data_id),
        projectName: this.formatProjectName(item.project_id),
        applicant: this.formatUserName(item.handler_userid),
        contractDate: item.contract_date || "-",
        counterparty: item.counterparty || "-",
        contractType: item.contract_type || "-",
        totalAmountText: formatAmount(item.total_amount),
        paidAmountText: formatAmount(item.paid_amount),
        receivedAmountText: formatAmount(item.received_amount),
        remark: item.remark || "-",
        attachments: parseAttachments(item.attachments_json),
        amountChanges: Array.isArray(item.amount_changes) ? item.amount_changes : [],
        paymentRequests: Array.isArray(item.payment_requests) ? item.payment_requests : []
      };
      detail.amountChanges = detail.amountChanges.map((row) => ({
        ...row,
        applicant_text: this.formatUserName(row.applicant_userid),
        status_text: amountChangeStatusText(row.status)
      }));
      detail.paymentRequests = detail.paymentRequests.map((row) => ({
        ...row,
        status_text: paymentStatusText(row.status)
      }));

      const receiptRes = await request({
        method: "GET",
        path: `/api/v1/receipt?contract_id=${this.data.id}&page=1&pageSize=20`
      }).catch(() => null);
      const receiptRows = receiptRes && Array.isArray(receiptRes.data) ? receiptRes.data : [];
      detail.receipts = receiptRows.map((row) => ({
        id: row.id,
        receiptNo: row.receipt_no || "-",
        amountText: formatAmount(row.amount),
        status_text: receiptStatusText(row.status),
        applicant_text: this.formatUserName(row.receiver_userid),
        receivedDate: row.received_date || "-"
      }));

      this.setData({ detail });
    } catch (error) {
      wx.showToast({ title: error.message || "加载失败", icon: "none" });
    } finally {
      this.setData({ loading: false });
    }
  },

  openPaymentDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/query-payment-detail/index?id=${id}` });
  },

  openReceiptDetail(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id) return;
    wx.navigateTo({ url: `/pages/query-receipt-detail/index?id=${id}` });
  },

  async openAttachment(e) {
    const key = e.currentTarget.dataset.key;
    const fileUrl = e.currentTarget.dataset.url || "";
    const name = e.currentTarget.dataset.name || "附件";
    if (!key && !fileUrl) {
      wx.showToast({ title: "附件链接无效", icon: "none" });
      return;
    }
    let url = resolveAttachmentUrl(fileUrl, key);
    // legacy/fin 等受保护前缀需签名访问；previewImage 无法带请求头，统一先取签名地址，失败回退直连
    if (key) {
      try {
        const signRes = await request({
          method: "POST",
          path: "/api/v1/upload/sign-download",
          data: { key }
        });
        const signed = signRes && signRes.data && signRes.data.url;
        if (signed) {
          url = /^https?:\/\//i.test(signed) ? signed : buildUrl(signed);
        }
      } catch (signErr) {
        console.warn("[attachment] sign-download failed, fallback to direct url", signErr);
      }
    }
    if (!url) {
      wx.showToast({ title: "附件链接无效", icon: "none" });
      return;
    }
    const lower = String(name).toLowerCase();
    if (
      lower.endsWith(".png") ||
      lower.endsWith(".jpg") ||
      lower.endsWith(".jpeg") ||
      lower.endsWith(".webp") ||
      lower.endsWith(".gif") ||
      lower.endsWith(".bmp")
    ) {
      wx.previewImage({ urls: [url], current: url });
      return;
    }

    const token = getToken();
    const openFromArrayBuffer = () => {
      const fs = typeof wx.getFileSystemManager === "function" ? wx.getFileSystemManager() : null;
      const targetPath = buildPersistentFilePath(name);
      if (!fs || typeof fs.writeFile !== "function" || !targetPath) {
        wx.showToast({ title: "附件打开失败", icon: "none" });
        return;
      }
      wx.request({
        url,
        method: "GET",
        responseType: "arraybuffer",
        header: token ? { Authorization: `Bearer ${token}` } : {},
        success: (resp) => {
          if (!(resp.statusCode >= 200 && resp.statusCode < 300) || !resp.data) {
            wx.showToast({ title: "附件下载失败", icon: "none" });
            return;
          }
          fs.writeFile({
            filePath: targetPath,
            data: resp.data,
            success: () => {
              const docType = inferDocumentType(name);
              const options = {
                filePath: targetPath,
                showMenu: true,
                fail: (err) => {
                  console.error("[query-contract-detail] openAttachment arraybuffer fallback failed", {
                    name,
                    url,
                    errMsg: (err && (err.errMsg || err.message)) || ""
                  });
                  wx.showToast({ title: "附件打开失败", icon: "none" });
                }
              };
              if (docType) options.fileType = docType;
              wx.openDocument(options);
            },
            fail: (err) => {
              console.error("[query-contract-detail] writeFile fallback failed", {
                name,
                url,
                errMsg: (err && (err.errMsg || err.message)) || ""
              });
              wx.showToast({ title: "附件打开失败", icon: "none" });
            }
          });
        },
        fail: (err) => {
          console.error("[query-contract-detail] request arraybuffer fallback failed", {
            name,
            url,
            errMsg: (err && (err.errMsg || err.message)) || ""
          });
          wx.showToast({ title: "附件下载失败", icon: "none" });
        }
      });
    };

    wx.downloadFile({
      url,
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const localPath = res.tempFilePath || res.filePath || res.apFilePath || "";
          if (!localPath) {
            openFromArrayBuffer();
            return;
          }
          const docType = inferDocumentType(name);
          wx.openDocument({
            filePath: localPath,
            showMenu: true,
            ...(docType ? { fileType: docType } : {}),
            fail: (err) => {
              console.error("[query-contract-detail] openAttachment failed", {
                name,
                url,
                errMsg: (err && (err.errMsg || err.message)) || ""
              });
              openFromArrayBuffer();
            }
          });
          return;
        }
        wx.showToast({ title: "附件下载失败", icon: "none" });
      },
      fail: (err) => {
        console.error("[query-contract-detail] download failed", {
          name,
          url,
          errMsg: (err && (err.errMsg || err.message)) || ""
        });
        wx.showToast({ title: "附件下载失败", icon: "none" });
      }
    });
  }
});
