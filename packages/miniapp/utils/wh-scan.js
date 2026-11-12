/** 设备二维码：内容是 HYBC:D:<设备编号>。库房 tab 页和库房分包都用。 */
const { request } = require("./request");
const { wxScanCode } = require("./wx");

const DEVICE_CODE_PREFIX = "HYBC:D:";

/**
 * 扫到的文字 → 设备编号。只认 HYBC:D: 前缀（不分大小写）。
 * @param {unknown} text
 * @returns {{ ok: true, code: string } | { ok: false, message: string }}
 */
const parseDeviceCode = (text) => {
  const value = typeof text === "string" ? text.trim() : "";
  const code = value.toUpperCase().startsWith(DEVICE_CODE_PREFIX)
    ? value.slice(DEVICE_CODE_PREFIX.length).trim()
    : "";
  return code ? { ok: true, code } : { ok: false, message: "不是设备码" };
};

const isScanCancelled = (error) =>
  /cancel/i.test(String((error && (error.errMsg || error.message)) || ""));

/**
 * 按编号精确查一台设备。查不到时报"没有这台设备：<编号>"。
 * @param {string} code
 */
const findDeviceByCode = async (code) => {
  try {
    const result = await request({
      method: "GET",
      path: `/api/v1/warehouse/device/by-code/${encodeURIComponent(code)}`
    });
    return result.data;
  } catch (error) {
    if (Number(error && error.__statusCode) === 404) throw new Error(`没有这台设备：${code}`);
    throw error;
  }
};

/**
 * 打开扫一扫并查出设备。用户取消返回 null；其余失败抛出带中文 message 的错误。
 * @returns {Promise<object | null>}
 */
const scanDevice = async () => {
  let scanned;
  try {
    scanned = await wxScanCode();
  } catch (error) {
    if (isScanCancelled(error)) return null;
    throw new Error("扫码失败，请重试");
  }
  const parsed = parseDeviceCode(scanned && scanned.result);
  if (!parsed.ok) throw new Error(parsed.message);
  return findDeviceByCode(parsed.code);
};

module.exports = { DEVICE_CODE_PREFIX, parseDeviceCode, findDeviceByCode, scanDevice };
