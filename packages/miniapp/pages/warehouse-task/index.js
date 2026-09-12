const { request } = require("../../utils/request");
const { uploadFileToR2 } = require("../../utils/upload");
const { wxChooseMediaImage } = require("../../utils/wx");

const typeLabelMap = {
  inspection: "检查",
  maintenance: "维护",
  servicing: "保养",
  modification: "改装",
  scrapping: "报废"
};

const statusLabelMap = {
  assigned: "待开始",
  in_progress: "执行中",
  rejected: "退回补充",
  submitted: "已提交"
};

const priorityLabelMap = {
  urgent: "紧急",
  high: "高",
  normal: "普通",
  low: "低"
};

const emptyBuckets = () => ({
  assigned: [],
  in_progress: [],
  rejected: []
});

const buildSegmentItems = (buckets) => [
  { key: "assigned", label: "待开始", count: buckets.assigned.length },
  { key: "in_progress", label: "执行中", count: buckets.in_progress.length },
  { key: "rejected", label: "退回", count: buckets.rejected.length }
];

const parseJsonObject = (value) => {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

Page({
  data: {
    busy: false,
    actionBusy: false,
    photoBusy: false,
    activeSegment: "assigned",
    segmentItems: buildSegmentItems(emptyBuckets()),
    buckets: emptyBuckets(),
    visibleTasks: [],
    totalCount: 0,
    selectedTask: null,
    resultSummary: ""
  },

  onShow() {
    this.loadTasks();
  },

  toShortDate(value) {
    if (!value) return "未排期";
    return String(value).slice(0, 10);
  },

  mapTask(item) {
    const completion = parseJsonObject(item.completion_summary_json);
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    const steps = Array.isArray(item.steps) ? item.steps : [];
    const localEvidence = Array.isArray(item.localEvidence) ? item.localEvidence : [];
    const allEvidence = evidence.concat(localEvidence);
    const photoCount = allEvidence.filter((evidenceItem) => evidenceItem.evidence_type === "photo").length;
    const localPhotoCount = localEvidence.filter((evidenceItem) => evidenceItem.evidence_type === "photo").length;
    return {
      ...item,
      completion,
      evidence,
      steps,
      localEvidence,
      typeText: typeLabelMap[item.work_order_type] || "任务",
      statusText: statusLabelMap[item.status] || "待处理",
      priorityText: priorityLabelMap[item.priority] || "普通",
      scheduledDay: this.toShortDate(item.scheduled_date),
      requiredPhotoCount: Number(item.required_photo_count || 0),
      evidenceCount: allEvidence.length,
      photoCount,
      localPhotoCount,
      canStart: item.status === "assigned",
      canSubmit: ["assigned", "in_progress", "rejected"].includes(item.status),
      manualVersionText: item.manual_version_no ? `第${item.manual_version_no}版` : "",
      manualContent: parseJsonObject(item.manual_content_json || item.manual_content)
    };
  },

  buildBuckets(rows) {
    const buckets = emptyBuckets();
    (rows || []).map((item) => this.mapTask(item)).forEach((item) => {
      if (buckets[item.status]) {
        buckets[item.status].push(item);
      }
    });
    return buckets;
  },

  refreshVisibleTasks(buckets = this.data.buckets, activeSegment = this.data.activeSegment) {
    this.setData({
      buckets,
      activeSegment,
      segmentItems: buildSegmentItems(buckets),
      totalCount: buckets.assigned.length + buckets.in_progress.length + buckets.rejected.length,
      visibleTasks: buckets[activeSegment] || []
    });
  },

  async loadTasks() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const res = await request({ method: "GET", path: "/api/v1/warehouse/work-order/mobile/my-tasks" });
      const rows = Array.isArray(res.data) ? res.data : [];
      this.refreshVisibleTasks(this.buildBuckets(rows));
    } catch (error) {
      wx.showToast({ title: error.message || "任务加载失败", icon: "none" });
      this.refreshVisibleTasks(emptyBuckets());
    } finally {
      this.setData({ busy: false });
    }
  },

  onSegmentChange(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeSegment) return;
    this.refreshVisibleTasks(this.data.buckets, key);
  },

  onResultInput(e) {
    this.setData({ resultSummary: e.detail.value });
  },

  async openTask(e) {
    const id = Number(e.currentTarget.dataset.id || 0);
    if (!id || this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    try {
      await this.loadTaskDetail(id);
    } catch (error) {
      wx.showToast({ title: error.message || "任务详情加载失败", icon: "none" });
    } finally {
      this.setData({ actionBusy: false });
    }
  },

  closeTask() {
    this.setData({
      selectedTask: null,
      resultSummary: ""
    });
  },

  noop() {},

  async loadTaskDetail(id) {
    const res = await request({ method: "GET", path: `/api/v1/warehouse/work-order/mobile/task/${id}` });
    const task = this.mapTask(res.data || {});
    this.setData({
      selectedTask: task,
      resultSummary: task.result_summary || ""
    });
  },

  async startTask() {
    const task = this.data.selectedTask;
    if (!task || !task.id || this.data.actionBusy) return;
    this.setData({ actionBusy: true });
    try {
      await request({ method: "POST", path: `/api/v1/warehouse/work-order/mobile/task/${task.id}/start` });
      wx.showToast({ title: "已开始", icon: "success" });
      await this.loadTaskDetail(task.id);
      await this.loadTasks();
    } catch (error) {
      wx.showToast({ title: error.message || "开始失败", icon: "none" });
    } finally {
      this.setData({ actionBusy: false });
    }
  },

  async pickEvidencePhoto() {
    const task = this.data.selectedTask;
    if (!task || !task.id || this.data.photoBusy) return;
    this.setData({ photoBusy: true });
    try {
      const choose = await wxChooseMediaImage({ count: 1 });
      const picked = choose && choose.tempFiles && choose.tempFiles[0] ? choose.tempFiles[0] : null;
      const filePath = picked ? picked.tempFilePath || picked.path : "";
      if (!filePath) return;
      const signed = await uploadFileToR2(filePath, {
        category: "warehouse-task",
        fileName: picked.fileName || picked.name,
        debugContext: "warehouse-task-evidence"
      });
      const localEvidence = (task.localEvidence || []).concat([
        {
          evidence_type: "photo",
          file_key: signed.key,
          file_name: picked.fileName || picked.name || "现场照片",
          summary: "现场执行照片",
          captured_at: new Date().toISOString()
        }
      ]);
      const selectedTask = this.mapTask({ ...task, localEvidence });
      this.setData({ selectedTask });
      wx.showToast({ title: "照片已加入", icon: "success" });
    } catch (error) {
      wx.showToast({ title: error.message || "上传失败", icon: "none" });
    } finally {
      this.setData({ photoBusy: false });
    }
  },

  async submitTask() {
    const task = this.data.selectedTask;
    if (!task || !task.id || this.data.actionBusy) return;
    const localEvidence = task.localEvidence || [];
    const photoCount = localEvidence.filter((item) => item.evidence_type === "photo").length;
    if (task.requiredPhotoCount > 0 && photoCount < task.requiredPhotoCount) {
      wx.showToast({ title: `至少上传${task.requiredPhotoCount}张照片`, icon: "none" });
      return;
    }
    this.setData({ actionBusy: true });
    try {
      await request({
        method: "POST",
        path: `/api/v1/warehouse/work-order/mobile/task/${task.id}/submit`,
        data: {
          result_summary: this.data.resultSummary || "",
          completion_summary_json: JSON.stringify({
            submitted_from: "miniapp",
            submitted_at: new Date().toISOString(),
            local_photo_count: photoCount
          }),
          evidence: localEvidence
        }
      });
      wx.showToast({ title: "已提交", icon: "success" });
      this.closeTask();
      await this.loadTasks();
    } catch (error) {
      wx.showToast({ title: error.message || "提交失败", icon: "none" });
    } finally {
      this.setData({ actionBusy: false });
    }
  }
});
