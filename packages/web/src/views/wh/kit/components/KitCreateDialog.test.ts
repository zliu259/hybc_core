import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import ElementPlus from "element-plus";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import type {
  KitPlanPreview,
  KitPlanSource,
  KitTemplateRow
} from "@/api/wh/kit-types";

const api = vi.hoisted(() => ({
  createKit: vi.fn(),
  listKits: vi.fn(),
  listKitTemplates: vi.fn(),
  getKitPlanSource: vi.fn(),
  previewKitPlan: vi.fn()
}));
vi.mock("@/api/wh/kit", () => api);
vi.mock("@/utils/message", () => ({ message: vi.fn() }));
vi.mock("@/composables/useProjectOptions", () => ({
  useProjectOptions: () => ({
    projects: ref([
      {
        id: 7,
        project_name: "26-08 阳坊",
        manager_userid: "lead",
        created_at: "2026-04-07T07:29:00.525Z",
        updated_at: "2026-04-15T07:52:55.400Z"
      },
      {
        id: 8,
        project_name: "西城热力顶管",
        manager_userid: null,
        created_at: "2026-10-26T08:06:00.000Z",
        updated_at: "2026-10-26T08:06:00.000Z"
      }
    ]),
    loadProjects: vi.fn().mockResolvedValue(undefined)
  })
}));

if (typeof globalThis.ResizeObserver === "undefined") {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
}

import KitCreateDialog from "./KitCreateDialog.vue";

const template = (
  id: number,
  name: string,
  machine_type: string,
  diameter_mm: number
): KitTemplateRow => ({
  id,
  name,
  machine_type,
  diameter_mm,
  remark: null,
  status: "active",
  version: 0,
  created_by_userid: "kp",
  created_at: "",
  updated_at: "",
  line_count: 176
});

const SOURCE: KitPlanSource = {
  params: {
    machine_type: "泥水平衡",
    pipe_diameter_mm: 1600,
    section_count: 1
  },
  sources: {
    machine_type: { from: "project" },
    pipe_diameter_mm: { from: "section" },
    section_count: { from: "section" }
  },
  has_text: true
};

const PREVIEW: KitPlanPreview = {
  template: { id: 1, version: 0, name: "泥水平衡 DN1200", diameter_mm: 1200 },
  lines: [
    {
      section: "顶进设备",
      sort_order: 0,
      line_kind: "device",
      device_category_id: 1,
      material_id: null,
      name_text: "机头泥水",
      spec_text: "D1600",
      unit: "台",
      qty: 1,
      source: "warehouse",
      note: null,
      calc_text: null,
      needs_spec: false,
      material_label: null
    },
    {
      section: "辅助设备",
      sort_order: 1,
      line_kind: "material",
      device_category_id: null,
      material_id: 3,
      name_text: "排泥钢管",
      spec_text: "Φ114",
      unit: "米",
      qty: 270,
      source: "warehouse",
      note: null,
      calc_text: "按最长一段：2 × 105 + 60 = 270",
      needs_spec: false,
      material_label: "排泥钢管 Φ114"
    },
    {
      section: "生活设施",
      sort_order: 2,
      line_kind: "material",
      device_category_id: null,
      material_id: 9,
      name_text: "上下床",
      spec_text: null,
      unit: "套",
      qty: 3,
      source: "on_site",
      note: null,
      calc_text: null,
      needs_spec: false,
      material_label: "上下床"
    }
  ],
  devices: [
    {
      name_text: "机头泥水",
      qty: 1,
      candidates: [
        { device_code: "DG-012", name: "唐兴1600", diameter_mm: 1600 }
      ]
    }
  ],
  warnings: ["模板是 DN1200，本项目 D1600"]
};

const field = (wrapper: VueWrapper, name: string): VueWrapper =>
  wrapper.findComponent(`[data-field="${name}"]`) as unknown as VueWrapper;

/** 这个控件现在显示的值 */
const valueOf = (wrapper: VueWrapper, name: string): unknown =>
  (field(wrapper, name).props() as { modelValue?: unknown }).modelValue;

const setField = async (wrapper: VueWrapper, name: string, value: unknown) => {
  const control = field(wrapper, name);
  expect(control.exists()).toBe(true);
  control.vm.$emit("update:modelValue", value);
  await flushPromises();
};

const openDialog = async (
  onlyProjectsOf: string | null = null
): Promise<VueWrapper> => {
  const wrapper: VueWrapper = mount(KitCreateDialog, {
    props: { modelValue: false, onlyProjectsOf },
    // 对话框不挂到 body 上，内容就渲染在组件里，直接能查到
    global: { plugins: [ElementPlus] }
  });
  await wrapper.setProps({ modelValue: true });
  await flushPromises();
  return wrapper;
};

const button = (wrapper: VueWrapper, action: string) =>
  wrapper.find(`[data-action="${action}"]`);

describe("新建清单：按项目参数生成", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listKitTemplates.mockResolvedValue({
      success: true,
      data: [
        template(2, "泥水平衡 DN600", "泥水平衡", 600),
        template(1, "泥水平衡 DN1200", "泥水平衡", 1200),
        template(3, "土压平衡 DN2400", "土压平衡", 2400)
      ]
    });
    api.getKitPlanSource.mockResolvedValue({ success: true, data: SOURCE });
    api.previewKitPlan.mockResolvedValue({ success: true, data: PREVIEW });
    api.createKit.mockResolvedValue({
      success: true,
      data: { id: 55, kit_no: "PT-20261113-0001" }
    });
    api.listKits.mockResolvedValue({ success: true, data: [] });
  });

  it("「从哪来」第一项是按项目参数生成，默认选中；原来三项还在", async () => {
    const wrapper = await openDialog();
    const options = wrapper
      .findAll(".el-radio-button")
      .map(node => node.text());
    expect(options).toEqual([
      "按项目参数生成",
      "选模板",
      "复制已有清单",
      "空白"
    ]);
    expect(valueOf(wrapper, "source")).toBe("plan");
    // 没选项目时不显示参数区
    expect(wrapper.find(".plan-form").exists()).toBe(false);
  });

  it("项目下拉按建档时间排，最新建的在最前（不是按最后修改时间，也不是接口给的顺序）", async () => {
    const wrapper = await openDialog();
    const labels = field(wrapper, "project")
      .findAllComponents({ name: "ElOption" })
      .map(option => (option.props() as { label?: string }).label);
    // 接口给的顺序是 阳坊（4 月建）、西城（10 月建）
    expect(labels).toEqual(["西城热力顶管", "26-08 阳坊"]);
  });

  it("选了项目就取参数并填进去，按机型和管径预选模板，来源标在每一项下面", async () => {
    const wrapper = await openDialog();
    await setField(wrapper, "project", 7);
    expect(api.getKitPlanSource).toHaveBeenCalledWith(7);
    expect(valueOf(wrapper, "pipe_diameter_mm")).toBe(1600);
    expect(valueOf(wrapper, "machine_type")).toBe("泥水平衡");
    expect(valueOf(wrapper, "set_count")).toBe(1);
    // 泥水 600 和 1200 里，1600 离 1200 近
    expect(valueOf(wrapper, "plan_template")).toBe(1);
    const hints = wrapper.findAll(".param-source").map(node => node.text());
    expect(hints).toEqual(expect.arrayContaining(["项目档案", "工作段"]));
    expect(button(wrapper, "create").attributes("disabled")).toBeDefined();
  });

  it("取参数失败只提示一句，参数区照样能手填", async () => {
    api.getKitPlanSource.mockRejectedValue(new Error("boom"));
    const wrapper = await openDialog();
    await setField(wrapper, "project", 7);
    expect(wrapper.find(".plan-form").exists()).toBe(true);
    expect(wrapper.text()).toContain("没能取到项目的参数，请手填");
    await setField(wrapper, "machine_type", "土压平衡");
    await setField(wrapper, "pipe_diameter_mm", 2200);
    // 手填机型和管径以后也会预选模板
    expect(valueOf(wrapper, "plan_template")).toBe(3);
  });

  it("参数不对时「预览」点不了，并显示那句话", async () => {
    const wrapper = await openDialog();
    await setField(wrapper, "project", 7);
    await setField(wrapper, "total_length_m", 100);
    await setField(wrapper, "longest_drive_m", 200);
    expect(wrapper.text()).toContain("最长一段不能超过总长度");
    expect(button(wrapper, "preview").attributes("disabled")).toBeDefined();
    await setField(wrapper, "longest_drive_m", 100);
    expect(button(wrapper, "preview").attributes("disabled")).toBeUndefined();
  });

  it("点预览：用现在的参数取预览，显示主要设备和提醒；改了参数或模板，预览作废", async () => {
    const wrapper = await openDialog();
    await setField(wrapper, "project", 7);
    await setField(wrapper, "total_length_m", 105);
    await setField(wrapper, "longest_drive_m", 105);
    await setField(wrapper, "client_supplies", ["power"]);
    await button(wrapper, "preview").trigger("click");
    await flushPromises();
    expect(api.previewKitPlan).toHaveBeenCalledWith({
      project_id: 7,
      template_id: 1,
      params: {
        machine_type: "泥水平衡",
        pipe_diameter_mm: 1600,
        total_length_m: 105,
        longest_drive_m: 105,
        section_count: 1,
        set_count: 1,
        soil: null,
        client_supplies: ["power"]
      }
    });
    const preview = wrapper.find(".plan-preview");
    expect(preview.text()).toContain("机头泥水");
    expect(preview.text()).toContain("DG-012 唐兴1600（1600）");
    expect(preview.text()).toContain("模板是 DN1200，本项目 D1600");
    expect(preview.text()).toContain("按最长一段：2 × 105 + 60 = 270");
    // 甲方提供的行在预览里标出来
    expect(preview.findAll(".on-site").map(node => node.text())).toEqual([
      "现场已有"
    ]);
    expect(button(wrapper, "create").attributes("disabled")).toBeUndefined();

    await setField(wrapper, "set_count", 2);
    expect(wrapper.find(".plan-preview").exists()).toBe(false);
    expect(button(wrapper, "create").attributes("disabled")).toBeDefined();

    await button(wrapper, "preview").trigger("click");
    await flushPromises();
    expect(wrapper.find(".plan-preview").exists()).toBe(true);
    await setField(wrapper, "plan_template", 2);
    expect(wrapper.find(".plan-preview").exists()).toBe(false);
  });

  it("点创建：带模板和 plan（参数和来源；手改过的那项来源是手填），不带行", async () => {
    const wrapper = await openDialog();
    await setField(wrapper, "project", 7);
    await setField(wrapper, "total_length_m", 105);
    await setField(wrapper, "pipe_diameter_mm", 1650);
    await button(wrapper, "preview").trigger("click");
    await flushPromises();
    await button(wrapper, "create").trigger("click");
    await flushPromises();
    expect(api.createKit).toHaveBeenCalledTimes(1);
    expect(api.createKit).toHaveBeenCalledWith({
      project_id: 7,
      title: "26-08 阳坊",
      template_id: 1,
      copy_from_kit_id: null,
      plan: {
        params: {
          machine_type: "泥水平衡",
          pipe_diameter_mm: 1650,
          total_length_m: 105,
          longest_drive_m: null,
          section_count: 1,
          set_count: 1,
          soil: null,
          client_supplies: []
        },
        sources: {
          machine_type: { from: "project" },
          pipe_diameter_mm: { from: "manual" },
          section_count: { from: "section" },
          total_length_m: { from: "manual" }
        }
      }
    });
    expect(wrapper.emitted("created")).toEqual([[55]]);
  });

  it("换成「选模板」再创建：请求里没有 plan", async () => {
    const wrapper = await openDialog();
    await setField(wrapper, "project", 7);
    await setField(wrapper, "source", "template");
    expect(wrapper.find(".plan-form").exists()).toBe(false);
    await setField(wrapper, "template", 3);
    await button(wrapper, "create").trigger("click");
    await flushPromises();
    expect(api.createKit).toHaveBeenCalledWith({
      project_id: 7,
      title: "26-08 阳坊",
      template_id: 3,
      copy_from_kit_id: null
    });
  });

  it("预览还没回来时又改了参数：晚到的预览不算数，「创建」仍然点不了", async () => {
    let finish: (value: unknown) => void = () => {};
    api.previewKitPlan.mockReturnValue(
      new Promise(resolve => {
        finish = resolve;
      })
    );
    const wrapper = await openDialog();
    await setField(wrapper, "project", 7);
    await button(wrapper, "preview").trigger("click");
    await flushPromises();
    // 请求还在路上，人把套数从 1 改成 2
    await setField(wrapper, "set_count", 2);
    finish({ success: true, data: PREVIEW });
    await flushPromises();
    expect(wrapper.find(".plan-preview").exists()).toBe(false);
    expect(button(wrapper, "create").attributes("disabled")).toBeDefined();
  });

  it("预览还没回来时换了模板或换了项目：晚到的预览也不算数", async () => {
    const pending: ((value: unknown) => void)[] = [];
    api.previewKitPlan.mockImplementation(
      () =>
        new Promise(resolve => {
          pending.push(resolve);
        })
    );
    const wrapper = await openDialog();
    await setField(wrapper, "project", 7);
    await button(wrapper, "preview").trigger("click");
    await flushPromises();
    await setField(wrapper, "plan_template", 2);
    pending[0]({ success: true, data: PREVIEW });
    await flushPromises();
    expect(wrapper.find(".plan-preview").exists()).toBe(false);

    await button(wrapper, "preview").trigger("click");
    await flushPromises();
    await setField(wrapper, "project", 8);
    pending[1]({ success: true, data: PREVIEW });
    await flushPromises();
    expect(wrapper.find(".plan-preview").exists()).toBe(false);
    expect(button(wrapper, "create").attributes("disabled")).toBeDefined();
  });

  it("换项目：重新取参数，清掉预览", async () => {
    const wrapper = await openDialog();
    await setField(wrapper, "project", 7);
    await button(wrapper, "preview").trigger("click");
    await flushPromises();
    api.getKitPlanSource.mockResolvedValue({
      success: true,
      data: { params: {}, sources: {}, has_text: false }
    });
    await setField(wrapper, "project", 8);
    expect(api.getKitPlanSource).toHaveBeenLastCalledWith(8);
    expect(wrapper.find(".plan-preview").exists()).toBe(false);
    expect(valueOf(wrapper, "pipe_diameter_mm")).toBeUndefined();
    expect(valueOf(wrapper, "plan_template")).toBeNull();
  });
});
