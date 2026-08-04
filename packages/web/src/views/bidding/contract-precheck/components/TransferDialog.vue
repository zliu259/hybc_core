<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import dayjs from "dayjs";
import { listEntities, type Entity } from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import type { TransferPrecheckPayload } from "@/api/contract-precheck";

defineOptions({ name: "PrecheckTransferDialog" });

const props = defineProps<{
  visible: boolean;
  submitting?: boolean;
  counterparty: string | null;
  directionLabel: string;
}>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
  (e: "submit", payload: TransferPrecheckPayload): void;
}>();

const { projects, loadProjects } = useProjectOptions();
const entities = ref<Entity[]>([]);

const form = ref({
  project_id: undefined as number | undefined,
  entity_id: undefined as number | undefined,
  contract_type: "",
  total_amount: 0,
  // dayjs 取本地日历日：toISOString 是 UTC，北京 0-8 点会差一天
  contract_date: dayjs().format("YYYY-MM-DD"),
  // 建单时可留空，转入前在此补填（服务端必填校验）
  counterparty: props.counterparty ?? ""
});

watch(
  () => props.counterparty,
  value => {
    if (!form.value.counterparty && value) form.value.counterparty = value;
  }
);

const dialogVisible = computed({
  get: () => props.visible,
  set: (value: boolean) => emit("update:visible", value)
});

onMounted(async () => {
  try {
    await loadProjects();
    const res = await listEntities({ status: "active" });
    entities.value = res.data ?? [];
  } catch {
    // 下拉加载失败不阻塞弹窗，提交时仍会校验必填
  }
});

const canSubmit = computed(
  () =>
    !!form.value.project_id &&
    !!form.value.entity_id &&
    !!form.value.contract_type &&
    form.value.counterparty.trim().length > 0 &&
    Number.isFinite(form.value.total_amount) &&
    form.value.total_amount >= 0
);

const onSubmit = () => {
  if (!form.value.project_id || !form.value.entity_id) return;
  emit("submit", {
    project_id: form.value.project_id,
    entity_id: form.value.entity_id,
    contract_type: form.value.contract_type,
    total_amount: form.value.total_amount,
    contract_date: form.value.contract_date || undefined,
    counterparty: form.value.counterparty.trim()
  });
};
</script>

<template>
  <el-dialog v-model="dialogVisible" title="转入合同台账" width="520px">
    <el-alert
      type="info"
      :closable="false"
      title="将以预审单的方向与对方主体创建草稿合同（携带合同原件），创建后可在合同详情页补全信息并提交审批。"
      style="margin-bottom: 12px"
    />
    <el-form label-width="90px">
      <el-form-item label="合同方向">
        <span>{{ directionLabel }}</span>
      </el-form-item>
      <el-form-item label="对方主体" required>
        <el-input
          v-model="form.counterparty"
          maxlength="120"
          placeholder="对方公司全称（建单未填的在此补填）"
        />
      </el-form-item>
      <el-form-item label="所属项目" required>
        <el-select
          v-model="form.project_id"
          filterable
          placeholder="选择项目"
          style="width: 100%"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="我方主体" required>
        <el-select
          v-model="form.entity_id"
          filterable
          placeholder="选择我方主体"
          style="width: 100%"
        >
          <el-option
            v-for="item in entities"
            :key="item.id"
            :label="item.entity_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="合同类型" required>
        <el-select
          v-model="form.contract_type"
          placeholder="选择类型"
          style="width: 100%"
        >
          <el-option label="人工" value="人工" />
          <el-option label="机械" value="机械" />
          <el-option label="总包" value="总包" />
          <el-option label="材料" value="材料" />
          <el-option label="其他" value="其他" />
        </el-select>
      </el-form-item>
      <el-form-item label="合同金额" required>
        <el-input-number
          v-model="form.total_amount"
          :min="0"
          :precision="2"
          :controls="false"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="签订日期">
        <el-date-picker
          v-model="form.contract_date"
          type="date"
          value-format="YYYY-MM-DD"
          style="width: 100%"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        创建草稿合同
      </el-button>
    </template>
  </el-dialog>
</template>
