const { buildUrl } = require("../../utils/request");
const { docGet } = require("../common/wh-api");
const { buildDocDetail, documentType } = require("../common/wh-doc-view");
const {
  toast,
  errorText,
  isNotFound,
  confirmModal,
  alertModal,
  loadNameOf,
  queryId
} = require("../common/wh-ui");

/** 进度每变这么多才刷一次界面 */
const PROGRESS_STEP = 5;

/**
 * 看一份资料：信息、历史版本，「打开」按类型来：图片预览、视频在页面里放、文档下载后用系统打开。
 * 文件地址 15 分钟有效，点「打开」时才取。
 */
Page({
  data: {
    loading: false,
    notFound: false,
    loadFailed: false,
    view: null,
    opening: false,
    progress: 0,
    videoUrl: ""
  },

  onLoad(query) {
    this.docId = queryId(query && query.id);
    // 这一页里下过的文档留着，再点「打开」不用重新下
    this.localPath = "";
    if (this.docId === null) {
      this.setData({ notFound: true });
      return undefined;
    }
    return this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load() {
    if (this.docId === null || this.data.loading) return;
    this.setData({ loading: true });
    try {
      const [result, nameOf] = await Promise.all([docGet(`/file/${this.docId}`), loadNameOf()]);
      const view = buildDocDetail(result.data, nameOf);
      this.setData({ view, notFound: false, loadFailed: false });
      wx.setNavigationBarTitle({ title: view.title });
    } catch (error) {
      if (isNotFound(error)) this.setData({ notFound: true, view: null });
      else if (!this.data.view) this.setData({ loadFailed: true });
      toast(errorText(error, "资料加载失败"));
    } finally {
      this.setData({ loading: false });
    }
  },

  async fetchUrl() {
    const result = await docGet(`/file/${this.docId}/url`);
    const url = String((result && result.data && result.data.url) || "");
    if (!url) throw new Error("没有取到文件地址，请稍后重试");
    return /^https?:\/\//i.test(url) ? url : buildUrl(url);
  },

  download(url) {
    return new Promise((resolve, reject) => {
      const task = wx.downloadFile({
        url,
        success: (res) => {
          const path = (res && (res.tempFilePath || res.filePath)) || "";
          // 地址过期、文件没了的时候回来的是一段报错文字，不是文件
          if (res && res.statusCode >= 200 && res.statusCode < 300 && path) resolve(path);
          else reject(new Error("下载失败，请再点一次"));
        },
        fail: (error) => {
          console.warn("[wh-doc-view] 下载失败", error && error.errMsg);
          reject(new Error("下载失败，请检查网络后再试"));
        }
      });
      if (task && typeof task.onProgressUpdate === "function") {
        task.onProgressUpdate((res) => {
          const progress = Number(res && res.progress) || 0;
          if (progress - this.data.progress >= PROGRESS_STEP) this.setData({ progress });
        });
      }
    });
  },

  /** 用系统的查看器打开；打不开（企微电脑端）返回 false。 */
  showDocument(filePath) {
    const fileType = documentType(this.data.view.fileName);
    return new Promise((resolve) => {
      wx.openDocument({
        filePath,
        showMenu: true,
        ...(fileType ? { fileType } : {}),
        success: () => resolve(true),
        fail: (error) => {
          console.warn("[wh-doc-view] 打不开", error && error.errMsg);
          resolve(false);
        }
      });
    });
  },

  async openDocumentFile() {
    if (!this.localPath) this.localPath = await this.download(await this.fetchUrl());
    if (await this.showDocument(this.localPath)) return;
    await alertModal({
      title: "这里打不开这个文件",
      content: "请用手机，或者在电脑上用网页版打开。"
    });
  },

  async onOpen() {
    const view = this.data.view;
    if (!view || this.data.opening) return;
    if (view.kind === "unsupported") {
      toast("这种文件请在电脑上打开");
      return;
    }
    // 先占住，免得连点两次下两遍
    this.setData({ opening: true, progress: 0 });
    try {
      if (view.kind === "document") {
        const go =
          this.localPath ||
          !view.needConfirm ||
          (await confirmModal({
            title: `文件有 ${view.sizeText}`,
            content: "要下载吗？不在 Wi-Fi 下会用掉不少流量。",
            confirmText: "下载"
          }));
        if (go) await this.openDocumentFile();
        return;
      }
      const url = await this.fetchUrl();
      if (view.kind === "image") wx.previewImage({ urls: [url], current: url });
      else this.setData({ videoUrl: url });
    } catch (error) {
      toast(errorText(error, "打开失败，请稍后重试"));
    } finally {
      this.setData({ opening: false });
    }
  },

  onVideoError() {
    this.setData({ videoUrl: "" });
    toast("视频放不了，再点一次「打开」试试");
  },

  openHistory(event) {
    const id = queryId(event.currentTarget.dataset.id);
    if (id !== null) wx.navigateTo({ url: `/packageWarehouse/doc-view/index?id=${id}` });
  }
});
