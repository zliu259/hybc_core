/** 库房通知卡片的纯函数：页面路径、卡片结构、截断、收件人。不碰数据库。 */

export interface NoticeLinks {
  miniAppId: string | null;
  webBaseUrl: string | null;
}

export interface NoticeCardInput {
  title: string;
  desc: string;
  lines: { keyname: string; value: string }[];
  /** 小程序页面路径，不带开头的斜杠 */
  pagePath: string;
  /** Web 的 hash 路径，如 "/wh/kit/12" */
  webPath: string;
}

/** 写进企微卡片的小程序页面路径。卡片发出去就改不了，这些路径不能再变。 */
export const NOTICE_PAGES = {
  kit: (id: number): string => `packageWarehouse/kit/index?id=${id}`,
  task: (id: number): string => `packageWarehouse/task-detail/index?id=${id}`,
  myTasks: "packageWarehouse/task-list/index?tab=mine",
  project: (id: number): string => `packageWarehouse/project/index?projectId=${id}`,
  /** 库房 tab 页（每日摘要点开这里） */
  home: "pages/warehouse/index"
} as const;

// 企微模板卡片各字段的建议上限
const TITLE_MAX = 26;
const DESC_MAX = 30;
const KEYNAME_MAX = 5;
const VALUE_MAX = 26;
const LINES_MAX = 6;

export const clip = (text: string, max: number): string => {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
};

/** 去掉空值、重复和操作人。 */
export const recipientsExcept = (userids: readonly (string | null)[], actor: string): string[] => [
  ...new Set(userids.filter((userid): userid is string => Boolean(userid) && userid !== actor))
];

/** 两种跳转都没配时返回 null。 */
export const buildNoticeCard = (
  input: NoticeCardInput,
  links: NoticeLinks
): Record<string, unknown> | null => {
  const mini = links.miniAppId
    ? { type: 2, appid: links.miniAppId, pagepath: input.pagePath }
    : null;
  const web = links.webBaseUrl
    ? { type: 1, url: `${links.webBaseUrl.replace(/\/+$/, "")}/#${input.webPath}` }
    : null;
  const action = mini ?? web;
  if (!action) return null;
  return {
    card_type: "text_notice",
    source: { desc: "库房", desc_color: 0 },
    main_title: { title: clip(input.title, TITLE_MAX), desc: clip(input.desc, DESC_MAX) },
    horizontal_content_list: input.lines
      .filter((line) => line.value.trim() !== "")
      .slice(0, LINES_MAX)
      .map((line) => ({
        keyname: line.keyname.trim().slice(0, KEYNAME_MAX),
        value: clip(line.value, VALUE_MAX)
      })),
    jump_list: [
      ...(mini ? [{ ...mini, title: "打开小程序" }] : []),
      ...(web ? [{ ...web, title: "打开Web" }] : [])
    ],
    card_action: action
  };
};
