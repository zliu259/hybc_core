const { resolveAttachmentUrl, signAttachmentUrl } = require("../../utils/attachment-open");
const { uploadFileToR2 } = require("../../utils/upload");
const { loadUserNameMap } = require("../../utils/user-names");
const { wxChooseMediaImage } = require("../../utils/wx");
const { whGet, whSend } = require("../common/wh-api");
const { beijingToday } = require("../common/wh-format");
const {
  SYSTEM_OPTIONS,
  assigneeOptions,
  buildTaskDetail,
  submitProblem,
  toSubmitPayload
} = require("../common/wh-task-view");
const {
  toast,
  errorText,
  isConflict,
  isNotFound,
  confirmModal,
  loadViewer,
  loadNameOf,
  queryId
} = require("../common/wh-ui");
const keeperActions = require("./keeper-actions");

const MAX_PICK = 9;
const NO_ASSIGNEE_OPTIONS = { range: [], userids: [], index: 0 };

const emptyForm = () => ({ result: "", systems: [], resultNote: "" });

const systemOptions = (selected) =>
  SYSTEM_OPTIONS.map((option) => ({ ...option, active: selected.includes(option.key) }));

const isCancelled = (error) =>
  /cancel/i.test(String((error && (error.errMsg || error.message)) || ""));

Page({
  ...keeperActions,

  data: {
    loading: false,
    notFound: false,
    loadFailed: false,
    busy: false,
    uploading: false,
    view: null,
    photos: [],
    form: emptyForm(),
    systemOptions: systemOptions([]),
    // 派工用的人员选项，只有库管看待执行的任务时才有
    assignee: NO_ASSIGNEE_OPTIONS
  },

  onLoad(query) {
    this.taskId = queryId(query && query.id);
    if (this.taskId === null) this.setData({ notFound: true });
  },

  onShow() {
    return this.load();
  },

  async onPullDownRefresh() {
    await this.load();
    wx.stopPullDownRefresh();
  },

  async load() {
    if (this.taskId === null) return;
    // 上一趟还没回来（企微在选图、扫码界面关掉时会触发 onShow 刷新）：记下来，等它回来再取一次。
    // 直接丢掉的话，传完照片后页面会停在旧的张数上，提交时还说照片不够。
    if (this.data.loading) {
      this.reloadPending = true;
      return;
    }
    this.setData({ loading: true });
    try {
      const [result, viewer, nameOf] = await Promise.all([
        whGet(`/task/${this.taskId}`),
        loadViewer(),
        loadNameOf()
      ]);
      const task = result.data;
      const photos = await Promise.all(
        (Array.isArray(task.photos) ? task.photos : []).map(async (photo) => ({
          id: photo.id,
          url: await signAttachmentUrl(photo.file_key, resolveAttachmentUrl("", photo.file_key)),
          // 后端只让上传的人在提交前删自己的照片
          canDelete: task.status === "todo" && photo.uploaded_by_userid === viewer.userid
        }))
      );
      const view = buildTaskDetail(task, viewer, beijingToday(), nameOf);
      const options = view.actions.canAssign ? assigneeOptions(await loadUserNameMap()) : null;
      this.task = task;
      this.viewer = viewer;
      this.setData({
        view,
        photos,
        notFound: false,
        loadFailed: false,
        assignee: options
          ? {
              ...options,
              index: Math.max(0, options.userids.indexOf(task.assignee_userid || ""))
            }
          : NO_ASSIGNEE_OPTIONS
      });
    } catch (error) {
      if (isNotFound(error)) this.setData({ notFound: true, view: null });
      else if (!this.data.view) this.setData({ loadFailed: true });
      toast(errorText(error, "任务加载失败"));
    } finally {
      this.setData({ loading: false });
    }
    if (this.reloadPending) {
      this.reloadPending = false;
      await this.load();
    }
  },

  async choosePhotos() {
    if (this.data.uploading || !this.task) return;
    let picked;
    try {
      picked = await wxChooseMediaImage({ count: MAX_PICK });
    } catch (error) {
      if (!isCancelled(error)) toast(errorText(error, "选图失败，请重试"));
      return;
    }
    const files = ((picked && picked.tempFiles) || [])
      .map((file) => file.path || file.tempFilePath)
      .filter(Boolean);
    if (files.length === 0) return;

    this.setData({ uploading: true });
    try {
      // 一张一张传：哪张失败就停在哪张，前面传好的已经登记在任务上
      for (let index = 0; index < files.length; index += 1) {
        let uploaded;
        try {
          uploaded = await uploadFileToR2(files[index], { category: "wh-task" });
        } catch (error) {
          toast(`第 ${index + 1} 张上传失败`);
          return;
        }
        try {
          await whSend("POST", `/task/${this.taskId}/photo`, { file_key: uploaded.key });
        } catch (error) {
          toast(errorText(error, `第 ${index + 1} 张保存失败`));
          return;
        }
      }
      toast(`已上传 ${files.length} 张`);
    } finally {
      this.setData({ uploading: false });
      await this.load();
    }
  },

  previewPhoto(event) {
    const index = Number(event.currentTarget.dataset.index);
    const urls = this.data.photos.map((photo) => photo.url);
    if (!Number.isInteger(index) || index < 0 || index >= urls.length) return;
    wx.previewImage({ urls, current: urls[index] });
  },

  async deletePhoto(event) {
    const photoId = queryId(event.currentTarget.dataset.id);
    if (photoId === null || this.data.busy) return;
    if (!(await confirmModal({ title: "删除这张照片？", confirmText: "删除" }))) return;
    this.setData({ busy: true });
    try {
      await whSend("DELETE", `/task/${this.taskId}/photo/${photoId}`);
    } catch (error) {
      toast(errorText(error, "删除失败，请重试"));
    } finally {
      this.setData({ busy: false });
    }
    await this.load();
  },

  onResult(event) {
    const value = event.currentTarget.dataset.value;
    if (value !== "pass" && value !== "fail") return;
    this.setData({ "form.result": value });
  },

  toggleSystem(event) {
    const key = event.currentTarget.dataset.key;
    if (!SYSTEM_OPTIONS.some((option) => option.key === key)) return;
    const current = this.data.form.systems;
    const systems = current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key];
    this.setData({ "form.systems": systems, systemOptions: systemOptions(systems) });
  },

  onNoteInput(event) {
    this.setData({ "form.resultNote": String((event.detail && event.detail.value) || "") });
  },

  async submit() {
    if (this.data.busy || !this.task || !this.data.view) return;
    const problem = submitProblem(this.task, this.data.view.photo.count, this.data.form);
    if (problem) {
      toast(problem);
      return;
    }
    this.setData({ busy: true });
    try {
      const result = await whSend(
        "POST",
        `/task/${this.taskId}/submit`,
        toSubmitPayload(this.task, this.data.form)
      );
      const data = (result && result.data) || {};
      const done = data.status === "done" ? "已完成" : "已提交，等库管确认";
      toast(data.followup_task_id ? `${done}，已生成维修任务` : done);
      this.setData({ form: emptyForm(), systemOptions: systemOptions([]) });
    } catch (error) {
      toast(errorText(error, "提交失败，请重试"));
      // 别人先动过这个任务：重新加载看现在的样子；其他失败留在原地让人重试
      if (!isConflict(error)) return;
    } finally {
      this.setData({ busy: false });
    }
    await this.load();
  },

  openDevice() {
    const device = this.data.view && this.data.view.device;
    if (!device) return;
    wx.navigateTo({ url: `/packageWarehouse/device/index?id=${device.id}` });
  }
});
