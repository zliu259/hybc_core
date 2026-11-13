/** 微盘镜像在页面上怎么说：卡片顶上的一句话、出哪些按钮、资料列表里的那一列。都是纯函数。 */
import type { DocFileRow } from "@/api/wh/doc-library-types";
import type { WedriveStatus } from "@/api/wh/wedrive";

export type MirrorTone = "info" | "success" | "warning" | "danger";

export interface MirrorHeadline {
  text: string;
  type: MirrorTone;
}

const waiting = (status: WedriveStatus): number =>
  status.counts.pending + status.counts.syncing;

/** 卡片顶上的一句话和颜色 */
export const mirrorHeadline = (status: WedriveStatus): MirrorHeadline => {
  if (!status.initialized) return { text: "还没有建微盘空间", type: "info" };
  if (status.paused_reason !== null) {
    return { text: `已暂停：${status.paused_reason}`, type: "danger" };
  }
  if (!status.enabled) return { text: "镜像已关闭", type: "info" };
  const problems = [
    status.counts.failed > 0 ? `${status.counts.failed} 份没传上去` : "",
    status.failed_removals > 0
      ? `${status.failed_removals} 份该删的还留在微盘里`
      : ""
  ].filter(Boolean);
  if (problems.length > 0) {
    return { text: problems.join("，"), type: "warning" };
  }
  if (waiting(status) > 0) {
    return { text: `正在镜像，还有 ${waiting(status)} 份`, type: "info" };
  }
  return { text: "微盘和系统一致", type: "success" };
};

export interface MirrorActions {
  setup: boolean;
  /** 现在能做的那个开关动作：on 是「开启镜像」，off 是「关闭镜像」 */
  toggle: "on" | "off" | null;
  resume: boolean;
  open: boolean;
  retryFailed: boolean;
}

const NO_ACTIONS: MirrorActions = {
  setup: false,
  toggle: null,
  resume: false,
  open: false,
  retryFailed: false
};

/** 现在该显示哪些按钮。只有经理和超管能动。 */
export const mirrorActions = (
  status: WedriveStatus,
  canManage: boolean
): MirrorActions => {
  if (!canManage) return NO_ACTIONS;
  if (!status.initialized) return { ...NO_ACTIONS, setup: true };
  return {
    setup: false,
    toggle: status.enabled ? "off" : "on",
    resume: status.paused_reason !== null,
    // 问过企微但没收到答复的，还能再点一次
    open: !status.space_open || !status.space_open_confirmed,
    retryFailed: status.counts.failed > 0 || status.failed_removals > 0
  };
};

export interface MirrorTag {
  text: string;
  type: MirrorTone;
  /** 鼠标放上去显示的原因；没有就是空串 */
  tip: string;
}

/** 资料列表里「微盘」那一列。被替换的旧版本不在微盘里，不显示。 */
export const mirrorTag = (
  row: Pick<DocFileRow, "mirror_status" | "mirror_error" | "is_latest">
): MirrorTag | null => {
  if (!row.is_latest) return null;
  const tip = row.mirror_error ?? "";
  if (row.mirror_status === "synced") {
    return { text: "已同步", type: "success", tip: "" };
  }
  if (row.mirror_status === "failed") {
    return { text: "没传上去", type: "danger", tip };
  }
  if (row.mirror_status === "skipped") {
    return { text: "不镜像", type: "warning", tip };
  }
  return { text: "等待同步", type: "info", tip: "" };
};

/** 各状态的份数；等待和正在传的合成一项 */
export const mirrorCountItems = (
  status: WedriveStatus
): { label: string; value: number }[] => [
  { label: "已同步", value: status.counts.synced },
  { label: "等待同步", value: waiting(status) },
  { label: "没传上去", value: status.counts.failed },
  { label: "不镜像", value: status.counts.skipped },
  ...(status.failed_removals > 0
    ? [{ label: "该删没删掉", value: status.failed_removals }]
    : [])
];

/** 微盘里的「设备资料库」现在谁能看到 */
export const mirrorAudienceText = (status: WedriveStatus): string => {
  if (!status.space_open) return "还没有开放，微盘里谁也看不到";
  return status.space_open_confirmed
    ? "全公司，只能下载"
    : "不确定：上次开放没收到企业微信的答复，请到微盘里看一下成员";
};

export const mirrorCallsText = (status: WedriveStatus): string =>
  `已用 ${status.calls_this_month} / 预算 ${status.monthly_budget}（企业每月上限 1000 次）`;
