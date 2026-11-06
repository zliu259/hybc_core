import { computed, ref, shallowRef, type Ref } from "vue";
import {
  getApprovalDetail,
  type AiGateReview,
  type ApprovalDetailResponse,
  type ApprovalInstance
} from "@/api/approval";
import { getAmountChange, getContract } from "@/api/contract";
import { getRiskReport, getPaymentRequest } from "@/api/payment";
import { getInvoiceRequest, getReceiptRefund } from "@/api/receipt";
import {
  getBatchAuditReport,
  getReimbursementBatch
} from "@/api/reimbursement";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import type { BizRecords } from "./biz-view";

const EMPTY_RECORDS: BizRecords = {
  payment: null,
  contract: null,
  amountChange: null,
  reimbursementBatch: null,
  invoiceRequest: null,
  invoiceContract: null,
  receiptRefund: null
};

export type AiReport = {
  status: string;
  result: Record<string, unknown> | string | null;
};

const NO_REPORT: AiReport = { status: "none", result: null };

const fetchRecords = async (
  bizType: string,
  bizId: number
): Promise<BizRecords> => {
  if (bizType === "payment_request") {
    return {
      ...EMPTY_RECORDS,
      payment: (await getPaymentRequest(bizId)).data
    };
  }
  if (bizType === "outbound_contract" || bizType === "inbound_contract") {
    return { ...EMPTY_RECORDS, contract: (await getContract(bizId)).data };
  }
  if (bizType === "contract_amount_change") {
    return {
      ...EMPTY_RECORDS,
      amountChange: (await getAmountChange(bizId)).data
    };
  }
  if (bizType === "reimbursement_batch") {
    return {
      ...EMPTY_RECORDS,
      reimbursementBatch: (await getReimbursementBatch(bizId)).data
    };
  }
  if (bizType === "invoice_request") {
    const invoiceRequest = (await getInvoiceRequest(bizId)).data;
    const invoiceContract = (await getContract(invoiceRequest.contract_id))
      .data;
    return { ...EMPTY_RECORDS, invoiceRequest, invoiceContract };
  }
  if (bizType === "receipt_refund") {
    return {
      ...EMPTY_RECORDS,
      receiptRefund: (await getReceiptRefund(bizId)).data
    };
  }
  return EMPTY_RECORDS;
};

const fetchReport = async (
  bizType: string,
  bizId: number
): Promise<AiReport> => {
  if (bizType === "payment_request") {
    const report = await getRiskReport(bizId);
    return { status: report.data.status, result: report.data.result };
  }
  if (bizType === "reimbursement_batch") {
    const report = await getBatchAuditReport(bizId);
    return { status: report.data.status, result: report.data.result };
  }
  return NO_REPORT;
};

/**
 * 审批详情的数据加载。实例先到先渲染，业务详情和 AI 报告随后补齐；
 * 操作后的刷新是静默的，页面不闪遮罩。
 */
export function useApprovalDetail(instanceId: Ref<number>) {
  const detail = ref<ApprovalDetailResponse | null>(null);
  const records = shallowRef<BizRecords>(EMPTY_RECORDS);
  const report = shallowRef<AiReport>(NO_REPORT);
  const bizLoading = ref(false);
  const loadFailed = ref(false);
  // 切到下一条时上一条的响应可能晚到，只认最新一次加载
  let latestLoad = 0;

  const instance = computed<ApprovalInstance | null>(
    () => detail.value?.instance ?? null
  );
  const aiGateReviews = computed<AiGateReview[]>(
    () => detail.value?.ai_gate_reviews ?? []
  );
  const hasAction = (action: string) =>
    detail.value?.available_actions.includes(action) ?? false;

  const loadBizParts = async (loadId: number, target: ApprovalInstance) => {
    bizLoading.value = true;
    const [recordsResult, reportResult] = await Promise.allSettled([
      fetchRecords(target.biz_type, target.biz_id),
      fetchReport(target.biz_type, target.biz_id)
    ]);
    if (loadId !== latestLoad) return;
    bizLoading.value = false;
    if (recordsResult.status === "fulfilled") {
      records.value = recordsResult.value;
    } else {
      message(
        resolveApiErrorMessage(recordsResult.reason, "业务详情加载失败"),
        { type: "error" }
      );
    }
    // 报告取不到不影响审批：组件会回退到业务记录里落库的结果
    report.value =
      reportResult.status === "fulfilled" ? reportResult.value : NO_REPORT;
  };

  const load = async () => {
    const id = instanceId.value;
    if (!Number.isFinite(id)) return;
    const loadId = ++latestLoad;
    const switching = detail.value?.instance.id !== id;
    if (switching) {
      detail.value = null;
      records.value = EMPTY_RECORDS;
      report.value = NO_REPORT;
    }
    loadFailed.value = false;
    try {
      const result = await getApprovalDetail(id);
      if (loadId !== latestLoad) return;
      detail.value = result.data;
      await loadBizParts(loadId, result.data.instance);
    } catch (error) {
      if (loadId !== latestLoad) return;
      loadFailed.value = true;
      bizLoading.value = false;
      message(resolveApiErrorMessage(error, "审批详情加载失败"), {
        type: "error"
      });
    }
  };

  return {
    detail,
    instance,
    records,
    report,
    aiGateReviews,
    bizLoading,
    loadFailed,
    hasAction,
    load
  };
}
