/**
 * 资料分片上传的令牌：初始化时签发，传分片和完成时带上。
 * 传分片的请求不带登录态（小程序的二进制上传通道、浏览器的 fetch 都能直接用），
 * 所以这次上传是谁的、传到哪个文件键、申报多大，都写在令牌里并签名，改不了。
 */
import { toHex } from "../upload-signature";

export interface DocUploadClaims {
  /** R2 里的文件键 */
  key: string;
  /** R2 分片上传的 ID */
  uploadId: string;
  /** 原始文件名 */
  name: string;
  /** 申报的文件大小（字节） */
  size: number;
  /** 按扩展名定的类型 */
  type: string;
  /** 上传人的企微 userid */
  uid: string;
  /** 过期时间（毫秒时间戳） */
  exp: number;
}

const PURPOSE = "doc-upload";

const toBase64Url = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (value: string): string => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};

const hmac = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${PURPOSE}:${payload}`))
  );
};

export const signUploadToken = async (secret: string, claims: DocUploadClaims): Promise<string> => {
  const payload = toBase64Url(JSON.stringify(claims));
  return `${payload}.${await hmac(secret, payload)}`;
};

const isClaims = (value: unknown): value is DocUploadClaims => {
  if (!value || typeof value !== "object") return false;
  const claims = value as Record<string, unknown>;
  return (
    typeof claims.key === "string" &&
    typeof claims.uploadId === "string" &&
    typeof claims.name === "string" &&
    typeof claims.type === "string" &&
    typeof claims.uid === "string" &&
    typeof claims.size === "number" &&
    Number.isInteger(claims.size) &&
    claims.size > 0 &&
    typeof claims.exp === "number"
  );
};

/** 格式不对、签名不对、过期都返回 null。 */
export const verifyUploadToken = async (
  secret: string,
  token: unknown,
  now: number
): Promise<DocUploadClaims | null> => {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts;
  if ((await hmac(secret, payload)) !== signature) return null;
  try {
    const claims: unknown = JSON.parse(fromBase64Url(payload));
    return isClaims(claims) && claims.exp >= now ? claims : null;
  } catch {
    return null;
  }
};
