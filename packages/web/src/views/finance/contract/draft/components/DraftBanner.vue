<script setup lang="ts">
import { computed, nextTick, reactive, ref } from "vue";
import { ElInput } from "element-plus";
import type { ContractDraft } from "@/api/contract-draft";
import type { Entity, EntityBankAccount } from "@/api/entity";
import type { Project } from "@/api/project";
import {
  draftStatusLabelMap,
  draftStatusTagType,
  familyLabelMap
} from "../draft-labels";

const props = defineProps<{
  draft: ContractDraft;
  entities: Entity[];
  projects: Project[];
  bankAccounts: EntityBankAccount[];
  bankAccountId: number | null;
  saving: boolean;
}>();
const emit = defineEmits<{
  (e: "patch", payload: Partial<ContractDraft>): void;
  (e: "update:bankAccountId", id: number | null): void;
  (e: "save"): void;
  (e: "back"): void;
  (e: "view-contract", contractId: number): void;
}>();

const ourEntity = computed(() =>
  props.entities.find(en => en.id === props.draft.entity_id)
);

// 标题 click-to-edit：文字态点击变输入框，blur/回车确认后保存
const editingTitle = ref(false);
const titleDraft = ref("");
const titleInputRef = ref<InstanceType<typeof ElInput> | null>(null);
const startTitleEdit = () => {
  if (props.draft.status !== "drafting") return;
  titleDraft.value = props.draft.title;
  editingTitle.value = true;
  nextTick(() => titleInputRef.value?.focus());
};
const confirmTitle = () => {
  if (!editingTitle.value) return;
  editingTitle.value = false;
  const next = titleDraft.value.trim();
  if (!next || next === props.draft.title) return;
  emit("patch", { title: next });
  emit("save");
};

// 对方详情弹层：本地副本编辑，保存时一次性 patch 七字段并落库
const counterpartyVisible = ref(false);
const counterpartyForm = reactive({
  counterparty_credit_code: "",
  counterparty_legal_person: "",
  counterparty_address: "",
  counterparty_contact: "",
  counterparty_phone: "",
  counterparty_bank_name: "",
  counterparty_bank_account: ""
});
const openCounterparty = () => {
  counterpartyForm.counterparty_credit_code =
    props.draft.counterparty_credit_code ?? "";
  counterpartyForm.counterparty_legal_person =
    props.draft.counterparty_legal_person ?? "";
  counterpartyForm.counterparty_address =
    props.draft.counterparty_address ?? "";
  counterpartyForm.counterparty_contact =
    props.draft.counterparty_contact ?? "";
  counterpartyForm.counterparty_phone = props.draft.counterparty_phone ?? "";
  counterpartyForm.counterparty_bank_name =
    props.draft.counterparty_bank_name ?? "";
  counterpartyForm.counterparty_bank_account =
    props.draft.counterparty_bank_account ?? "";
  counterpartyVisible.value = true;
};
const saveCounterparty = () => {
  emit("patch", { ...counterpartyForm });
  emit("save");
  counterpartyVisible.value = false;
};

const onSelectPatch = (
  field: "entity_id" | "project_id",
  value: number | null | undefined
) => {
  emit("patch", { [field]: value ?? null });
};
</script>

<template>
  <el-card class="draft-banner">
    <div class="banner-main">
      <div class="banner-left">
        <el-input
          v-if="editingTitle"
          ref="titleInputRef"
          v-model="titleDraft"
          size="small"
          maxlength="120"
          class="title-input"
          @blur="confirmTitle"
          @keyup.enter="confirmTitle"
        />
        <span
          v-else
          class="banner-title"
          :class="{ editable: draft.status === 'drafting' }"
          :title="draft.status === 'drafting' ? '点击修改标题' : draft.title"
          @click="startTitleEdit"
          >{{ draft.title }}</span
        >
        <el-tag size="small">{{
          familyLabelMap[draft.family] ?? draft.family
        }}</el-tag>
        <el-tag size="small" type="info">
          {{ draft.direction === "inbound" ? "对甲方" : "对分包商" }}
        </el-tag>
        <el-tag size="small" :type="draftStatusTagType[draft.status] ?? 'info'">
          {{ draftStatusLabelMap[draft.status] ?? draft.status }}
        </el-tag>
        <el-button
          v-if="draft.status === 'converted' && draft.converted_contract_id"
          link
          type="primary"
          @click="emit('view-contract', draft.converted_contract_id)"
        >
          查看正式合同
        </el-button>
      </div>
      <div class="banner-right">
        <el-select
          :model-value="draft.entity_id"
          clearable
          filterable
          placeholder="我方主体"
          class="field-entity"
          @update:model-value="
            (v: number | null | undefined) => onSelectPatch('entity_id', v)
          "
        >
          <el-option
            v-for="en in entities"
            :key="en.id"
            :value="en.id"
            :label="en.entity_name"
          />
        </el-select>
        <el-select
          v-if="ourEntity"
          :model-value="bankAccountId"
          clearable
          filterable
          placeholder="开户账户（默认主账户）"
          class="field-account"
          @update:model-value="
            (v: number | null | undefined) =>
              emit('update:bankAccountId', v ?? null)
          "
        >
          <el-option
            v-for="a in bankAccounts"
            :key="a.id"
            :value="a.id"
            :label="`${a.bank_name} ${a.account_no}`"
          />
        </el-select>
        <el-select
          :model-value="draft.project_id"
          clearable
          filterable
          placeholder="关联项目"
          class="field-project"
          @update:model-value="
            (v: number | null | undefined) => onSelectPatch('project_id', v)
          "
        >
          <el-option
            v-for="p in projects"
            :key="p.id"
            :value="p.id"
            :label="p.project_name"
          />
        </el-select>
        <el-input
          :model-value="draft.counterparty_name"
          maxlength="120"
          placeholder="对方单位"
          class="field-counterparty"
          @update:model-value="
            (v: string) => emit('patch', { counterparty_name: v })
          "
        />
        <el-button plain @click="openCounterparty">对方详情</el-button>
        <el-button type="primary" :loading="saving" @click="emit('save')"
          >保存</el-button
        >
        <el-button @click="emit('back')">返回列表</el-button>
      </div>
    </div>
    <div v-if="ourEntity" class="banner-sub">
      <el-text size="small" type="info">
        我方主体：统一社会信用代码 {{ ourEntity.tax_id || "—" }}｜法定代表人
        {{ ourEntity.legal_person || "—" }}
      </el-text>
    </div>
    <el-dialog
      v-model="counterpartyVisible"
      title="对方单位详情"
      width="480px"
      append-to-body
    >
      <el-form label-width="96px" size="small">
        <el-form-item label="信用代码">
          <el-input
            v-model="counterpartyForm.counterparty_credit_code"
            maxlength="32"
          />
        </el-form-item>
        <el-form-item label="法定代表人">
          <el-input
            v-model="counterpartyForm.counterparty_legal_person"
            maxlength="60"
          />
        </el-form-item>
        <el-form-item label="地址">
          <el-input
            v-model="counterpartyForm.counterparty_address"
            maxlength="200"
          />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input
            v-model="counterpartyForm.counterparty_contact"
            maxlength="60"
          />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input
            v-model="counterpartyForm.counterparty_phone"
            maxlength="32"
          />
        </el-form-item>
        <el-form-item label="开户银行">
          <el-input
            v-model="counterpartyForm.counterparty_bank_name"
            maxlength="120"
          />
        </el-form-item>
        <el-form-item label="银行账号">
          <el-input
            v-model="counterpartyForm.counterparty_bank_account"
            maxlength="64"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="counterpartyVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="saveCounterparty"
          >保存</el-button
        >
      </template>
    </el-dialog>
  </el-card>
</template>

<style scoped>
.draft-banner {
  margin-bottom: 12px;
}

.banner-main {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: center;
  justify-content: space-between;
}

.banner-left {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-width: 0;
}

.banner-title {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
}

.banner-title.editable {
  cursor: pointer;
}

.banner-title.editable:hover {
  color: var(--el-color-primary);
}

.title-input {
  width: 280px;
}

.banner-right {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.banner-right .el-button + .el-button {
  margin-left: 0;
}

.field-entity {
  width: 200px;
}

.field-account {
  width: 220px;
}

.field-project {
  width: 200px;
}

.field-counterparty {
  width: 200px;
}

.banner-sub {
  margin-top: 6px;
}
</style>
