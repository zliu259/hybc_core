<script setup lang="ts">
import { ElMessageBox, type MessageBoxInputData } from "element-plus";
import { onMounted, ref } from "vue";

import {
  createKitTemplate,
  getKitTemplate,
  listKitTemplates,
  updateKitTemplate
} from "@/api/wh/kit";
import type {
  KitTemplateDetail,
  KitTemplateRow,
  TemplateLineInput
} from "@/api/wh/kit-types";
import { listDeviceCategories } from "@/api/wh/settings";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import KitLineTable from "./components/KitLineTable.vue";
import TemplateImportDialog from "./components/TemplateImportDialog.vue";
import {
  editableFromTemplate,
  kitLineProblems,
  newEditableLine,
  toTemplateLines,
  type EditableKitLine
} from "./kit-view";

defineOptions({ name: "WhKitTemplate" });

const { caps, load: loadCaps } = useWhCapabilities();
const { busy, run } = useWhAction();
const templates = ref<KitTemplateRow[]>([]);
const categories = ref<{ id: number; name: string }[]>([]);
const current = ref<KitTemplateDetail | null>(null);
const header = ref({
  name: "",
  machine_type: "",
  diameter_mm: null as number | null,
  remark: ""
});
const lines = ref<EditableKitLine[]>([]);
const editorOpen = ref(false);
const importOpen = ref(false);

const loadList = async () => {
  const result = await run(() => listKitTemplates());
  if (result) templates.value = result.data;
};

const open = async (id: number) => {
  const result = await run(() => getKitTemplate(id));
  if (!result) return;
  current.value = result.data;
  header.value = {
    name: result.data.name,
    machine_type: result.data.machine_type ?? "",
    diameter_mm: result.data.diameter_mm,
    remark: result.data.remark ?? ""
  };
  lines.value = editableFromTemplate(result.data.lines);
  editorOpen.value = true;
};

const create = async () => {
  let name: string;
  try {
    // prompt 的类型是 MessageBoxInputData | Action；确定时只会给前者，取消走 reject
    ({ value: name } = (await ElMessageBox.prompt(
      "模板名称，例如 土压平衡",
      "新建模板",
      {
        inputValidator: (value: string) =>
          Boolean(value?.trim()) || "名称不能为空",
        confirmButtonText: "创建",
        cancelButtonText: "取消"
      }
    )) as MessageBoxInputData);
  } catch {
    return;
  }
  const result = await run(() => createKitTemplate({ name: name.trim() }), {
    success: "模板已创建"
  });
  if (!result) return;
  await loadList();
  await open(result.data.id);
};

const problems = () =>
  kitLineProblems(
    lines.value.map(line => ({
      line_kind: line.line_kind,
      material_id: 1, // 模板行不选具体物资
      name_text: line.name_text,
      planned_qty: line.qty ?? 0
    }))
  );

const save = async (patch: { status?: "active" | "disabled" } = {}) => {
  if (!current.value) return;
  if (!patch.status && problems().length > 0) return;
  const { id, version } = current.value;
  const result = await run(
    () =>
      updateKitTemplate(id, {
        version,
        name: header.value.name.trim(),
        machine_type: header.value.machine_type.trim() || null,
        diameter_mm: header.value.diameter_mm ?? null,
        remark: header.value.remark.trim() || null,
        ...(patch.status
          ? { status: patch.status }
          : { lines: toTemplateLines(lines.value) })
      }),
    { success: patch.status ? "已更新" : "模板已保存" }
  );
  if (result) {
    await open(id);
    await loadList();
  } else {
    await open(id);
  }
};

const onImported = (rows: TemplateLineInput[]) => {
  lines.value = rows.map(row => ({
    ...newEditableLine(row.section),
    line_kind: row.line_kind,
    device_category_id: row.device_category_id,
    name_text: row.name_text,
    spec_text: row.spec_text ?? "",
    unit: row.unit ?? "",
    qty: row.default_qty,
    note: row.note ?? "",
    rule: {
      qty_basis: row.qty_basis,
      qty_factor: row.qty_factor,
      qty_extra: row.qty_extra,
      qty_round_to: row.qty_round_to,
      qty_per_set: row.qty_per_set,
      spec_by_diameter: row.spec_by_diameter,
      role: row.role
    }
  }));
};

onMounted(async () => {
  await loadCaps();
  await loadList();
  try {
    categories.value = (await listDeviceCategories()).data.filter(
      c => c.status === "active"
    );
  } catch (error) {
    console.error("[warehouse] 读取设备类别失败", error);
  }
});
</script>

<template>
  <el-card shadow="never">
    <div class="toolbar">
      <span class="title">配套模板</span>
      <span class="spacer" />
      <el-button v-if="caps?.is_keeper" type="primary" @click="create"
        >新建模板</el-button
      >
    </div>
    <el-table
      v-loading="busy"
      :data="templates"
      @row-click="(row: KitTemplateRow) => open(row.id)"
    >
      <el-table-column prop="name" label="名称" min-width="160" />
      <el-table-column label="机型" width="120">
        <template #default="{ row }">{{ row.machine_type ?? "-" }}</template>
      </el-table-column>
      <el-table-column label="管径" width="100">
        <template #default="{ row }">{{
          row.diameter_mm ? `DN${row.diameter_mm}` : "-"
        }}</template>
      </el-table-column>
      <el-table-column prop="line_count" label="行数" width="80" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'active' ? 'success' : 'info'">{{
            row.status === "active" ? "在用" : "已停用"
          }}</el-tag>
        </template>
      </el-table-column>
      <template #empty>还没有模板</template>
    </el-table>

    <el-drawer
      v-model="editorOpen"
      :title="current ? `模板：${current.name}` : '模板'"
      size="92%"
    >
      <div v-if="current" v-loading="busy">
        <el-form :inline="true" :disabled="!caps?.is_keeper">
          <el-form-item label="名称">
            <el-input v-model="header.name" maxlength="30" />
          </el-form-item>
          <el-form-item label="机型">
            <el-input
              v-model="header.machine_type"
              maxlength="20"
              placeholder="例如 泥水平衡"
            />
          </el-form-item>
          <el-form-item label="管径（毫米）">
            <el-input-number
              :model-value="header.diameter_mm ?? undefined"
              :min="300"
              :max="5000"
              :precision="0"
              :controls="false"
              placeholder="例如 1200"
              style="width: 120px"
              @update:model-value="
                (value: number | null | undefined) =>
                  (header.diameter_mm = value ?? null)
              "
            />
          </el-form-item>
          <el-form-item label="备注">
            <el-input
              v-model="header.remark"
              maxlength="200"
              style="width: 320px"
            />
          </el-form-item>
        </el-form>
        <KitLineTable
          v-model="lines"
          mode="template"
          :categories="categories"
          :readonly="!caps?.is_keeper"
          :problems="problems()"
        />
        <div v-if="caps?.is_keeper" class="actions">
          <el-button @click="importOpen = true">粘贴导入</el-button>
          <el-button
            v-if="current.status === 'active'"
            @click="save({ status: 'disabled' })"
            >停用</el-button
          >
          <el-button v-else @click="save({ status: 'active' })">启用</el-button>
          <el-button type="primary" :loading="busy" @click="save()"
            >保存</el-button
          >
        </div>
      </div>
    </el-drawer>
    <TemplateImportDialog
      v-model="importOpen"
      :categories="categories"
      @imported="onImported"
    />
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
}

.title {
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}

:deep(.el-table__row) {
  cursor: pointer;
}
</style>
