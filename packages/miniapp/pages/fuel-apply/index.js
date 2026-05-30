const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxChooseMediaImage } = require("../../utils/wx");

const STATUS_LABELS = {
  pending: "待办公室处理",
  needs_info: "待补充资料",
  processed: "已通过",
  rejected: "已拒绝",
  cancelled: "已废除"
};

const parsePhotoKeys = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string" && item.trim())
      : [];
  } catch {
    return [];
  }
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
    resubmitApplicationId: "",
    needsInfoCount: 0,
    statusTextMap: STATUS_LABELS,
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
        request({
          method: "GET",
          path: "/api/v1/fleet/vehicles?status=active"
        }).catch(() => null),
        request({
          method: "GET",
          path: "/api/v1/fleet/fuel-cards?mine=true&status=active"
        }).catch(() => null),
        request({
          method: "GET",
          path: "/api/v1/fleet/fuel-applications?mine=true"
        }).catch(() => null)
      ]);

      const vehicles =
        vehicleRes && Array.isArray(vehicleRes.data) ? vehicleRes.data : [];
      const fuelCards =
        cardRes && Array.isArray(cardRes.data) ? cardRes.data : [];
      const myApplications = (
        myRes && Array.isArray(myRes.data) ? myRes.data : []
      ).map((item) => ({
        ...item,
        statusLabel: STATUS_LABELS[item.status] || item.status
      }));
      const needsInfoCount = myApplications.filter(
        (item) => item.status === "needs_info"
      ).length;
      this.setData({
        vehicles,
        fuelCards,
        vehicleLabels: ["请选择车辆"].concat(
          vehicles.map((item) => `${item.current_plate_no || "-"} (${item.vehicle_uuid || item.id})`)
        ),
        fuelCardLabels: ["请选择油卡"].concat(
          fuelCards.map(
            (item) => `${item.card_no || item.id} (余额: ${item.latest_balance || 0})`
          )
        ),
        needsInfoCount,
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
      const res = await wxChooseMediaImage({ count: 9 });

      const files = (res && res.tempFiles) || [];
      if (!files.length) return;
      this.setData({ submitting: true });

      const uploaded = [];
      for (const file of files) {
        const filePath = String(file.path || file.tempFilePath || file.tempPath || "");
        if (!filePath) {
          continue;
        }
        const fileName =
          (typeof file.name === "string" && file.name.trim()) ||
          (typeof file.fileName === "string" && file.fileName.trim()) ||
          `fuel-${Date.now()}.jpg`;
        const result = await uploadFileToR2(filePath, {
          category: "fuel-application",
          fileName
        });
        uploaded.push({
          file_key: result.key,
          file_name: fileName || result.key,
          file_size: file.size || file.fileSize || 0
        });
      }

      if (!uploaded.length) {
        wx.showToast({ title: "未识别到可上传图片", icon: "none" });
        return;
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

  startResubmit(e) {
    const id = e.currentTarget.dataset.id;
    const target = this.data.myApplications.find(
      (item) => String(item.id) === String(id)
    );
    if (!target) return;
    const vehicleIndex = this.data.vehicles.findIndex(
      (item) => Number(item.id) === Number(target.vehicle_id)
    );
    const fuelCardIndex = this.data.fuelCards.findIndex(
      (item) => Number(item.id) === Number(target.fuel_card_id)
    );
    this.setData({
      resubmitApplicationId: String(id),
      vehicleIndex: vehicleIndex >= 0 ? vehicleIndex + 1 : 0,
      fuelCardIndex: fuelCardIndex >= 0 ? fuelCardIndex + 1 : 0,
      photoList: [],
      "form.vehicle_id": target.vehicle_id || "",
      "form.fuel_card_id": target.fuel_card_id || "",
      "form.requested_amount": target.requested_amount || "",
      "form.vehicle_mileage_km": target.vehicle_mileage_km || ""
    });
  },

  cancelResubmit() {
    this.setData({
      resubmitApplicationId: "",
      vehicleIndex: 0,
      fuelCardIndex: 0,
      photoList: [],
      form: {
        vehicle_id: "",
        fuel_card_id: "",
        requested_amount: "",
        vehicle_mileage_km: ""
      }
    });
  },

  statusText(status) {
    return this.data.statusTextMap[status] || status || "-";
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
      const isResubmit = Boolean(this.data.resubmitApplicationId);
      const path = isResubmit
        ? `/api/v1/fleet/fuel-applications/${this.data.resubmitApplicationId}/resubmit`
        : "/api/v1/fleet/fuel-applications";
      const targetApplication = isResubmit
        ? this.data.myApplications.find(
            (item) =>
              String(item.id) === String(this.data.resubmitApplicationId)
          )
        : null;
      const photoKeys = Array.from(
        new Set(
          parsePhotoKeys(targetApplication && targetApplication.photo_keys_json).concat(
            this.data.photoList.map((item) => item.file_key)
          )
        )
      );

      await request({
        method: "POST",
        path,
        data: {
          vehicle_id: vehicleId,
          fuel_card_id: fuelCardId,
          requested_amount: amount,
          vehicle_mileage_km: mileage,
          photo_keys_json: JSON.stringify(photoKeys)
        }
      });

      wx.hideLoading();
      wx.showToast({
        title: isResubmit ? "补充已提交" : "申请已提交",
        icon: "success"
      });
      this.setData({
        resubmitApplicationId: "",
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
      wx.showToast({
        title: (error && error.message) || "提交失败",
        icon: "none"
      });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
