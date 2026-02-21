import { http } from "@/utils/http";

export type WeComDepartment = {
  id: number;
  name: string;
  parentid: number;
  order: number;
};

export type WeComUser = {
  userid: string;
  name: string;
  department: number[];
  mobile?: string;
  email?: string;
  avatar?: string;
  status?: number;
};

export const getWeComScanUrl = (redirectUri: string) => {
  return http.request<{
    success: boolean;
    data: { oauthUrl: string; scanUrl: string; state: string };
  }>("get", "/api/v1/auth/oauth-url", {
    params: {
      redirect_uri: redirectUri
    }
  });
};

export const syncWeComContacts = () => {
  return http.request<{
    success: boolean;
    data: {
      syncedAt: string;
      departmentCount: number;
      userCount: number;
    };
  }>("post", "/api/v1/auth/wecom/contacts/sync");
};

export const getWeComContacts = () => {
  return http.request<{
    success: boolean;
    data: {
      syncedAt: string;
      departments: WeComDepartment[];
      users: WeComUser[];
    };
  }>("get", "/api/v1/auth/wecom/contacts");
};
