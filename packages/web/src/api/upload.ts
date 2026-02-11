import { http } from "@/utils/http";

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
