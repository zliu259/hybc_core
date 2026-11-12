export const toHex = (arrayBuffer: ArrayBuffer): string => {
  const view = new Uint8Array(arrayBuffer);
  return [...view].map((value) => value.toString(16).padStart(2, "0")).join("");
};

/**
 * 签名的用途。上传（put）和下载（get）的签名互不通用：
 * 以前两者是同一个签名，拿任何一个下载地址都能把那个文件覆盖掉。
 */
export type ObjectAccessPurpose = "get" | "put";

export const signObjectAccess = async (
  secret: string,
  key: string,
  expiresAt: number,
  purpose: ObjectAccessPurpose
): Promise<string> => {
  const keyData = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    keyData,
    new TextEncoder().encode(`${purpose}:${key}:${expiresAt}`)
  );

  return toHex(signature);
};

const normalizeBaseUrl = (baseUrl?: string | null): string => {
  if (!baseUrl?.trim()) return "";
  return baseUrl.trim().replace(/\/+$/, "");
};

export const buildObjectUrl = (key: string, baseUrl?: string | null): string => {
  return `${normalizeBaseUrl(baseUrl)}/api/v1/upload/object/${encodeURIComponent(key)}`;
};

export const buildSignedObjectUrl = (
  key: string,
  expiresAt: number,
  signature: string,
  baseUrl?: string | null
): string => {
  return `${buildObjectUrl(key, baseUrl)}?expires=${expiresAt}&signature=${signature}`;
};

export const isObjectAccessSignatureValid = async (
  secret: string,
  key: string,
  expiresAt: number,
  signature: string,
  purpose: ObjectAccessPurpose,
  now = Date.now()
): Promise<boolean> => {
  if (!key || !expiresAt || !signature || Number.isNaN(expiresAt)) {
    return false;
  }
  if (now > expiresAt) return false;

  const expectedSignature = await signObjectAccess(secret, key, expiresAt, purpose);
  return expectedSignature === signature;
};

/** 给前端的文件地址用哪个域名：配了对外地址就用它，否则用请求进来的域名。 */
export const getUploadBaseUrl = (
  env: { WECOM_PUSH_API_BASE_URL?: string },
  requestUrl: string
): string => env.WECOM_PUSH_API_BASE_URL?.trim() || new URL(requestUrl).origin;
