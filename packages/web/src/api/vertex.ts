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
