import { describe, expect, it } from "vitest";
import type { ApprovalDetailResponse } from "@/api/approval";
import type { Payee } from "@/api/payment";
import {
  contractRemaining,
  isDateOnly,
  mergeCurrentPayee,
  mergeRemarkEditLog,
  resolvePaymentCapabilities,
  type CapabilityInput
} from "./payment-detail-view";

const approval = (status: string, actions: string[] = []) =>
  ({
    instance: { status },
    available_actions: actions
  }) as unknown as Pick<
    ApprovalDetailResponse,
    "instance" | "available_actions"
  >;

const resolve = (overrides: Partial<CapabilityInput>) =>
  resolvePaymentCapabilities({
    detail: { status: "draft", approval_instance_id: null },
    approvalDetail: null,
    roles: ["finance"],
    superEditMode: false,
    ...overrides
  });

describe("resolvePaymentCapabilities", () => {
  it("详情没加载出来时什么都不能做", () => {
    const caps = resolve({ detail: null, roles: ["super_admin"] });
    expect(Object.values(caps).filter(Boolean)).toEqual([]);
  });

  it("草稿：能改、能提交、能评估", () => {
    const caps = resolve({});
    expect(caps.canEditFields).toBe(true);
    expect(caps.canSubmit).toBe(true);
    expect(caps.canAssessRisk).toBe(true);
    expect(caps.canMarkPaid).toBe(false);
    expect(caps.attachmentUploadVia).toBe("payment");
    expect(caps.canRemoveAttachment).toBe(true);
    expect(caps.canToggleSuperEdit).toBe(false);
  });

  it("操作员没有 PUT 权限：草稿只能提交，不给保存和上传入口", () => {
    const caps = resolve({ roles: ["operator"] });
    expect(caps.canSubmit).toBe(true);
    expect(caps.canEditFields).toBe(false);
    expect(caps.canAssessRisk).toBe(false);
    expect(caps.attachmentUploadVia).toBeNull();
    expect(caps.canRemoveAttachment).toBe(false);
  });

  it("审批中：字段锁定；当前审批人走审批接口补附件、可调付款账户", () => {
    const caps = resolve({
      detail: { status: "pending_approval", approval_instance_id: 9 },
      approvalDetail: approval("in_progress", ["approve", "reject"])
    });
    expect(caps.canEditFields).toBe(false);
    expect(caps.canSubmit).toBe(false);
    expect(caps.canAdjustPayout).toBe(true);
    expect(caps.attachmentUploadVia).toBe("approval");
    expect(caps.canRemoveAttachment).toBe(false);
  });

  it("审批中：不是当前审批人就没有入口（后端会拒绝）", () => {
    const caps = resolve({
      detail: { status: "pending_approval", approval_instance_id: 9 },
      approvalDetail: approval("in_progress", [])
    });
    expect(caps.canAdjustPayout).toBe(false);
    expect(caps.attachmentUploadVia).toBeNull();
  });

  it("实例在跑但业务状态还是草稿：按审批中处理", () => {
    const caps = resolve({
      detail: { status: "draft", approval_instance_id: 9 },
      approvalDetail: approval("in_progress", [])
    });
    expect(caps.canEditFields).toBe(false);
    expect(caps.canSubmit).toBe(false);
  });

  it("退回后回到草稿：恢复可改可提交", () => {
    const caps = resolve({
      detail: { status: "draft", approval_instance_id: 9 },
      approvalDetail: approval("returned")
    });
    expect(caps.canEditFields).toBe(true);
    expect(caps.canSubmit).toBe(true);
  });

  it("已审批：财务和经理能标记付款，项目经理不能", () => {
    const detail = { status: "approved", approval_instance_id: 9 };
    expect(resolve({ detail }).canMarkPaid).toBe(true);
    expect(resolve({ detail, roles: ["manager"] }).canMarkPaid).toBe(true);
    expect(resolve({ detail, roles: ["site_manager"] }).canMarkPaid).toBe(
      false
    );
    expect(resolve({ detail }).canSubmit).toBe(false);
    expect(resolve({ detail }).canEditFields).toBe(false);
  });

  it("审批结束：能补传附件，不能删", () => {
    const caps = resolve({
      detail: { status: "paid", approval_instance_id: 9 },
      approvalDetail: approval("approved")
    });
    expect(caps.attachmentUploadVia).toBe("payment");
    expect(caps.canRemoveAttachment).toBe(false);
  });

  it("没有审批实例的历史已付款单：后端不让写，不给上传入口", () => {
    const caps = resolve({
      detail: { status: "paid", approval_instance_id: null }
    });
    expect(caps.attachmentUploadVia).toBeNull();
    expect(caps.canEditFields).toBe(false);
  });

  it("废除、重新激活只给超管，且只给当前状态能用的那个", () => {
    const detail = { status: "approved", approval_instance_id: 9 };
    expect(resolve({ detail }).canVoid).toBe(false);
    const admin = resolve({ detail, roles: ["super_admin"] });
    expect(admin.canVoid).toBe(true);
    expect(admin.canReactivate).toBe(false);
    const cancelled = resolve({
      detail: { status: "cancelled", approval_instance_id: 9 },
      roles: ["super_admin"]
    });
    expect(cancelled.canVoid).toBe(false);
    expect(cancelled.canReactivate).toBe(true);
  });

  it("超管编辑模式：解锁字段、附件和付款账户，开关只在锁定时出现", () => {
    const detail = { status: "pending_approval", approval_instance_id: 9 };
    const running = approval("in_progress", []);
    const locked = resolve({
      detail,
      approvalDetail: running,
      roles: ["super_admin"]
    });
    expect(locked.canToggleSuperEdit).toBe(true);
    expect(locked.canEditFields).toBe(false);
    // 超管不是当前审批人也能走审批接口补附件
    expect(locked.attachmentUploadVia).toBe("approval");

    const unlocked = resolve({
      detail,
      approvalDetail: running,
      roles: ["super_admin"],
      superEditMode: true
    });
    expect(unlocked.canEditFields).toBe(true);
    expect(unlocked.canAdjustPayout).toBe(true);
    expect(unlocked.attachmentUploadVia).toBe("payment");
    expect(unlocked.canRemoveAttachment).toBe(true);

    expect(
      resolve({ roles: ["super_admin"] }).canToggleSuperEdit,
      "草稿本来就能改，不需要开关"
    ).toBe(false);
  });

  it("不是超管时打开编辑模式也不生效", () => {
    const caps = resolve({
      detail: { status: "approved", approval_instance_id: 9 },
      superEditMode: true
    });
    expect(caps.canEditFields).toBe(false);
  });
});

describe("contractRemaining", () => {
  const contract = (total_amount: number, paid_amount: number) => ({
    contract_no: "HT-1",
    counterparty: "对方",
    total_amount,
    paid_amount,
    entity_id: 1
  });

  it("算余额，付超了就是负数", () => {
    expect(contractRemaining(contract(500, 200))).toBe(300);
    expect(contractRemaining(contract(500, 600))).toBe(-100);
  });

  it("无合同或总额为 0 时不算", () => {
    expect(contractRemaining(null)).toBeNull();
    expect(contractRemaining(contract(0, 0))).toBeNull();
  });
});

describe("isDateOnly", () => {
  it("只认纯日期", () => {
    expect(isDateOnly("2026-11-05")).toBe(true);
    expect(isDateOnly("2026-11-05T01:00:00.000Z")).toBe(false);
    expect(isDateOnly(null)).toBe(false);
  });
});

describe("mergeRemarkEditLog", () => {
  const log = "[超管修改 2026-10-01T02:03:04.000Z] admin：改账户";

  it("改备注时保留系统修改记录", () => {
    expect(mergeRemarkEditLog(" 新备注 ", `旧备注\n${log}`)).toBe(
      `新备注\n${log}`
    );
  });

  it("备注清空时只留修改记录，没有记录时就是空串", () => {
    expect(mergeRemarkEditLog("", `旧备注\n${log}`)).toBe(log);
    expect(mergeRemarkEditLog("", "旧备注")).toBe("");
    expect(mergeRemarkEditLog("新备注", null)).toBe("新备注");
  });
});

describe("mergeCurrentPayee", () => {
  const payee = {
    id: 1,
    name: "甲",
    bank_name: "工行",
    bank_account: "1"
  } as Payee;
  const snapshot = { name: "乙", bank_name: "建行", bank_account: "2" };

  it("当前收款人已在列表里时原样返回", () => {
    const list = [payee];
    expect(mergeCurrentPayee(list, { payee_id: 1, payee: snapshot })).toBe(
      list
    );
  });

  it("当前收款人被停用时补进列表最前面，不改原数组", () => {
    const list = [payee];
    const merged = mergeCurrentPayee(list, { payee_id: 2, payee: snapshot });
    expect(merged.map(item => item.id)).toEqual([2, 1]);
    expect(list).toHaveLength(1);
  });

  it("详情未加载时返回原列表", () => {
    const list = [payee];
    expect(mergeCurrentPayee(list, null)).toBe(list);
  });
});
