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

export const requiredLevelLabelMap: Record<string, string> = {
  core: "核心",
  recommended: "建议",
  optional: "可选"
};

export const toDraftLabel = (
  map: Record<string, string>,
  value: string | null | undefined
): string => (value ? (map[value] ?? value) : "-");
