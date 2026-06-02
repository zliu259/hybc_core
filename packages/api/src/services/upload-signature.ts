export const toHex = (arrayBuffer: ArrayBuffer): string => {
  const view = new Uint8Array(arrayBuffer);
  return [...view].map((value) => value.toString(16).padStart(2, "0")).join("");
};

export const signObjectAccess = async (
  secret: string,
  key: string,
  expiresAt: number
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
    new TextEncoder().encode(`${key}:${expiresAt}`)
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
  now = Date.now()
): Promise<boolean> => {
  if (!key || !expiresAt || !signature || Number.isNaN(expiresAt)) {
    return false;
  }
  if (now > expiresAt) return false;

  const expectedSignature = await signObjectAccess(secret, key, expiresAt);
  return expectedSignature === signature;
};
