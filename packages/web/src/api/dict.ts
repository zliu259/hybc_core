import { http } from "@/utils/http";

export type DictItem = {
  id: number;
  dict_type: string;
  dict_label: string;
  dict_value: string;
  sort_order: number;
  status: string;
  created_at: string;
  updated_at: string;
};

export const listDictItems = (dictType?: string) => {
  return http.request<{ success: boolean; data: Record<string, DictItem[]> | DictItem[] }>(
    "get",
    "/api/v1/dict",
    {
      params: dictType ? { dict_type: dictType } : undefined
    }
  );
};

export const createDictItem = (data: {
  dict_type: string;
  dict_label: string;
  dict_value: string;
  sort_order?: number;
  status?: string;
}) => {
  return http.request<{ success: boolean; data: { id: number } }>(
    "post",
    "/api/v1/dict",
    { data }
  );
};

export const updateDictItem = (
  id: number,
  data: {
    dict_label?: string;
    dict_value?: string;
    sort_order?: number;
    status?: string;
  }
) => {
  return http.request<{ success: boolean }>("put", `/api/v1/dict/${id}`, { data });
};

export const deleteDictItem = (id: number) => {
  return http.request<{ success: boolean }>("delete", `/api/v1/dict/${id}`);
};
