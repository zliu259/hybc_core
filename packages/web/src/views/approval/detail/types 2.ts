import type { RouteLocationRaw } from "vue-router";

export type TagType = "primary" | "success" | "warning" | "danger" | "info";

/** 明细网格的一行：值、链接、标签三选一渲染，避免每种业务各写一遍模板。 */
export type DetailRow = {
  label: string;
  value?: string | number | null;
  /** 占满整行（长文本、账号等） */
  wide?: boolean;
  /** 保留换行（变更缘由、备注等多行文本） */
  multiline?: boolean;
  to?: RouteLocationRaw | null;
  tag?: { text: string; type: TagType } | null;
};

export type AttachmentItem = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
};

/** 页面头部：审批人第一眼要看的金额、事由与关键事实。 */
export type HeroModel = {
  /** 无金额的业务（如出入库）为 null，头部退化为只显示事由 */
  amount: number | null;
  amountLabel: string;
  title: string;
  bizNo: string;
  bizNoTo: RouteLocationRaw | null;
  facts: DetailRow[];
};

export type LabelContext = {
  project: (id: number | null | undefined) => string;
  entity: (id: number | null | undefined) => string;
  user: (userid: string | null | undefined) => string;
  /** 当前角色能否打开财务业务页；决定业务编号是否可点 */
  canOpenFinance: boolean;
};

export type RemarkEdit = { at: string; by: string; note: string };
