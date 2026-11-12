/** 库房设置：存在 system_config 表里，三个键。 */
import type { Env } from "../../types/env";
import { getSystemConfig, setSystemConfig } from "../system-config";
import { badRequest } from "./errors";
import { optionalNumber, optionalText } from "./validation";

const KEY_INSPECTOR = "warehouse.default_inspector_userid";
const KEY_PHOTO_COUNT = "warehouse.return_inspection_photo_count";
const KEY_NOTIFY = "warehouse.notify_enabled";
const DEFAULT_PHOTO_COUNT = 3;

export interface WarehouseSettings {
  default_inspector_userid: string | null;
  return_inspection_photo_count: number;
  /** 企微通知总开关。卡片点开的页面只在新版小程序里有，所以默认关。 */
  notify_enabled: boolean;
}

export const getWarehouseSettings = async (env: Env): Promise<WarehouseSettings> => {
  const [inspector, photoCount, notify] = await Promise.all([
    getSystemConfig(env, KEY_INSPECTOR),
    getSystemConfig(env, KEY_PHOTO_COUNT),
    getSystemConfig(env, KEY_NOTIFY)
  ]);
  const parsedCount = photoCount === null ? Number.NaN : Number(photoCount);
  return {
    default_inspector_userid: inspector,
    return_inspection_photo_count:
      Number.isInteger(parsedCount) && parsedCount >= 0 && parsedCount <= 9
        ? parsedCount
        : DEFAULT_PHOTO_COUNT,
    notify_enabled: notify === "1"
  };
};

export const saveWarehouseSettings = async (
  env: Env,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<WarehouseSettings> => {
  if ("default_inspector_userid" in input) {
    const inspector = optionalText(input.default_inspector_userid, "默认检查人", 64);
    await setSystemConfig(env, KEY_INSPECTOR, inspector ?? "", operatorUserid);
  }
  if ("return_inspection_photo_count" in input) {
    const count = optionalNumber(input.return_inspection_photo_count, "返库检查照片数", {
      min: 0,
      max: 9,
      integer: true
    });
    if (count === null) throw badRequest("返库检查照片数不能为空");
    await setSystemConfig(env, KEY_PHOTO_COUNT, String(count), operatorUserid);
  }
  if ("notify_enabled" in input) {
    if (typeof input.notify_enabled !== "boolean") throw badRequest("通知开关只能是开或关");
    await setSystemConfig(env, KEY_NOTIFY, input.notify_enabled ? "1" : "0", operatorUserid);
  }
  return getWarehouseSettings(env);
};
