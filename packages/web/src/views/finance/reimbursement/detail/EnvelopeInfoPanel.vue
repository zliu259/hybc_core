<script setup lang="ts">
import { computed } from "vue";

import type { Entity } from "@/api/entity";
import type { ReimbursementEnvelopeDetail } from "@/api/reimbursement";
import {
  invoiceTitleSourceLabel,
  reimbursementTaskStatusLabel
} from "../reimbursement-labels";
import { invoiceTitleDisplay } from "../reimbursement-title";
import { wholeEnvelopeDuplicates, type EnvelopeForm } from "./view-model";

const props = defineProps<{
  form: EnvelopeForm;
  detail: ReimbursementEnvelopeDetail | null;
  isCreate: boolean;
  canEdit: boolean;
  dirty: boolean;
  saving: boolean;
  projects: { id: number; project_name: string }[];
  users: { userid: string; name?: string }[];
  entities: Entity[];
  titleEntityId: number | undefined;
  canEditInvoiceTitle: boolean;
  savingInvoiceTitle: boolean;
}>();

const emit = defineEmits<{
  (event: "patch", patch: Partial<EnvelopeForm>): void;
  (event: "save"): void;
  (event: "update:titleEntityId", value: number | undefined): void;
  (event: "save-title"): void;
  (event: "open-envelope", envelopeId: number): void;
}>();

const entityNameById = computed(
  () => new Map(props.entities.map(item => [item.id, item.entity_name]))
);

const invoiceTitleText = computed(() => {
  if (!props.detail) return "-";
  const display = invoiceTitleDisplay(
    props.detail,
    props.detail.invoice_title_entity_id
      ? entityNameById.value.get(props.detail.invoice_title_entity_id)
      : null
  );
  return display.tag === "unmatched"
    ? `${display.text}（未匹配主体）`
    : display.text;
});

const titleOptions = computed(() => {
  const active = props.entities.filter(item => item.status === "active");
  const current = props.detail?.invoice_title_entity_id;
  if (!current || active.some(item => item.id === current)) return active;
  const inactive = props.entities.find(item => item.id === current);
  return inactive ? [...active, inactive] : active;
});

const titleDirty = computed(
  () =>
    (props.titleEntityId ?? null) !==
    (props.detail?.invoice_title_entity_id ?? null)
);

const uuidLocked = computed(
  () =>
    !!props.detail &&
    ((props.detail.attachments ?? []).length > 0 ||
      props.detail.status !== "draft")
);

const envelopeDuplicates = computed(() =>
  wholeEnvelopeDuplicates(props.detail?.duplicate_checks ?? [])
);

const voidReason = computed(() =>
  props.detail?.status === "cancelled" ? props.detail.void_reason : null
);
</script>

<template>
  <section class="rb-info">
    <el-form label-width="84px" label-position="left" class="rb-form">
      <el-form-item label="所属项目" required>
        <el-select
          :model-value="form.project_id"
          filterable
          placeholder="请选择项目"
          :disabled="!canEdit"
          @update:model-value="emit('patch', { project_id: $event })"
        >
          <el-option
            v-for="item in projects"
            :key="item.id"
            :label="item.project_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="填报人">
        <el-select
          :model-value="form.applicant_userid"
          clearable
          filterable
          placeholder="留空默认当前登录人"
          :disabled="!canEdit"
          @update:model-value="
            emit('patch', { applicant_userid: $event ?? '' })
          "
        >
          <el-option
            v-for="item in users"
            :key="item.userid"
            :label="item.name || item.userid"
            :value="item.userid"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="通道">
        <el-select
          :model-value="form.channel"
          :disabled="!isCreate"
          @update:model-value="emit('patch', { channel: $event })"
        >
          <el-option label="电子发票" value="electronic" />
          <el-option label="实物信封" value="physical" />
        </el-select>
      </el-form-item>

      <el-form-item
        v-if="isCreate && form.channel === 'physical'"
        label="信封识别号"
        required
      >
        <el-input
          :model-value="form.bind_envelope_uuid"
          placeholder="输入或扫描预打印信封上的识别号"
          @update:model-value="emit('patch', { bind_envelope_uuid: $event })"
        />
      </el-form-item>

      <el-form-item label="费用日期">
        <el-date-picker
          :model-value="form.expense_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
          :disabled="!canEdit"
          @update:model-value="emit('patch', { expense_date: $event ?? '' })"
        />
      </el-form-item>

      <el-form-item label="报销金额">
        <el-input-number
          :model-value="form.amount"
          :min="0"
          :precision="2"
          :step="100"
          :disabled="!canEdit"
          @update:model-value="emit('patch', { amount: $event ?? 0 })"
        />
        <span class="rb-hint">默认等于已识别的票面合计，可以改</span>
      </el-form-item>

      <el-form-item label="费用类别">
        <el-input
          :model-value="form.category"
          :disabled="!canEdit"
          @update:model-value="emit('patch', { category: $event })"
        />
      </el-form-item>

      <el-form-item label="说明">
        <el-input
          :model-value="form.description"
          type="textarea"
          :rows="3"
          :disabled="!canEdit"
          @update:model-value="emit('patch', { description: $event })"
        />
      </el-form-item>

      <el-form-item v-if="canEdit && (isCreate || dirty)">
        <el-button type="primary" plain :loading="saving" @click="emit('save')"
          >保存</el-button
        >
      </el-form-item>
    </el-form>

    <div v-if="envelopeDuplicates.length > 0" class="rb-block rb-block--warn">
      <h3>疑似和这些报销重复</h3>
      <p v-for="item in envelopeDuplicates" :key="item.id">
        {{ item.summary }}
        <el-button
          v-if="item.matched_envelope_id"
          link
          type="primary"
          @click="emit('open-envelope', item.matched_envelope_id as number)"
        >
          查看那张报销
        </el-button>
      </p>
    </div>

    <template v-if="detail">
      <div v-if="voidReason" class="rb-block">
        <h3>废止原因</h3>
        <p>{{ voidReason }}</p>
      </div>

      <dl class="rb-facts-list">
        <div>
          <dt>报销识别号</dt>
          <dd>{{ detail.envelope_no }}</dd>
        </div>
        <div>
          <dt>信封识别号</dt>
          <dd>{{ detail.envelope_uuid }}</dd>
        </div>
        <div>
          <dt>识别号状态</dt>
          <dd>{{ uuidLocked ? "已锁定" : "未锁定" }}</dd>
        </div>
        <div>
          <dt>发票抬头</dt>
          <dd>{{ invoiceTitleText }}</dd>
        </div>
        <div>
          <dt>识别原文</dt>
          <dd>{{ detail.invoice_title_name || "-" }}</dd>
        </div>
        <div>
          <dt>抬头来源</dt>
          <dd>{{ invoiceTitleSourceLabel(detail.invoice_title_source) }}</dd>
        </div>
        <div>
          <dt>PDF 状态</dt>
          <dd>{{ reimbursementTaskStatusLabel(detail.pdf_status) }}</dd>
        </div>
        <div>
          <dt>PDF 文件</dt>
          <dd>{{ detail.pdf_file_key || "-" }}</dd>
        </div>
        <div>
          <dt>批次</dt>
          <dd>{{ detail.batch?.batch_no || "-" }}</dd>
        </div>
      </dl>

      <div v-if="canEditInvoiceTitle" class="rb-block">
        <h3>办公室指定抬头</h3>
        <p class="rb-hint">
          报销款须由抬头对应的我方主体支付。手工指定后不再被识别结果覆盖。
        </p>
        <div class="rb-title-row">
          <el-select
            :model-value="titleEntityId"
            filterable
            clearable
            placeholder="选择我方主体；清除后回到自动识别"
            @update:model-value="emit('update:titleEntityId', $event)"
          >
            <el-option
              v-for="item in titleOptions"
              :key="item.id"
              :label="item.entity_name"
              :value="item.id"
            />
          </el-select>
          <el-button
            type="primary"
            plain
            :loading="savingInvoiceTitle"
            :disabled="!titleDirty"
            @click="emit('save-title')"
          >
            保存抬头
          </el-button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.rb-info {
  min-width: 0;
  padding: 16px 24px 20px;
  font-size: 13px;
  line-height: 20px;
}

.rb-form {
  max-width: 560px;
}

.rb-form :deep(.el-select),
.rb-form :deep(.el-date-editor) {
  width: 100%;
}

.rb-hint {
  margin-left: 8px;
  color: #5c667a;
}

.rb-block {
  margin-top: 16px;
}

.rb-block h3 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: #1f2329;
}

.rb-block p {
  margin: 0;
}

.rb-block .rb-hint {
  margin: 0 0 8px;
}

.rb-block--warn p {
  color: #b4470c;
}

.rb-facts-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 24px;
  padding-top: 16px;
  margin: 16px 0 0;
  border-top: 1px solid #e7ebf0;
}

.rb-facts-list dt {
  color: #8a94a6;
}

.rb-facts-list dd {
  margin: 0;
  color: #1f2329;
  overflow-wrap: anywhere;
}

.rb-title-row {
  display: flex;
  gap: 8px;
  max-width: 560px;
}

.rb-title-row :deep(.el-select) {
  flex: 1;
}

@container (max-width: 860px) {
  .rb-info {
    padding: 14px 16px 16px;
  }

  .rb-facts-list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
