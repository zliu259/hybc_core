<script setup lang="ts">
import { computed } from "vue";

import type { KitPlanPreview } from "@/api/wh/kit-types";

/** 按项目参数生成的预览：主要设备、提醒、算好的每一行。只读。 */
const props = defineProps<{ preview: KitPlanPreview }>();

const counts = computed(() => {
  const material = props.preview.lines.filter(
    line => line.line_kind === "material"
  );
  return {
    lines: props.preview.lines.length,
    material: material.length,
    needsSpec: material.filter(line => line.needs_spec && line.qty > 0).length
  };
});

const candidateText = (device: KitPlanPreview["devices"][number]): string =>
  device.candidates
    .map(
      candidate =>
        `${candidate.device_code} ${candidate.name}${
          candidate.diameter_mm === null ? "" : `（${candidate.diameter_mm}）`
        }`
    )
    .join("、");
</script>

<template>
  <div class="plan-preview">
    <el-alert
      v-for="warning in props.preview.warnings"
      :key="warning"
      :title="warning"
      type="warning"
      :closable="false"
      show-icon
      class="warning"
    />
    <div class="block">
      <div class="block-title">主要设备</div>
      <div v-if="props.preview.devices.length === 0" class="muted">
        这个模板没有设备行
      </div>
      <div
        v-for="device in props.preview.devices"
        :key="device.name_text"
        class="device"
      >
        <span class="device-name"
          >{{ device.name_text }} × {{ device.qty }}</span
        >
        <span v-if="device.candidates.length > 0" class="muted"
          >库里合适的：{{ candidateText(device) }}</span
        >
      </div>
    </div>
    <div class="block">
      <div class="block-title">
        共 {{ counts.lines }} 行，物资 {{ counts.material }} 行<template
          v-if="counts.needsSpec > 0"
          >，{{ counts.needsSpec }} 行要选规格</template
        >
      </div>
      <el-table :data="props.preview.lines" size="small" max-height="260">
        <el-table-column prop="section" label="分节" width="110" />
        <el-table-column label="品名" min-width="130">
          <template #default="{ row }"
            >{{ row.name_text }}
            <span v-if="row.spec_text" class="muted">{{ row.spec_text }}</span>
            <el-tag
              v-if="row.needs_spec && row.qty > 0"
              size="small"
              type="warning"
              >待选规格</el-tag
            ></template
          >
        </el-table-column>
        <el-table-column label="数量" width="90" align="right">
          <template #default="{ row }"
            >{{ row.qty }} {{ row.unit ?? "" }}</template
          >
        </el-table-column>
        <el-table-column label="怎么算的" min-width="220">
          <template #default="{ row }">
            <span class="muted">{{ row.calc_text ?? "" }}</span>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.plan-preview {
  margin-top: 12px;
}

.warning {
  margin-bottom: 6px;
}

.block {
  margin-top: 10px;
}

.block-title {
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
}

.device {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-bottom: 4px;
  font-size: 13px;
}

.device-name {
  font-weight: 500;
}

.muted {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
