export type AmountChangeDelta = {
  kind: "increase" | "decrease" | "unchanged";
  label: string;
};

const formatMoney = (amount: number): string =>
  amount.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

/** 合同金额变更的差额文案；按分取整，避免浮点误差显示成「增加 0.00」 */
export const describeAmountChangeDelta = (
  oldAmount: number,
  newAmount: number
): AmountChangeDelta => {
  const deltaCents = Math.round((newAmount - oldAmount) * 100);
  if (deltaCents === 0) return { kind: "unchanged", label: "无变化" };
  const amount = formatMoney(Math.abs(deltaCents) / 100);
  return deltaCents > 0
    ? { kind: "increase", label: `增加 ${amount}` }
    : { kind: "decrease", label: `减少 ${amount}` };
};
