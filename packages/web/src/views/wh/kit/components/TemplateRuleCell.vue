<script setup lang="ts">
import { computed, ref } from "vue";

import type {
  KitLineKind,
  KitLineRole,
  KitLineRule,
  KitQtyBasis
} from "@/api/wh/kit-types";
import { BASIS_LABELS, ROLE_LABELS, ruleSummary } from "../kit-plan-view";

/**
 * 模板一行的计算规则：平时显示一句话，点「改」在格子里展开六样设置。
 * 每次改动都发出一个新的规则对象，不改传进来的那个。
 */
const props = defineProps<{ lineKind: KitLineKind; readonly: boolean }>();
const rule = defineModel<KitLineRule>({ required: true });

const editing = ref(false);
const summary = computed(() => ruleSummary(rule.value) || "固定");

const BASES = Object.entries(BASIS_LABELS) as [KitQtyBasis, string][];
const ROLES = Object.entries(ROLE_LABELS) as [KitLineRole, string][];

const patch = (change: Partial<KitLineRule>) => {
  rule.value = { ...rule.value, ...change };
};
const setBasis = (basis: KitQtyBasis) =>
  patch(
    basis === "fixed"
      ? { qty_basis: basis, qty_factor: null, qty_extra: null }
      : { qty_basis: basis }
  );
// 输入框清空时 Element Plus 给 undefined 或 null：都当作没填
const toNumber = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : value;
const setRole = (role: KitLineRole | "" | null | undefined) =>
  patch({ role: role || null });
</script>

<template>
  <div v-if="props.lineKind !== 'text'" class="rule-cell">
    <span class="rule-text">{{ summary }}</span>
    <el-button
      v-if="!props.readonly"
      class="rule-edit"
      link
      type="primary"
      size="small"
      @click="editing = !editing"
      >{{ editing ? "收起" : "改" }}</el-button
    >
    <div v-if="editing && !props.readonly" class="rule-editor">
      <label class="field">
        <span>计算方式</span>
        <el-select
          data-field="qty_basis"
          size="small"
          :model-value="rule.qty_basis"
          @update:model-value="setBasis"
        >
          <el-option
            v-for="[value, label] in BASES"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
      </label>
      <template v-if="rule.qty_basis !== 'fixed'">
        <label class="field">
          <span>系数</span>
          <el-input-number
            data-field="qty_factor"
            size="small"
            :model-value="rule.qty_factor ?? undefined"
            :min="0"
            :controls="false"
            placeholder="每米或每段多少"
            @update:model-value="
              (value: number | null | undefined) =>
                patch({ qty_factor: toNumber(value) })
            "
          />
        </label>
        <label class="field">
          <span>另加</span>
          <el-input-number
            data-field="qty_extra"
            size="small"
            :model-value="rule.qty_extra ?? undefined"
            :min="0"
            :controls="false"
            placeholder="固定余量，可不填"
            @update:model-value="
              (value: number | null | undefined) =>
                patch({ qty_extra: toNumber(value) })
            "
          />
        </label>
      </template>
      <el-checkbox
        data-field="qty_per_set"
        size="small"
        :model-value="rule.qty_per_set"
        @update:model-value="
          (value: string | number | boolean) =>
            patch({ qty_per_set: Boolean(value) })
        "
        >每套一份（乘套数）</el-checkbox
      >
      <el-checkbox
        v-if="props.lineKind === 'material'"
        data-field="spec_by_diameter"
        size="small"
        :model-value="rule.spec_by_diameter"
        @update:model-value="
          (value: string | number | boolean) =>
            patch({ spec_by_diameter: Boolean(value) })
        "
        >规格随管径</el-checkbox
      >
      <label class="field">
        <span>标记</span>
        <el-select
          data-field="role"
          size="small"
          clearable
          placeholder="无"
          :model-value="rule.role ?? ''"
          @update:model-value="setRole"
        >
          <el-option
            v-for="[value, label] in ROLES"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
      </label>
    </div>
  </div>
</template>

<style scoped>
.rule-text {
  margin-right: 6px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}

.rule-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 0 4px;
}

.field {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.field > span {
  flex: 0 0 56px;
}
</style>
