/** 设备卡片页的视图模型和单台返库的请求体。纯函数。 */
const { deviceLocationText, formatQty, formatTime, toQty } = require("./wh-format");
const { DEVICE_STATE_THEME, TASK_KIND_LABELS, TASK_STATUS_LABELS } = require("./wh-labels");

/**
 * @param {object} detail GET /warehouse/device/:id 的 data
 * @param {{ is_keeper?: boolean }} caps
 * @param {(userid: string) => string} toUserName
 */
const buildDeviceView = (detail, caps, toUserName) => {
  const keeper = Boolean(caps && caps.is_keeper);
  const alive = detail.state !== "scrapped";
  const usageRecords = Array.isArray(detail.usage_records) ? detail.usage_records : [];
  const total = Number(detail.usage_meters_total || 0);
  return {
    header: {
      code: detail.device_code,
      name: detail.name,
      alias: detail.alias || "",
      stateLabel: detail.state_label,
      stateTheme: DEVICE_STATE_THEME[detail.state] || "default",
      locationText: deviceLocationText(detail),
      categoryName: detail.category_name || "",
      specText: [detail.spec, detail.model].filter(Boolean).join(" · ")
    },
    openTasks: (Array.isArray(detail.open_tasks) ? detail.open_tasks : []).map((task) => ({
      id: task.id,
      title: task.title,
      kindLabel: TASK_KIND_LABELS[task.kind] || "任务",
      statusLabel: TASK_STATUS_LABELS[task.status] || "",
      blocking: Number(task.blocking) === 1
    })),
    timeline: (Array.isArray(detail.events) ? detail.events : []).map((event) => ({
      id: event.id,
      summary: event.summary,
      timeText: formatTime(event.occurred_at),
      operatorName: toUserName(event.operator_userid)
    })),
    usage: {
      rows: usageRecords.map((record) => ({
        projectName: record.project_name || "",
        timeText: formatTime(record.returned_at),
        metersText:
          record.usage_meters === null || record.usage_meters === undefined
            ? "-"
            : `${formatQty(record.usage_meters)} 米`,
        soilType: record.soil_type || ""
      })),
      totalText: total > 0 ? `累计 ${formatQty(total)} 米` : ""
    },
    actions: {
      canReturn: keeper && detail.state === "on_project",
      canShip: keeper && detail.state === "available",
      canNote: keeper && alive,
      canNewTask: keeper && alive
    }
  };
};

/**
 * 单台返库（扫码，点返库，确认）。usageMeters、soilType 是输入框里的字符串。
 * @returns {{ payload: object } | { error: string }}
 */
const buildSingleReturn = (detail, { usageMeters, soilType }, requestId) => {
  if (!detail.current_project_id) return { error: "这台设备不在项目上" };
  const meters = toQty(usageMeters);
  if (Number.isNaN(meters)) return { error: "顶进距离只填数字（米）" };
  const soil = String(soilType || "").trim();
  return {
    payload: {
      doc_type: "back",
      client_request_id: requestId,
      project_id: detail.current_project_id,
      device_lines: [{ device_id: detail.id, usage_meters: meters, soil_type: soil || null }],
      material_lines: []
    }
  };
};

module.exports = { buildDeviceView, buildSingleReturn };
