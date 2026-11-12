/** 录单页里往单上加东西的动作：扫码、搜设备、搜物资、拍送货单。在页面里用 Page({ ...adders }) 展开。 */
const { uploadFileToR2 } = require("../../utils/upload");
const { scanDevice } = require("../../utils/wh-scan");
const { wxChooseMediaImage } = require("../../utils/wx");
const { whGet } = require("../common/wh-api");
const { formatQty } = require("../common/wh-format");
const { addDevice, addMaterial, materialLabel } = require("../common/wh-ship-view");
const { toast, errorText } = require("../common/wh-ui");

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
  /** 加一台设备到单上；加不进去时提示原因。返回加没加上。 */
  tryAddDevice(device, quiet) {
    const result = addDevice(this.form, device);
    if (result.error) {
      toast(result.error);
      return false;
    }
    this.form = result.form;
    this.render();
    if (!quiet) toast(`已加 ${device.device_code}`);
    return true;
  },

  /** 连续扫码：扫到一台加一台，直到取消。重复的、不是设备码的提示后接着扫；其他错误停下。 */
  async onScanAdd() {
    if (this.data.scanning || !this.data.canAddDevice) return;
    this.setData({ scanning: true });
    try {
      for (;;) {
        let device;
        try {
          device = await scanDevice();
        } catch (error) {
          const message = errorText(error, "扫码失败，请重试");
          toast(message);
          if (canKeepScanning(message)) continue;
          break;
        }
        if (!device) break;
        if (this.tryAddDevice(device)) wx.vibrateShort({ type: "light" });
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
    if (device) this.tryAddDevice(device, true);
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
