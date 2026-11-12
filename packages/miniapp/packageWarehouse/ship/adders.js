/** 录单页里往单上加东西的动作：扫码、搜设备、搜物资、拍送货单。在页面里用 Page({ ...adders }) 展开。 */
const { uploadFileToR2 } = require("../../utils/upload");
const { scanDevice } = require("../../utils/wh-scan");
const { wxChooseMediaImage } = require("../../utils/wx");
const { whGet } = require("../common/wh-api");
const { formatQty } = require("../common/wh-format");
const { addDevice, addMaterial, materialLabel } = require("../common/wh-ship-view");
const { toast, errorText, confirmModal } = require("../common/wh-ui");

const SEARCH_SIZE = 20;
const MAX_PHOTOS = 9;

/** 扫到的东西不对，但可以接着扫下一个。 */
const canKeepScanning = (message) => message === "不是设备码" || message.startsWith("没有这台设备");

const isCancelled = (error) =>
  /cancel/i.test(String((error && (error.errMsg || error.message)) || ""));

const deviceOptionLabel = (device) =>
  `${[device.device_code, device.name].filter(Boolean).join(" ")} · ${device.state_label || ""}`;

const materialOptionLabel = (material) =>
  `${materialLabel(material)} · 在库 ${formatQty(material.quantity)} ${material.unit || ""}`.trim();

module.exports = {
  /** 加一台设备到单上。加上了返回 ""，加不进去返回原因（不提示，由调用的地方决定怎么说）。 */
  addDeviceToForm(device) {
    const result = addDevice(this.form, device);
    if (result.error) return result.error;
    this.form = result.form;
    this.render();
    return "";
  },

  /** 搜索选中、从设备页带进来的设备：加不进去时提示原因。 */
  tryAddDevice(device) {
    const problem = this.addDeviceToForm(device);
    if (problem) toast(problem);
    return !problem;
  },

  /**
   * 连续扫码：扫到一台加一台，直到取消。
   * 加不进去的（重复、状态不对、不是设备码、查不到）弹窗停住，点"继续扫"才接着扫：
   * 扫码界面盖着页面，toast 一闪就没了，人会以为这台已经加上。断网、相机打不开这类错误直接停。
   */
  async onScanAdd() {
    if (this.data.scanning || !this.data.canAddDevice) return;
    this.setData({ scanning: true });
    try {
      for (;;) {
        let problem = "";
        try {
          const device = await scanDevice();
          if (!device) break;
          problem = this.addDeviceToForm(device);
          if (!problem) {
            wx.vibrateShort({ type: "light" });
            toast(`已加 ${device.device_code}`);
            continue;
          }
        } catch (error) {
          problem = errorText(error, "扫码失败，请重试");
          if (!canKeepScanning(problem)) {
            toast(problem);
            break;
          }
        }
        const again = await confirmModal({
          title: problem,
          content: "这一台没有加到单上。",
          confirmText: "继续扫",
          cancelText: "结束"
        });
        if (!again) break;
      }
    } finally {
      this.setData({ scanning: false });
    }
  },

  async onDeviceSearch(event) {
    const keyword = String((event.detail && event.detail.keyword) || "").trim();
    this.setData({ deviceSearching: true });
    try {
      const result = await whGet("/device", { keyword, pageSize: SEARCH_SIZE });
      const items = Array.isArray(result.data) ? result.data : [];
      this.setData({
        deviceOptions: { range: ["搜索设备", ...items.map(deviceOptionLabel)], items: [null, ...items] }
      });
    } catch (error) {
      toast(errorText(error, "设备搜索失败"));
    } finally {
      this.setData({ deviceSearching: false });
    }
  },

  onDevicePick(event) {
    const index = Number(event.detail && event.detail.value);
    const device = Number.isInteger(index) ? this.data.deviceOptions.items[index] : undefined;
    if (device) this.tryAddDevice(device);
  },

  async onMaterialSearch(event) {
    const keyword = String((event.detail && event.detail.keyword) || "").trim();
    this.setData({ materialSearching: true });
    try {
      const result = await whGet("/material", { keyword, status: "active", pageSize: SEARCH_SIZE });
      const items = Array.isArray(result.data) ? result.data : [];
      this.setData({
        materialOptions: {
          range: ["搜索物资", ...items.map(materialOptionLabel)],
          items: [null, ...items]
        }
      });
    } catch (error) {
      toast(errorText(error, "物资搜索失败"));
    } finally {
      this.setData({ materialSearching: false });
    }
  },

  onMaterialPick(event) {
    const index = Number(event.detail && event.detail.value);
    const material = Number.isInteger(index) ? this.data.materialOptions.items[index] : undefined;
    if (!material) return;
    const result = addMaterial(this.form, material);
    if (result.error) {
      toast(result.error);
      return;
    }
    this.form = result.form;
    this.render();
  },

  /** 拍送货单（入库）。一张一张传，哪张失败停在哪张。 */
  async choosePhotos() {
    const room = MAX_PHOTOS - this.data.photos.length;
    if (this.data.uploading || room <= 0) return;
    let picked;
    try {
      picked = await wxChooseMediaImage({ count: room });
    } catch (error) {
      if (!isCancelled(error)) toast(errorText(error, "选图失败，请重试"));
      return;
    }
    const files = ((picked && picked.tempFiles) || [])
      .map((file) => file.path || file.tempFilePath)
      .filter(Boolean)
      .slice(0, room);
    if (files.length === 0) return;
    this.setData({ uploading: true });
    try {
      for (let index = 0; index < files.length; index += 1) {
        let uploaded;
        try {
          uploaded = await uploadFileToR2(files[index], { category: "wh-doc" });
        } catch (error) {
          toast(`第 ${index + 1} 张上传失败`);
          return;
        }
        this.setData({ photos: [...this.data.photos, { key: uploaded.key, path: files[index] }] });
      }
    } finally {
      this.setData({ uploading: false });
    }
  },

  removePhoto(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.data.photos.length) return;
    this.setData({ photos: this.data.photos.filter((_, position) => position !== index) });
  }
};
