<script setup lang="ts">
/**
 * 合同信息：阅读视图、编辑表单、新建表单三态。方向、项目、我方主体只有新建时能选——
 * 更新接口不接受这三个字段，已有合同上摆可编辑的控件只会让人以为改成功了。
 */
import { computed, onMounted, ref, watch } from "vue";
import {
  createContract,
  updateContract,
  type ContractDetail
} from "@/api/contract";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import type { WeComUser } from "@/api/wecom";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { toChineseAmount } from "@/utils/amount-cn";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { formatBeijingDateTime } from "@/utils/datetime";
import { contractTypeLabel } from "@/utils/enum-labels";
import { message } from "@/utils/message";
import { splitRemark } from "@/views/approval/detail/formatters";
import FinSection from "../../shared/components/FinSection.vue";
import { formatMoney, mergeRemarkEditLog } from "../../shared/format";
import {
  contractTypeOptions,
  type ContractCapabilities
} from "../contract-detail-view";

defineOptions({ name: "ContractInfoSection" });

const props = defineProps<{
  detail: ContractDetail | null;
  isCreate: boolean;
  initialDirection?: "inbound" | "outbound";
  capabilities: ContractCapabilities;
  wecomUsers: WeComUser[];
  toUserLabel: (userid: string | null | undefined) => string;
  /** 新建时先传到存储的附件，随合同一起创建 */
  draftAttachmentsJson: string;
}>();

const emit = defineEmits<{
  (e: "refresh"): void;
  (e: "created", id: number): void;
}>();

const editing = defineModel<boolean>("editing", { required: true });
const superEditMode = defineModel<boolean>("superEditMode", { required: true });
const superEditNote = defineModel<string>("superEditNote", { required: true });

const { projects, loadProjects } = useProjectOptions();
const entities = ref<Entity[]>([]);
const entityAccount = ref<EntityBankAccount | null>(null);
const saving = ref(false);

const emptyForm = () => ({
  direction: props.initialDirection ?? "outbound",
  project_id: undefined as number | undefined,
  entity_id: undefined as number | undefined,
  counterparty: "",
  contract_type: "",
  handler_userid: "",
  contract_date: "",
  total_amount: 0,
  remark: ""
});
const form = ref(emptyForm());

const remark = computed(() => splitRemark(props.detail?.remark));
const typeOptions = computed(() =>
  contractTypeOptions(form.value.contract_type)
);
const showForm = computed(
  () => props.isCreate || (editing.value && props.capabilities.canEditFields)
);
const amountEditable = computed(
  () => props.isCreate || props.capabilities.canEditAmount
);
const amountUpperText = computed(() =>
  toChineseAmount(Number(form.value.total_amount || 0))
);
const projectText = computed(() => {
  const project = props.detail?.project;
  return project ? `${project.project_name} (${project.project_code})` : "-";
});
const entityText = computed(() => {
  const name = props.detail?.entity?.entity_name || "-";
  return entityAccount.value
    ? `${name}（${entityAccount.value.bank_name} / ${entityAccount.value.account_no}）`
    : name;
});

/** 只取这一个主体的账户，不再为每个主体各发一次请求。 */
const loadEntityAccount = async (entityId: number | null | undefined) => {
  entityAccount.value = null;
  if (!entityId) return;
  try {
    const { data } = await listEntityBankAccounts(entityId);
    entityAccount.value =
      data.find(item => item.status === "active") ?? data[0] ?? null;
  } catch {
    // 账户只是辅助信息，取不到时只显示主体名
  }
};

const syncForm = () => {
  const { detail } = props;
  if (!detail) return;
  form.value = {
    direction: detail.direction,
    project_id: detail.project_id,
    entity_id: detail.entity_id,
    counterparty: detail.counterparty,
    // 存量值可能是 labor 这样的英文，下拉框要显示中文
    contract_type: contractTypeLabel(detail.contract_type),
    handler_userid: detail.handler_userid,
    contract_date: detail.contract_date,
    total_amount: detail.total_amount,
    remark: remark.value.text
  };
};

watch(
  () => props.detail,
  detail => {
    syncForm();
    if (detail) void loadEntityAccount(detail.entity_id);
  },
  { immediate: true }
);

onMounted(async () => {
  if (!props.isCreate) return;
  try {
    const [entityRes] = await Promise.all([listEntities(), loadProjects()]);
    entities.value = entityRes.data;
  } catch (error) {
    message(resolveApiErrorMessage(error, "项目或主体列表加载失败"), {
      type: "error"
    });
  }
});

const cancelEdit = () => {
  syncForm();
  editing.value = false;
};

const createNew = async () => {
  const { project_id, entity_id, direction, ...rest } = form.value;
  if (!project_id || !entity_id || !rest.counterparty.trim()) {
    message("请先填写所属项目、我方主体和对方单位", { type: "warning" });
    return;
  }
  const result = await createContract({
    ...rest,
    direction,
    project_id,
    entity_id,
    attachments_json: props.draftAttachmentsJson
  });
  message("合同创建成功", { type: "success" });
  emit("created", result.data.id);
};

const saveExisting = async () => {
  const id = props.detail?.id;
  if (!id) return;
  if (!form.value.counterparty.trim()) {
    message("请填写对方单位", { type: "warning" });
    return;
  }
  if (superEditMode.value && !superEditNote.value.trim()) {
    message("超管编辑模式下必须填写修改说明", { type: "warning" });
    return;
  }
  await updateContract(id, {
    counterparty: form.value.counterparty,
    contract_type: form.value.contract_type,
    handler_userid: form.value.handler_userid,
    contract_date: form.value.contract_date,
    // 非草稿传金额会被接口拒绝，整张表单都存不进去；生效后走金额变更
    ...(props.capabilities.canEditAmount
      ? { total_amount: form.value.total_amount }
      : {}),
    // 表单只改经办人写的那部分，系统修改记录原样保留
    remark: mergeRemarkEditLog(form.value.remark, props.detail?.remark),
    ...(superEditMode.value
      ? { admin_edit_mode: true, edit_note: superEditNote.value.trim() }
      : {})
  });
  message("保存成功", { type: "success" });
  editing.value = false;
  superEditMode.value = false;
  superEditNote.value = "";
  emit("refresh");
};

const onSave = async () => {
  saving.value = true;
  try {
    await (props.isCreate ? createNew() : saveExisting());
  } catch (error) {
    message(resolveApiErrorMessage(error, "保存失败"), { type: "error" });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <FinSection title="合同信息">
    <template v-if="!isCreate" #extra>
      <el-switch
        v-if="capabilities.canToggleSuperEdit"
        v-model="superEditMode"
        size="small"
        active-text="超管编辑"
      />
      <template v-if="showForm">
        <el-button size="small" :disabled="saving" @click="cancelEdit">
          取消
        </el-button>
        <el-button
          type="primary"
          size="small"
          :loading="saving"
          @click="onSave"
        >
          保存
        </el-button>
      </template>
      <el-button
        v-else-if="capabilities.canEditFields"
        size="small"
        @click="editing = true"
      >
        编辑资料
      </el-button>
    </template>

    <template v-if="superEditMode">
      <el-alert
        title="超管编辑模式已开启：保存时必须写修改说明，说明会写入备注留痕。"
        type="warning"
        :closable="false"
        style="margin-bottom: 8px"
      />
      <el-input
        v-model="superEditNote"
        placeholder="修改说明（必填）"
        style="margin-bottom: 12px"
      />
    </template>

    <el-form v-if="showForm" label-width="100px" class="contract-form">
      <template v-if="isCreate">
        <el-form-item label="合同方向">
          <el-radio-group v-model="form.direction">
            <el-radio label="outbound">对外付款</el-radio>
            <el-radio label="inbound">收款</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="所属项目">
          <el-select
            v-model="form.project_id"
            filterable
            clearable
            style="width: 360px"
          >
            <el-option
              v-for="item in projects"
              :key="item.id"
              :value="item.id"
              :label="item.project_name"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="我方主体">
          <el-select
            v-model="form.entity_id"
            filterable
            clearable
            style="width: 360px"
            @change="loadEntityAccount"
          >
            <el-option
              v-for="item in entities"
              :key="item.id"
              :value="item.id"
              :label="item.entity_name"
            />
          </el-select>
          <span v-if="entityAccount" class="contract-form__hint">
            {{ entityAccount.bank_name }} / {{ entityAccount.account_no }}
          </span>
        </el-form-item>
      </template>
      <template v-else>
        <el-form-item label="所属项目">{{ projectText }}</el-form-item>
        <el-form-item label="我方主体">{{ entityText }}</el-form-item>
      </template>

      <el-form-item label="对方单位">
        <el-input v-model="form.counterparty" placeholder="请输入对方单位" />
      </el-form-item>
      <el-form-item label="合同类型">
        <el-select v-model="form.contract_type" clearable style="width: 220px">
          <el-option
            v-for="item in typeOptions"
            :key="item"
            :label="item"
            :value="item"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="经办人">
        <el-select
          v-model="form.handler_userid"
          clearable
          filterable
          placeholder="选择公司人员"
          style="width: 360px"
        >
          <el-option
            v-for="item in wecomUsers"
            :key="item.userid"
            :label="item.name"
            :value="item.userid"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="合同日期">
        <el-date-picker
          v-model="form.contract_date"
          type="date"
          value-format="YYYY-MM-DD"
          placeholder="选择日期"
        />
      </el-form-item>
      <el-form-item label="合同金额">
        <template v-if="amountEditable">
          <el-input-number
            v-model="form.total_amount"
            :min="0"
            :precision="2"
            :step="1000"
          />
          <span class="contract-form__hint">{{ amountUpperText }}</span>
        </template>
        <template v-else>
          ¥ {{ formatMoney(detail?.total_amount) }}
          <span class="contract-form__hint">
            金额不能在这里改，请用头部的「发起金额变更」
          </span>
        </template>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="3" />
      </el-form-item>
      <el-form-item v-if="isCreate">
        <el-button type="primary" :loading="saving" @click="onSave">
          保存
        </el-button>
      </el-form-item>
    </el-form>

    <el-descriptions v-else :column="2" border>
      <el-descriptions-item label="所属项目">
        {{ projectText }}
      </el-descriptions-item>
      <el-descriptions-item label="我方主体">
        {{ entityText }}
      </el-descriptions-item>
      <el-descriptions-item label="对方单位">
        {{ detail?.counterparty || "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="合同类型">
        {{
          detail?.contract_type ? contractTypeLabel(detail.contract_type) : "-"
        }}
      </el-descriptions-item>
      <el-descriptions-item label="经办人">
        {{ toUserLabel(detail?.handler_userid) }}
      </el-descriptions-item>
      <el-descriptions-item label="合同日期">
        {{ detail?.contract_date || "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="备注" :span="2">
        <span class="contract-multiline">{{ remark.text || "-" }}</span>
      </el-descriptions-item>
    </el-descriptions>

    <el-collapse
      v-if="!showForm && remark.edits.length > 0"
      class="contract-edits"
    >
      <el-collapse-item :title="`资料修改记录（${remark.edits.length} 条）`">
        <ul>
          <li v-for="(edit, index) in remark.edits" :key="index">
            <time>{{ formatBeijingDateTime(edit.at) }}</time>
            <span>{{ toUserLabel(edit.by) }}</span>
            <span>{{ edit.note }}</span>
          </li>
        </ul>
      </el-collapse-item>
    </el-collapse>
  </FinSection>
</template>

<style scoped>
.contract-form {
  max-width: 900px;
}

.contract-form__hint {
  margin-left: 12px;
  font-size: 13px;
  color: #8c6a2f;
}

.contract-multiline {
  white-space: pre-wrap;
}

.contract-edits {
  margin-top: 12px;
}

.contract-edits ul {
  padding: 0;
  margin: 0;
  list-style: none;
}

.contract-edits li {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 2px 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.contract-edits time {
  color: var(--el-text-color-secondary);
}
</style>
