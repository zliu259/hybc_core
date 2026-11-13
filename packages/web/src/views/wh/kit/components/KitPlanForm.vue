<script setup lang="ts">
import { computed } from "vue";

import type {
  KitClientSupply,
  KitPlanParams,
  KitPlanSources,
  KitTemplateRow
} from "@/api/wh/kit-types";
import { CLIENT_SUPPLY_LABELS, SOURCE_FROM_LABELS } from "../kit-plan-view";

/**
 * 「按项目参数生成」的参数区：七项参数、甲方提供什么、用哪个模板。
 * 每一项下面标来源；这里不存状态，改动都发给对话框。
 */
const props = defineProps<{
  params: KitPlanParams;
  sources: KitPlanSources;
  templates: KitTemplateRow[];
  templateId: number | null;
  loading: boolean;
  loadFailed: boolean;
  problems: string[];
}>();
const emit = defineEmits<{
  change: [key: keyof KitPlanParams, value: KitPlanParams[keyof KitPlanParams]];
  "update:templateId": [id: number | null];
}>();

const machineTypes = computed(() => [
  ...new Set(
    props.templates
      .map(template => (template.machine_type ?? "").trim())
      .filter(Boolean)
  )
]);

const SUPPLIES = Object.entries(CLIENT_SUPPLY_LABELS) as [
  KitClientSupply,
  string
][];

/** 这一项是从哪来的；手填的和没来源的不标。 */
const sourceText = (key: keyof KitPlanParams): string => {
  const source = props.sources[key];
  if (!source) return "";
  const label = SOURCE_FROM_LABELS[source.from];
  if (!label) return "";
  return source.quote ? `${label}：「${source.quote}」` : label;
};

const setText = (key: "machine_type" | "soil", value: string | null) =>
  emit("change", key, value && value.trim() ? value.trim() : null);
const setNumber = (
  key:
    | "pipe_diameter_mm"
    | "total_length_m"
    | "longest_drive_m"
    | "section_count",
  value: number | null | undefined
) => emit("change", key, value ?? null);
</script>

<template>
  <div v-loading="props.loading" class="plan-form">
    <div v-if="props.loadFailed" class="hint">没能取到项目的参数，请手填</div>
    <el-row :gutter="12">
      <el-col :span="12">
        <el-form-item label="机型">
          <el-select
            data-field="machine_type"
            :model-value="props.params.machine_type ?? ''"
            filterable
            allow-create
            clearable
            default-first-option
            placeholder="泥水平衡、土压平衡，或手填"
            style="width: 100%"
            @update:model-value="
              (value: string | null) => setText('machine_type', value)
            "
          >
            <el-option
              v-for="type in machineTypes"
              :key="type"
              :label="type"
              :value="type"
            />
          </el-select>
          <div v-if="sourceText('machine_type')" class="param-source">
            {{ sourceText("machine_type") }}
          </div>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="管径（毫米）">
          <el-input-number
            data-field="pipe_diameter_mm"
            :model-value="props.params.pipe_diameter_mm ?? undefined"
            :controls="false"
            :precision="0"
            placeholder="例如 1600"
            style="width: 100%"
            @update:model-value="
              (value: number | null | undefined) =>
                setNumber('pipe_diameter_mm', value)
            "
          />
          <div v-if="sourceText('pipe_diameter_mm')" class="param-source">
            {{ sourceText("pipe_diameter_mm") }}
          </div>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="总长度（米）">
          <el-input-number
            data-field="total_length_m"
            :model-value="props.params.total_length_m ?? undefined"
            :controls="false"
            placeholder="各段加起来"
            style="width: 100%"
            @update:model-value="
              (value: number | null | undefined) =>
                setNumber('total_length_m', value)
            "
          />
          <div v-if="sourceText('total_length_m')" class="param-source">
            {{ sourceText("total_length_m") }}
          </div>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="最长一段（米）">
          <el-input-number
            data-field="longest_drive_m"
            :model-value="props.params.longest_drive_m ?? undefined"
            :controls="false"
            placeholder="排泥管、电缆按它算"
            style="width: 100%"
            @update:model-value="
              (value: number | null | undefined) =>
                setNumber('longest_drive_m', value)
            "
          />
          <div v-if="sourceText('longest_drive_m')" class="param-source">
            {{ sourceText("longest_drive_m") }}
          </div>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="段数">
          <el-input-number
            data-field="section_count"
            :model-value="props.params.section_count ?? undefined"
            :controls="false"
            :precision="0"
            style="width: 100%"
            @update:model-value="
              (value: number | null | undefined) =>
                setNumber('section_count', value)
            "
          />
          <div v-if="sourceText('section_count')" class="param-source">
            {{ sourceText("section_count") }}
          </div>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="套数">
          <el-input-number
            data-field="set_count"
            :model-value="props.params.set_count"
            :controls="false"
            :precision="0"
            style="width: 100%"
            @update:model-value="
              (value: number | null | undefined) =>
                emit('change', 'set_count', value ?? 1)
            "
          />
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="土质">
          <el-input
            data-field="soil"
            :model-value="props.params.soil ?? ''"
            maxlength="100"
            placeholder="例如 粉质粘土"
            @update:model-value="(value: string) => setText('soil', value)"
          />
          <div v-if="sourceText('soil')" class="param-source">
            {{ sourceText("soil") }}
          </div>
        </el-form-item>
      </el-col>
      <el-col :span="12">
        <el-form-item label="甲方提供">
          <el-checkbox-group
            data-field="client_supplies"
            :model-value="props.params.client_supplies"
            @update:model-value="
              (value: (string | number | boolean)[]) =>
                emit('change', 'client_supplies', value as KitClientSupply[])
            "
          >
            <el-checkbox
              v-for="[value, label] in SUPPLIES"
              :key="value"
              :value="value"
              >{{ label }}</el-checkbox
            >
          </el-checkbox-group>
        </el-form-item>
      </el-col>
    </el-row>
    <el-form-item label="模板" required>
      <el-select
        data-field="plan_template"
        :model-value="props.templateId"
        placeholder="选择模板"
        style="width: 100%"
        @update:model-value="
          (value: number | null) => emit('update:templateId', value)
        "
      >
        <el-option
          v-for="template in props.templates"
          :key="template.id"
          :label="`${template.name}（${template.line_count} 行）`"
          :value="template.id"
        />
      </el-select>
      <div class="param-hint">
        按机型和管径预选了最接近的模板，可以换。数量按模板行上配的规则算。
      </div>
    </el-form-item>
    <div v-for="problem in props.problems" :key="problem" class="problem">
      {{ problem }}
    </div>
  </div>
</template>

<style scoped>
.hint,
.param-hint,
.param-source {
  width: 100%;
  font-size: 12px;
  line-height: 1.4;
  color: var(--el-text-color-secondary);
}

.problem {
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--el-color-danger);
}
</style>
