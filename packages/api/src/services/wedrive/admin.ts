/**
 * 微盘镜像的管理动作：看状态、初始化空间、开关、恢复、对全公司开放、重试。
 * 这里会直接调微盘的只有两处（建空间、给空间加成员），都经过 WedriveClient，照样计数、认限额。
 */
import type { Env } from "../../types/env";
import type { DocMirrorStatus } from "../../types/wh";
import { IS_LATEST } from "../doc-library/query";
import { badRequest, WarehouseError } from "../warehouse/errors";
import { createWedriveClient, type WedriveClient } from "./client";
import { kickMirrorDrain, markForMirror } from "./mirror-run";
import { getCallCount, getWedriveSettings, mirrorActive, saveWedriveSetting } from "./settings";

export interface WedriveStatus {
  initialized: boolean;
  enabled: boolean;
  space_open: boolean;
  paused_reason: string | null;
  /** 只数应该在微盘里的资料：没删、是最新版 */
  counts: Record<DocMirrorStatus, number>;
  calls_this_month: number;
  monthly_budget: number;
  mirror_max_mb: number;
}

export interface AdminDeps {
  client?: WedriveClient;
  now?: () => Date;
}

export const WEDRIVE_SPACE_NAME = "设备资料库";
const MB = 1024 * 1024;
const NOT_INITIALIZED = "微盘空间还没初始化";

const EMPTY_COUNTS: Record<DocMirrorStatus, number> = {
  pending: 0,
  syncing: 0,
  synced: 0,
  failed: 0,
  skipped: 0
};

const isMirrorStatus = (value: string): value is DocMirrorStatus => value in EMPTY_COUNTS;

const countByStatus = async (env: Env): Promise<Record<DocMirrorStatus, number>> => {
  const rows = await env.DB.prepare(
    `SELECT f.mirror_status AS status, COUNT(*) AS n FROM doc_file f
      WHERE f.deleted_at IS NULL AND ${IS_LATEST} GROUP BY f.mirror_status`
  ).all<{ status: string; n: number }>();
  return (rows.results ?? []).reduce(
    (counts, row) =>
      isMirrorStatus(row.status) ? { ...counts, [row.status]: Number(row.n) } : counts,
    EMPTY_COUNTS
  );
};

export const getWedriveStatus = async (
  env: Env,
  now: Date = new Date()
): Promise<WedriveStatus> => {
  const [settings, counts, calls] = await Promise.all([
    getWedriveSettings(env),
    countByStatus(env),
    getCallCount(env, now)
  ]);
  return {
    initialized: settings.space_id !== null,
    enabled: settings.enabled,
    space_open: settings.space_open,
    paused_reason: settings.paused_reason,
    counts,
    calls_this_month: calls,
    monthly_budget: settings.monthly_budget,
    mirror_max_mb: Math.round(settings.mirror_max_bytes / MB)
  };
};

/** 建一个没有成员的空间，记下空间 ID，把镜像打开，触发一次排空。 */
export const setupWedrive = async (
  env: Env,
  userid: string,
  deps: AdminDeps = {}
): Promise<WedriveStatus> => {
  if ((await getWedriveSettings(env)).space_id !== null) {
    throw new WarehouseError(409, "微盘空间已经建过了");
  }
  const client = deps.client ?? createWedriveClient(env, deps.now ? { now: deps.now } : {});
  const spaceId = await client.createSpace(WEDRIVE_SPACE_NAME);
  await saveWedriveSetting(
    env,
    { space_id: spaceId, enabled: true, space_open: false, paused_reason: null },
    userid
  );
  await kickMirrorDrain(env);
  return getWedriveStatus(env, deps.now?.());
};

/** { enabled?: boolean, resume?: true }：开关镜像；resume 清掉暂停原因。之后镜像能跑的话触发一次排空。 */
export const updateWedriveSettings = async (
  env: Env,
  input: Record<string, unknown>,
  userid: string
): Promise<WedriveStatus> => {
  const { enabled, resume } = input;
  if (enabled === undefined && resume === undefined) throw badRequest("没有要改的内容");
  if (enabled !== undefined && typeof enabled !== "boolean") throw badRequest("开关只能是开或关");
  if (resume !== undefined && resume !== true) throw badRequest("恢复只能传 true");
  if ((await getWedriveSettings(env)).space_id === null) {
    throw new WarehouseError(409, NOT_INITIALIZED);
  }
  const saved = await saveWedriveSetting(
    env,
    {
      ...(typeof enabled === "boolean" ? { enabled } : {}),
      ...(resume === true ? { paused_reason: null } : {})
    },
    userid
  );
  if (mirrorActive(saved)) await kickMirrorDrain(env);
  return getWedriveStatus(env);
};

/** 把公司根部门加为只能下载的成员。之后新传的文件一律走分块上传（不推卡片）。 */
export const openWedriveSpace = async (
  env: Env,
  userid: string,
  deps: AdminDeps = {}
): Promise<WedriveStatus> => {
  const settings = await getWedriveSettings(env);
  if (settings.space_id === null) throw new WarehouseError(409, NOT_INITIALIZED);
  if (settings.space_open) throw new WarehouseError(409, "已经对全公司开放过了");
  const counts = await countByStatus(env);
  const unfinished = counts.pending + counts.syncing;
  if (unfinished > 0) {
    throw new WarehouseError(409, `还有 ${unfinished} 份资料没镜像完，等它们完成再开放`);
  }
  const client = deps.client ?? createWedriveClient(env, deps.now ? { now: deps.now } : {});
  await client.openSpaceToCompany(settings.space_id);
  await saveWedriveSetting(env, { space_open: true }, userid);
  return getWedriveStatus(env, deps.now?.());
};

/** 把失败的全部标回待镜像（次数清零）并触发排空。返回标了多少份。 */
export const retryFailedMirrors = async (env: Env): Promise<{ requeued: number }> => {
  const settings = await getWedriveSettings(env);
  if (settings.space_id === null) throw new WarehouseError(409, NOT_INITIALIZED);
  const result = await env.DB.prepare(
    `UPDATE doc_file SET mirror_status = 'pending', mirror_attempts = 0, mirror_error = NULL
      WHERE mirror_status = 'failed'`
  ).run();
  const requeued = Number(result.meta?.changes ?? 0);
  if (requeued > 0 && mirrorActive(settings)) await kickMirrorDrain(env);
  return { requeued };
};

/** 把一份资料重新对一遍（跳过的、失败的、看着不对的）。 */
export const remirrorDoc = async (env: Env, id: number): Promise<void> => {
  const doc = await env.DB.prepare("SELECT id FROM doc_file WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<{ id: number }>();
  if (!doc) throw new WarehouseError(404, "资料不存在");
  if ((await getWedriveSettings(env)).space_id === null) {
    throw new WarehouseError(409, NOT_INITIALIZED);
  }
  await markForMirror(env, [id]);
};
