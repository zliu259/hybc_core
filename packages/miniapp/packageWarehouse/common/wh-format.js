/** 库房分包的格式化：数量、时间、设备位置、输入框里的数量。都是纯函数。 */

const BEIJING_OFFSET_MS = 8 * 3600 * 1000;

/**
 * 数量显示：最多 3 位小数，去掉结尾的 0。
 * @param {unknown} value
 * @returns {string}
 */
const formatQty = (value) => {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return "0";
  return String(Math.round(number * 1000) / 1000);
};

/**
 * ISO 时间 → 北京时间 "MM-DD HH:mm"。
 * @param {string | null | undefined} iso
 * @returns {string}
 */
const formatTime = (iso) => {
  if (!iso) return "-";
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "-";
  return new Date(time + BEIJING_OFFSET_MS).toISOString().slice(5, 16).replace("T", " ");
};

/**
 * 北京时间的今天 "YYYY-MM-DD"。
 * @param {Date} [now]
 * @returns {string}
 */
const beijingToday = (now = new Date()) =>
  new Date(now.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);

/**
 * @param {string | null | undefined} dueDate "YYYY-MM-DD"
 * @param {string} today "YYYY-MM-DD"
 */
const isOverdue = (dueDate, today) => Boolean(dueDate) && dueDate < today;

/**
 * 设备在哪。
 * @param {{ location?: string, project_name?: string | null, storage_note?: string | null } | null | undefined} device
 * @returns {string}
 */
const deviceLocationText = (device) => {
  if (!device) return "";
  if (device.location === "scrapped") return "已报废";
  if (device.location === "project") {
    return device.project_name ? `在项目：${device.project_name}` : "在项目";
  }
  return device.storage_note ? `在库 · ${device.storage_note}` : "在库";
};

/**
 * 输入框里的数量：空返回 null；不是非负数、超过 3 位小数返回 NaN。
 * @param {unknown} text
 * @returns {number | null}
 */
const toQty = (text) => {
  if (text === null || text === undefined) return null;
  const trimmed = String(text).trim();
  if (trimmed === "") return null;
  if (!/^\d+(\.\d{1,3})?$/.test(trimmed)) return Number.NaN;
  return Number(trimmed);
};

module.exports = { formatQty, formatTime, beijingToday, isOverdue, deviceLocationText, toQty };
