import { http } from "@/utils/http";

export type VertexHandoffRequest = {
  vertexBaseUrl?: string;
  hybcApiBaseUrl?: string;
  entryPath?: string;
};

export type VertexHandoffUser = {
  sub: string;
  username: string;
  nickname: string;
  avatar: string;
  roles: string[];
  permissions: string[];
  scopes: string[];
  hybc_api_base_url: string;
  vertex_base_url: string;
  entry_path: string;
  expires_at: string;
};

export type VertexHandoffResult = {
  success: boolean;
  data: {
    launch_url: string;
    launch_token: string;
    token_type: "Bearer";
    expires_at: string;
    expires_in_seconds: number;
    hybc_api_base_url: string;
    vertex_base_url: string;
    entry_path: string;
    user: VertexHandoffUser;
    scopes: string[];
  };
};

export const createVertexHandoff = (data: VertexHandoffRequest) => {
  return http.request<VertexHandoffResult>("post", "/api/v1/vertex/handoff", {
    data
  });
};

// v2 门户：后端只发一次性不透明 code，浏览器带 code 跳转 vertex，
// vertex 经 Service Binding 回 HYBC 换取身份，前端不再接触任何 token。
export type VertexHandoffCodeRequest = {
  vertexBaseUrl?: string;
};

export type VertexHandoffCodeResult = {
  success: boolean;
  data: {
    code: string;
    redirect_url: string;
    expires_at: string;
    expires_in_seconds: number;
    vertex_base_url: string;
    scopes: string[];
  };
};

export const createVertexHandoffCode = (data: VertexHandoffCodeRequest) => {
  return http.request<VertexHandoffCodeResult>(
    "post",
    "/api/v1/vertex/handoff/code",
    { data }
  );
};
