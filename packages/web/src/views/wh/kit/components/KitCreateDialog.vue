<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import { createKit, listKits, listKitTemplates } from "@/api/wh/kit";
import type { KitTemplateRow, ProjectKitRow } from "@/api/wh/kit-types";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { projectsByCreation } from "../kit-view";
import { useWhAction } from "../../shared/useWhAction";
import { useKitPlan } from "../useKitPlan";
import KitPlanForm from "./KitPlanForm.vue";
import KitPlanPreview from "./KitPlanPreview.vue";

const props = defineProps<{
  /** 只是现场负责人时，只列自己负责的项目 */
  onlyProjectsOf: string | null;
}>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ created: [id: number] }>();

const { busy, run } = useWhAction();
const { projects, loadProjects } = useProjectOptions();
const templates = ref<KitTemplateRow[]>([]);
const copyOptions = ref<ProjectKitRow[]>([]);
const searching = ref(false);
const form = reactive({
  project_id: null as number | null,
  title: "",
  source: "plan" as "plan" | "template" | "copy" | "blank",
  template_id: null as number | null,
  copy_from_kit_id: null as number | null
});

const plan = useKitPlan(templates);

// 按建档时间排，最新建的项目在最前
const projectOptions = computed(() =>
  projectsByCreation(
    props.onlyProjectsOf
      ? projects.value.filter(
          project => project.manager_userid === props.onlyProjectsOf
        )
      : projects.value
  )
);

watch(visible, async open => {
  if (!open) return;
  Object.assign(form, {
    project_id: null,
    title: "",
    source: "plan",
    template_id: null,
    copy_from_kit_id: null
  });
  copyOptions.value = [];
  plan.reset();
  await Promise.all([
    loadProjects(100).catch(error =>
      console.error("[warehouse] 读取项目失败", error)
    ),
    run(() => listKitTemplates({ status: "active" })).then(result => {
      if (result) templates.value = result.data;
    })
  ]);
});

// 项目选好后标题默认用项目名
watch(
  () => form.project_id,
  id => {
    const project = projects.value.find(item => item.id === id);
    if (project && !form.title) form.title = project.project_name;
  }
);

// 按项目参数生成：选了项目（或者切回这一项）就取这个项目的参数
watch(
  () => [form.project_id, form.source] as const,
  ([id, source], [oldId]) => {
    if (source !== "plan" || id === null) return;
    if (id !== oldId || plan.loadedFor.value !== id) void plan.loadFor(id);
  }
);

const canPreview = computed(
  () =>
    form.project_id !== null &&
    plan.templateId.value !== null &&
    plan.problems.value.length === 0 &&
    !plan.loading.value
);
const runPreview = async () => {
  const projectId = form.project_id;
  if (!canPreview.value || projectId === null) return;
  await run(() => plan.loadPreview(projectId));
};

const searchKits = async (keyword: string) => {
  searching.value = true;
  try {
    copyOptions.value = (
      await listKits({ keyword: keyword || undefined, pageSize: 30 })
    ).data;
  } catch {
    copyOptions.value = [];
  } finally {
    searching.value = false;
  }
};

const ready = computed(
  () =>
    form.project_id !== null &&
    form.title.trim() !== "" &&
    (form.source === "blank" ||
      (form.source === "plan" && plan.preview.value !== null) ||
      (form.source === "template" && form.template_id !== null) ||
      (form.source === "copy" && form.copy_from_kit_id !== null))
);

const submit = async () => {
  if (!ready.value || form.project_id === null) return;
  const result = await run(
    () =>
      createKit({
        project_id: form.project_id as number,
        title: form.title.trim(),
        template_id:
          form.source === "plan"
            ? plan.templateId.value
            : form.source === "template"
              ? form.template_id
              : null,
        copy_from_kit_id: form.source === "copy" ? form.copy_from_kit_id : null,
        // 按项目参数生成：行由服务端按模板和参数算
        ...(form.source === "plan"
          ? { plan: { params: plan.params.value, sources: plan.sources.value } }
          : {})
      }),
    { success: "清单已创建" }
  );
  if (result) {
    visible.value = false;
    emit("created", result.data.id);
  }
};
</script>

<template>
  <el-dialog
    v-model="visible"
    title="新建配套清单"
    :width="form.source === 'plan' ? '760px' : '560px'"
  >
    <el-form label-width="90px">
      <el-form-item label="项目" required>
        <el-select
          v-model="form.project_id"
          data-field="project"
          filterable
          placeholder="选择项目"
          style="width: 100%"
        >
          <el-option
            v-for="project in projectOptions"
            :key="project.id"
            :label="project.project_name"
            :value="project.id"
          />
        </el-select>
        <div
          v-if="props.onlyProjectsOf && projectOptions.length === 0"
          class="hint"
        >
          没有你负责的项目
        </div>
      </el-form-item>
      <el-form-item label="标题" required>
        <el-input
          v-model="form.title"
          maxlength="60"
          placeholder="例如 临河 DN1200 第二套"
        />
      </el-form-item>
      <el-form-item label="从哪来">
        <el-radio-group v-model="form.source" data-field="source">
          <el-radio-button value="plan">按项目参数生成</el-radio-button>
          <el-radio-button value="template">选模板</el-radio-button>
          <el-radio-button value="copy">复制已有清单</el-radio-button>
          <el-radio-button value="blank">空白</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <template v-if="form.source === 'plan' && form.project_id !== null">
        <KitPlanForm
          :params="plan.params.value"
          :sources="plan.sources.value"
          :templates="templates"
          :template-id="plan.templateId.value"
          :loading="plan.loading.value"
          :load-failed="plan.loadFailed.value"
          :problems="plan.problems.value"
          @change="plan.setParam"
          @update:template-id="plan.setTemplate"
        />
        <div class="plan-actions">
          <el-button
            data-action="preview"
            :disabled="!canPreview"
            :loading="busy"
            @click="runPreview"
            >预览</el-button
          >
          <span class="hint">看过预览才能创建；改了参数或模板要重新预览。</span>
        </div>
        <KitPlanPreview
          v-if="plan.preview.value"
          :preview="plan.preview.value"
        />
      </template>
      <div v-else-if="form.source === 'plan'" class="hint plan-empty">
        先选项目，系统会把能确定的参数填好。
      </div>
      <el-form-item v-if="form.source === 'template'" label="模板" required>
        <el-select
          v-model="form.template_id"
          data-field="template"
          placeholder="选择模板"
          style="width: 100%"
        >
          <el-option
            v-for="template in templates"
            :key="template.id"
            :label="`${template.name}（${template.line_count} 行）`"
            :value="template.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-if="form.source === 'copy'" label="复制哪份" required>
        <el-select
          v-model="form.copy_from_kit_id"
          filterable
          remote
          :remote-method="searchKits"
          :loading="searching"
          placeholder="输入项目名、标题或清单号"
          style="width: 100%"
          @visible-change="
            (open: boolean) =>
              open && copyOptions.length === 0 && searchKits('')
          "
        >
          <el-option
            v-for="kit in copyOptions"
            :key="kit.id"
            :label="`${kit.project_name} · ${kit.title} · ${kit.kit_no}`"
            :value="kit.id"
          />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        data-action="create"
        type="primary"
        :loading="busy"
        :disabled="!ready"
        @click="submit"
        >创建</el-button
      >
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.plan-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.plan-empty {
  margin-bottom: 12px;
}
</style>
