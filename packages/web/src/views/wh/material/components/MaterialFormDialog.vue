<script setup lang="ts">
import { ref, watch } from "vue";

import {
  createMaterial,
  updateMaterial,
  type MaterialInput
} from "@/api/wh/material";
import type { Material } from "@/api/wh/types";
import { MATERIAL_CATEGORIES } from "../../shared/labels";
import { useWhAction } from "../../shared/useWhAction";

const props = defineProps<{ material: Material | null }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ saved: [] }>();

const { busy, run } = useWhAction();
const form = ref<MaterialInput>({});

watch(visible, open => {
  if (!open) return;
  const m = props.material;
  form.value = m
    ? {
        name: m.name,
        spec: m.spec,
        unit: m.unit,
        category: m.category,
        kind: m.kind,
        unit_price: m.unit_price,
        min_stock: m.min_stock,
        storage_note: m.storage_note,
        remark: m.remark,
        status: m.status
      }
    : { kind: "turnover" };
});

const save = async () => {
  const data = { ...form.value };
  if (!props.material) delete data.status;
  const done = props.material
    ? await run(() => updateMaterial(props.material!.id, data), {
        success: "已保存"
      })
    : await run(() => createMaterial(data), { success: "已新增" });
  if (done) {
    visible.value = false;
    emit("saved");
  }
};
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="props.material ? '修改物资' : '新增物资'"
    width="560px"
    destroy-on-close
  >
    <el-form :model="form" label-width="90px">
      <el-form-item label="品名" required
        ><el-input v-model="form.name" maxlength="50"
      /></el-form-item>
      <el-form-item label="规格">
        <el-input
          v-model="form.spec"
          maxlength="80"
          placeholder="一个规格一条，如 Φ114；不要写 DN25/32/40"
        />
      </el-form-item>
      <el-form-item label="单位" required
        ><el-input v-model="form.unit" maxlength="10" style="width: 120px"
      /></el-form-item>
      <el-form-item label="分节" required>
        <el-select
          v-model="form.category"
          placeholder="选择分节"
          style="width: 100%"
        >
          <el-option
            v-for="c in MATERIAL_CATEGORIES"
            :key="c"
            :label="c"
            :value="c"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="管法" required>
        <el-radio-group v-model="form.kind">
          <el-radio value="turnover">周转（发出去要退回）</el-radio>
          <el-radio value="consumable">消耗（发出即用掉）</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="单价"
        ><el-input-number
          v-model="form.unit_price"
          :min="0"
          :precision="2"
          controls-position="right"
      /></el-form-item>
      <el-form-item label="最低库存"
        ><el-input-number
          v-model="form.min_stock"
          :min="0"
          controls-position="right"
      /></el-form-item>
      <el-form-item label="库位"
        ><el-input v-model="form.storage_note" maxlength="50"
      /></el-form-item>
      <el-form-item label="备注"
        ><el-input
          v-model="form.remark"
          type="textarea"
          maxlength="300"
          :rows="2"
      /></el-form-item>
      <el-form-item v-if="props.material" label="状态">
        <el-switch
          v-model="form.status"
          active-value="active"
          inactive-value="disabled"
          active-text="启用"
          inactive-text="停用"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="busy" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>
