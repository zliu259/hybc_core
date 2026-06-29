<script setup lang="ts">
import { computed } from "vue";
import VChart from "vue-echarts";
import { use } from "echarts/core";
import { HeatmapChart } from "echarts/charts";
import {
  GridComponent,
  VisualMapComponent,
  TooltipComponent
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import type { CallbackDataParams } from "echarts/types/dist/shared";
import type { ParsedDoc } from "../lib/types";

use([
  HeatmapChart,
  GridComponent,
  VisualMapComponent,
  TooltipComponent,
  CanvasRenderer
]);

const props = defineProps<{ docs: ParsedDoc[]; matrix: number[][] }>();

const names = computed(() => props.docs.map((d) => d.name));
const data = computed(() => {
  const out: [number, number, number][] = [];
  props.matrix.forEach((row, i) =>
    row.forEach((v, j) => out.push([j, i, Math.round(v * 100)])),
  );
  return out;
});

const option = computed<EChartsOption>(() => ({
  tooltip: { position: "top" },
  grid: { containLabel: true },
  xAxis: { type: "category", data: names.value },
  yAxis: { type: "category", data: names.value },
  visualMap: {
    min: 0,
    max: 100,
    calculable: true,
    orient: "horizontal",
    left: "center",
    bottom: 0
  },
  series: [
    {
      type: "heatmap",
      data: data.value,
      label: {
        show: true,
        formatter: (p: CallbackDataParams) => {
          const v = p.value as [number, number, number];
          return `${v[2]}%`;
        }
      }
    }
  ]
}));
</script>

<template>
  <v-chart :option="option" autoresize style="height: 360px" />
</template>
