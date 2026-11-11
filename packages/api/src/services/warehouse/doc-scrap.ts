/** 报废和撤销报废：设备上的动作，各生成一张库房单（scrap / unscrap）。 */
import type { Env } from "../../types/env";
import type { Device } from "../../types/wh";
import { docDeviceEvent, executeDoc, findReplay, insertLine, type WhDocResult } from "./doc-core";
import { parsePhotoKeys, requireClientRequestId } from "./doc-input";
import { badRequest, WarehouseError } from "./errors";
import { assertInBatch } from "./guard";
import { optionalText, requireText } from "./validation";

const loadDevice = async (env: Env, id: number): Promise<Device> => {
  const device = await env.DB.prepare("SELECT * FROM device WHERE id = ?").bind(id).first<Device>();
  if (!device) throw new WarehouseError(404, "设备不存在");
  return device;
};

const header = (
  type: "scrap" | "unscrap",
  projectId: number | null,
  remark: string | null,
  photos: string | null
) => ({
  doc_type: type,
  project_id: projectId,
  to_project_id: null,
  counterparty: null,
  handover_name: null,
  remark,
  photo_keys_json: photos,
  occurred_at: new Date().toISOString(),
  reverses_doc_id: null
});

const deviceLine = (deviceId: number, projectId: number | null) => ({
  device_id: deviceId,
  material_id: null,
  quantity: 1,
  outcome: "normal" as const,
  stock_delta: 0,
  project_id: projectId,
  project_delta: 0,
  usage_meters: null,
  soil_type: null,
  note: null
});

export const scrapDevice = async (
  env: Env,
  deviceId: number,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<WhDocResult> => {
  const crid = requireClientRequestId(input.client_request_id);
  const replay = await findReplay(env, crid);
  if (replay) return replay;
  const device = await loadDevice(env, deviceId);
  const reason = requireText(input.remark, "报废原因", 300);
  const photos = parsePhotoKeys(input.photo_keys, "wh-doc/", "报废照片");
  if (!photos) throw badRequest("请上传报废照片");
  if (device.location === "scrapped") throw new WarehouseError(409, "设备已经报废");
  return executeDoc(env, {
    clientRequestId: crid,
    operatorUserid,
    header: header("scrap", device.current_project_id, reason, photos),
    build: async (now) => [
      assertInBatch(env.DB, "SELECT 1 FROM device WHERE id = ? AND location <> 'scrapped'", [
        deviceId
      ]),
      env.DB.prepare(
        "UPDATE device SET location = 'scrapped', current_project_id = NULL, version = version + 1, updated_at = ? WHERE id = ?"
      ).bind(now, deviceId),
      insertLine(env.DB, crid, deviceLine(deviceId, device.current_project_id), now),
      docDeviceEvent(env.DB, deviceId, "scrapped", crid, `报废：${reason}`, operatorUserid, now)
    ]
  });
};

export const unscrapDevice = async (
  env: Env,
  deviceId: number,
  input: Record<string, unknown>,
  operatorUserid: string
): Promise<WhDocResult> => {
  const crid = requireClientRequestId(input.client_request_id);
  const replay = await findReplay(env, crid);
  if (replay) return replay;
  const device = await loadDevice(env, deviceId);
  if (device.location !== "scrapped") throw new WarehouseError(409, "设备不是报废状态");
  const remark = optionalText(input.remark, "备注", 300);
  return executeDoc(env, {
    clientRequestId: crid,
    operatorUserid,
    header: header("unscrap", null, remark, null),
    build: async (now) => [
      assertInBatch(env.DB, "SELECT 1 FROM device WHERE id = ? AND location = 'scrapped'", [
        deviceId
      ]),
      env.DB.prepare(
        "UPDATE device SET location = 'warehouse', current_project_id = NULL, version = version + 1, updated_at = ? WHERE id = ?"
      ).bind(now, deviceId),
      insertLine(env.DB, crid, deviceLine(deviceId, null), now),
      docDeviceEvent(
        env.DB,
        deviceId,
        "unscrapped",
        crid,
        remark ? `撤销报废：${remark}` : "撤销报废",
        operatorUserid,
        now
      )
    ]
  });
};
