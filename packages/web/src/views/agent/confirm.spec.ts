import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";

const mocks = vi.hoisted(() => ({
  getPendingByToken: vi.fn(),
  getPendingAction: vi.fn(),
  confirmPendingAction: vi.fn(),
  rejectPendingAction: vi.fn(),
  message: vi.fn(),
  confirmBox: vi.fn(),
  // useRoute() 要返回同一个【响应式】对象，测试才能改 query.token 模拟
  // 「页面已开着，用户又点了第二张卡片的链接」——组件会被复用，不会重新挂载。
  routeHolder: { current: null as { query: { token?: string } } | null }
}));

vi.mock("@/api/agent", () => ({
  getPendingByToken: mocks.getPendingByToken,
  getPendingAction: mocks.getPendingAction,
  confirmPendingAction: mocks.confirmPendingAction,
  rejectPendingAction: mocks.rejectPendingAction
}));
vi.mock("@/utils/message", () => ({ message: mocks.message }));
vi.mock("vue-router", () => ({
  useRoute: () => mocks.routeHolder.current
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

import { reactive } from "vue";
import Confirm from "./confirm.vue";

// useRoute() 在组件 setup 时才被调用，所以这里赋值来得及。
const route = reactive({ query: { token: "tok-1" } as { token?: string } });
mocks.routeHolder.current = route;

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
  route.query.token = "tok-1";
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
    const said = mocks.message.mock.calls.map(c => String(c[0]));
    expect(said.some(t => t.includes("系统尚未完成配置"))).toBe(true);
    // 503 是服务端【明确承诺没有认领这个动作】，所以无需、也不该去重新核对状态；
    // 这条断言正是 503 特判存在与否的分水岭（去掉特判就会走通用「结果未知」路径）。
    expect(mocks.getPendingAction).not.toHaveBeenCalled();
    // 仍停留在可确认状态，供稍后重试
    expect(w.text()).toContain("待确认");
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

// [HIGH 1] 未知错误（典型：http 客户端 10s 超时，而 confirm 端点要同步跑完
// 审计写 → claim → 完整重放审批写 → finish → 再审计写）之后，服务端很可能【已经
// 以员工名义把审批落库了】。此时继续显示「待确认 + 确认执行」是在臆测一个确定
// 结果，且是最危险的那个方向——员工会再点一次。
describe("confirm.vue 结果未知时的处理", () => {
  const timeoutError = () =>
    Object.assign(new Error("timeout of 10000ms exceeded"), {
      code: "ECONNABORTED"
    });

  it("确认超时后不再显示待确认与可点按钮，并重新拉取真实状态", async () => {
    const w = await mountPage(view());
    mocks.confirmPendingAction.mockRejectedValue(timeoutError());
    mocks.getPendingAction.mockResolvedValue({
      success: true,
      data: view({ status: "done" })
    });
    await w.find("button.confirm-btn").trigger("click");
    await flushPromises();

    expect(mocks.getPendingAction).toHaveBeenCalledWith("p1");
    // 服务端其实已经执行完了——页面必须如实改口，而不是停在「待确认」
    expect(w.text()).toContain("已执行");
    expect(w.text()).not.toContain("待确认");
    expect(w.find("button.confirm-btn").exists()).toBe(false);
    // 不把 axios 的英文原文摔到员工脸上
    expect(w.text()).not.toContain("timeout of 10000ms exceeded");
  });

  it("重新拉取也失败时明确告知结果未知、禁止重复操作，且不给按钮", async () => {
    const w = await mountPage(view());
    mocks.confirmPendingAction.mockRejectedValue(timeoutError());
    mocks.getPendingAction.mockRejectedValue(new Error("network down"));
    await w.find("button.confirm-btn").trigger("click");
    await flushPromises();

    expect(w.text()).toContain("结果未知");
    expect(w.text()).toContain("请勿重复操作");
    expect(w.text()).not.toContain("待确认");
    expect(w.find("button.confirm-btn").exists()).toBe(false);
    expect(w.find("button.reject-btn").exists()).toBe(false);
  });

  it("核对结果返回前也不得渲染成任何确定状态", async () => {
    const w = await mountPage(view());
    mocks.confirmPendingAction.mockRejectedValue(timeoutError());
    // 让重新拉取悬着不 settle，观察中间态
    mocks.getPendingAction.mockReturnValue(new Promise(() => {}));
    await w.find("button.confirm-btn").trigger("click");
    await flushPromises();

    expect(w.text()).toContain("正在核对");
    expect(w.text()).not.toContain("待确认");
    expect(w.text()).not.toContain("已执行");
    expect(w.find("button.confirm-btn").exists()).toBe(false);
  });
});

// [HIGH 2] 503 之后服务端把行留在 confirmed（刻意不 claim、不 finish），
// 恢复方式就是【再 POST 一次 confirm】。把 confirmed 当终态渲染，等于这条链路
// 唯一的人类界面拒绝提供服务端专门为它保留的恢复动作，行会被 sweep 成 failed。
describe("confirm.vue confirmed 可恢复", () => {
  it("confirmed 不渲染成已结束，而是给出重试执行与刷新状态", async () => {
    const w = await mountPage(view({ status: "confirmed" }));
    expect(w.find("button.retry-btn").exists()).toBe(true);
    expect(w.find("button.refresh-btn").exists()).toBe(true);
    expect(w.text()).not.toContain("已结束");
  });

  it("executing 同样可重试", async () => {
    const w = await mountPage(view({ status: "executing" }));
    expect(w.find("button.retry-btn").exists()).toBe(true);
  });

  it("重试执行会再次 POST confirm，并以返回的视图为准", async () => {
    const w = await mountPage(view({ status: "confirmed" }));
    mocks.confirmPendingAction.mockResolvedValue({
      success: true,
      data: view({ status: "done" })
    });
    await w.find("button.retry-btn").trigger("click");
    await flushPromises();
    expect(mocks.confirmPendingAction).toHaveBeenCalledWith("p1");
    expect(w.text()).toContain("已执行");
  });

  it("刷新状态走 getPendingAction", async () => {
    const w = await mountPage(view({ status: "confirmed" }));
    mocks.getPendingAction.mockResolvedValue({
      success: true,
      data: view({ status: "done" })
    });
    await w.find("button.refresh-btn").trigger("click");
    await flushPromises();
    expect(mocks.getPendingAction).toHaveBeenCalledWith("p1");
    expect(w.text()).toContain("已执行");
  });
});

describe("confirm.vue 服务端错误呈现", () => {
  // [MEDIUM 3] 拦截器原样 rethrow AxiosError，error.message 是 axios 生成的英文；
  // 服务端真正的中文说明在 response.data.error.message。员工正是靠这句话判断
  // 「我刚才那一下到底生效没有」。
  it("优先展示服务端中文说明，不暴露 axios 英文原文", async () => {
    const w = await mountPage(view());
    const err = Object.assign(
      new Error("Request failed with status code 500"),
      {
        response: {
          status: 500,
          data: {
            error: {
              message: "服务端未配置重放密钥，本次确认已保留、稍后可重试"
            }
          }
        }
      }
    );
    mocks.confirmPendingAction.mockRejectedValue(err);
    mocks.getPendingAction.mockResolvedValue({ success: true, data: view() });
    await w.find("button.confirm-btn").trigger("click");
    await flushPromises();

    const said = mocks.message.mock.calls.map(c => String(c[0]));
    expect(said.some(t => t.includes("服务端未配置重放密钥"))).toBe(true);
    expect(said.some(t => t.includes("Request failed"))).toBe(false);
  });

  it("服务端没给说明时用中文兜底，仍不暴露英文原文", async () => {
    const w = await mountPage(view());
    mocks.confirmPendingAction.mockRejectedValue(
      Object.assign(new Error("Network Error"), { response: { status: 500 } })
    );
    mocks.getPendingAction.mockResolvedValue({ success: true, data: view() });
    await w.find("button.confirm-btn").trigger("click");
    await flushPromises();

    const said = mocks.message.mock.calls.map(c => String(c[0]));
    expect(said.some(t => t.includes("Network Error"))).toBe(false);
    expect(said.some(t => /[一-龥]/.test(t))).toBe(true);
  });

  // [MEDIUM 6] sweep 把超时 executing 标 failed 时注释写明「写可能已经落库」，
  // 服务端把这句歧义警告放进 result_snapshot —— 不能被页面吞掉。
  it("failed 时展示服务端 result 里的说明", async () => {
    const w = await mountPage(
      view({
        status: "failed",
        result: {
          success: false,
          error: { message: "重放执行失败，请到网页端确认该动作是否已生效" }
        }
      })
    );
    expect(w.text()).toContain("重放执行失败，请到网页端确认该动作是否已生效");
  });
});

// [MEDIUM 4] 动作行本身可能是「拒绝审批单 #42」，而按钮上的「拒绝」指的是
// 拒绝这个【智能体动作】——两者指向完全相反的业务结果。
describe("confirm.vue 拒绝按钮语义", () => {
  it("按钮措辞指向 pending 动作而非业务结果", async () => {
    const w = await mountPage(
      view({
        summary: "拒绝审批单 #42",
        detail: {
          ...(view().detail as object),
          action_kind: "approval.reject",
          verb: "拒绝"
        }
      })
    );
    const label = w.find("button.reject-btn").text();
    expect(label).toContain("不执行");
    // 光一个「拒绝」会被读成「驳回这张审批单」
    expect(label.trim()).not.toBe("拒绝");
  });

  it("拒绝也要二次确认，并复述完整动作", async () => {
    const w = await mountPage(view());
    mocks.rejectPendingAction.mockResolvedValue({
      success: true,
      data: { ...view({ status: "rejected" }), rejected: true }
    });
    await w.find("button.reject-btn").trigger("click");
    await flushPromises();
    expect(mocks.confirmBox).toHaveBeenCalled();
    expect(String(mocks.confirmBox.mock.calls[0][0])).toContain("审批单 #42");
  });

  it("拒绝的二次确认被取消时不发起请求", async () => {
    const w = await mountPage(view());
    mocks.confirmBox.mockRejectedValue("cancel");
    await w.find("button.reject-btn").trigger("click");
    await flushPromises();
    expect(mocks.rejectPendingAction).not.toHaveBeenCalled();
  });
});

// [MEDIUM 5] approval 为 null 同时覆盖「这单不存在」和「查询失败」。detail 存在时
// 动作行只有 `${verb}${target}`，员工手上就只剩一个等同随机数字的 #42。
describe("confirm.vue 业务上下文缺失", () => {
  it("approval 为 null 时显式提示不可用，而不是整块静默消失", async () => {
    const w = await mountPage(
      view({ detail: { ...(view().detail as object), approval: null } })
    );
    expect(w.text()).toContain("业务上下文暂不可用");
  });
});

// 本地端到端冒烟里踩到的真实缺陷：页面已经开着时再打开第二张卡片的链接，
// 路由 query 变了但组件被复用，onMounted 不会重跑，页面仍显示【上一个动作】，
// 而那两个不可逆按钮就摆在旁边。等于让人对着 A 的信息点 B 的确认。
describe("confirm.vue 响应 token 变化", () => {
  it("token 变化时重新拉取并渲染新动作，而不是继续显示上一个", async () => {
    const w = await mountPage(view());
    expect(w.text()).toContain("审批单 #42");

    mocks.getPendingByToken.mockResolvedValue({
      success: true,
      data: view({
        id: "p2",
        summary: "驳回审批单 #99",
        detail: {
          action_kind: "approval.reject",
          verb: "驳回",
          target: "审批单 #99",
          approval: {
            instance_no: "SP-20260719-002",
            biz_type: "payment",
            biz_summary: "PT-002 | 另一家公司 | ￥8,000",
            initiator_userid: "LiSi"
          },
          agent_comment: "发票缺失，建议驳回"
        }
      })
    });
    route.query.token = "tok-2";
    await flushPromises();

    expect(mocks.getPendingByToken).toHaveBeenLastCalledWith("tok-2");
    expect(w.text()).toContain("审批单 #99");
    expect(w.text()).toContain("SP-20260719-002");
    expect(w.text()).not.toContain("审批单 #42");
    expect(w.text()).not.toContain("SP-20260719-001");
  });

  it("从已结束的动作切到新的待确认动作时，终态不残留、按钮恢复", async () => {
    const w = await mountPage(view({ status: "done" }));
    expect(w.find("button.confirm-btn").exists()).toBe(false);
    expect(w.text()).toContain("已执行");

    mocks.getPendingByToken.mockResolvedValue({
      success: true,
      data: view({ id: "p2", status: "pending" })
    });
    route.query.token = "tok-2";
    await flushPromises();

    expect(w.find("button.confirm-btn").exists()).toBe(true);
    expect(w.find("button.reject-btn").exists()).toBe(true);
    expect(w.text()).not.toContain("已执行");
  });

  it("新 token 加载失败时清掉上一个动作，不留下可点的按钮", async () => {
    const w = await mountPage(view());
    expect(w.find("button.confirm-btn").exists()).toBe(true);

    mocks.getPendingByToken.mockRejectedValue(new Error("404"));
    route.query.token = "tok-bad";
    await flushPromises();

    expect(w.text()).toContain("无法打开");
    expect(w.find("button.confirm-btn").exists()).toBe(false);
    expect(w.text()).not.toContain("审批单 #42");
  });
});
