/**
 * 资料的分片上传：初始化 → 逐片上传 → 完成（核对大小后落库）。
 * R2 和 D1 之间没有事务：先把文件拼好并核对，再写记录；宁可留下没人引用的文件，
 * 不能有指向半个文件的记录。完成请求可以安全地重发。
 */
import type { AuthTokenPayload } from "../../types/auth";
import type { Env } from "../../types/env";
import { runAtomicBatch } from "../db-transaction";
import { badRequest, WarehouseError } from "../warehouse/errors";
import { assertInBatch, releaseGuards } from "../warehouse/guard";
import { optionalDate, optionalId, requireEnum, requireText } from "../warehouse/validation";
import { getDocLibraryConfig } from "./config";
import {
  buildDocKey,
  contentTypeFor,
  DOC_CATEGORIES,
  DOC_PART_SIZE,
  extensionOf,
  safeFileName
} from "./file-types";
import { signUploadToken, verifyUploadToken, type DocUploadClaims } from "./upload-token";

const TOKEN_TTL_MS = 24 * 3600 * 1000;
const MB = 1024 * 1024;
const EXPIRED = "上传已失效，请重新上传";
const INCOMPLETE = "文件不完整，请重新上传";

/** 文件是最新版而且没删除。绑定一个参数：文件 id。 */
export const LATEST_DOC_EXISTS_SQL = `SELECT 1 FROM doc_file f
  WHERE f.id = ? AND f.deleted_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM doc_file n WHERE n.supersedes_id = f.id AND n.deleted_at IS NULL)`;

const nowIso = () => new Date().toISOString();
const partCountOf = (size: number): number => Math.ceil(size / DOC_PART_SIZE);

/** 上传令牌失效用 403：小程序的请求层遇到 401 会把人登出去，这里不是登录态的问题。 */
const claimsOf = async (env: Env, token: unknown): Promise<DocUploadClaims> => {
  const claims = await verifyUploadToken(env.UPLOAD_SIGNING_SECRET, token, Date.now());
  if (!claims) throw new WarehouseError(403, EXPIRED);
  return claims;
};

export const initDocUpload = async (
  env: Env,
  input: Record<string, unknown>,
  auth: AuthTokenPayload
): Promise<{ upload_token: string; part_size: number; part_count: number }> => {
  const fileName = safeFileName(requireText(input.file_name, "文件名", 300));
  const contentType = contentTypeFor(fileName);
  if (!contentType) {
    throw badRequest(`不支持这种文件：${extensionOf(fileName) || "没有扩展名"}`);
  }
  const size = input.file_size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    throw badRequest("文件大小不对");
  }
  const config = await getDocLibraryConfig(env);
  const limit = input.client === "miniapp" ? config.max_bytes_miniapp : config.max_bytes;
  if (size > limit) throw badRequest(`文件太大，最大 ${Math.floor(limit / MB)} MB`);

  const key = buildDocKey(fileName, new Date(), crypto.randomUUID());
  const upload = await env.FILES.createMultipartUpload(key, { httpMetadata: { contentType } });
  const token = await signUploadToken(env.UPLOAD_SIGNING_SECRET, {
    key,
    uploadId: upload.uploadId,
    name: fileName,
    size,
    type: contentType,
    uid: auth.sub,
    exp: Date.now() + TOKEN_TTL_MS
  });
  return { upload_token: token, part_size: DOC_PART_SIZE, part_count: partCountOf(size) };
};

export const putDocUploadPart = async (
  env: Env,
  token: unknown,
  partNumber: unknown,
  body: ArrayBuffer
): Promise<{ part_number: number; etag: string }> => {
  const claims = await claimsOf(env, token);
  const count = partCountOf(claims.size);
  const part = Number(partNumber);
  if (!Number.isInteger(part) || part < 1 || part > count) throw badRequest("分片序号不对");
  // 每一片该多大是定死的：除最后一片外都是 8 MiB，最后一片是剩下的
  const expected = part === count ? claims.size - DOC_PART_SIZE * (count - 1) : DOC_PART_SIZE;
  if (body.byteLength !== expected) throw badRequest("分片大小不对");
  try {
    const uploaded = await env.FILES.resumeMultipartUpload(claims.key, claims.uploadId).uploadPart(
      part,
      body
    );
    return { part_number: uploaded.partNumber, etag: uploaded.etag };
  } catch (error) {
    // 这次上传已经被放弃或完成了
    console.warn("[doc-library] 分片上传失败", { key: claims.key, part, error });
    throw new WarehouseError(403, EXPIRED);
  }
};

const parsePartList = (raw: unknown, count: number): { partNumber: number; etag: string }[] => {
  const list = Array.isArray(raw) ? raw : [];
  const parts = list.map((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return { partNumber: Number(record.part_number), etag: String(record.etag ?? "") };
  });
  const complete =
    parts.length === count &&
    parts.every((part) => part.etag !== "") &&
    [...parts]
      .sort((a, b) => a.partNumber - b.partNumber)
      .every((part, i) => part.partNumber === i + 1);
  if (!complete) throw badRequest(INCOMPLETE);
  return [...parts].sort((a, b) => a.partNumber - b.partNumber);
};

interface DocMeta {
  title: string;
  docCategory: string;
  deviceId: number | null;
  deviceCategoryId: number | null;
  validUntil: string | null;
}

/** 标题、资料类别、归属、有效期的校验。上传完成和修改资料共用。 */
export const parseDocMeta = async (env: Env, input: Record<string, unknown>): Promise<DocMeta> => {
  const title = requireText(input.title, "标题", 120);
  const docCategory = requireEnum(input.doc_category, "资料类别", DOC_CATEGORIES);
  const deviceId = optionalId(input.device_id, "设备");
  const deviceCategoryId = optionalId(input.device_category_id, "设备类别");
  if (deviceId !== null && deviceCategoryId !== null) {
    throw badRequest("归属只能选设备或设备类别其中一个");
  }
  if (deviceId !== null) {
    const device = await env.DB.prepare("SELECT id FROM device WHERE id = ?")
      .bind(deviceId)
      .first();
    if (!device) throw badRequest("设备不存在");
  }
  if (deviceCategoryId !== null) {
    const category = await env.DB.prepare("SELECT id FROM device_category WHERE id = ?")
      .bind(deviceCategoryId)
      .first();
    if (!category) throw badRequest("设备类别不存在");
  }
  return {
    title,
    docCategory,
    deviceId,
    deviceCategoryId,
    validUntil: optionalDate(input.valid_until, "有效期")
  };
};

const findByKey = async (env: Env, key: string): Promise<number | null> => {
  const row = await env.DB.prepare("SELECT id FROM doc_file WHERE file_key = ?")
    .bind(key)
    .first<{ id: number }>();
  return row ? Number(row.id) : null;
};

const isKeyTaken = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("UNIQUE constraint failed: doc_file.file_key");

/** 把分片拼成文件并核对大小。已经拼好过（上一次完成请求走到一半）也算成功。 */
const assembleObject = async (
  env: Env,
  claims: DocUploadClaims,
  parts: { partNumber: number; etag: string }[]
): Promise<void> => {
  try {
    await env.FILES.resumeMultipartUpload(claims.key, claims.uploadId).complete(parts);
  } catch (error) {
    console.warn("[doc-library] 拼分片失败，看文件是不是已经拼好了", { key: claims.key, error });
  }
  const head = await env.FILES.head(claims.key);
  if (!head) throw badRequest(INCOMPLETE);
  if (head.size !== claims.size) {
    await env.FILES.delete(claims.key);
    throw badRequest(INCOMPLETE);
  }
};

export const completeDocUpload = async (
  env: Env,
  input: Record<string, unknown>,
  auth: AuthTokenPayload
): Promise<{ id: number; replayed: boolean }> => {
  const claims = await claimsOf(env, input.upload_token);
  if (claims.uid !== auth.sub) throw new WarehouseError(403, "这不是你的上传");
  // 完成请求超时后重发：记录已经在了就直接返回
  const existing = await findByKey(env, claims.key);
  if (existing !== null) return { id: existing, replayed: true };

  const parts = parsePartList(input.parts, partCountOf(claims.size));
  const meta = await parseDocMeta(env, input);
  const supersedesId = optionalId(input.supersedes_id, "要替换的文件");
  if (supersedesId !== null) {
    const latest = await env.DB.prepare(LATEST_DOC_EXISTS_SQL).bind(supersedesId).first();
    if (!latest) throw new WarehouseError(409, "这个文件已经被替换或删除，请刷新");
  }

  await assembleObject(env, claims, parts);

  const now = nowIso();
  try {
    await runAtomicBatch(env.DB, [
      // 写记录的那一刻旧文件必须还是最新版：两个人同时替换同一个文件时只成一个
      ...(supersedesId !== null
        ? [assertInBatch(env.DB, LATEST_DOC_EXISTS_SQL, [supersedesId])]
        : []),
      env.DB.prepare(
        `INSERT INTO doc_file (title, file_name, file_key, file_size, content_type, doc_category,
           device_id, device_category_id, valid_until, supersedes_id, uploaded_by_userid,
           version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).bind(
        meta.title,
        claims.name,
        claims.key,
        claims.size,
        claims.type,
        meta.docCategory,
        meta.deviceId,
        meta.deviceCategoryId,
        meta.validUntil,
        supersedesId,
        auth.sub,
        now,
        now
      ),
      // 替换多半是因为旧文件有问题：旧文件上的对外链接一并作废
      ...(supersedesId !== null
        ? [
            env.DB.prepare(
              "UPDATE doc_share SET revoked_at = ? WHERE doc_file_id = ? AND revoked_at IS NULL"
            ).bind(now, supersedesId)
          ]
        : []),
      releaseGuards(env.DB)
    ]);
  } catch (error) {
    if (!isKeyTaken(error)) throw error;
    const taken = await findByKey(env, claims.key);
    if (taken !== null) return { id: taken, replayed: true };
    throw error;
  }
  const id = await findByKey(env, claims.key);
  if (id === null) throw new Error("doc_file row missing right after insert");
  return { id, replayed: false };
};

/** 放弃一次上传。清理动作：令牌无效、不是本人、已经结束都静默返回。 */
export const abortDocUpload = async (
  env: Env,
  input: Record<string, unknown>,
  auth: AuthTokenPayload
): Promise<void> => {
  const claims = await verifyUploadToken(env.UPLOAD_SIGNING_SECRET, input.upload_token, Date.now());
  if (!claims || claims.uid !== auth.sub) return;
  try {
    await env.FILES.resumeMultipartUpload(claims.key, claims.uploadId).abort();
  } catch (error) {
    console.warn("[doc-library] 放弃上传失败", { key: claims.key, error });
  }
};
