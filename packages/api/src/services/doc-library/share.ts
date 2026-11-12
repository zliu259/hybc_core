/** 对外链接：生成、列出、作废，以及公开下载时认令牌。 */
import type { Env } from "../../types/env";
import type { DocFile, DocShare } from "../../types/wh";
import { runAtomicBatch } from "../db-transaction";
import { getUploadBaseUrl } from "../upload-signature";
import { badRequest, WarehouseError } from "../warehouse/errors";
import { assertInBatch, releaseGuards } from "../warehouse/guard";
import { LATEST_DOC_EXISTS_SQL } from "./upload";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 30;
/** 32 个随机字节的 base64url，正好 43 个字符。 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface DocShareRow extends DocShare {
  url: string;
  /** 没作废、没过期 */
  active: boolean;
}

export type SharedFile = Pick<DocFile, "file_key" | "file_name" | "content_type">;

const nowIso = () => new Date().toISOString();

const newToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const parseDays = (value: unknown): number => {
  if (value === undefined) return DEFAULT_DAYS;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_DAYS) {
    throw badRequest(`有效天数要填 1 到 ${MAX_DAYS} 的整数`);
  }
  return value;
};

const toRow = (share: DocShare, baseUrl: string, now: string): DocShareRow => ({
  ...share,
  access_count: Number(share.access_count),
  url: `${baseUrl}/api/v1/doc-library/shared/${share.token}`,
  active: share.revoked_at === null && share.expires_at > now
});

const assertDocExists = async (env: Env, fileId: number): Promise<void> => {
  const row = await env.DB.prepare("SELECT 1 FROM doc_file WHERE id = ? AND deleted_at IS NULL")
    .bind(fileId)
    .first();
  if (!row) throw new WarehouseError(404, "资料不存在");
};

/**
 * 给一个文件生成对外链接。input.days 是有效天数，1 到 30，不填是 7。
 * 只能给最新版生成：被替换的旧文件多半有问题，不该再往外发。
 */
export const createDocShare = async (
  env: Env,
  fileId: number,
  input: Record<string, unknown>,
  userid: string,
  requestUrl: string
): Promise<DocShareRow> => {
  const days = parseDays(input.days);
  await assertDocExists(env, fileId);
  const latest = await env.DB.prepare(LATEST_DOC_EXISTS_SQL).bind(fileId).first();
  if (!latest) throw new WarehouseError(409, "旧版本不能生成对外链接");

  const token = newToken();
  const now = new Date();
  await runAtomicBatch(env.DB, [
    // 写链接的那一刻文件必须还是最新版：和替换、删除撞在一起时不留下指向旧文件的有效链接
    assertInBatch(env.DB, LATEST_DOC_EXISTS_SQL, [fileId]),
    env.DB.prepare(
      `INSERT INTO doc_share (token, doc_file_id, expires_at, created_by_userid, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      token,
      fileId,
      new Date(now.getTime() + days * DAY_MS).toISOString(),
      userid,
      now.toISOString()
    ),
    releaseGuards(env.DB)
  ]);
  const share = await env.DB.prepare("SELECT * FROM doc_share WHERE token = ?")
    .bind(token)
    .first<DocShare>();
  if (!share) throw new Error("doc_share row missing right after insert");
  return toRow(share, getUploadBaseUrl(env, requestUrl), now.toISOString());
};

/** 一个文件的全部链接，新的在前；作废的、过期的也列出来。 */
export const listDocShares = async (
  env: Env,
  fileId: number,
  requestUrl: string
): Promise<DocShareRow[]> => {
  await assertDocExists(env, fileId);
  const result = await env.DB.prepare(
    "SELECT * FROM doc_share WHERE doc_file_id = ? ORDER BY created_at DESC, id DESC"
  )
    .bind(fileId)
    .all<DocShare>();
  const baseUrl = getUploadBaseUrl(env, requestUrl);
  const now = nowIso();
  return (result.results ?? []).map((share) => toRow(share, baseUrl, now));
};

/** 作废一个链接。已经作废的再作废一次不报错，作废时间保持第一次的。 */
export const revokeDocShare = async (env: Env, token: string): Promise<void> => {
  const share = await env.DB.prepare("SELECT 1 FROM doc_share WHERE token = ?").bind(token).first();
  if (!share) throw new WarehouseError(404, "链接不存在");
  await env.DB.prepare("UPDATE doc_share SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL")
    .bind(nowIso(), token)
    .run();
};

/**
 * 公开下载用：链接有效就把访问次数加一并返回文件，否则返回 null（调用方一律回「链接已失效」，不说原因）。
 * 有效 = 没作废、没过期、文件没删除而且还是最新版。一条 UPDATE 里判断，按改到的行数算，不先查再改。
 */
export const openDocShare = async (env: Env, token: string): Promise<SharedFile | null> => {
  if (!TOKEN_PATTERN.test(token)) return null;
  const result = await env.DB.prepare(
    `UPDATE doc_share SET access_count = access_count + 1
     WHERE token = ? AND revoked_at IS NULL AND expires_at > ?
       AND EXISTS (
         SELECT 1 FROM doc_file f
         WHERE f.id = doc_share.doc_file_id AND f.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM doc_file n WHERE n.supersedes_id = f.id AND n.deleted_at IS NULL
           )
       )`
  )
    .bind(token, nowIso())
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) return null;
  return env.DB.prepare(
    `SELECT f.file_key, f.file_name, f.content_type
     FROM doc_share s JOIN doc_file f ON f.id = s.doc_file_id
     WHERE s.token = ?`
  )
    .bind(token)
    .first<SharedFile>();
};
