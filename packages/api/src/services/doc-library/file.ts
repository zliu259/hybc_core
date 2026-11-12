/** 改资料信息、删除（软删除）、取查看地址。 */
import type { Env } from "../../types/env";
import type { DocFile } from "../../types/wh";
import { runAtomicBatch } from "../db-transaction";
import { isInlineType } from "../object-serve";
import { buildSignedObjectUrl, getUploadBaseUrl, signObjectAccess } from "../upload-signature";
import { WarehouseError } from "../warehouse/errors";
import { assertInBatch, releaseGuards } from "../warehouse/guard";
import { requireVersion } from "../warehouse/kit-template";
import { LATEST_DOC_EXISTS_SQL, parseDocMeta } from "./upload";

const URL_TTL_MS = 15 * 60 * 1000;
/** 这一行还在、版本没变。绑定两个参数：id、version。 */
const UNCHANGED_SQL = "SELECT 1 FROM doc_file WHERE id = ? AND version = ? AND deleted_at IS NULL";

const nowIso = () => new Date().toISOString();

/** 没删除的那一行；不存在或已删除报 404。 */
const loadDoc = async (env: Env, id: number): Promise<DocFile> => {
  const row = await env.DB.prepare("SELECT * FROM doc_file WHERE id = ? AND deleted_at IS NULL")
    .bind(id)
    .first<DocFile>();
  if (!row) throw new WarehouseError(404, "资料不存在");
  return row;
};

const assertLatest = async (env: Env, id: number, message: string): Promise<void> => {
  const latest = await env.DB.prepare(LATEST_DOC_EXISTS_SQL).bind(id).first();
  if (!latest) throw new WarehouseError(409, message);
};

/** 改标题、资料类别、归属、有效期。文件本身不能改，要换文件走替换。 */
export const updateDocFile = async (
  env: Env,
  id: number,
  input: Record<string, unknown>
): Promise<void> => {
  const version = requireVersion(input.version);
  await loadDoc(env, id);
  await assertLatest(env, id, "旧版本不能修改");
  const meta = await parseDocMeta(env, input);
  await runAtomicBatch(env.DB, [
    assertInBatch(env.DB, UNCHANGED_SQL, [id, version]),
    // 前面查过是最新版，但查和写之间别人可能正好把它替换了
    assertInBatch(env.DB, LATEST_DOC_EXISTS_SQL, [id]),
    env.DB.prepare(
      `UPDATE doc_file SET title = ?, doc_category = ?, device_id = ?, device_category_id = ?,
         valid_until = ?, version = version + 1, updated_at = ?
       WHERE id = ?`
    ).bind(
      meta.title,
      meta.docCategory,
      meta.deviceId,
      meta.deviceCategoryId,
      meta.validUntil,
      nowIso(),
      id
    ),
    releaseGuards(env.DB)
  ]);
};

/**
 * 软删除最新版，它的对外链接一并作废。旧版本留着：删掉新版后，上一版重新成为最新版。
 * 只能删最新版：删中间的版本会让更早的一版和最新版同时出现在列表里。
 */
export const deleteDocFile = async (
  env: Env,
  id: number,
  input: Record<string, unknown>,
  userid: string
): Promise<void> => {
  const version = requireVersion(input.version);
  await loadDoc(env, id);
  await assertLatest(env, id, "旧版本不能删除，只能删除最新版");
  const now = nowIso();
  await runAtomicBatch(env.DB, [
    assertInBatch(env.DB, UNCHANGED_SQL, [id, version]),
    // 写的那一刻还得是最新版：和别人的替换撞上时，不能把中间这一版删掉、让前后两版都显示成最新
    assertInBatch(env.DB, LATEST_DOC_EXISTS_SQL, [id]),
    env.DB.prepare(
      `UPDATE doc_file SET deleted_at = ?, deleted_by_userid = ?, version = version + 1, updated_at = ?
       WHERE id = ?`
    ).bind(now, userid, now, id),
    env.DB.prepare(
      "UPDATE doc_share SET revoked_at = ? WHERE doc_file_id = ? AND revoked_at IS NULL"
    ).bind(now, id),
    releaseGuards(env.DB)
  ]);
};

export interface DocFileUrl {
  url: string;
  expires_at: string;
  file_name: string;
  content_type: string;
  file_size: number;
  /** 能不能直接在页面里显示（PDF、图片、视频） */
  inline: boolean;
}

/** 15 分钟有效的查看地址。被替换的旧版本也能取（历史版本要能看），已删除的不行。 */
export const getDocFileUrl = async (
  env: Env,
  id: number,
  requestUrl: string
): Promise<DocFileUrl> => {
  const doc = await loadDoc(env, id);
  const expiresAt = Date.now() + URL_TTL_MS;
  const signature = await signObjectAccess(
    env.UPLOAD_SIGNING_SECRET,
    doc.file_key,
    expiresAt,
    "get"
  );
  const signed = buildSignedObjectUrl(
    doc.file_key,
    expiresAt,
    signature,
    getUploadBaseUrl(env, requestUrl)
  );
  return {
    // filename 不在签名里：它只决定下载时显示的名字
    url: `${signed}&filename=${encodeURIComponent(doc.file_name)}`,
    expires_at: new Date(expiresAt).toISOString(),
    file_name: doc.file_name,
    content_type: doc.content_type,
    file_size: Number(doc.file_size),
    inline: isInlineType(doc.content_type)
  };
};
