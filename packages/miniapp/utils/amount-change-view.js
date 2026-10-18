// 审批详情页「合同金额变更」明细的展示辅助

const formatMoney = (value) => {
  const parts = value.toFixed(2).split(".");
  return `${parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${parts[1]}`;
};

const formatFileSize = (size) => {
  const num = Number(size);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (num < 1024 * 1024) return `${Math.max(1, Math.round(num / 1024))} KB`;
  return `${(num / 1024 / 1024).toFixed(1)} MB`;
};

/**
 * 差额文案；按分取整，避免浮点误差显示成「增加 0.00」
 * @param {unknown} oldAmount
 * @param {unknown} newAmount
 * @returns {string}
 */
const amountChangeDeltaLabel = (oldAmount, newAmount) => {
  if (typeof oldAmount !== "number" || !Number.isFinite(oldAmount)) return "-";
  if (typeof newAmount !== "number" || !Number.isFinite(newAmount)) return "-";
  const deltaCents = Math.round((newAmount - oldAmount) * 100);
  if (deltaCents === 0) return "无变化";
  const amount = formatMoney(Math.abs(deltaCents) / 100);
  return deltaCents > 0 ? `增加 ${amount}` : `减少 ${amount}`;
};

/**
 * 取接口返回的 attachments，转成页面「附件」卡片用的结构
 * @param {{ attachments?: unknown } | null | undefined} change
 * @returns {Array<{ file_key: string, file_name: string, file_size: string | null }>}
 */
const amountChangeAttachments = (change) => {
  const list = change && Array.isArray(change.attachments) ? change.attachments : [];
  return list
    .filter((item) => item && typeof item.file_key === "string" && item.file_key)
    .map((item) => ({
      file_key: item.file_key,
      file_name: item.file_name || "未命名附件",
      file_size: formatFileSize(item.file_size)
    }));
};

module.exports = { amountChangeDeltaLabel, amountChangeAttachments };
