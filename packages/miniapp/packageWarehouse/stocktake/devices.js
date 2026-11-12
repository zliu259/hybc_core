/** 盘点页里和设备有关的动作：连续扫码、手输编号、逐台标记。并进 Page 的配置里用。 */
const { parseDeviceCode } = require("../../utils/wh-scan");
const { wxScanCode } = require("../../utils/wx");
const { whSend } = require("../common/wh-api");
const { deviceActions, withDeviceLine } = require("../common/wh-stocktake-view");
const {
  toast,
  errorText,
  isConflict,
  isNotFound,
  confirmModal,
  promptModal
} = require("../common/wh-ui");

const isScanCancelled = (error) =>
  /cancel/i.test(String((error && (error.errMsg || error.message)) || ""));

/**
 * 扫一次，返回设备编号。用户取消返回 null。
 * 不是设备码时抛出的错误带 keepScanning：弹窗停一下还能接着扫。
 */
const scanCode = async () => {
  let scanned;
  try {
    scanned = await wxScanCode();
  } catch (error) {
    if (isScanCancelled(error)) return null;
    throw new Error("扫码失败，请重试");
  }
  const parsed = parseDeviceCode(scanned && scanned.result);
  if (!parsed.ok) {
    const error = new Error(parsed.message);
    error.keepScanning = true;
    throw error;
  }
  return parsed.code;
};

const chooseAction = (labels) =>
  new Promise((resolve) => {
    wx.showActionSheet({
      itemList: labels,
      success: (result) => resolve(Number(result && result.tapIndex)),
      fail: () => resolve(-1)
    });
  });

module.exports = {
  /** 标记一台设备并把结果换进页面。失败直接抛出，由调用的地方决定怎么提示。 */
  async markDevice(data) {
    const result = await whSend("POST", `/stocktake/${this.detail.id}/device-scan`, data);
    this.detail = withDeviceLine(this.detail, result.data.line);
    this.render();
    return result.data;
  },

  /**
   * 连续扫码：扫到一台标记一台，直到取消。
   * 不是设备码、查不到、账上不在库的，弹窗停住，点「继续扫」才接着扫：
   * 扫码界面盖着页面，toast 一闪就没了。断网、相机打不开、盘点已经结束，直接停。
   */
  async onScan() {
    if (this.data.scanning || this.data.busy || !this.canEdit()) return;
    this.apply({ scanning: true });
    try {
      for (;;) {
        let stop = null;
        let code = "";
        try {
          code = await scanCode();
          if (code === null) break;
          const marked = await this.markDevice({ device_code: code, found: true });
          if (!marked.hint) {
            wx.vibrateShort({ type: "light" });
            toast(`${marked.line.device_code} 已找到`);
            continue;
          }
          stop = { title: `${marked.line.device_code} 账上不在库`, content: marked.hint };
        } catch (error) {
          if (error && error.keepScanning) {
            stop = { title: error.message, content: "这个码没有记进盘点。" };
          } else if (isNotFound(error)) {
            stop = { title: `没有这台设备：${code}`, content: "这个码没有记进盘点。" };
          } else {
            toast(errorText(error, "扫码失败，请重试"));
            if (isConflict(error)) await this.load();
            break;
          }
        }
        const again = await confirmModal({ ...stop, confirmText: "继续扫", cancelText: "结束" });
        if (!again) break;
      }
    } finally {
      this.apply({ scanning: false });
    }
  },

  /** 码坏了扫不出来的时候手输编号。 */
  async onInputCode() {
    if (this.data.busy || !this.canEdit()) return;
    const code = await promptModal({ title: "输入设备编号", placeholder: "例如 SB-0012" });
    if (!code) return;
    await this.sendMark({ device_code: code, found: true });
  },

  async onDeviceTap(event) {
    if (this.data.busy || !this.canEdit()) return;
    const deviceId = Number(event.currentTarget.dataset.id);
    const line = this.detail.device_lines.find((item) => item.device_id === deviceId);
    const actions = deviceActions(line);
    if (actions.length === 0) return;
    const index = await chooseAction(actions.map((item) => item.label));
    const action = actions[index];
    if (!action) return;
    if (action.key === "found") {
      await this.sendMark({ device_id: deviceId, found: true });
      return;
    }
    if (action.key === "clear") {
      await this.sendMark({ device_id: deviceId, found: null, note: "" });
      return;
    }
    const note = await promptModal({
      title: `${line.device_code} 没找到`,
      placeholder: "备注（可不填），比如：借给二队了"
    });
    if (note === null) return;
    await this.sendMark({ device_id: deviceId, found: false, note });
  },

  /** 单次标记：带忙状态和提示。 */
  async sendMark(data) {
    this.apply({ busy: true });
    try {
      const marked = await this.markDevice(data);
      const code = marked.line.device_code;
      if (marked.hint) toast(`${code}：${marked.hint}`);
      else if (data.found === true) toast(`${code} 已找到`);
    } catch (error) {
      toast(errorText(error, "标记失败，请稍后重试"));
      if (isConflict(error)) await this.load();
    } finally {
      this.apply({ busy: false });
    }
  }
};
