import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import { useElementPlus } from "@/plugins/elementPlus";
import AiReviewReport from "./index.vue";

/**
 * 回归护栏：本组件是业务级 AI 审查报告在审批端/详情页的唯一渲染出口，
 * 下列每一条都对应一个已确认并修复的缺陷，改动时不得回退。
 */

const mountReport = (props: {
  source?: string | Record<string, unknown> | null;
  kind: "contract" | "payment";
  status?: string | null;
}) =>
  mount(AiReviewReport, {
    props,
    global: { plugins: [useElementPlus] }
  });

describe("AiReviewReport — 金额合理性语义轴", () => {
  it("reasonableness=low 是「合理性低」，必须红色告警而非绿色安全色", () => {
    // 生产 CT-20260805-0001 实据：low 同时列了多条 risk_points，指金额依据不足
    const wrapper = mountReport({
      kind: "contract",
      status: "completed",
      source: {
        amount_assessment: {
          reasonableness: "low",
          basis: "未载明总价与台班单价",
          risk_points: ["缺附件依据"]
        }
      }
    });
    const tag = wrapper.find(".ai-review-report__label .el-tag");
    expect(tag.exists()).toBe(true);
    expect(tag.text()).toBe("低");
    expect(tag.classes()).toContain("el-tag--danger");
  });

  it("reasonableness=high 是「合理性高」，显示为绿色", () => {
    const wrapper = mountReport({
      kind: "contract",
      status: "completed",
      source: {
        amount_assessment: { reasonableness: "high", basis: "与预算一致" }
      }
    });
    expect(
      wrapper.find(".ai-review-report__label .el-tag").classes()
    ).toContain("el-tag--success");
  });

  it("旧结构 reasonable=true（合理）与新结构同轴映射为 high", () => {
    const wrapper = mountReport({
      kind: "contract",
      status: "completed",
      source: {
        amount_assessment: { reasonable: true, comment: "与市场价相符" }
      }
    });
    const tag = wrapper.find(".ai-review-report__label .el-tag");
    expect(tag.text()).toBe("高");
    expect(tag.classes()).toContain("el-tag--success");
  });
});

describe("AiReviewReport — 不得吞掉模型结论", () => {
  it("能解析但字段不认识的报告原样兜底，不落空态", () => {
    // 服务端对这类结果是原样透传的，本组件是最后一道防线
    const wrapper = mountReport({
      kind: "contract",
      status: "completed",
      source: '{"risk_level":"low","conclusion":"金额与合同一致"}'
    });
    expect(wrapper.text()).toContain("金额与合同一致");
    expect(wrapper.text()).toContain("非标准结构");
  });

  it("已解析对象同样兜底（四个调用点里三个传的是对象）", () => {
    const wrapper = mountReport({
      kind: "payment",
      status: "completed",
      source: { output: "x", metadata: { summary: "重复支付风险", score: 50 } }
    });
    expect(wrapper.text()).toContain("重复支付风险");
  });

  it("完全无法解析的纯文本也保留原文", () => {
    const wrapper = mountReport({
      kind: "contract",
      status: "completed",
      source: "模型返回了一段自由文本结论"
    });
    expect(wrapper.text()).toContain("模型返回了一段自由文本结论");
  });
});

describe("AiReviewReport — 状态与内容的优先级", () => {
  it("重新触发审查（pending）时保留上一轮报告，只做提示", () => {
    const wrapper = mountReport({
      kind: "payment",
      status: "pending",
      source: { overall_risk: "high", summary: "上一轮结论" }
    });
    expect(wrapper.text()).toContain("上一轮结论");
    expect(wrapper.text()).toContain("以下为上一次的结果");
  });

  it("pending 且无任何报告时才显示进行中占位", () => {
    const wrapper = mountReport({
      kind: "payment",
      status: "pending",
      source: null
    });
    expect(wrapper.text()).toContain("AI 审查进行中");
  });

  it("无报告显示暂无占位", () => {
    const wrapper = mountReport({
      kind: "contract",
      status: "none",
      source: null
    });
    expect(wrapper.text()).toContain("暂无 AI 审查报告");
  });
});

describe("AiReviewReport — 分档签只跟确定性计分", () => {
  it("带 score_basis 的结果显示分档", () => {
    const wrapper = mountReport({
      kind: "payment",
      status: "completed",
      source: {
        score: 70,
        score_basis: ["+50 重复支付：两笔同额"],
        summary: "s"
      }
    });
    expect(wrapper.text()).toContain("高风险（≥50）");
  });

  it("旧结果的分数是模型自编的，只显示数值不打分档", () => {
    const wrapper = mountReport({
      kind: "payment",
      status: "completed",
      source: { score: 70, summary: "s" }
    });
    expect(wrapper.text()).toContain("风险分 70");
    expect(wrapper.text()).not.toContain("高风险（≥50）");
  });
});

describe("AiReviewReport — 两代 schema 归一", () => {
  // el-table 的行内容在 happy-dom 下不进 DOM 文本，改为断言表格数据源——
  // 归一逻辑的产物正是这份 data
  const tableRows = (
    wrapper: ReturnType<typeof mountReport>
  ): Array<Record<string, unknown>> => {
    const table = wrapper.findComponent({ name: "ElTable" });
    expect(table.exists()).toBe(true);
    return table.props("data") as Array<Record<string, unknown>>;
  };

  it("旧合同条款的 comment 落到问题列", () => {
    const rows = tableRows(
      mountReport({
        kind: "contract",
        status: "completed",
        source: {
          clause_analysis: [
            {
              clause: "违约责任",
              risk_level: "high",
              comment: "缺失违约金约定"
            }
          ]
        }
      })
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].issue).toBe("缺失违约金约定");
    expect(rows[0].risk_level).toBe("high");
  });

  it("旧付款三段 *_check 合成等价发现项，异常映射为 warn", () => {
    const rows = tableRows(
      mountReport({
        kind: "payment",
        status: "completed",
        source: {
          frequency_check: { is_abnormal: true, comment: "近期付款异常密集" },
          duplicate_check: { found_duplicates: false, comment: "无重复" }
        }
      })
    );
    expect(rows.map(r => r.dimension)).toEqual([
      "frequency_anomaly",
      "duplicate_payment"
    ]);
    expect(rows[0]).toMatchObject({
      status: "warn",
      detail: "近期付款异常密集"
    });
    expect(rows[1].status).toBe("pass");
  });

  it("kind 与载荷形状不匹配时不渲染空白卡片，走原文兜底", () => {
    // hasBody 按 kind 计算：合同形状传成 payment 时两张表都不渲染
    const wrapper = mountReport({
      kind: "payment",
      status: "completed",
      source: {
        clause_analysis: [
          { clause: "付款条款", risk_level: "high", issue: "无验收挂钩" }
        ]
      }
    });
    expect(wrapper.text()).toContain("无验收挂钩");
  });
});
