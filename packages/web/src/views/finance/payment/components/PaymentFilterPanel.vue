<script setup lang="ts">
import type { Project } from "@/api/project";
import type { WeComUser } from "@/api/wecom";
import {
  AI_RISK_FILTER_OPTIONS,
  type PaymentListFilters
} from "../payment-list-filters";

defineOptions({ name: "PaymentFilterPanel" });

defineProps<{
  projects: Project[];
  wecomUsers: WeComUser[];
}>();

const emit = defineEmits<{
  /** 用当前条件重新查询 */
  (e: "search"): void;
  /** 清空全部条件并查询 */
  (e: "reset"): void;
}>();

const model = defineModel<PaymentListFilters>({ required: true });

const update = <K extends keyof PaymentListFilters>(
  key: K,
  value: PaymentListFilters[K]
) => {
  model.value = { ...model.value, [key]: value };
};

/** 下拉和日期选完立即查询；文本和金额在回车或点「查询」时生效 */
const updateAndSearch = <K extends keyof PaymentListFilters>(
  key: K,
  value: PaymentListFilters[K]
) => {
  update(key, value);
  emit("search");
};
</script>

<template>
  <el-form class="payment-filter" label-width="72px" @submit.prevent>
    <div class="payment-filter__grid">
      <el-form-item label="所属项目">
        <el-select
          :model-value="model.project_id"
          clearable
          filterable
          placeholder="全部项目"
          @update:model-value="
            (value: number | undefined) =>
              updateAndSearch('project_id', value || undefined)
          "
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="申请人">
        <el-select
          :model-value="model.applicant_userid"
          clearable
          filterable
          placeholder="全部申请人"
          @update:model-value="
            (value: string | undefined) =>
              updateAndSearch('applicant_userid', value ?? '')
          "
        >
          <el-option
            v-for="item in wecomUsers"
            :key="item.userid"
            :label="item.name || item.userid"
            :value="item.userid"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="收款方">
        <el-input
          :model-value="model.payee_keyword"
          clearable
          maxlength="100"
          placeholder="收款方名称，回车查询"
          @update:model-value="
            (value: string) => update('payee_keyword', value)
          "
          @keyup.enter="emit('search')"
          @clear="emit('search')"
        />
      </el-form-item>
      <el-form-item label="付款内容">
        <el-input
          :model-value="model.keyword"
          clearable
          maxlength="100"
          placeholder="内容或流水号，回车查询"
          @update:model-value="(value: string) => update('keyword', value)"
          @keyup.enter="emit('search')"
          @clear="emit('search')"
        />
      </el-form-item>
      <el-form-item label="金额(元)">
        <div class="payment-filter__amount">
          <el-input-number
            :model-value="model.amount_min ?? undefined"
            :min="0"
            :precision="2"
            :controls="false"
            placeholder="最低"
            @update:model-value="
              (value: number | null | undefined) => update('amount_min', value)
            "
            @keyup.enter="emit('search')"
          />
          <span class="payment-filter__dash">至</span>
          <el-input-number
            :model-value="model.amount_max ?? undefined"
            :min="0"
            :precision="2"
            :controls="false"
            placeholder="最高"
            @update:model-value="
              (value: number | null | undefined) => update('amount_max', value)
            "
            @keyup.enter="emit('search')"
          />
        </div>
      </el-form-item>
      <el-form-item label="申请日期">
        <el-date-picker
          :model-value="model.created_range ?? undefined"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          unlink-panels
          @update:model-value="
            (value: [string, string] | null) =>
              updateAndSearch('created_range', value ?? null)
          "
        />
      </el-form-item>
      <el-form-item label="支付日期">
        <el-date-picker
          :model-value="model.paid_range ?? undefined"
          type="daterange"
          value-format="YYYY-MM-DD"
          range-separator="至"
          start-placeholder="开始"
          end-placeholder="结束"
          unlink-panels
          @update:model-value="
            (value: [string, string] | null) =>
              updateAndSearch('paid_range', value ?? null)
          "
        />
      </el-form-item>
      <el-form-item label="AI风险">
        <el-select
          :model-value="model.ai_risk_status"
          clearable
          placeholder="全部"
          @update:model-value="
            (value: string | undefined) =>
              updateAndSearch('ai_risk_status', value ?? '')
          "
        >
          <el-option
            v-for="item in AI_RISK_FILTER_OPTIONS"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
      </el-form-item>
    </div>
    <div class="payment-filter__actions">
      <el-button @click="emit('reset')">重置</el-button>
      <el-button type="primary" @click="emit('search')">查询</el-button>
    </div>
  </el-form>
</template>

<style scoped>
.payment-filter {
  padding: 16px 16px 0;
  margin-top: 4px;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}

.payment-filter__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 0 20px;
}

.payment-filter__grid :deep(.el-select),
.payment-filter__grid :deep(.el-input),
.payment-filter__grid :deep(.el-date-editor) {
  width: 100%;
}

.payment-filter__amount {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.payment-filter__amount :deep(.el-input-number) {
  flex: 1;
  min-width: 0;
}

.payment-filter__amount :deep(.el-input__inner) {
  text-align: left;
}

.payment-filter__dash {
  flex-shrink: 0;
  color: #9ca3af;
}

.payment-filter__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding-bottom: 16px;
}
</style>
