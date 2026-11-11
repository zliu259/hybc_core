<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

import { createKit, listKits, listKitTemplates } from "@/api/wh/kit";
import type { KitTemplateRow, ProjectKitRow } from "@/api/wh/kit-types";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWhAction } from "../../shared/useWhAction";

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
  source: "template" as "template" | "copy" | "blank",
  template_id: null as number | null,
  copy_from_kit_id: null as number | null
});

const projectOptions = computed(() =>
  props.onlyProjectsOf
    ? projects.value.filter(
        project => project.manager_userid === props.onlyProjectsOf
      )
    : projects.value
);

watch(visible, async open => {
  if (!open) return;
  Object.assign(form, {
    project_id: null,
    title: "",
    source: "template",
    template_id: null,
    copy_from_kit_id: null
  });
  copyOptions.value = [];
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
        template_id: form.source === "template" ? form.template_id : null,
        copy_from_kit_id: form.source === "copy" ? form.copy_from_kit_id : null
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
  <el-dialog v-model="visible" title="新建配套清单" width="560px">
    <el-form label-width="90px">
      <el-form-item label="项目" required>
        <el-select
          v-model="form.project_id"
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
        <el-radio-group v-model="form.source">
          <el-radio-button value="template">选模板</el-radio-button>
          <el-radio-button value="copy">复制已有清单</el-radio-button>
          <el-radio-button value="blank">空白</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="form.source === 'template'" label="模板" required>
        <el-select
          v-model="form.template_id"
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
</style>
