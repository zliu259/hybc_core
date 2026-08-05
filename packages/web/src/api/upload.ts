import { http } from "@/utils/http";

const toAbsoluteApiUrl = (url: string): string => {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;

  const base = import.meta.env.VITE_API_BASE_URL || "";
  if (!base) return url;

  const normalizedBase = base.replace(/\/$/, "");
  const normalizedPath = url.startsWith("/") ? url : `/${url}`;
  return `${normalizedBase}${normalizedPath}`;
};

export const createUploadSignature = (data: {
  fileName: string;
  contentType?: string;
  category?: string;
}) => {
  return http.request<{
    success: boolean;
    data: {
      key: string;
      expiresAt: number;
      signature: string;
      contentType: string;
      uploadUrl: string;
      fileUrl: string;
    };
  }>("post", "/api/v1/upload/sign", { data });
};

export const resolveUploadUrl = (url: string) => toAbsoluteApiUrl(url);

export const signDownloadUrl = (key: string) => {
  return http.request<{ success: boolean; data: { url: string } }>(
    "post",
    "/api/v1/upload/sign-download",
    { data: { key } }
  );
};

/** 对象直连地址（未签名），仅作为签名失败时的兜底。 */
export const resolveObjectUrl = (key: string) =>
  toAbsoluteApiUrl(`/api/v1/upload/object/${encodeURIComponent(key)}`);

/**
 * 返回可直接放进 <img>/<iframe> 的文件地址：
 * 优先取带签名的临时地址，签名接口异常时回退到直连地址，
 * 避免单次签名失败导致整块预览不可用。
 */
export const resolveViewableFileUrl = async (key: string): Promise<string> => {
  try {
    const result = await signDownloadUrl(key);
    return toAbsoluteApiUrl(result.data.url);
  } catch {
    return resolveObjectUrl(key);
  }
};
