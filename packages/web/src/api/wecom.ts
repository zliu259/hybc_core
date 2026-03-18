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
  system_role?:
    | "super_admin"
    | "finance"
    | "manager"
    | "site_manager"
    | "operator";
  role_source?: "wecom_tag" | "username_fallback";
  permissions?: string[];
  permission_status?: "configured";
};

export const getWeComScanUrl = (
  redirectUri: string,
  options?: {
    mode?: "scan" | "oauth";
    scope?: "snsapi_base" | "snsapi_privateinfo";
  }
) => {
  return http.request<{
    success: boolean;
    data: {
      oauthUrl: string;
      scanUrl: string;
      loginUrl: string;
      state: string;
    };
  }>("get", "/api/v1/auth/oauth-url", {
    params: {
      redirect_uri: redirectUri,
      mode: options?.mode,
      scope: options?.scope
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
      permission_sync?: {
        enriched: boolean;
        mode: "wecom_tag+fallback" | "username_fallback";
        error?: string;
      };
    };
  }>("get", "/api/v1/auth/wecom/contacts");
};

export const getWeComJsSdkConfig = (url: string) => {
  return http.request<{
    success: boolean;
    data: {
      corpId: string;
      agentId: string;
      url: string;
      timestamp: number;
      nonceStr: string;
      signature: string;
      agentSignature: string;
    };
  }>("get", "/api/v1/auth/wecom/jssdk-config", {
    params: {
      url
    }
  });
};
