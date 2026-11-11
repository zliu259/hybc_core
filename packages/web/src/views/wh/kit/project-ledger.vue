<script setup lang="ts">
import { ElMessageBox } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import { closeKit, getProjectLedger } from "@/api/wh/kit";
import type { ProjectKitRow, ProjectLedger } from "@/api/wh/kit-types";
import DocFormDialog from "../doc/components/DocFormDialog.vue";
import { formatTime } from "../shared/ids";
import { MATERIAL_KIND_LABELS } from "../shared/labels";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import { KIT_STATUS_LABELS, KIT_STATUS_TAG } from "./kit-view";

defineOptions({ name: "WhKitProjectLedger" });

const route = useRoute();
const router = useRouter();
const { caps, load: loadCaps } = useWhCapabilities();
const { busy, run } = useWhAction();
const projectId = computed(() => Number(route.params.projectId));
const ledger = ref<ProjectLedger | null>(null);
const backOpen = ref(false);

const load = async () => {
  const result = await run(() => getProjectLedger(projectId.value));
  if (result) ledger.value = result.data;
};

const lossTotal = computed(
  () =>
    Math.round(
      (ledger.value?.materials ?? []).reduce(
        (sum, row) => sum + (row.loss_amount ?? 0),
        0
      ) * 100
    ) / 100
);
const dash = (value: number | null | undefined) =>
  value === null || value === undefined ? "-" : value;
const day = (iso: string | null) => (iso ? formatTime(iso).split(" ")[0] : "-");

const close = async (kit: ProjectKitRow) => {
  try {
    await ElMessageBox.confirm(
      `关闭清单 ${kit.kit_no}？关闭后只能查看。`,
      "关闭清单",
      {
        type: "warning",
        confirmButtonText: "关闭",
        cancelButtonText: "取消"
      }
    );
  } catch {
    return;
  }
  const result = await run(() => closeKit(kit.id, kit.version), {
    success: "清单已关闭"
  });
  if (result !== undefined) await load();
  else await load();
};

// 换项目时路由只换参数、页面不重建
watch(projectId, () => void load());

onMounted(async () => {
  await loadCaps();
  await load();
});
</script>

<template>
  <el-card v-loading="busy" shadow="never">
    <template v-if="ledger">
      <div class="head">
        <div class="title-line">
          <span class="name">{{ ledger.project_name }}</span>
          <el-tag v-if="ledger.settled" type="success">已结清</el-tag>
          <el-tag v-else type="warning"
            >未结清（{{ ledger.devices_on_site }} 台设备、{{
              ledger.turnover_kinds_on_site
            }}
            种周转件在场）</el-tag
          >
        </div>
        <el-button
          v-if="caps?.is_keeper && !ledger.settled"
          type="primary"
          @click="backOpen = true"
          >项目返库</el-button
        >
      </div>

      <div class="section-title">物资</div>
      <el-table :data="ledger.materials" size="small" border>
        <el-table-column prop="category" label="分节" width="100" />
        <el-table-column prop="material_code" label="编号" width="90" />
        <el-table-column label="品名和规格" min-width="160">
          <template #default="{ row }">{{ row.name }} {{ row.spec }}</template>
        </el-table-column>
        <el-table-column prop="unit" label="单位" width="60" />
        <el-table-column label="管法" width="60">
          <template #default="{ row }">{{
            MATERIAL_KIND_LABELS[row.kind]
          }}</template>
        </el-table-column>
        <el-table-column prop="planned" label="计划" width="70" align="right" />
        <el-table-column prop="shipped" label="已发" width="70" align="right" />
        <el-table-column
          prop="transferred_out"
          label="转出"
          width="70"
          align="right"
        />
        <el-table-column
          prop="returned"
          label="已退"
          width="70"
          align="right"
        />
        <el-table-column label="报损" width="70" align="right">
          <template #default="{ row }">
            <span :class="{ lost: row.lost > 0 }">{{ row.lost }}</span>
          </template>
        </el-table-column>
        <el-table-column label="在场" width="70" align="right">
          <template #default="{ row }">
            <span :class="{ onsite: (row.on_site ?? 0) > 0 }">{{
              dash(row.on_site)
            }}</span>
          </template>
        </el-table-column>
        <el-table-column label="首次出库" width="100">
          <template #default="{ row }">{{ day(row.first_out_at) }}</template>
        </el-table-column>
        <el-table-column label="最后退库" width="100">
          <template #default="{ row }">{{ day(row.last_back_at) }}</template>
        </el-table-column>
        <el-table-column label="报损金额" width="90" align="right">
          <template #default="{ row }">{{ dash(row.loss_amount) }}</template>
        </el-table-column>
        <template #empty>这个项目还没有发过物资</template>
      </el-table>
      <div class="total">
        报损金额合计（只算填了单价的）：{{ lossTotal }} 元
      </div>

      <div class="section-title">设备</div>
      <el-table :data="ledger.device_categories" size="small" border>
        <el-table-column prop="category_name" label="类别" min-width="140" />
        <el-table-column prop="planned" label="计划" width="80" align="right" />
        <el-table-column prop="shipped" label="已发" width="80" align="right" />
        <el-table-column prop="on_site" label="在场" width="80" align="right" />
        <template #empty>没有设备</template>
      </el-table>
      <div v-if="ledger.devices.length" class="devices">
        在场设备：
        <el-link
          v-for="device in ledger.devices"
          :key="device.id"
          type="primary"
          class="device"
          @click="router.push(`/wh/device/${device.id}`)"
          >{{ device.device_code }} {{ device.name }}</el-link
        >
      </div>

      <div class="section-title">配套清单</div>
      <el-table :data="ledger.kits" size="small" border>
        <el-table-column label="清单号" width="170">
          <template #default="{ row }">
            <el-link type="primary" @click="router.push(`/wh/kit/${row.id}`)">{{
              row.kit_no
            }}</el-link>
          </template>
        </el-table-column>
        <el-table-column prop="title" label="标题" min-width="160" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="KIT_STATUS_TAG[row.status]">{{
              KIT_STATUS_LABELS[row.status]
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="" width="90">
          <template #default="{ row }">
            <el-button
              v-if="
                caps?.is_keeper && row.status === 'confirmed' && ledger.settled
              "
              link
              type="primary"
              @click="close(row)"
              >关闭</el-button
            >
          </template>
        </el-table-column>
        <template #empty>这个项目还没有配套清单</template>
      </el-table>
      <DocFormDialog
        v-model="backOpen"
        doc-type="back"
        :project-id="ledger.project_id"
        @created="load"
      />
    </template>
  </el-card>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.title-line {
  display: flex;
  gap: 8px;
  align-items: center;
}

.name {
  font-size: 16px;
  font-weight: 600;
}

.section-title {
  margin: 16px 0 8px;
  font-weight: 600;
}

.total {
  margin-top: 6px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  text-align: right;
}

.devices {
  margin-top: 8px;
  font-size: 13px;
}

.device {
  margin-right: 12px;
}

.lost {
  font-weight: 600;
  color: var(--el-color-danger);
}

.onsite {
  font-weight: 600;
  color: var(--el-color-warning);
}
</style>
