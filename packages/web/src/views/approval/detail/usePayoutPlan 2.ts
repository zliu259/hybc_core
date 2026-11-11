import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { ElMessageBox } from "element-plus";
import {
  listEntityBankAccounts,
  type Entity,
  type EntityBankAccount
} from "@/api/entity";
import { updatePaymentRequest } from "@/api/payment";
import { updateBatchPayoutPlan } from "@/api/reimbursement";
import type { BizRecords } from "./biz-view";
import { normalizePaymentMethodValue } from "./formatters";

export const PAYOUT_METHOD_OPTIONS = [
  { label: "可后续补充", value: "" },
  { label: "对公转账", value: "transfer" },
  { label: "转账", value: "personal_transfer" },
  { label: "现金", value: "cash" },
  { label: "票据", value: "bill" },
  { label: "其他", value: "other" }
];

type PayoutForm = {
  payment_method: string;
  payment_entity_id: number | undefined;
  payment_entity_bank_account_id: number | undefined;
  payment_account: string;
};

const EMPTY_FORM: PayoutForm = {
  payment_method: "",
  payment_entity_id: undefined,
  payment_entity_bank_account_id: undefined,
  payment_account: ""
};

const accountLabel = (account: EntityBankAccount) =>
  `${account.bank_name} / ${account.account_no}`;

const sameForm = (a: PayoutForm, b: PayoutForm) =>
  a.payment_method === b.payment_method &&
  a.payment_entity_id === b.payment_entity_id &&
  a.payment_entity_bank_account_id === b.payment_entity_bank_account_id &&
  a.payment_account === b.payment_account;

/** 审批台支付方案。银行账户只在选中主体时才请求，不再进页面就把所有主体查一遍。 */
export function usePayoutPlan(options: {
  records: Ref<BizRecords>;
  entities: Ref<Entity[]>;
  isSuperAdmin: ComputedRef<boolean>;
  hasAction: (action: string) => boolean;
}) {
  const { records, entities, isSuperAdmin, hasAction } = options;

  const form = ref<PayoutForm>({ ...EMPTY_FORM });
  const baseline = ref<PayoutForm>({ ...EMPTY_FORM });
  const accountsByEntity = ref<Record<number, EntityBankAccount[]>>({});
  const accountsLoading = ref(false);

  const source = computed(
    () => records.value.payment ?? records.value.reimbursementBatch ?? null
  );

  const visible = computed(
    () =>
      Boolean(source.value) &&
      (hasAction("approve") || hasAction("reject") || hasAction("return_prev"))
  );

  const entityAccounts = computed(() =>
    form.value.payment_entity_id
      ? (accountsByEntity.value[form.value.payment_entity_id] ?? [])
      : []
  );

  const ensureAccounts = async (entityId: number) => {
    if (accountsByEntity.value[entityId]) {
      return accountsByEntity.value[entityId];
    }
    accountsLoading.value = true;
    try {
      const result = await listEntityBankAccounts(entityId);
      const active = result.data.filter(item => item.status === "active");
      accountsByEntity.value = {
        ...accountsByEntity.value,
        [entityId]: active
      };
      return active;
    } catch {
      return [];
    } finally {
      accountsLoading.value = false;
    }
  };

  const fillDefaultAccount = async (entityId: number) => {
    const accounts = await ensureAccounts(entityId);
    // 请求期间用户可能已改选，只在主体未变且账户仍为空时才默认填第一个
    if (
      form.value.payment_entity_id !== entityId ||
      form.value.payment_entity_bank_account_id ||
      accounts.length === 0
    ) {
      return;
    }
    form.value = {
      ...form.value,
      payment_entity_bank_account_id: accounts[0].id,
      payment_account: accountLabel(accounts[0])
    };
  };

  watch(source, record => {
    if (!record) {
      form.value = { ...EMPTY_FORM };
      baseline.value = { ...EMPTY_FORM };
      return;
    }
    const next: PayoutForm = {
      payment_method: normalizePaymentMethodValue(record.payment_method),
      payment_entity_id: record.payment_entity_id ?? undefined,
      payment_entity_bank_account_id:
        record.payment_entity_bank_account_id ?? undefined,
      payment_account: record.payment_account ?? ""
    };
    form.value = { ...next };
    baseline.value = { ...next };
    if (visible.value && next.payment_entity_id) {
      void fillDefaultAccount(next.payment_entity_id);
    }
  });

  const onEntityChange = (entityId: number | undefined) => {
    form.value = {
      ...form.value,
      payment_entity_id: entityId,
      payment_entity_bank_account_id: undefined,
      payment_account: ""
    };
    if (entityId) void fillDefaultAccount(entityId);
  };

  const onAccountChange = (accountId: number | undefined) => {
    const target = entityAccounts.value.find(item => item.id === accountId);
    form.value = {
      ...form.value,
      payment_entity_bank_account_id: accountId,
      payment_account: target ? accountLabel(target) : ""
    };
  };

  const setMethod = (method: string) => {
    form.value = { ...form.value, payment_method: method };
  };

  /** 没改过就不提交：否则每次审批都往备注写一条「超管修改」日志 */
  const dirty = computed(() => !sameForm(form.value, baseline.value));

  const hasSelection = computed(
    () =>
      Boolean(form.value.payment_method) ||
      Boolean(form.value.payment_entity_id) ||
      Boolean(form.value.payment_entity_bank_account_id)
  );

  const entityName = computed(
    () =>
      entities.value.find(item => item.id === form.value.payment_entity_id)
        ?.entity_name ?? ""
  );

  const titleEntityName = computed(
    () =>
      records.value.reimbursementBatch?.invoice_title_entity?.entity_name ??
      null
  );

  const titleMismatch = computed(() => {
    const batch = records.value.reimbursementBatch;
    return Boolean(
      batch?.invoice_title_entity_id &&
      form.value.payment_entity_id &&
      form.value.payment_entity_id !== batch.invoice_title_entity_id
    );
  });

  const confirmTitleMismatch = async (): Promise<boolean> => {
    if (!titleMismatch.value) return true;
    try {
      await ElMessageBox.confirm(
        `所选付款主体与批次发票抬头主体（${titleEntityName.value ?? "-"}）不一致。报销款应由发票抬头对应主体支付，确定仍要继续？`,
        "付款主体与发票抬头不一致",
        {
          type: "warning",
          confirmButtonText: "仍要继续",
          cancelButtonText: "取消"
        }
      );
      return true;
    } catch {
      return false;
    }
  };

  const persist = async () => {
    const value = form.value;
    const method = value.payment_method || undefined;
    if (records.value.payment) {
      await updatePaymentRequest(records.value.payment.id, {
        payment_method: method,
        payment_entity_id: value.payment_entity_id,
        payment_entity_bank_account_id: value.payment_entity_bank_account_id,
        payment_account: value.payment_account || null,
        admin_edit_mode: isSuperAdmin.value ? true : undefined,
        edit_note: isSuperAdmin.value ? "审批页更新支付信息" : undefined
      });
    } else if (records.value.reimbursementBatch) {
      await updateBatchPayoutPlan(records.value.reimbursementBatch.id, {
        payment_method: method,
        payment_entity_id: value.payment_entity_id,
        payment_entity_bank_account_id: value.payment_entity_bank_account_id,
        payment_account: value.payment_account || undefined
      });
    }
    baseline.value = { ...value };
  };

  return {
    form,
    visible,
    dirty,
    hasSelection,
    entityName,
    entityAccounts,
    accountsLoading,
    titleEntityName,
    titleMismatch,
    onEntityChange,
    onAccountChange,
    setMethod,
    confirmTitleMismatch,
    persist
  };
}

export type PayoutPlan = ReturnType<typeof usePayoutPlan>;
