/**
 * 「我的车辆记录」（油卡申请 + 车辆保养）的视图模型：列表卡片和详情页要显示什么。不碰接口和 wx。
 * 放在分包里，主包不背这份代码。
 */
const { formatAmount } = require("../../utils/amount-cn");
const { formatBeijingTime, withFileSizeText } = require("../../utils/approval-detail-view");
const { parseQueryAttachments } = require("../../utils/attachment-open");
const { toUserName } = require("../../utils/user-names");

/** 文案和提交页（fuel-apply）一致 */
const FUEL_STATUS = {
  pending: { label: "待办公室处理", theme: "primary" },
  needs_info: { label: "待补充资料", theme: "warning" },
  processed: { label: "已通过", theme: "success" },
  rejected: { label: "已拒绝", theme: "danger" },
  cancelled: { label: "已废除", theme: "default" }
};

const MAINTENANCE_STATUS = {
  active: { label: "有效", theme: "success" },
  voided: { label: "已作废", theme: "default" }
};

const FUEL_STATUS_FILTERS = [{ label: "全部状态", value: "" }].concat(
  Object.keys(FUEL_STATUS).map((value) => ({ label: FUEL_STATUS[value].label, value }))
);

const MAINTENANCE_STATUS_FILTERS = [{ label: "全部状态", value: "" }].concat(
  Object.keys(MAINTENANCE_STATUS).map((value) => ({ label: MAINTENANCE_STATUS[value].label, value }))
);

const statusOf = (table, status) =>
  (typeof status === "string" && Object.prototype.hasOwnProperty.call(table, status)
    ? table[status]
    : { label: "未知状态", theme: "default" });

const asText = (value) => (typeof value === "string" ? value.trim() : "");

const hasNumber = (value) =>
  value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

const yuanText = (value) => (hasNumber(value) ? `${formatAmount(value)} 元` : "-");

/** 不用 toLocaleString：部分机型的 JS 引擎不带完整 Intl */
const kmText = (value) => {
  if (!hasNumber(value)) return "-";
  const rounded = String(Math.round(Number(value) * 10) / 10);
  const [whole, fraction] = rounded.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${fraction ? `${grouped}.${fraction}` : grouped} km`;
};

/** 精确到分钟，列表和详情都按北京时间显示 */
const minuteText = (value) => {
  const text = formatBeijingTime(value);
  return text === "-" ? "-" : String(text).slice(0, 16);
};

/** 保养日期多是选择器给的「YYYY-MM-DD」，也可能是完整时间 */
const dayText = (value) => {
  const text = asText(value);
  if (!text) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return String(formatBeijingTime(text)).slice(0, 10);
};

const vehicleText = (row) => {
  const plate = asText(row.current_plate_no) || "-";
  const model = asText(row.vehicle_model);
  return model ? `${plate} · ${model}` : plate;
};

/** 只留有值的行，详情里不出现一排「-」 */
const factRows = (rows) => rows.filter((row) => row.value && row.value !== "-");

// ── 油卡申请 ──

/**
 * @param {Record<string, any>} row GET /fleet/fuel-applications 的一行
 */
const buildFuelCard = (row) => {
  const status = statusOf(FUEL_STATUS, row.status);
  return {
    id: row.id,
    title: asText(row.application_no) || `油卡申请 ${row.id}`,
    statusLabel: status.label,
    statusTheme: status.theme,
    amountText: yuanText(row.requested_amount),
    amountEmpty: !hasNumber(row.requested_amount),
    metaText: [asText(row.current_plate_no) || "-", kmText(row.vehicle_mileage_km)].join(" ｜ "),
    timeText: `申请于 ${minuteText(row.requested_at)}`,
    noteText: row.status === "needs_info" ? asText(row.needs_info_reason) : ""
  };
};

const parsePhotoKeys = (raw) =>
  parseQueryAttachments(raw).map((item, index) => ({
    file_key: item.file_key,
    file_url: item.file_url,
    // R2 key 里的文件名是微信临时文件名，对人没意义
    file_name: `现场照片 ${index + 1}`,
    // 打开时按扩展名决定走图片预览；提交页只收图片，统一按图片打开
    openName: `现场照片 ${index + 1}.jpg`,
    extLabel: "图片",
    sizeText: ""
  }));

/**
 * @param {Record<string, any>} row GET /fleet/fuel-applications/:id
 * @param {Record<string, string>} userNames userid → 姓名
 */
const buildFuelDetail = (row, userNames) => {
  const status = statusOf(FUEL_STATUS, row.status);
  const supplementCount = Number(row.supplement_count || 0);
  // 补充资料重新提交后回到 pending，但上一轮「要求补充」的处理人、时间、备注还留在行上，不能当成已处理
  const handled = row.status !== "pending" && Boolean(row.processed_at);
  const needsInfoReason = row.status === "needs_info" ? asText(row.needs_info_reason) : "";
  // 要求补充时后端默认把原因也写进办公室备注，上面已经显示过就不重复
  const officeRemark = asText(row.office_remark);
  return {
    id: row.id,
    status: row.status,
    serialNo: asText(row.application_no) || String(row.id),
    statusLabel: status.label,
    statusTheme: status.theme,
    amountText: hasNumber(row.requested_amount) ? formatAmount(row.requested_amount) : "-",
    facts: factRows([
      { label: "车辆", value: vehicleText(row) },
      { label: "油卡", value: asText(row.card_no) || "-" },
      { label: "里程", value: kmText(row.vehicle_mileage_km) },
      { label: "申请时间", value: minuteText(row.requested_at) },
      {
        label: "补充次数",
        value:
          supplementCount > 0
            ? `${supplementCount} 次（最近 ${minuteText(row.resubmitted_at)}）`
            : ""
      }
    ]),
    needsInfoReason,
    handled,
    handleFacts: handled
      ? factRows([
          { label: "处理人", value: toUserName(row.processed_by_userid, userNames, "办公室") },
          { label: "处理时间", value: minuteText(row.processed_at) },
          { label: "办公室备注", value: officeRemark === needsInfoReason ? "" : officeRemark },
          {
            label: "处理后余额",
            value: hasNumber(row.latest_card_balance) ? yuanText(row.latest_card_balance) : ""
          }
        ])
      : [],
    riskSummary: asText(row.risk_summary),
    photos: parsePhotoKeys(row.photo_keys_json),
    canResubmit: row.status === "needs_info"
  };
};

// ── 车辆保养 ──

/** @param {Array<{dict_value: string, dict_label: string}>} types */
const buildTypeMap = (types) =>
  (Array.isArray(types) ? types : []).reduce(
    (acc, item) =>
      item && item.dict_value ? { ...acc, [item.dict_value]: item.dict_label || item.dict_value } : acc,
    {}
  );

const typeLabelOf = (typeMap, value) => typeMap[value] || asText(value) || "-";

/**
 * @param {Record<string, any>} row GET /fleet/maintenance 的一行
 * @param {Record<string, string>} typeMap 保养类型字典
 */
const buildMaintenanceCard = (row, typeMap) => {
  const status = statusOf(MAINTENANCE_STATUS, row.status);
  return {
    id: row.id,
    title: asText(row.record_no) || `保养记录 ${row.id}`,
    statusLabel: status.label,
    statusTheme: status.theme,
    amountText: hasNumber(row.cost) ? yuanText(row.cost) : "未填费用",
    amountEmpty: !hasNumber(row.cost),
    metaText: [
      asText(row.current_plate_no) || "-",
      typeLabelOf(typeMap, row.maintenance_type),
      kmText(row.mileage_km)
    ].join(" ｜ "),
    timeText: `保养日期 ${dayText(row.serviced_at)}`,
    noteText: ""
  };
};

/**
 * @param {Record<string, any>} row GET /fleet/maintenance/:id
 * @param {Record<string, string>} typeMap
 */
const buildMaintenanceDetail = (row, typeMap) => {
  const status = statusOf(MAINTENANCE_STATUS, row.status);
  const voided = row.status === "voided";
  return {
    id: row.id,
    status: row.status,
    serialNo: asText(row.record_no) || String(row.id),
    statusLabel: status.label,
    statusTheme: status.theme,
    amountText: hasNumber(row.cost) ? formatAmount(row.cost) : "-",
    facts: factRows([
      { label: "车辆", value: vehicleText(row) },
      { label: "保养类型", value: typeLabelOf(typeMap, row.maintenance_type) },
      { label: "里程", value: kmText(row.mileage_km) },
      { label: "保养日期", value: dayText(row.serviced_at) },
      // 和提交页的字段名一致；放不下「保养人/修理厂」，标签栏会折行
      { label: "保养人", value: asText(row.service_provider) },
      { label: "提交时间", value: minuteText(row.created_at) }
    ]),
    content: asText(row.content),
    remark: asText(row.remark),
    voided,
    voidFacts: voided
      ? factRows([
          { label: "作废时间", value: minuteText(row.voided_at) },
          { label: "作废原因", value: asText(row.void_reason) || "未填写" }
        ])
      : [],
    attachments: withFileSizeText(parseQueryAttachments(row.attachments_json))
  };
};

module.exports = {
  FUEL_STATUS_FILTERS,
  MAINTENANCE_STATUS_FILTERS,
  buildFuelCard,
  buildFuelDetail,
  buildMaintenanceCard,
  buildMaintenanceDetail,
  buildTypeMap
};
