import { http } from "@/utils/http";
import { formatToken, getToken } from "@/utils/auth";
import { normalizeApiUrl } from "@/utils/api-url";

// 相对路径拼基址；后端签发的 https://api.hybcdg.com 绝对地址也归一到当前基址（见 utils/api-url.ts）。
const toAbsoluteApiUrl = (url: string): string => normalizeApiUrl(url);

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

export type UploadedAttachment = {
  file_key: string;
  file_name: string;
  file_size: number;
};

/**
 * 签名 + 直传一个文件到对象存储，返回可写进业务单据的附件元信息。
 * 上传接口非 2xx 时抛错，调用方负责提示。
 */
export const uploadAttachmentFile = async (
  file: File,
  category: string
): Promise<UploadedAttachment> => {
  const signRes = await createUploadSignature({
    fileName: file.name,
    contentType: file.type,
    category
  });
  const uploadResp = await fetch(resolveUploadUrl(signRes.data.uploadUrl), {
    method: "PUT",
    headers: {
      "content-type": file.type || "application/octet-stream",
      Authorization: formatToken(getToken().accessToken)
    },
    body: file
  });
  if (!uploadResp.ok) {
    throw new Error(`upload_failed_${uploadResp.status}`);
  }
  return {
    file_key: signRes.data.key,
    file_name: file.name,
    file_size: file.size
  };
};
