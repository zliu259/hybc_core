<script setup lang="ts">
/** 付款执行：付了看明细，已审批未付说一句；审批中当前审批人可调付款单位和账户。 */
import { computed, ref } from "vue";
import {
  listEntities,
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import { updatePaymentRequest, type PaymentRequestDetail } from "@/api/payment";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import FinSection from "../../shared/components/FinSection.vue";
import { isDateOnly } from "../payment-detail-view";
import { formatBeijingDateTime } from "../payment-labels";

defineOptions({ name: "PaymentPayoutPanel" });

const props = defineProps<{
  detail: PaymentRequestDetail | null;
  canAdjust: boolean;
  superEditMode: boolean;
  superEditNote: string;
  toUserLabel: (userid: string | null | undefined) => string;
}>();

const emit = defineEmits<{ (e: "refresh"): void }>();

const visible = computed(
  () =>
    !!props.detail?.paid_at ||
    props.detail?.status === "approved" ||
    props.canAdjust
);

const paidDateText = computed(() => {
  const value = props.detail?.paid_at;
  return isDateOnly(value) ? (value as string) : formatBeijingDateTime(value);
});

const currentPlanText = computed(() => {
  const entity = props.detail?.payment_entity?.entity_name || "尚未指定";
  const account = props.detail?.payment_account || "尚未指定";
  return `${entity} / ${account}`;
});

const editorOpen = ref(false);
const saving = ref(false);
const entities = ref<Entity[]>([]);
const accounts = ref<EntityBankAccount[]>([]);
const form = ref({
  payment_entity_id: undefined as number | undefined,
  payment_entity_bank_account_id: undefined as number | undefined
});

const accountText = (account: EntityBankAccount) =>
  `${account.bank_name} / ${account.account_no}`;

const loadAccounts = async (entityId: number | undefined) => {
  if (!entityId) {
    accounts.value = [];
    return;
  }
  const { data } = await listEntityBankAccounts(entityId);
  accounts.value = data.filter(item => item.status === "active");
};

/** 主体和账户只有真要改时才拉，打开页面不必为每个主体发一次请求。 */
const toggleEditor = async () => {
  if (editorOpen.value) {
    editorOpen.value = false;
    return;
  }
  const entityId =
    props.detail?.payment_entity_id ??
    props.detail?.contract?.entity_id ??
    undefined;
  form.value = {
    payment_entity_id: entityId,
    payment_entity_bank_account_id:
      props.detail?.payment_entity_bank_account_id ?? undefined
  };
  editorOpen.value = true;
  try {
    const [entityRes] = await Promise.all([
      listEntities(),
      loadAccounts(entityId)
    ]);
    entities.value = entityRes.data;
    if (!form.value.payment_entity_bank_account_id && accounts.value[0]) {
      form.value = {
        ...form.value,
        payment_entity_bank_account_id: accounts.value[0].id
      };
    }
  } catch (error) {
    message(resolveApiErrorMessage(error, "付款单位列表加载失败"), {
      type: "error"
    });
  }
};

const onEntityChange = async (entityId: number | undefined) => {
  form.value = {
    payment_entity_id: entityId,
    payment_entity_bank_account_id: undefined
  };
  try {
    await loadAccounts(entityId);
    // 换主体时默认带上第一个账户，否则只提交主体会和旧账户错配
    form.value = {
      ...form.value,
      payment_entity_bank_account_id: accounts.value[0]?.id
    };
  } catch (error) {
    message(resolveApiErrorMessage(error, "付款账户加载失败"), {
      type: "error"
    });
  }
};

const save = async () => {
  const id = props.detail?.id;
  const { payment_entity_id, payment_entity_bank_account_id } = form.value;
  if (!id) return;
  if (!payment_entity_id) {
    message("请选择付款单位", { type: "warning" });
    return;
  }
  const account = accounts.value.find(
    item => item.id === payment_entity_bank_account_id
  );
  if (!account) {
    message("请选择付款账户", { type: "warning" });
    return;
  }
  if (props.superEditMode && !props.superEditNote.trim()) {
    message("超管编辑模式下必须填写修改说明", { type: "warning" });
    return;
  }
  saving.value = true;
  try {
    await updatePaymentRequest(id, {
      payment_entity_id,
      payment_entity_bank_account_id: account.id,
      payment_account: accountText(account),
      ...(props.superEditMode
        ? { admin_edit_mode: true, edit_note: props.superEditNote.trim() }
        : {})
    });
    message("付款单位与账户已更新", { type: "success" });
    editorOpen.value = false;
    emit("refresh");
  } catch (error) {
    message(resolveApiErrorMessage(error, "保存失败，请重试"), {
      type: "error"
    });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <FinSection v-if="visible" title="付款执行">
    <template v-if="canAdjust" #extra>
      <el-button link type="primary" size="small" @click="toggleEditor">
        {{ editorOpen ? "收起" : "修改付款账户" }}
      </el-button>
    </template>

    <el-descriptions v-if="detail?.paid_at" :column="3" border>
      <el-descriptions-item label="支付日期">
        {{ paidDateText }}
      </el-descriptions-item>
      <el-descriptions-item label="支付流水号">
        {{ detail.payment_reference || "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="经办人">
        {{ toUserLabel(detail.paid_by_userid) }}
      </el-descriptions-item>
    </el-descriptions>
    <p v-else-if="detail?.status === 'approved'" class="payout-note">
      审批已通过，等待出纳付款。
    </p>

    <template v-if="canAdjust">
      <p v-if="!editorOpen" class="payout-note">
        当前付款方案：{{ currentPlanText }}
      </p>
      <el-form v-else inline class="payout-editor">
        <el-form-item label="付款单位">
          <el-select
            :model-value="form.payment_entity_id"
            filterable
            style="width: 260px"
            @change="onEntityChange"
          >
            <el-option
              v-for="item in entities"
              :key="item.id"
              :label="item.entity_name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="付款账户">
          <el-select
            v-model="form.payment_entity_bank_account_id"
            filterable
            style="width: 360px"
          >
            <el-option
              v-for="item in accounts"
              :key="item.id"
              :label="accountText(item)"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="saving" @click="save">
            保存
          </el-button>
        </el-form-item>
      </el-form>
    </template>
  </FinSection>
</template>

<style scoped>
.payout-note {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: #6e6458;
}

.payout-editor {
  padding: 12px 12px 0;
  background: #fdf8ee;
  border: 1px dashed #e3d5b8;
  border-radius: 8px;
}
</style>
