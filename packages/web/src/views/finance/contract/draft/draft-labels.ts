export type DraftTagType =
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

export const sectionAiStatusTagType: Record<string, DraftTagType> = {
  generating: "warning",
  done: "success",
  error: "danger"
};

export const sectionAiStatusLabelMap: Record<string, string> = {
  generating: "生成中",
  done: "已生成",
  error: "失败"
};

export const sectionSourceLabelMap: Record<string, string> = {
  default_template: "默认模板",
  ai_generated: "AI 生成",
  manual: "手工编辑"
};

export const familyLabelMap: Record<string, string> = {
  pipe_jacking: "顶管施工",
  equipment_lease: "设备租赁/机械施工",
  labor_service: "劳务分包",
  materials_sale: "材料购销"
};

export const requiredLevelLabelMap: Record<string, string> = {
  core: "核心",
  recommended: "建议",
  optional: "可选"
};

export const draftStatusTagType: Record<string, DraftTagType> = {
  drafting: "info",
  finalized: "warning",
  converted: "success",
  deleted: "info"
};

export const draftStatusLabelMap: Record<string, string> = {
  drafting: "起草中",
  finalized: "已定稿",
  converted: "已转正式合同",
  deleted: "已删除"
};

export const toDraftLabel = (
  map: Record<string, string>,
  value: string | null | undefined
): string => (value ? (map[value] ?? value) : "-");
