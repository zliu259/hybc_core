/** 新建清单对话框里「按项目参数生成」这一路的状态：参数、来源、模板、预览。 */
import { computed, ref, type Ref } from "vue";

import { getKitPlanSource, previewKitPlan } from "@/api/wh/kit";
import type {
  KitPlanParams,
  KitPlanPreview,
  KitPlanSources,
  KitTemplateRow
} from "@/api/wh/kit-types";
import {
  emptyPlanParams,
  pickTemplateFor,
  planParamProblems
} from "./kit-plan-view";

export const useKitPlan = (templates: Ref<KitTemplateRow[]>) => {
  const params = ref<KitPlanParams>(emptyPlanParams());
  const sources = ref<KitPlanSources>({});
  const templateId = ref<number | null>(null);
  /** 人自己选过模板以后，参数再变也不替他换 */
  const templateTouched = ref(false);
  const preview = ref<KitPlanPreview | null>(null);
  const loading = ref(false);
  const loadFailed = ref(false);
  /** 现在这份参数是给哪个项目取的 */
  const loadedFor = ref<number | null>(null);
  /** 换项目太快时，丢掉上一个项目晚到的结果 */
  let loadSeq = 0;

  const problems = computed(() => planParamProblems(params.value));

  const repickTemplate = () => {
    if (templateTouched.value) return;
    templateId.value = pickTemplateFor(
      templates.value,
      params.value.machine_type,
      params.value.pipe_diameter_mm
    );
  };

  const reset = () => {
    loadSeq += 1;
    params.value = emptyPlanParams();
    sources.value = {};
    templateId.value = null;
    templateTouched.value = false;
    preview.value = null;
    loading.value = false;
    loadFailed.value = false;
    loadedFor.value = null;
  };

  /** 选了项目：从工作段和项目档案取参数，按机型和管径预选模板。取不到不挡手填。 */
  const loadFor = async (projectId: number) => {
    reset();
    const seq = loadSeq;
    loadedFor.value = projectId;
    loading.value = true;
    try {
      const result = await getKitPlanSource(projectId);
      if (seq !== loadSeq) return;
      params.value = { ...emptyPlanParams(), ...result.data.params };
      sources.value = result.data.sources;
    } catch (error) {
      if (seq !== loadSeq) return;
      console.error("[warehouse] 读取项目参数失败", error);
      loadFailed.value = true;
    }
    loading.value = false;
    repickTemplate();
  };

  /** 人改了一项参数：记成手填，预览作废。 */
  const setParam = <K extends keyof KitPlanParams>(
    key: K,
    value: KitPlanParams[K]
  ) => {
    params.value = { ...params.value, [key]: value };
    sources.value = { ...sources.value, [key]: { from: "manual" } };
    preview.value = null;
    if (key === "machine_type" || key === "pipe_diameter_mm") repickTemplate();
  };

  const setTemplate = (id: number | null) => {
    templateId.value = id;
    templateTouched.value = true;
    preview.value = null;
  };

  const loadPreview = async (projectId: number) => {
    if (templateId.value === null) return;
    const result = await previewKitPlan({
      project_id: projectId,
      template_id: templateId.value,
      params: params.value
    });
    preview.value = result.data;
  };

  return {
    params,
    sources,
    templateId,
    preview,
    loading,
    loadFailed,
    loadedFor,
    problems,
    reset,
    loadFor,
    setParam,
    setTemplate,
    loadPreview
  };
};
