import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  getPendingByToken: vi.fn(),
  confirmPendingAction: vi.fn(),
  rejectPendingAction: vi.fn(),
  message: vi.fn(),
  confirmBox: vi.fn()
}));

vi.mock("@/api/agent", () => ({
  getPendingByToken: mocks.getPendingByToken,
  confirmPendingAction: mocks.confirmPendingAction,
  rejectPendingAction: mocks.rejectPendingAction
}));
vi.mock("@/utils/message", () => ({ message: mocks.message }));
vi.mock("vue-router", () => ({
  useRoute: () => ({ query: { token: "tok-1" } })
}));
// 真实的 ElMessageBox.confirm 会挂一个等待用户点击的对话框，返回的 Promise 在组件
// 测试里永远不会 settle（没人去点那个按钮），确认流程就卡死了。沿用仓库里
// SplitEnvelopeDialog.spec.ts 的做法，只替换 confirm，其余保持真实实现。
vi.mock("element-plus", async () => {
  const actual =
    await vi.importActual<typeof import("element-plus")>("element-plus");
  return {
    ...actual,
    ElMessageBox: { ...actual.ElMessageBox, confirm: mocks.confirmBox }
  };
});

import Confirm from "./confirm.vue";

const view = (over: Record<string, unknown> = {}) => ({
  id: "p1",
  action_kind: "approval.approve",
  summary: "批准审批单 #42",
  status: "pending",
  detail: {
    action_kind: "approval.approve",
    verb: "批准",
    target: "审批单 #42",
    approval: {
      instance_no: "SP-20260719-001",
      biz_type: "payment",
      biz_summary: "PT-001 | 某某公司 | ￥120,000",
      initiator_userid: "ZhangSan"
    },
    agent_comment: "金额与合同一致，建议批准"
  },
  created_at: "2026-07-19T02:00:00.000Z",
  expires_at: "2026-07-19T02:10:00.000Z",
  confirmed_at: null,
  executed_at: null,
  result: null,
  ...over
});

const mountPage = async (data: unknown) => {
  mocks.getPendingByToken.mockResolvedValue({ success: true, data });
  const w = mount(Confirm, {
    global: {
      stubs: {
        "el-button": {
          template: "<button @click=\"$emit('click')\"><slot/></button>"
        }
      }
    }
  });
  await flushPromises();
  return w;
};

beforeEach(() => {
  vi.clearAllMocks();
  // 默认「用户点了确认」，需要测取消的用例自行覆盖
  mocks.confirmBox.mockResolvedValue("confirm");
});

describe("confirm.vue 展示", () => {
  it("渲染动作、目标、业务上下文与 agent 意见", async () => {
    const w = await mountPage(view());
    const text = w.text();
    expect(text).toContain("批准");
    expect(text).toContain("审批单 #42");
    expect(text).toContain("SP-20260719-001");
    expect(text).toContain("￥120,000");
    expect(text).toContain("金额与合同一致，建议批准");
  });

  it("把 agent 意见明确标注为智能体填写、将以本人名义入库", async () => {
    const w = await mountPage(view());
    expect(w.text()).toContain("智能体填写");
    expect(w.text()).toContain("你的名义");
  });

  it("verb 为 null 时不臆造动词，改为提示动作类型未登记", async () => {
    const w = await mountPage(
      view({ detail: { ...(view().detail as object), verb: null } })
    );
    expect(w.text()).not.toContain("批准审批单 #42（");
    expect(w.text()).toContain("approval.approve");
  });

  it("detail 为 null（历史行）时降级为 summary，仍可操作", async () => {
    const w = await mountPage(view({ detail: null }));
    expect(w.text()).toContain("批准审批单 #42");
  });

  it("token 无效时提示且不渲染操作按钮", async () => {
    mocks.getPendingByToken.mockRejectedValue(new Error("404"));
    const w = mount(Confirm);
    await flushPromises();
    expect(w.text()).toContain("无法打开");
    expect(w.text()).not.toContain("确认执行");
  });
});

describe("confirm.vue 操作", () => {
  it("确认成功后展示终态，不再显示操作按钮", async () => {
    const w = await mountPage(view());
    mocks.confirmPendingAction.mockResolvedValue({
      success: true,
      data: view({ status: "done" })
    });
    await w.find("button.confirm-btn").trigger("click");
    await flushPromises();
    expect(mocks.confirmPendingAction).toHaveBeenCalledWith("p1");
    expect(w.text()).toContain("已执行");
    expect(w.find("button.confirm-btn").exists()).toBe(false);
  });

  it("确认前先二次确认；用户取消则不发起请求", async () => {
    const w = await mountPage(view());
    mocks.confirmBox.mockRejectedValue("cancel");
    await w.find("button.confirm-btn").trigger("click");
    await flushPromises();
    expect(mocks.confirmBox).toHaveBeenCalled();
    // 二次确认文案必须复述将要执行的动作与目标
    expect(String(mocks.confirmBox.mock.calls[0][0])).toContain("审批单 #42");
    expect(mocks.confirmPendingAction).not.toHaveBeenCalled();
    expect(w.find("button.confirm-btn").exists()).toBe(true);
  });

  it("密钥未配置(503)时提示可稍后重试，且不把动作显示为失败", async () => {
    const w = await mountPage(view());
    const err = Object.assign(new Error("配置"), { response: { status: 503 } });
    mocks.confirmPendingAction.mockRejectedValue(err);
    await w.find("button.confirm-btn").trigger("click");
    await flushPromises();
    expect(mocks.message).toHaveBeenCalled();
    // 仍停留在可确认状态，供稍后重试
    expect(w.find("button.confirm-btn").exists()).toBe(true);
  });

  it("拒绝后展示已拒绝", async () => {
    const w = await mountPage(view());
    mocks.rejectPendingAction.mockResolvedValue({
      success: true,
      data: { ...view({ status: "rejected" }), rejected: true }
    });
    await w.find("button.reject-btn").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("已拒绝");
  });

  it("rejected:false（已被他路结算）时如实展示当前状态而非谎报成功", async () => {
    const w = await mountPage(view());
    mocks.rejectPendingAction.mockResolvedValue({
      success: true,
      data: { ...view({ status: "done" }), rejected: false }
    });
    await w.find("button.reject-btn").trigger("click");
    await flushPromises();
    expect(w.text()).toContain("已执行");
  });

  it("已过期时不显示操作按钮", async () => {
    const w = await mountPage(view({ status: "expired" }));
    expect(w.find("button.confirm-btn").exists()).toBe(false);
  });
});
