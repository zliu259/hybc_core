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
