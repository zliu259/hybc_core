const { uploadBinary } = require("../../utils/request");
const { wxChooseMediaImage, wxChooseMessageFile } = require("../../utils/wx");
const { whGet, docGet, docSend } = require("../common/wh-api");
const {
  DATED_CATEGORIES,
  guessDocCategory,
  keepPartsAfter,
  newUploadForm,
  titleFromFileName,
  toCompletePayload,
  uploadFormProblem,
  uploadInParts,
  uploadProblem
} = require("../common/wh-doc-upload");
const { formatFileSize } = require("../common/wh-doc-view");
const { beijingToday } = require("../common/wh-format");
const { toast, errorText, alertModal, loadViewer, queryId } = require("../common/wh-ui");

const DEVICE_SEARCH_SIZE = 20;
/** 一片 8 MB，信号差的时候要传一阵子 */
const PART_TIMEOUT_MS = 180000;
const BACK_DELAY_MS = 800;
const OWNER_KINDS = [
  { key: "device", label: "某台设备" },
  { key: "category", label: "某类设备" },
  { key: "general", label: "通用" }
];

const deviceLabel = (device) => [device.device_code, device.name].filter(Boolean).join(" ");
const toDeviceOptions = (devices) => ({ range: devices.map(deviceLabel), devices });
const isCancelled = (error) =>
  /cancel/i.test(String((error && (error.errMsg || error.message)) || ""));
const pad = (value) => String(value).padStart(2, "0");

/** 拍的照片没有像样的文件名，用「照片-日期-时间」。 */
const photoName = (path, now = new Date()) => {
  const local = new Date(now.getTime() + 8 * 3600 * 1000);
  const stamp = `${local.getUTCFullYear()}${pad(local.getUTCMonth() + 1)}${pad(local.getUTCDate())}-${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}${pad(local.getUTCSeconds())}`;
  const extension = (/\.([a-zA-Z0-9]+)$/.exec(String(path || "")) || [])[1];
  return `照片-${stamp}.${(extension || "jpg").toLowerCase()}`;
};

const fileSizeOf = (path) =>
  new Promise((resolve) => {
    wx.getFileSystemManager().getFileInfo({
      filePath: path,
      success: (res) => resolve(Number(res && res.size) || 0),
      fail: () => resolve(0)
    });
  });

/**
 * 上传一份设备资料（只有库管和资料管理员能用）。带 deviceId 进来时归属定死那台设备。
 * 文件一片一片读着传；改、删、替换、对外链接在网页上做。
 */
Page({
  data: {
    denied: false,
    busy: false,
    progress: 0,
    form: newUploadForm(null),
    fileText: "",
    showValidity: false,
    ownerKinds: OWNER_KINDS,
    categoryLabels: [],
    categoryIndex: 0,
    deviceOptions: toDeviceOptions([]),
    deviceSearching: false,
    deviceCategories: { range: [], ids: [] },
    deviceCategoryIndex: -1,
    today: beijingToday()
  },

  async onLoad(query) {
    this.config = null;
    // 分片都传上去了、记录还没写成时留着：再点「上传」只重发完成请求
    this.uploaded = null;
    this.titleTouched = false;
    this.categoryTouched = false;
    try {
      const viewer = await loadViewer();
      if (!(viewer.caps && viewer.caps.is_doc_admin)) {
        this.setData({ denied: true });
        return;
      }
    } catch (error) {
      this.setData({ denied: true });
      toast(errorText(error, "权限没取到，请稍后重试"));
      return;
    }
    const deviceId = queryId(query && query.deviceId);
    await Promise.all([
      this.loadConfig(),
      this.loadDeviceCategories(),
      deviceId === null ? this.searchDevices("") : this.loadDevice(deviceId)
    ]);
  },

  onUnload() {
    if (this.backTimer) clearTimeout(this.backTimer);
  },

  async loadConfig() {
    try {
      const result = await docGet("/config");
      this.config = result.data;
      this.setData({ categoryLabels: this.config.categories.map((item) => item.label) });
      this.showCategory(this.data.form.category);
    } catch (error) {
      toast(errorText(error, "上传设置没取到，请稍后重试"));
    }
  },

  async loadDeviceCategories() {
    try {
      const result = await whGet("/device-category");
      const active = (Array.isArray(result.data) ? result.data : []).filter(
        (item) => item.status === "active"
      );
      this.setData({
        deviceCategories: { range: active.map((item) => item.name), ids: active.map((item) => item.id) }
      });
    } catch (error) {
      console.warn("[wh-doc-upload] 设备类别没取到", errorText(error, ""));
    }
  },

  /** 从设备页进来：归属定死这台设备。取不到就退回自己选。 */
  async loadDevice(deviceId) {
    try {
      const result = await whGet(`/device/${deviceId}`);
      this.setData({ form: { ...newUploadForm(result.data), category: this.data.form.category } });
    } catch (error) {
      toast(errorText(error, "设备没取到，请自己选一下"));
      await this.searchDevices("");
    }
  },

  async searchDevices(keyword) {
    this.setData({ deviceSearching: true });
    try {
      const result = await whGet("/device", { keyword, pageSize: DEVICE_SEARCH_SIZE });
      this.setData({ deviceOptions: toDeviceOptions(Array.isArray(result.data) ? result.data : []) });
    } catch (error) {
      toast(errorText(error, "设备搜索失败"));
    } finally {
      this.setData({ deviceSearching: false });
    }
  },

  onDeviceSearch(event) {
    return this.searchDevices(String((event.detail && event.detail.keyword) || "").trim());
  },

  onDevicePick(event) {
    const device = this.data.deviceOptions.devices[Number(event.detail && event.detail.value)];
    if (!device || this.data.busy) return;
    this.setData({ "form.deviceId": device.id, "form.deviceText": deviceLabel(device) });
  },

  onOwnerKind(event) {
    const kind = String(event.currentTarget.dataset.kind || "");
    if (this.data.form.locked || this.data.busy) return;
    if (OWNER_KINDS.some((item) => item.key === kind)) this.setData({ "form.ownerKind": kind });
  },

  onDeviceCategoryPick(event) {
    const index = Number(event.detail && event.detail.value);
    const id = this.data.deviceCategories.ids[index];
    if (id === undefined) return;
    this.setData({ "form.deviceCategoryId": id, deviceCategoryIndex: index });
  },

  showCategory(category) {
    const keys = this.config ? this.config.categories.map((item) => item.key) : [];
    this.setData({
      "form.category": category,
      categoryIndex: Math.max(0, keys.indexOf(category)),
      showValidity: DATED_CATEGORIES.includes(category)
    });
  },

  onCategoryPick(event) {
    const item = this.config && this.config.categories[Number(event.detail && event.detail.value)];
    if (!item) return;
    this.categoryTouched = true;
    this.showCategory(item.key);
  },

  onTitleInput(event) {
    this.titleTouched = true;
    this.setData({ "form.title": String((event.detail && event.detail.value) || "") });
  },

  onValidUntil(event) {
    this.setData({ "form.validUntil": String((event.detail && event.detail.value) || "") });
  },

  clearValidUntil() {
    this.setData({ "form.validUntil": "" });
  },

  /** 选好一个文件：先看传不传得了，传得了才算选上。 */
  async takeFile(file, suggestTitle) {
    const problem = uploadProblem(file, this.config);
    if (problem) {
      await alertModal({ title: "这个文件传不了", content: problem });
      return;
    }
    // 换了文件：上一个文件传到一半的分片不要了
    if (this.uploaded) {
      const stale = this.uploaded.upload_token;
      this.uploaded = null;
      docSend("POST", "/upload/abort", { upload_token: stale }).catch(() => undefined);
    }
    this.setData({
      "form.file": file,
      fileText: `${file.name}（${formatFileSize(file.size)}）`,
      progress: 0,
      ...(this.titleTouched ? {} : { "form.title": suggestTitle })
    });
    if (!this.categoryTouched) this.showCategory(guessDocCategory(file.name));
  },

  async chooseFile() {
    if (this.data.denied || this.data.busy) return;
    let picked;
    try {
      picked = await wxChooseMessageFile({ count: 1, type: "file" });
    } catch (error) {
      if (!isCancelled(error)) toast(errorText(error, "选文件失败，请重试"));
      return;
    }
    const first = picked && picked.tempFiles && picked.tempFiles[0];
    if (!first || !first.path) return;
    const size = Number(first.size) > 0 ? Number(first.size) : await fileSizeOf(first.path);
    const name = String(first.name || "").trim() || "文件";
    await this.takeFile({ path: first.path, name, size }, titleFromFileName(name));
  },

  async choosePhoto() {
    if (this.data.denied || this.data.busy) return;
    let picked;
    try {
      picked = await wxChooseMediaImage({ count: 1 });
    } catch (error) {
      if (!isCancelled(error)) toast(errorText(error, "选图失败，请重试"));
      return;
    }
    const first = picked && picked.tempFiles && picked.tempFiles[0];
    if (!first || !first.path) return;
    const size = Number(first.size) > 0 ? Number(first.size) : await fileSizeOf(first.path);
    // 照片的文件名是一串乱码，标题留给人自己填
    await this.takeFile({ path: first.path, name: photoName(first.path), size }, "");
  },

  sendParts(file) {
    return uploadInParts(
      file,
      {
        init: (input) => docSend("POST", "/upload/init", input).then((result) => result.data),
        putPart: (token, partNumber, chunk) =>
          uploadBinary({
            path: `/api/v1/doc-library/upload/part?token=${encodeURIComponent(token)}&part=${partNumber}`,
            arrayBuffer: chunk,
            contentType: "application/octet-stream",
            timeout: PART_TIMEOUT_MS
          }).then((result) => result.data),
        abort: (token) => docSend("POST", "/upload/abort", { upload_token: token }),
        retryDelayMs: this.retryDelayMs
      },
      (sent) => this.setData({ progress: Math.floor((sent / file.size) * 100) })
    );
  },

  async submit() {
    if (this.data.denied || this.data.busy) return;
    const form = this.data.form;
    const problem = uploadFormProblem(form);
    if (problem) {
      toast(problem);
      return;
    }
    this.setData({ busy: true });
    // 传到一半退出去就白传了，离开前问一句（老一点的客户端没有这个接口）
    if (typeof wx.enableAlertBeforeUnload === "function") {
      wx.enableAlertBeforeUnload({ message: "文件还没传完，现在离开要重新传。" });
    }
    try {
      if (!this.uploaded || this.uploaded.filePath !== form.file.path) {
        this.uploaded = null;
        const sent = await this.sendParts(form.file);
        this.uploaded = { ...sent, filePath: form.file.path };
      }
      try {
        await docSend("POST", "/upload/complete", toCompletePayload(this.data.form, this.uploaded));
      } catch (error) {
        if (!keepPartsAfter(error)) this.uploaded = null;
        throw error;
      }
      this.uploaded = null;
      this.setData({ progress: 100 });
      toast("已上传");
      this.backTimer = setTimeout(() => wx.navigateBack(), BACK_DELAY_MS);
    } catch (error) {
      if (!this.uploaded) this.setData({ progress: 0 });
      toast(errorText(error, "上传失败，请稍后重试"));
    } finally {
      if (typeof wx.disableAlertBeforeUnload === "function") wx.disableAlertBeforeUnload();
      this.setData({ busy: false });
    }
  }
});
