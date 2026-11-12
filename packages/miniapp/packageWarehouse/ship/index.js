const { whGet, whSend, newRequestId } = require("../common/wh-api");
const { formatQty } = require("../common/wh-format");
const {
  SHIP_TYPES,
  deviceNeedHints,
  materialLabel,
  newShipForm,
  prefillFromHoldings,
  prefillFromKit,
  removeDevice,
  removeMaterial,
  setDeviceField,
  setMaterialQty,
  shipProblem,
  toDocPayload
} = require("../common/wh-ship-view");
const { toast, errorText, alertModal, queryId } = require("../common/wh-ui");
const adders = require("./adders");

const BACK_DELAY_MS = 600;
const TEXT_FIELDS = ["counterparty", "handoverName", "remark"];

const availableText = (type, row) => {
  if (row.available === null) return "";
  return `${type === "out" ? "在库" : "在场"} ${formatQty(row.available)}`;
};

Page({
  ...adders,

  data: {
    type: "out",
    title: SHIP_TYPES.out.title,
    needsProject: true,
    needsToProject: false,
    isBack: false,
    isIn: false,
    isOut: true,
    canAddDevice: true,
    canAddMaterial: true,
    kitLocked: false,
    kitNo: "",
    // 按清单发货时项目是定死的，直接显示名字
    projectName: "",
    projectId: null,
    toProjectId: null,
    devices: [],
    materials: [],
    hints: [],
    counterparty: "",
    handoverName: "",
    remark: "",
    photos: [],
    busy: false,
    scanning: false,
    uploading: false,
    prefilling: false,
    deviceOptions: { range: ["搜索设备"], items: [null] },
    deviceSearching: false,
    materialOptions: { range: ["搜索物资"], items: [null] },
    materialSearching: false
  },

  async onLoad(query) {
    // 请求号在这里定下：提交失败重试用同一个，成功后才换
    this.form = newShipForm(query && query.type, newRequestId());
    const { type } = this.form;
    const config = SHIP_TYPES[type];
    this.setData({
      type,
      title: config.title,
      needsProject: config.needsProject,
      needsToProject: Boolean(config.needsToProject),
      isBack: type === "back",
      isIn: type === "in",
      isOut: type === "out",
      canAddDevice: type !== "in",
      canAddMaterial: type !== "transfer"
    });
    wx.setNavigationBarTitle({ title: config.title });

    const kitId = queryId(query && query.kitId);
    const projectId = queryId(query && query.projectId);
    const deviceId = queryId(query && query.deviceId);
    if (type === "out" && kitId !== null) await this.loadKit(kitId);
    else if (config.needsProject && projectId !== null) await this.setProject(projectId);
    if (deviceId !== null) await this.loadDevice(deviceId);
    this.render();
  },

  /** 现在显示的还是不是这一次选的项目（换项目换得快时，先发出的请求可能后回来）。 */
  isLatestProject(sequence) {
    return sequence === this.projectSequence;
  },

  /** 表单 → 页面上显示的东西。 */
  render() {
    const form = this.form;
    this.setData({
      projectId: form.projectId,
      toProjectId: form.toProjectId,
      kitNo: form.kitNo,
      devices: form.devices,
      materials: form.materials.map((row) => ({
        materialId: row.materialId,
        label: materialLabel(row),
        unit: row.unit,
        availableText: availableText(form.type, row),
        quantity: row.quantity,
        returned: row.returned,
        lost: row.lost,
        showLost: form.type === "back" && row.kind !== "consumable"
      })),
      hints: deviceNeedHints(form).map((hint) => hint.text),
      counterparty: form.counterparty,
      handoverName: form.handoverName,
      remark: form.remark
    });
  },

  async loadKit(kitId) {
    this.setData({ prefilling: true });
    try {
      const [kit, fulfilment] = await Promise.all([
        whGet(`/kit/${kitId}`),
        whGet(`/kit/${kitId}/fulfilment`)
      ]);
      this.form = prefillFromKit(this.form, kit.data, fulfilment.data);
      this.setData({ kitLocked: true, projectName: kit.data.project_name || "" });
    } catch (error) {
      toast(errorText(error, "清单加载失败"));
    } finally {
      this.setData({ prefilling: false });
    }
  },

  /** 选了项目：返库和转场把这个项目在场的东西整单带出；换项目时先清空。 */
  async setProject(projectId) {
    this.projectSequence = (this.projectSequence || 0) + 1;
    const sequence = this.projectSequence;
    this.form = { ...this.form, projectId, devices: [], materials: [], deviceNeeds: [] };
    // 马上让页面知道选了哪个项目，不等在场清单回来
    this.render();
    if (this.form.type === "out") return;
    this.setData({ prefilling: true });
    try {
      const result = await whGet(`/project/${projectId}/holdings`);
      // 这期间又换了项目：这份在场清单不要了
      if (!this.isLatestProject(sequence)) return;
      this.form = prefillFromHoldings(this.form, result.data);
    } catch (error) {
      if (this.isLatestProject(sequence)) toast(errorText(error, "在场清单加载失败"));
    } finally {
      if (this.isLatestProject(sequence)) this.setData({ prefilling: false });
    }
  },

  async loadDevice(deviceId) {
    try {
      const result = await whGet(`/device/${deviceId}`);
      this.tryAddDevice(result.data);
    } catch (error) {
      toast(errorText(error, "设备加载失败"));
    }
  },

  async onProjectChange(event) {
    const projectId = queryId(event.detail && event.detail.projectId);
    if (projectId === null || this.data.kitLocked || projectId === this.form.projectId) return;
    if (this.form.type === "out") {
      // 发货换项目不动已经加的东西
      this.form = { ...this.form, projectId };
    } else {
      await this.setProject(projectId);
    }
    this.render();
  },

  onToProjectChange(event) {
    const projectId = queryId(event.detail && event.detail.projectId);
    if (projectId === null) return;
    this.form = { ...this.form, toProjectId: projectId };
    this.render();
  },

  removeDeviceTap(event) {
    const id = queryId(event.currentTarget.dataset.id);
    if (id === null) return;
    this.form = removeDevice(this.form, id);
    this.render();
  },

  onDeviceField(event) {
    const id = queryId(event.currentTarget.dataset.id);
    if (id === null) return;
    const value = String((event.detail && event.detail.value) || "");
    this.form = setDeviceField(this.form, id, event.currentTarget.dataset.field, value);
    this.render();
  },

  onQtyInput(event) {
    const id = queryId(event.currentTarget.dataset.id);
    if (id === null) return;
    const value = String((event.detail && event.detail.value) || "");
    this.form = setMaterialQty(this.form, id, event.currentTarget.dataset.field, value);
    this.render();
  },

  removeMaterialTap(event) {
    const id = queryId(event.currentTarget.dataset.id);
    if (id === null) return;
    this.form = removeMaterial(this.form, id);
    this.render();
  },

  onField(event) {
    const field = event.currentTarget.dataset.field;
    if (!TEXT_FIELDS.includes(field)) return;
    this.form = { ...this.form, [field]: String((event.detail && event.detail.value) || "") };
    this.render();
  },

  async submit() {
    // submitted：已经成功、正等着返回上一页，再点不重复提交
    if (this.data.busy || this.submitted) return;
    const form = { ...this.form, photoKeys: this.data.photos.map((photo) => photo.key) };
    const problem = shipProblem(form);
    if (problem) {
      toast(problem);
      return;
    }
    const payload = toDocPayload(form);
    const sent = JSON.stringify(payload);
    this.setData({ busy: true });
    let data;
    try {
      const result = await whSend("POST", "/doc", payload);
      data = (result && result.data) || {};
    } catch (error) {
      // 表单和请求号都留着：再点一次是同一张单，后端不会重复记。
      // 记下这次发的内容：它可能其实已经记上了（超时），之后再改的东西后端不会认。
      if (!this.firstSent) this.firstSent = sent;
      toast(errorText(error, "提交失败，请重试"));
      return;
    } finally {
      this.setData({ busy: false });
    }
    this.submitted = true;
    this.form = { ...this.form, requestId: newRequestId() };
    if (data.replayed && this.firstSent && this.firstSent !== sent) {
      // 后端回的是第一次那张单，这次改的没有记上：必须让人看到，不能当成功带过
      await alertModal({
        title: "有改动没记上",
        content: `${data.doc_no} 上一次其实已经提交成功，之后改的内容没有记上。请到项目页核对，缺的另开一张单。`
      });
      wx.navigateBack();
      return;
    }
    const tasks = Array.isArray(data.created_task_ids) ? data.created_task_ids.length : 0;
    toast(tasks > 0 ? `已提交 ${data.doc_no}，已生成 ${tasks} 个检查任务` : `已提交 ${data.doc_no}`);
    // 让提示露一下再返回
    setTimeout(() => wx.navigateBack(), BACK_DELAY_MS);
  }
});
