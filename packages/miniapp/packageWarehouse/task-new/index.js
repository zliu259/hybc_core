const { loadUserNameMap } = require("../../utils/user-names");
const { scanDevice } = require("../../utils/wh-scan");
const { whGet, whSend } = require("../common/wh-api");
const { beijingToday } = require("../common/wh-format");
const {
  NEW_TASK_KINDS,
  assigneeOptions,
  newTaskForm,
  newTaskProblem,
  toNewTaskPayload
} = require("../common/wh-task-view");
const { toast, errorText, queryId } = require("../common/wh-ui");

const TEXT_FIELDS = ["title", "description", "requiredPhotoCount"];
const DEVICE_SEARCH_SIZE = 20;

const deviceLabel = (device) => [device.device_code, device.name].filter(Boolean).join(" ");

/** 设备选项：第 0 项是"不关联设备"。 */
const toDeviceOptions = (devices) => ({
  range: ["不关联设备", ...devices.map(deviceLabel)],
  devices: [null, ...devices]
});

Page({
  data: {
    busy: false,
    scanning: false,
    form: newTaskForm(null),
    kinds: NEW_TASK_KINDS.map((kind) => kind.label),
    kindIndex: 0,
    assignee: { range: ["不指定"], userids: [""], index: 0 },
    deviceLocked: false,
    deviceOptions: toDeviceOptions([]),
    deviceSearching: false,
    today: beijingToday()
  },

  async onLoad(query) {
    const deviceId = queryId(query && query.deviceId);
    await Promise.all([
      this.loadAssignees(),
      deviceId === null ? this.searchDevices("") : this.loadDevice(deviceId)
    ]);
  },

  async loadAssignees() {
    const options = assigneeOptions(await loadUserNameMap());
    this.setData({ assignee: { ...options, index: 0 } });
  },

  /** 从设备页进来：设备定死，不让换。 */
  async loadDevice(deviceId) {
    try {
      const result = await whGet(`/device/${deviceId}`);
      this.setDevice(result.data);
      this.setData({ deviceLocked: true });
    } catch (error) {
      toast(errorText(error, "设备加载失败"));
      await this.searchDevices("");
    }
  },

  setDevice(device) {
    this.setData({
      "form.deviceId": device ? device.id : null,
      "form.deviceText": device ? deviceLabel(device) : ""
    });
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
    const index = Number(event.detail && event.detail.value);
    const { devices } = this.data.deviceOptions;
    if (!Number.isInteger(index) || index < 0 || index >= devices.length) return;
    this.setDevice(devices[index]);
  },

  async onScanDevice() {
    if (this.data.scanning || this.data.deviceLocked) return;
    this.setData({ scanning: true });
    try {
      const device = await scanDevice();
      if (device) this.setDevice(device);
    } catch (error) {
      toast(errorText(error, "扫码失败，请重试"));
    } finally {
      this.setData({ scanning: false });
    }
  },

  onKind(event) {
    const index = Number(event.detail && event.detail.value);
    if (!Number.isInteger(index) || index < 0 || index >= NEW_TASK_KINDS.length) return;
    this.setData({ kindIndex: index, "form.kind": NEW_TASK_KINDS[index].key });
  },

  onInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!TEXT_FIELDS.includes(field)) return;
    this.setData({ [`form.${field}`]: String((event.detail && event.detail.value) || "") });
  },

  onAssigneePick(event) {
    const index = Number(event.detail && event.detail.value);
    const { userids } = this.data.assignee;
    if (!Number.isInteger(index) || index < 0 || index >= userids.length) return;
    this.setData({ "assignee.index": index, "form.assigneeUserid": userids[index] });
  },

  onDueDate(event) {
    this.setData({ "form.dueDate": String((event.detail && event.detail.value) || "") });
  },

  clearDueDate() {
    this.setData({ "form.dueDate": "" });
  },

  async submit() {
    if (this.data.busy) return;
    const problem = newTaskProblem(this.data.form);
    if (problem) {
      toast(problem);
      return;
    }
    this.setData({ busy: true });
    try {
      const result = await whSend("POST", "/task", toNewTaskPayload(this.data.form));
      // 建好直接进这个任务，返回时回到进来的地方
      wx.redirectTo({ url: `/packageWarehouse/task-detail/index?id=${result.data.id}` });
    } catch (error) {
      toast(errorText(error, "建任务失败，请重试"));
    } finally {
      this.setData({ busy: false });
    }
  }
});
