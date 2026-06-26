import type { ContractDirection } from "../types/contract";

/**
 * The lower bound a contract's amount may be changed to, plus a human label for
 * error messages. Direction matters: an outbound (付款) contract may not drop
 * below what has already been paid out, while an inbound (收款) contract may not
 * drop below what has already been received.
 */
export interface AmountChangeFloor {
  floor: number;
  label: string;
}

export function amountChangeFloor(
  contract: Readonly<{
    direction: ContractDirection;
    paid_amount: number;
    received_amount: number;
  }>
): AmountChangeFloor {
  if (contract.direction === "inbound") {
    return { floor: contract.received_amount, label: "已收款" };
  }
  return { floor: contract.paid_amount, label: "已打款" };
}
