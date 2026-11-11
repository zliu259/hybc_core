import { describe, expect, it } from "vitest";
import type { ApprovalDetailResponse } from "@/api/approval";
import {
  buildContractProgress,
  canSubmitAmountChange,
  contractTypeOptions,
  effectivePaymentTotal,
  resolveContractCapabilities,
  toAmountChangeStatus,
  type ContractCapabilityInput
} from "./contract-detail-view";

const approval = (status: string, actions: string[] = []) =>
  ({
    instance: { status },
    available_actions: actions
  }) as unknown as Pick<
    ApprovalDetailResponse,
    "instance" | "available_actions"
  >;

const resolve = (overrides: Partial<ContractCapabilityInput>) =>
  resolveContractCapabilities({
    detail: { status: "draft", approval_instance_id: null },
    approvalDetail: null,
    roles: ["finance"],
    superEditMode: false,
    ...overrides
  });

describe("resolveContractCapabilities", () => {
  it("详情没加载出来时什么都不能做", () => {
    const caps = resolve({ detail: null, roles: ["super_admin"] });
    expect(Object.values(caps).filter(Boolean)).toEqual([]);
  });

  it("草稿：能改资料和金额、能提交、能审查、不能发起金额变更", () => {
    const caps = resolve({});
    expect(caps.canEditFields).toBe(true);
    expect(caps.canEditAmount).toBe(true);
    expect(caps.canSubmit).toBe(true);
    expect(caps.canTriggerReview).toBe(true);
    expect(caps.canRequestAmountChange).toBe(false);
    expect(caps.attachmentUploadVia).toBe("biz");
    expect(caps.canRemoveAttachment).toBe(true);
    expect(caps.canToggleSuperEdit).toBe(false);
  });

  it("项目经理能改和提交，但后端不让它触发审查、发起金额变更", () => {
    const caps = resolve({ roles: ["site_manager"] });
    expect(caps.canEditFields).toBe(true);
    expect(caps.canSubmit).toBe(true);
    expect(caps.canTriggerReview).toBe(false);
    const active = resolve({
      detail: { status: "active", approval_instance_id: 9 },
      roles: ["site_manager"]
    });
    expect(active.canRequestAmountChange).toBe(false);
  });

  it("操作员没有写权限：什么入口都不给", () => {
    const caps = resolve({ roles: ["operator"] });
    expect(caps.canEditFields).toBe(false);
    expect(caps.canSubmit).toBe(false);
    expect(caps.attachmentUploadVia).toBeNull();
  });

  it("审批中：资料锁定；当前审批人走审批接口补附件", () => {
    const detail = { status: "pending_approval", approval_instance_id: 9 };
    const approver = resolve({
      detail,
      approvalDetail: approval("in_progress", ["approve"])
    });
    expect(approver.canEditFields).toBe(false);
    expect(approver.canSubmit).toBe(false);
    expect(approver.attachmentUploadVia).toBe("approval");
    expect(approver.canRemoveAttachment).toBe(false);

    const others = resolve({
      detail,
      approvalDetail: approval("in_progress", [])
    });
    expect(others.attachmentUploadVia).toBeNull();
  });

  it("实例在跑但业务状态还是草稿：按审批中处理", () => {
    const caps = resolve({
      detail: { status: "draft", approval_instance_id: 9 },
      approvalDetail: approval("in_progress", [])
    });
    expect(caps.canEditFields).toBe(false);
    expect(caps.canSubmit).toBe(false);
  });

  it("退回或驳回后回到草稿：恢复可改可提交", () => {
    const caps = resolve({
      detail: { status: "draft", approval_instance_id: 9 },
      approvalDetail: approval("rejected")
    });
    expect(caps.canEditFields).toBe(true);
    expect(caps.canEditAmount).toBe(true);
    expect(caps.canSubmit).toBe(true);
  });

  it("审批通过生效：资料锁定，能补附件，金额走变更", () => {
    const caps = resolve({
      detail: { status: "active", approval_instance_id: 9 },
      approvalDetail: approval("approved")
    });
    expect(caps.canEditFields).toBe(false);
    expect(caps.canEditAmount).toBe(false);
    expect(caps.canSubmit).toBe(false);
    expect(caps.canTriggerReview).toBe(false);
    expect(caps.canRequestAmountChange).toBe(true);
    expect(caps.attachmentUploadVia).toBe("biz");
    expect(caps.canRemoveAttachment).toBe(false);
  });

  it("没走过审批的存量生效合同：资料能改，金额不能（后端会拒绝）", () => {
    const caps = resolve({
      detail: { status: "active", approval_instance_id: null }
    });
    expect(caps.canEditFields).toBe(true);
    expect(caps.canEditAmount).toBe(false);
    expect(caps.canSubmit).toBe(false);
  });

  it("已终止、已完成：普通角色不再改资料", () => {
    for (const status of ["terminated", "completed"]) {
      const caps = resolve({ detail: { status, approval_instance_id: null } });
      expect(caps.canEditFields).toBe(false);
      expect(caps.canRequestAmountChange).toBe(false);
    }
  });

  it("超管编辑模式：解锁资料和金额，开关只在锁定时出现", () => {
    const detail = { status: "active", approval_instance_id: 9 };
    const locked = resolve({ detail, roles: ["super_admin"] });
    expect(locked.canToggleSuperEdit).toBe(true);
    expect(locked.canEditFields).toBe(false);

    const unlocked = resolve({
      detail,
      roles: ["super_admin"],
      superEditMode: true
    });
    expect(unlocked.canEditFields).toBe(true);
    expect(unlocked.canEditAmount).toBe(true);
    expect(unlocked.canRemoveAttachment).toBe(true);

    expect(
      resolve({ roles: ["super_admin"] }).canToggleSuperEdit,
      "草稿本来就能改，不需要开关"
    ).toBe(false);
  });

  it("不是超管时打开编辑模式也不生效", () => {
    const caps = resolve({
      detail: { status: "active", approval_instance_id: 9 },
      superEditMode: true
    });
    expect(caps.canEditFields).toBe(false);
    expect(caps.canEditAmount).toBe(false);
  });
});

describe("金额变更状态", () => {
  it("待提交的才能提交，审批在跑时不能再提交一次", () => {
    const roles = ["finance"];
    expect(
      canSubmitAmountChange({ status: "pending", approval_status: null }, roles)
    ).toBe(true);
    expect(
      canSubmitAmountChange(
        { status: "pending", approval_status: "in_progress" },
        roles
      )
    ).toBe(false);
    expect(
      canSubmitAmountChange(
        { status: "pending", approval_status: "returned" },
        roles
      )
    ).toBe(true);
    expect(
      canSubmitAmountChange(
        { status: "approved", approval_status: "approved" },
        roles
      )
    ).toBe(false);
  });

  it("项目经理没有金额变更权限", () => {
    expect(
      canSubmitAmountChange({ status: "pending", approval_status: null }, [
        "site_manager"
      ])
    ).toBe(false);
  });

  it("pending 要结合审批实例才能说清楚走到哪了", () => {
    const label = (status: string, approval_status: string | null) =>
      toAmountChangeStatus({ status, approval_status }).label;
    expect(label("pending", null)).toBe("待提交");
    expect(label("pending", "in_progress")).toBe("审批中");
    expect(label("pending", "returned")).toBe("已退回");
    expect(label("pending", "withdrawn")).toBe("已撤回");
    expect(label("approved", "approved")).toBe("已通过");
    expect(label("rejected", "rejected")).toBe("已驳回");
  });
});

describe("buildContractProgress", () => {
  const base = {
    total_amount: 1000,
    paid_amount: 250,
    invoiced_amount: 0,
    received_amount: 0
  };

  it("付款合同：已付比例和余额", () => {
    const { rows, remaining } = buildContractProgress({
      ...base,
      direction: "outbound"
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: "已付款",
      percent: 25,
      over: false
    });
    expect(remaining).toBe(750);
  });

  it("收款合同：开票和到账两行，超出时标红且封顶 100%", () => {
    const { rows, remaining } = buildContractProgress({
      ...base,
      direction: "inbound",
      invoiced_amount: 1200,
      received_amount: 400
    });
    expect(rows.map(row => [row.label, row.percent, row.over])).toEqual([
      ["已开票", 100, true],
      ["已到账", 40, false]
    ]);
    expect(remaining).toBeNull();
  });

  it("总额为 0 的单价合同：不算比例和余额", () => {
    const { rows, remaining } = buildContractProgress({
      ...base,
      total_amount: 0,
      direction: "outbound"
    });
    expect(rows[0]).toMatchObject({ percent: null, over: false });
    expect(remaining).toBeNull();
  });
});

describe("effectivePaymentTotal", () => {
  it("作废和被拒的付款不计入合计", () => {
    const row = (amount: number, status: string) => ({
      id: 1,
      serial_no: "SP",
      amount,
      status,
      created_at: ""
    });
    expect(
      effectivePaymentTotal([
        row(100, "paid"),
        row(50, "pending_approval"),
        row(999, "cancelled"),
        row(888, "rejected")
      ])
    ).toBe(150);
  });
});

describe("contractTypeOptions", () => {
  it("存量类型不在默认选项里时要补上", () => {
    expect(contractTypeOptions("人工")).not.toContain("服务");
    expect(contractTypeOptions("服务")).toContain("服务");
    expect(contractTypeOptions("")).toHaveLength(5);
  });
});
