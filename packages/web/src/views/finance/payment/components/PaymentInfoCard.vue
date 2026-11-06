<script setup lang="ts">
/** 申请信息：能改时是表单，不能改时是阅读视图。金额和收款方等已在头部，这里不重复强调。 */
import { computed, nextTick, ref, watch } from "vue";
import {
  listPayees,
  updatePaymentRequest,
  type Payee,
  type PaymentRequestDetail
} from "@/api/payment";
import { useUserStoreHook } from "@/store/modules/user";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { toChineseAmount } from "@/utils/amount-cn";
import { formatBeijingDateTime } from "@/utils/datetime";
import { message } from "@/utils/message";
import {
  splitRemark,
  toPaymentCategoryLabel
} from "@/views/approval/detail/formatters";
import FinSection from "../../shared/components/FinSection.vue";
import { formatMoney } from "../../shared/format";
import {
  contractRemaining,
  mergeCurrentPayee,
  mergeRemarkEditLog,
  PAYMENT_CATEGORY_OPTIONS,
  PAYMENT_METHOD_OPTIONS,
  type PaymentCapabilities
} from "../payment-detail-view";
import { toPaymentMethodLabel } from "../payment-labels";

defineOptions({ name: "PaymentInfoCard" });

const props = defineProps<{
  detail: PaymentRequestDetail | null;
  capabilities: PaymentCapabilities;
  autoEdit: boolean;
  toUserLabel: (userid: string | null | undefined) => string;
}>();

const emit = defineEmits<{ (e: "refresh"): void }>();

const superEditMode = defineModel<boolean>("superEditMode", { required: true });
const superEditNote = defineModel<string>("superEditNote", { required: true });

/** 支付方案可以后补，没选的时候要说清楚，不能显示成短横线让人以为没这一项。 */
const NOT_SPECIFIED = "尚未指定";

const userStore = useUserStoreHook();
const canOpenContract = computed(() =>
  ["super_admin", "manager", "finance"].some(role =>
    (userStore.roles ?? []).includes(role)
  )
);

const contractText = computed(() => {
  const contract = props.detail?.contract;
  return contract
    ? `${contract.contract_no} - ${contract.counterparty}`
    : "无合同 / 无需合同";
});

const remaining = computed(() =>
  contractRemaining(props.detail?.contract ?? null)
);
const remainingText = computed(() =>
  remaining.value === null
    ? "-"
    : `¥ ${formatMoney(remaining.value)}（${toChineseAmount(remaining.value)}）`
);

const payeeText = computed(() => {
  const payee = props.detail?.payee;
  return payee
    ? `${payee.name}（${payee.bank_name} / ${payee.bank_account}）`
    : "-";
});

const remark = computed(() => splitRemark(props.detail?.remark));

// ── 编辑 ──

const saving = ref(false);
const payees = ref<Payee[]>([]);
const form = ref({
  expected_payment_date: "",
  category: "",
  payee_id: undefined as number | undefined,
  amount: 0,
  content: "",
  payment_method: "",
  remark: ""
});

const payeeOptions = computed(() =>
  mergeCurrentPayee(payees.value, props.detail)
);
const selectedPayee = computed(() =>
  payeeOptions.value.find(item => item.id === form.value.payee_id)
);
const amountUpperText = computed(() =>
  toChineseAmount(Number(form.value.amount || 0))
);

const loadPayees = async () => {
  try {
    payees.value = (await listPayees()).data;
  } catch (error) {
    message(resolveApiErrorMessage(error, "收款人列表加载失败"), {
      type: "error"
    });
  }
};

const canEdit = computed(() => props.capabilities.canEditFields);

// 只有能改时才拉收款人：全量收款人不小，阅读视图用不到
watch(
  canEdit,
  value => {
    if (value && payees.value.length === 0) void loadPayees();
  },
  { immediate: true }
);

const sectionRef = ref<HTMLElement | null>(null);
let autoEditApplied = false;

watch(
  () => props.detail,
  detail => {
    if (!detail) return;
    form.value = {
      expected_payment_date: detail.expected_payment_date,
      category: detail.category,
      payee_id: detail.payee_id,
      amount: detail.amount,
      content: detail.content,
      // 存量值可能是 transfer 这样的英文，下拉框要显示中文
      payment_method: toPaymentMethodLabel(detail.payment_method),
      remark: remark.value.text
    };
    // ?edit=1 深链：加载后定位到表单（能不能改仍由权限决定）
    if (!autoEditApplied && props.autoEdit && canEdit.value) {
      autoEditApplied = true;
      nextTick(() => {
        sectionRef.value?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    }
  },
  { immediate: true }
);

const onSave = async () => {
  const id = props.detail?.id;
  if (!id) return;
  const { expected_payment_date, category, payee_id, payment_method, content } =
    form.value;
  if (
    !payee_id ||
    !expected_payment_date ||
    !category ||
    !payment_method ||
    !content.trim()
  ) {
    message("请完整填写付款审批字段", { type: "warning" });
    return;
  }
  if (superEditMode.value && !superEditNote.value.trim()) {
    message("超管编辑模式下必须填写修改说明", { type: "warning" });
    return;
  }
  saving.value = true;
  try {
    await updatePaymentRequest(id, {
      expected_payment_date,
      category,
      payee_id,
      amount: form.value.amount,
      content,
      payment_method,
      // 表单只改发起人写的那部分，系统修改记录原样保留
      remark: mergeRemarkEditLog(form.value.remark, props.detail?.remark),
      admin_edit_mode: superEditMode.value ? true : undefined,
      edit_note: superEditMode.value ? superEditNote.value.trim() : undefined
    });
    message("保存成功", { type: "success" });
    superEditMode.value = false;
    superEditNote.value = "";
    emit("refresh");
  } catch (error) {
    message(resolveApiErrorMessage(error, "保存失败"), { type: "error" });
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <div ref="sectionRef">
    <FinSection title="申请信息">
      <template
        v-if="capabilities.canToggleSuperEdit || capabilities.canEditFields"
        #extra
      >
        <el-switch
          v-if="capabilities.canToggleSuperEdit"
          v-model="superEditMode"
          size="small"
          active-text="超管编辑"
        />
        <el-button
          v-if="capabilities.canEditFields"
          type="primary"
          size="small"
          :loading="saving"
          @click="onSave"
        >
          保存
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

      <el-form
        v-if="capabilities.canEditFields"
        label-width="100px"
        class="payment-form"
      >
        <el-form-item label="关联合同">
          <span>{{ contractText }}</span>
          <span v-if="remaining !== null" class="payment-form__hint">
            剩余额度 {{ remainingText }}
          </span>
        </el-form-item>
        <el-form-item label="所属项目">
          {{ detail?.project?.project_name || "-" }}
        </el-form-item>
        <el-form-item label="付款类别">
          <el-select v-model="form.category" style="width: 220px">
            <el-option
              v-for="item in PAYMENT_CATEGORY_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="收款方">
          <el-select v-model="form.payee_id" filterable style="width: 360px">
            <el-option
              v-for="item in payeeOptions"
              :key="item.id"
              :value="item.id"
              :label="`${item.name} (${item.bank_account})`"
            />
          </el-select>
          <span v-if="selectedPayee" class="payment-form__hint">
            {{ selectedPayee.bank_name }} / {{ selectedPayee.bank_account }}
          </span>
        </el-form-item>
        <el-form-item label="申请金额">
          <el-input-number
            v-model="form.amount"
            :min="0"
            :precision="2"
            :step="1000"
          />
          <span class="payment-form__hint">{{ amountUpperText }}</span>
        </el-form-item>
        <el-form-item label="预计付款日">
          <el-date-picker
            v-model="form.expected_payment_date"
            type="date"
            value-format="YYYY-MM-DD"
          />
        </el-form-item>
        <el-form-item label="付款方式">
          <el-select v-model="form.payment_method" style="width: 220px">
            <el-option
              v-for="item in PAYMENT_METHOD_OPTIONS"
              :key="item"
              :label="item"
              :value="item"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="付款内容">
          <el-input v-model="form.content" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>

      <el-descriptions v-else :column="2" border>
        <el-descriptions-item label="关联合同">
          <router-link
            v-if="detail?.contract && detail.contract_id && canOpenContract"
            class="payment-link"
            :to="`/finance/contract/detail/${detail.contract_id}`"
          >
            {{ contractText }}
          </router-link>
          <template v-else>{{ contractText }}</template>
        </el-descriptions-item>
        <el-descriptions-item label="合同剩余额度">
          {{ remainingText }}
        </el-descriptions-item>
        <el-descriptions-item label="付款类别">
          {{ toPaymentCategoryLabel(detail?.category) }}
        </el-descriptions-item>
        <el-descriptions-item label="付款方式">
          {{ toPaymentMethodLabel(detail?.payment_method) }}
        </el-descriptions-item>
        <el-descriptions-item label="收款方" :span="2">
          {{ payeeText }}
        </el-descriptions-item>
        <el-descriptions-item label="付款单位">
          {{ detail?.payment_entity?.entity_name || NOT_SPECIFIED }}
        </el-descriptions-item>
        <el-descriptions-item label="付款账户">
          {{ detail?.payment_account || NOT_SPECIFIED }}
        </el-descriptions-item>
        <el-descriptions-item label="预计付款日">
          {{ detail?.expected_payment_date || "-" }}
        </el-descriptions-item>
        <el-descriptions-item label="申请人">
          {{ toUserLabel(detail?.applicant_userid) }}
        </el-descriptions-item>
        <el-descriptions-item label="付款内容" :span="2">
          <span class="payment-multiline">{{ detail?.content || "-" }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="备注" :span="2">
          <span class="payment-multiline">{{ remark.text || "-" }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <el-collapse v-if="remark.edits.length > 0" class="payment-edits">
        <el-collapse-item
          :title="`支付信息修改记录（${remark.edits.length} 条）`"
        >
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
  </div>
</template>

<style scoped>
.payment-form {
  max-width: 900px;
}

.payment-form__hint {
  margin-left: 12px;
  font-size: 13px;
  color: #8c6a2f;
}

.payment-link {
  color: var(--el-color-primary);
}

.payment-link:hover {
  text-decoration: underline;
}

.payment-multiline {
  white-space: pre-wrap;
}

.payment-edits {
  margin-top: 12px;
}

.payment-edits ul {
  padding: 0;
  margin: 0;
  list-style: none;
}

.payment-edits li {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 2px 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.payment-edits time {
  color: var(--el-text-color-secondary);
}
</style>
