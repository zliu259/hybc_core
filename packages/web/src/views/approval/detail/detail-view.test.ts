import { describe, expect, it } from "vitest";
import type {
  AiGateReview,
  ApprovalInstance,
  ApprovalTask
} from "@/api/approval";
import type { PaymentRequestDetail } from "@/api/payment";
import {
  readableAiComment,
  toAiVerdict,
  toTaskComment,
  toTaskDecision
} from "./ai-verdict";
import { buildBizView, type BizRecords } from "./biz-view";
import {
  canPreviewInline,
  formatFileSize,
  isMeaningfulComment,
  parseAttachments,
  splitRemark,
  toChineseAmount,
  toPaymentCategoryLabel
} from "./formatters";
import type { LabelContext } from "./types";

const ctx: LabelContext = {
  project: id => `项目${id}`,
  entity: id => `主体${id}`,
  user: userid => `用户${userid}`,
  canOpenFinance: true
};

const instance = {
  id: 478,
  instance_no: "SP-20261102-0005",
  biz_type: "payment_request",
  biz_id: 2956,
  biz_summary: "智能发单台-首笔预付款",
  initiator_userid: "LiuKun",
  submitted_at: "2026-11-02T06:14:24.200Z",
  completed_at: null
} as unknown as ApprovalInstance;

const noRecords: BizRecords = {
  payment: null,
  contract: null,
  amountChange: null,
  reimbursementBatch: null,
  invoiceRequest: null,
  invoiceContract: null,
  receiptRefund: null
};

const review = (overrides: Partial<AiGateReview>): AiGateReview => ({
  task_id: 1,
  node_key: "ai_gate_1",
  ai_slot_id: "approval_ai_gate",
  status: "completed",
  summary: null,
  recommendations: [],
  outcome: null,
  comment: null,
  error_message: null,
  created_at: "2026-11-02T06:14:23.294Z",
  completed_at: null,
  ...overrides
});

const task = (overrides: Partial<ApprovalTask>): ApprovalTask => ({
  id: 1,
  node_instance_id: 1,
  instance_id: 1,
  assignee_userid: "LiuPeng",
  action: "approve",
  comment: "同意",
  round: 1,
  status: "completed",
  acted_at: "2026-11-02T06:16:54.282Z",
  created_at: "2026-11-02T06:16:00.411Z",
  updated_at: "2026-11-02T06:16:54.282Z",
  ...overrides
});

describe("金额与文件大小", () => {
  it("大写金额不会写成「壹拾零万…伍拾零元」（生产存量里的错误写法）", () => {
    expect(toChineseAmount(107750.91)).toBe("壹拾万柒仟柒佰伍拾元玖角壹分");
    expect(toChineseAmount(100000)).toBe("壹拾万元整");
    expect(toChineseAmount(560)).toBe("伍佰陆拾元整");
  });

  it("大写金额不漏写该有的零，也不写多余的零元", () => {
    expect(toChineseAmount(200400)).toBe("贰拾万零肆佰元整");
    expect(toChineseAmount(10005)).toBe("壹万零伍元整");
    expect(toChineseAmount(100.05)).toBe("壹佰元零伍分");
    expect(toChineseAmount(0.5)).toBe("伍角");
  });

  it("文件大小换算成人能读的单位，不再显示裸字节数", () => {
    expect(formatFileSize(1923659)).toBe("1.8 MB");
    expect(formatFileSize(62078)).toBe("60.6 KB");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(null)).toBe("");
  });
});

describe("备注与附件解析", () => {
  it("系统追加的修改日志与发起人备注分开", () => {
    const { text, edits } = splitRemark(
      "2026.9月份员工工资\n[超管修改 2026-11-02T06:16:40.303Z] LiuPeng：小程序审批页更新支付信息\n[超管修改 2026-11-04T08:16:04.824Z] PangYueFeng：审批页更新支付信息"
    );
    expect(text).toBe("2026.9月份员工工资");
    expect(edits).toEqual([
      {
        at: "2026-11-02T06:16:40.303Z",
        by: "LiuPeng",
        note: "小程序审批页更新支付信息"
      },
      {
        at: "2026-11-04T08:16:04.824Z",
        by: "PangYueFeng",
        note: "审批页更新支付信息"
      }
    ]);
  });

  it("没有备注时返回空", () => {
    expect(splitRemark(null)).toEqual({ text: "", edits: [] });
  });

  it("附件解析容错：字符串、别名字段、非法项", () => {
    expect(
      parseAttachments(
        JSON.stringify([
          "a/b.pdf",
          { key: "c.png", name: "c.png", size: 3 },
          { nope: 1 },
          null
        ])
      )
    ).toEqual([
      { file_key: "a/b.pdf", file_name: "a/b.pdf" },
      { file_key: "c.png", file_name: "c.png", file_size: 3 }
    ]);
    expect(parseAttachments("not-json")).toEqual([]);
  });

  it("只有浏览器能直接打开的类型才内嵌预览", () => {
    expect(canPreviewInline("工资表.PDF")).toBe(true);
    expect(canPreviewInline("照片.jpeg")).toBe(true);
    expect(canPreviewInline("清单.xlsx")).toBe(false);
  });

  it("「同意」这类意见不重复显示，真实意见保留", () => {
    expect(isMeaningfulComment("同意")).toBe(false);
    expect(isMeaningfulComment(" 通过 ")).toBe(false);
    expect(isMeaningfulComment("金额需再核对")).toBe(true);
    expect(isMeaningfulComment(null)).toBe(false);
  });

  it("发单台写入的付款阶段显示中文", () => {
    expect(toPaymentCategoryLabel("settlement")).toBe("结算款");
    expect(toPaymentCategoryLabel("材料费")).toBe("材料费");
  });
});

describe("buildBizView", () => {
  const payment = {
    id: 2956,
    serial_no: "PM-20261102-0003",
    contract_id: 702,
    project_id: 143,
    amount: 107750.91,
    content: "员工工资",
    category: "settlement",
    payment_method: "transfer",
    expected_payment_date: "2026-11-09",
    remark:
      "2026.9月份员工工资\n[超管修改 2026-11-02T06:16:40.303Z] LiuPeng：小程序审批页更新支付信息",
    payee: { name: "员工", bank_name: "无", bank_account: "无" },
    contract: { contract_no: "CT-20261102-0002", counterparty: "员工" }
  } as unknown as PaymentRequestDetail;

  it("付款：头部突出金额和事由，备注去掉系统日志", () => {
    const view = buildBizView(instance, { ...noRecords, payment }, ctx);
    expect(view.hero.amount).toBe(107750.91);
    expect(view.hero.title).toBe("员工工资");
    expect(view.hero.bizNo).toBe("PM-20261102-0003");
    expect(view.hero.bizNoTo).toBe("/finance/payment/detail/2956");
    const remark = view.rows.find(row => row.label === "备注");
    expect(remark?.value).toBe("2026.9月份员工工资");
    expect(view.rows.find(row => row.label === "审批摘要")?.value).toBe(
      "智能发单台-首笔预付款"
    );
  });

  it("付款单：同时显示我方付款单位和付款账户，所有查看者都能看到", () => {
    const view = buildBizView(
      instance,
      {
        ...noRecords,
        payment: {
          ...payment,
          payment_entity_id: 22,
          payment_account: "中国农业银行 / 5066"
        }
      },
      ctx
    );
    const labels = view.hero.facts.map(fact => fact.label);
    expect(labels.indexOf("付款单位")).toBe(0);
    expect(labels.indexOf("收款方")).toBe(1);
    expect(view.hero.facts[0].value).toBe("主体22");
    expect(view.rows.find(row => row.label === "付款账户")?.value).toBe(
      "中国农业银行 / 5066"
    );
  });

  it("付款单位还没选时明确提示，不显示成短横线", () => {
    const view = buildBizView(
      instance,
      {
        ...noRecords,
        payment: {
          ...payment,
          payment_entity_id: null,
          payment_account: null
        }
      },
      ctx
    );
    expect(view.hero.facts[0]).toEqual({
      label: "付款单位",
      value: "尚未指定"
    });
    expect(view.rows.find(row => row.label === "付款账户")?.value).toBe(
      "尚未指定"
    );
  });

  it("报销批次：头部显示付款单位，优先用接口返回的名称", () => {
    const batch = {
      id: 7,
      batch_no: "BX-1",
      project_id: 7,
      applicant_userid: "LiuKun",
      item_count: 2,
      total_amount: 100,
      status: "submitted",
      payment_method: "transfer",
      payment_account: "账户",
      payment_entity_id: 22,
      payment_entity: { id: 22, entity_code: "X", entity_name: "北京鑫丰畅" }
    } as unknown as NonNullable<BizRecords["reimbursementBatch"]>;
    const view = buildBizView(
      instance,
      { ...noRecords, reimbursementBatch: batch },
      ctx
    );
    expect(view.hero.facts[0]).toEqual({
      label: "付款单位",
      value: "北京鑫丰畅"
    });
  });

  it("没有财务权限时业务编号不可点", () => {
    const view = buildBizView(
      instance,
      { ...noRecords, payment },
      { ...ctx, canOpenFinance: false }
    );
    expect(view.hero.bizNoTo).toBeNull();
  });

  it("业务详情未返回时先用审批实例信息渲染", () => {
    const view = buildBizView(instance, noRecords, ctx);
    expect(view.hero.amount).toBeNull();
    expect(view.hero.title).toBe("智能发单台-首笔预付款");
    expect(view.rows).toEqual([]);
  });
});

describe("splitRemark 作废和激活记录", () => {
  it("VOID、REACTIVATE 行不混进备注正文，归到修改记录", () => {
    const { text, edits } = splitRemark(
      "按月结算\n[VOID 2026-03-16T05:58:05.444Z] boss: 重复提交\n[REACTIVATE 2026-03-16T06:17:25.639Z] boss"
    );
    expect(text).toBe("按月结算");
    expect(edits).toEqual([
      {
        at: "2026-03-16T05:58:05.444Z",
        by: "boss",
        note: "作废付款：重复提交"
      },
      { at: "2026-03-16T06:17:25.639Z", by: "boss", note: "重新激活" }
    ]);
  });
});

describe("AI 结论", () => {
  it("三态判定优先，主文用模型摘要而不是整段意见", () => {
    const verdict = toAiVerdict(
      review({
        decision: "warn",
        outcome: "approve",
        summary: "申请金额与工资表实发合计不一致",
        comment: "AI审查放行（需人工重点关注）：申请金额与工资表实发合计不一致"
      })
    );
    expect(verdict.label).toBe("放行·需人工关注");
    expect(verdict.tagType).toBe("warning");
    expect(verdict.summary).toBe("申请金额与工资表实发合计不一致");
  });

  it("旧数据 summary 是裸 JSON 时解开", () => {
    const verdict = toAiVerdict(
      review({
        summary: '```json\n{"outcome":"reject","comment":"请补充发票材料"}\n```'
      })
    );
    expect(verdict.label).toBe("建议补充材料");
    expect(verdict.summary).toBe("请补充发票材料");
  });

  it("人工任务显示动作标签，AI 任务按意见前缀显示三态", () => {
    expect(toTaskDecision(task({}))?.label).toBe("通过");
    expect(toTaskDecision(task({}))?.tagType).toBe("success");
    expect(toTaskDecision(task({ action: "reject" }))?.tagType).toBe("danger");
    expect(toTaskDecision(task({ action: null }))).toBeNull();

    const aiTask = task({
      assignee_userid: "AI_GATE",
      action: "reject",
      comment: "AI审查不通过：金额矛盾｜依据：amount_terms：合同金额不一致"
    });
    expect(toTaskDecision(aiTask)?.label).toBe("建议拒绝");
    // 判定由标签表达，依据在 AI 审查区逐条展示，时间线只留一句结论
    expect(toTaskComment(aiTask)).toBe("金额矛盾");
  });

  it("AI 意见里的维度标识换成中文", () => {
    expect(readableAiComment("依据：amount_terms：合同金额不一致")).toBe(
      "依据：金额条款：合同金额不一致"
    );
  });
});
