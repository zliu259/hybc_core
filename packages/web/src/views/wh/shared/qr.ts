/** 设备二维码内容：HYBC:D:<设备编号>。小程序扫码只认这个前缀。 */
const PREFIX = "HYBC:D:";

export const deviceQrPayload = (deviceCode: string): string =>
  `${PREFIX}${deviceCode}`;

export const parseDeviceQr = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed.startsWith(PREFIX)) return null;
  const code = trimmed.slice(PREFIX.length).trim();
  return code || null;
};
