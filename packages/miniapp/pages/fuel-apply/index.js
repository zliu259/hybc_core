const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");

const STATUS_LABELS = {
  pending: "待处理",
  processed: "已处理",
  rejected: "已拒绝",
  cancelled: "已废除"
};

Page({
  data: {
    loading: false,
    submitting: false,
    vehicles: [],
    vehicleLabels: ["请选择车辆"],
    vehicleIndex: 0,
    fuelCards: [],
    fuelCardLabels: ["请选择油卡"],
    fuelCardIndex: 0,
    form: {
      vehicle_id: "",
      fuel_card_id: "",
      requested_amount: "",
      vehicle_mileage_km: ""
    },
    photoList: [],
    myApplications: []
  },

  onShow() {
    this.loadData();
  },

  async loadData() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      const [vehicleRes, cardRes, myRes] = await Promise.all([
        request({ method: "GET", path: "/api/v1/fleet/vehicles?status=active" }).catch(() => null),
        request({ method: "GET", path: "/api/v1/fleet/fuel-cards?mine=true&status=active" }).catch(() => null),
        request({ method: "GET", path: "/api/v1/fleet/fuel-applications?mine=true" }).catch(() => null)
      ]);

      const vehicles = vehicleRes && Array.isArray(vehicleRes.data) ? vehicleRes.data : [];
      const fuelCards = cardRes && Array.isArray(cardRes.data) ? cardRes.data : [];
      const myApplications = (myRes && Array.isArray(myRes.data) ? myRes.data : []).map((item) => ({
        ...item,
        statusLabel: STATUS_LABELS[item.status] || item.status
      }));
      this.setData({
        vehicles,
        fuelCards,
        vehicleLabels: ["请选择车辆"].concat(
          vehicles.map((item) => `${item.current_plate_no || "-"} (${item.vehicle_uuid || item.id})`)
        ),
        fuelCardLabels: ["请选择油卡"].concat(
          fuelCards.map((item) => `${item.card_no || item.id} (余额: ${item.latest_balance || 0})`)
        ),
        myApplications
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

  onFuelCardChange(e) {
    const index = Number(e.detail.value || 0);
    const card = this.data.fuelCards[index - 1] || null;
    this.setData({
      fuelCardIndex: index,
      "form.fuel_card_id": card ? card.id : ""
    });
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    const value = e.detail.value;
    this.setData({ [`form.${key}`]: value });
  },

  async choosePhotos() {
    if (this.data.submitting) return;
    try {
      const res = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 9,
          mediaType: ["image"],
          success: resolve,
          fail: reject
        });
      });

      const files = (res && res.tempFiles) || [];
      if (!files.length) return;
      this.setData({ submitting: true });

      const uploaded = [];
      for (const file of files) {
        const result = await uploadFileToR2(file.tempFilePath, {
          category: "fuel-application",
          fileName: file.fileName || `fuel-${Date.now()}.jpg`
        });
        uploaded.push({
          file_key: result.key,
          file_name: file.fileName || result.key,
          file_size: file.size || 0
        });
      }

      this.setData({ photoList: this.data.photoList.concat(uploaded) });
      wx.showToast({ title: "照片上传完成", icon: "success" });
    } catch {
      wx.showToast({ title: "照片上传失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  removePhoto(e) {
    const index = Number(e.currentTarget.dataset.index);
    const next = this.data.photoList.slice();
    next.splice(index, 1);
    this.setData({ photoList: next });
  },

  async submit() {
    if (this.data.submitting) return;
    const vehicleId = Number(this.data.form.vehicle_id || 0);
    const fuelCardId = Number(this.data.form.fuel_card_id || 0);
    const amount = Number(this.data.form.requested_amount || 0);
    const mileage = Number(this.data.form.vehicle_mileage_km || 0);

    if (!vehicleId) {
      wx.showToast({ title: "请选择车辆", icon: "none" });
      return;
    }
    if (!fuelCardId) {
      wx.showToast({ title: "请选择油卡", icon: "none" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      wx.showToast({ title: "请输入申请额度", icon: "none" });
      return;
    }
    if (!Number.isFinite(mileage) || mileage < 0) {
      wx.showToast({ title: "请输入里程", icon: "none" });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中...", mask: true });
    try {
      await request({
        method: "POST",
        path: "/api/v1/fleet/fuel-applications",
        data: {
          vehicle_id: vehicleId,
          fuel_card_id: fuelCardId,
          requested_amount: amount,
          vehicle_mileage_km: mileage,
          photo_keys_json: JSON.stringify(this.data.photoList.map((item) => item.file_key))
        }
      });

      wx.hideLoading();
      wx.showToast({ title: "申请已提交", icon: "success" });
      this.setData({
        vehicleIndex: 0,
        fuelCardIndex: 0,
        form: {
          vehicle_id: "",
          fuel_card_id: "",
          requested_amount: "",
          vehicle_mileage_km: ""
        },
        photoList: []
      });
      await this.loadData();
    } catch (error) {
      wx.hideLoading();
      wx.showToast({ title: (error && error.message) || "提交失败", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
