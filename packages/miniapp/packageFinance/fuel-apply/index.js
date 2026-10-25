const { request } = require("../../utils/request");
const { loadUserNameMap, toUserName } = require("../../utils/user-names");
const { fileSizeLabel, statusLabel } = require("../../utils/enum-labels");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxChooseMediaImage } = require("../../utils/wx");
const {
  fuelCardLabel,
  resolveFuelCardIndex,
  vehicleLabel
} = require("../../utils/fuel-card-selection");

// 油卡跟车走：卡列表随所选车辆加载，换车/重置时清空
const EMPTY_CARD_STATE = {
  fuelCards: [],
  fuelCardLabels: ["请选择油卡"],
  fuelCardIndex: 0,
  "form.fuel_card_id": "",
  noCardForVehicle: false
};

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
    fuelCardsLoading: false,
    noCardForVehicle: false,
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
      const [userNames, vehicleRes, myRes] = await Promise.all([
        loadUserNameMap(),
        request({
          method: "GET",
          path: "/api/v1/fleet/vehicles?status=active"
        }).catch(() => null),
        request({
          method: "GET",
          path: "/api/v1/fleet/fuel-applications?mine=true"
        }).catch(() => null)
      ]);

      const vehicles =
        vehicleRes && Array.isArray(vehicleRes.data) ? vehicleRes.data : [];
      const myApplications = (
        myRes && Array.isArray(myRes.data) ? myRes.data : []
      ).map((item) => ({
        ...item,
        statusLabel: STATUS_LABELS[item.status] || statusLabel(item.status),
        processedByName: toUserName(item.processed_by_userid, userNames, "办公室")
      }));
      const needsInfoCount = myApplications.filter(
        (item) => item.status === "needs_info"
      ).length;
      this.setData({
        vehicles,
        vehicleLabels: ["请选择车辆"].concat(vehicles.map(vehicleLabel)),
        needsInfoCount,
        myApplications
      });
    } finally {
      this.setData({ loading: false });
    }
  },

  // 让在途的按车拉卡请求作废（换车、补充、重置时调用）
  nextFuelCardSeq() {
    this._fuelCardSeq = (this._fuelCardSeq || 0) + 1;
    return this._fuelCardSeq;
  },

  async onVehicleChange(e) {
    const index = Number(e.detail.value || 0);
    const vehicle = this.data.vehicles[index - 1] || null;
    const seq = this.nextFuelCardSeq();
    this.setData({
      ...EMPTY_CARD_STATE,
      vehicleIndex: index,
      "form.vehicle_id": vehicle ? vehicle.id : ""
    });
    if (!vehicle) return;

    this.setData({ fuelCardsLoading: true });
    try {
      const res = await request({
        method: "GET",
        path: `/api/v1/fleet/fuel-cards?status=active&vehicle_id=${vehicle.id}`
      });
      // 快速换车时丢弃上一辆车晚到的结果
      if (seq !== this._fuelCardSeq) return;
      const cards = res && Array.isArray(res.data) ? res.data : [];
      const cardIndex = resolveFuelCardIndex(cards);
      this.setData({
        fuelCards: cards,
        fuelCardLabels: ["请选择油卡"].concat(cards.map(fuelCardLabel)),
        fuelCardIndex: cardIndex,
        "form.fuel_card_id": cardIndex > 0 ? cards[cardIndex - 1].id : "",
        noCardForVehicle: cards.length === 0
      });
    } catch (error) {
      if (seq !== this._fuelCardSeq) return;
      wx.showToast({
        title: (error && error.message) || "油卡加载失败",
        icon: "none"
      });
    } finally {
      if (seq === this._fuelCardSeq) this.setData({ fuelCardsLoading: false });
    }
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
          file_size: file.size || file.fileSize || 0,
          file_size_text: fileSizeLabel(file.size || file.fileSize || 0)
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
    // 补充资料时车和卡都锁定为申请单上记录的那张，不按车重新拉卡、不做无卡拦截
    const recordedCard = {
      id: target.fuel_card_id,
      card_no: target.card_no || `油卡 ${target.fuel_card_id}`,
      latest_balance: target.card_latest_balance
    };
    this.nextFuelCardSeq();
    this.setData({
      resubmitApplicationId: String(id),
      vehicleIndex: vehicleIndex >= 0 ? vehicleIndex + 1 : 0,
      fuelCards: [recordedCard],
      fuelCardLabels: ["请选择油卡", fuelCardLabel(recordedCard)],
      fuelCardIndex: 1,
      fuelCardsLoading: false,
      noCardForVehicle: false,
      photoList: [],
      "form.vehicle_id": target.vehicle_id || "",
      "form.fuel_card_id": target.fuel_card_id || "",
      "form.requested_amount": target.requested_amount || "",
      "form.vehicle_mileage_km": target.vehicle_mileage_km || ""
    });
  },

  cancelResubmit() {
    this.nextFuelCardSeq();
    this.setData({
      ...EMPTY_CARD_STATE,
      fuelCardsLoading: false,
      resubmitApplicationId: "",
      vehicleIndex: 0,
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
    return this.data.statusTextMap[status] || statusLabel(status, "-");
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
    if (this.data.noCardForVehicle) {
      wx.showToast({ title: "该车辆尚未配置油卡，请联系办公室", icon: "none" });
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
      this.nextFuelCardSeq();
      this.setData({
        ...EMPTY_CARD_STATE,
        fuelCardsLoading: false,
        resubmitApplicationId: "",
        vehicleIndex: 0,
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
