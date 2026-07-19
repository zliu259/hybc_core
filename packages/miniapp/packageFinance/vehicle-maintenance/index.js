const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxChooseMediaImage } = require("../../utils/wx");

const STATUS_LABELS = {
  active: "有效",
  voided: "已作废"
};

const todayStr = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};

Page({
  data: {
    loading: false,
    submitting: false,
    vehicles: [],
    vehicleLabels: ["请选择车辆"],
    vehicleIndex: 0,
    types: [],
    typeLabels: ["请选择类型"],
    typeIndex: 0,
    statusTextMap: STATUS_LABELS,
    form: {
      vehicle_id: "",
      maintenance_type: "",
      content: "",
      mileage_km: "",
      service_provider: "",
      cost: "",
      serviced_at: todayStr()
    },
    attachmentList: [],
    myRecords: []
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const [vehicleRes, typeRes, myRes] = await Promise.all([
        request({ method: "GET", path: "/api/v1/fleet/vehicles?status=active" }).catch(() => null),
        request({
          method: "GET",
          path: "/api/v1/dict?dict_type=vehicle_maintenance_type"
        }).catch(() => null),
        request({
          method: "GET",
          path: "/api/v1/fleet/maintenance?mine=true&pageSize=50"
        }).catch(() => null)
      ]);

      const vehicles = vehicleRes && Array.isArray(vehicleRes.data) ? vehicleRes.data : [];
      const types = typeRes && Array.isArray(typeRes.data) ? typeRes.data : [];
      const myRecords = (myRes && Array.isArray(myRes.data) ? myRes.data : []).map((item) => ({
        ...item,
        statusLabel: STATUS_LABELS[item.status] || item.status,
        typeLabel:
          (types.find((t) => t.dict_value === item.maintenance_type) || {}).dict_label ||
          item.maintenance_type
      }));

      this.setData({
        vehicles,
        types,
        vehicleLabels: ["请选择车辆"].concat(
          vehicles.map((item) => `${item.current_plate_no || "-"}`)
        ),
        typeLabels: ["请选择类型"].concat(types.map((item) => item.dict_label)),
        myRecords
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  onVehicleChange(e) {
    const index = Number(e.detail.value || 0);
    const vehicle = this.data.vehicles[index - 1] || null;
    this.setData({
      vehicleIndex: index,
      "form.vehicle_id": vehicle ? vehicle.id : ""
    });
  },

  onTypeChange(e) {
    const index = Number(e.detail.value || 0);
    const type = this.data.types[index - 1] || null;
    this.setData({
      typeIndex: index,
      "form.maintenance_type": type ? type.dict_value : ""
    });
  },

  onDateChange(e) {
    this.setData({ "form.serviced_at": e.detail.value });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: e.detail.value });
  },

  async chooseAttachments() {
    if (this.data.submitting) return;
    try {
      const res = await wxChooseMediaImage({ count: 9 });
      const files = (res && res.tempFiles) || [];
      if (!files.length) return;
      this.setData({ submitting: true });

      const uploaded = [];
      for (const file of files) {
        const filePath = String(file.path || file.tempFilePath || file.tempPath || "");
        if (!filePath) continue;
        const fileName =
          (typeof file.name === "string" && file.name.trim()) ||
          `maintenance-${Date.now()}.jpg`;
        const result = await uploadFileToR2(filePath, {
          category: "vehicle-maintenance",
          fileName
        });
        uploaded.push({
          file_key: result.key,
          file_name: fileName || result.key,
          file_size: file.size || file.fileSize || 0
        });
      }

      if (!uploaded.length) {
        wx.showToast({ title: "未识别到可上传文件", icon: "none" });
        return;
      }
      this.setData({ attachmentList: this.data.attachmentList.concat(uploaded) });
      wx.showToast({ title: "附件上传完成", icon: "success" });
    } catch {
      wx.showToast({ title: "附件上传失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  removeAttachment(e) {
    const index = Number(e.currentTarget.dataset.index);
    const next = this.data.attachmentList.slice();
    next.splice(index, 1);
    this.setData({ attachmentList: next });
  },

  resetForm() {
    this.setData({
      vehicleIndex: 0,
      typeIndex: 0,
      form: {
        vehicle_id: "",
        maintenance_type: "",
        content: "",
        mileage_km: "",
        service_provider: "",
        cost: "",
        serviced_at: todayStr()
      },
      attachmentList: []
    });
  },

  async submit() {
    if (this.data.submitting) return;
    const f = this.data.form;
    const vehicleId = Number(f.vehicle_id || 0);
    const mileage = Number(f.mileage_km || 0);

    if (!vehicleId) {
      wx.showToast({ title: "请选择车辆", icon: "none" });
      return;
    }
    if (!f.maintenance_type) {
      wx.showToast({ title: "请选择保养类型", icon: "none" });
      return;
    }
    if (!String(f.content || "").trim()) {
      wx.showToast({ title: "请填写保养内容", icon: "none" });
      return;
    }
    if (!Number.isFinite(mileage) || mileage < 0) {
      wx.showToast({ title: "请填写有效里程", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中...", mask: true });
    try {
      await request({
        method: "POST",
        path: "/api/v1/fleet/maintenance",
        data: {
          vehicle_id: vehicleId,
          maintenance_type: f.maintenance_type,
          content: String(f.content).trim(),
          mileage_km: mileage,
          service_provider: String(f.service_provider || "").trim() || null,
          cost: f.cost === "" ? null : Number(f.cost),
          serviced_at: f.serviced_at || undefined,
          attachments_json: JSON.stringify(this.data.attachmentList)
        }
      });
      wx.hideLoading();
      wx.showToast({ title: "保养记录已提交", icon: "success" });
      this.resetForm();
      await this.loadData();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: (error && error.message) || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
