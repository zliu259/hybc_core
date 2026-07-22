<script setup lang="ts">
import { computed, reactive } from "vue";
import type { ContractFamily, DraftDirection } from "@/api/contract-draft";
import { familyLabelMap } from "../draft-labels";

const emit = defineEmits<{
  (
    e: "create",
    payload: {
      direction: DraftDirection;
      family: ContractFamily;
      title: string;
      counterparty_name: string;
    }
  ): void;
}>();

const form = reactive({
  direction: "inbound" as DraftDirection,
  family: "pipe_jacking" as ContractFamily,
  title: "",
  counterparty_name: ""
});

const familyOptions: ContractFamily[] = [
  "pipe_jacking",
  "equipment_lease",
  "labor_service",
  "materials_sale"
];

const familyHintMap: Record<ContractFamily, string> = {
  pipe_jacking: "对甲方=我方承接顶管施工收款；对分包商=我方发包给分包商",
  equipment_lease:
    "对甲方=我方出租设备/带机施工收款；对分包商=我方对外承租付款",
  labor_service: "对甲方=我方承接劳务收款；对分包商=我方发包给劳务队",
  materials_sale: "对甲方=我方销售材料收款；对分包商=我方对外采购付款"
};
const familyHint = computed(() => familyHintMap[form.family]);
</script>

<template>
  <el-card class="init-card">
    <template #header>新建 AI 合同草稿</template>
    <el-form label-width="96px">
      <el-form-item label="合同类型" required>
        <el-select v-model="form.family" style="width: 100%">
          <el-option
            v-for="f in familyOptions"
            :key="f"
            :value="f"
            :label="familyLabelMap[f] ?? f"
          />
        </el-select>
      </el-form-item>
      <el-form-item>
        <el-text size="small" type="info">{{ familyHint }}</el-text>
      </el-form-item>
      <el-form-item label="合同立场" required>
        <el-radio-group v-model="form.direction">
          <el-radio-button value="inbound"
            >对甲方（我方为乙方）</el-radio-button
          >
          <el-radio-button value="outbound"
            >对分包商（我方为甲方）</el-radio-button
          >
        </el-radio-group>
      </el-form-item>
      <el-form-item label="草稿标题">
        <el-input
          v-model="form.title"
          maxlength="120"
          placeholder="留空自动命名"
        />
      </el-form-item>
      <el-form-item label="对方单位">
        <el-input
          v-model="form.counterparty_name"
          maxlength="120"
          placeholder="可稍后填写"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="emit('create', { ...form })"
          >创建并加载默认条款</el-button
        >
      </el-form-item>
    </el-form>
  </el-card>
</template>
