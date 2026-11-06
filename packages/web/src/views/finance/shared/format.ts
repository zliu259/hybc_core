/** 金额千分位格式化，保留两位小数；空值返回 "-" */
export const formatMoney = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
};

/** 审批进行中业务接口不接受写入，附件要走审批接口；null 表示当前不能上传 */
export type AttachmentUploadRoute = "biz" | "approval" | null;

/**
 * 表单只显示发起人写的备注，保存时要把系统追加的修改记录接回去，否则留痕会被覆盖掉。
 */
export const mergeRemarkEditLog = (
  text: string,
  originalRemark: string | null | undefined
): string => {
  const editLines = (originalRemark ?? "")
    .split("\n")
    .filter(line => /^\[(超管修改|VOID|REACTIVATE) /.test(line.trim()));
  return [text.trim(), ...editLines].filter(Boolean).join("\n");
};
