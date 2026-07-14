<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import { formatToken, getToken } from "@/utils/auth";
import { listBizThresholds } from "@/api/admin";
import {
  createContract,
  listContracts,
  submitContractApproval,
  type Contract
} from "@/api/contract";
import type { Project } from "@/api/project";
import {
  createPayee,
  createPaymentRequest,
  listPayees,
  submitPaymentApproval,
  type Payee
} from "@/api/payment";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { listEntities, type Entity } from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";

defineOptions({ name: "SmartPaymentWizard" });

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const checking = ref(false);
const submitting = ref(false);
const step = ref(0);
const thresholdLimit = ref(10000);
const exceedsThreshold = ref(false);

const contracts = ref<Contract[]>([]);
const payees = ref<Payee[]>([]);
const entities = ref<Entity[]>([]);
const { projects, loadProjects } = useProjectOptions();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const projectPriority = ["办公室", "仓库"] as const;
const prioritizedProjects = computed(() => {
  const used = new Set<number>();
  const top: Project[] = [];

  for (const key of projectPriority) {
    const matched = projects.value.find(
      item => item.project_name === key || item.project_code === key
    );
    if (matched && !used.has(matched.id)) {
      used.add(matched.id);
      top.push(matched);
    }
  }

  const rest = projects.value.filter(item => !used.has(item.id));
  return [...top, ...rest];
});

const amountInput = ref<number | undefined>(undefined);
const withFirstPayment = ref(false);

const directForm = ref({
  contract_id: null as number | null,
  project_id: undefined as number | undefined,
  payee_id: undefined as number | undefined,
  category: "其他费用",
  content: "",
  payment_method: "对公转账",
  expected_payment_date: "",
  remark: ""
});

const contractForm = ref({
  project_id: undefined as number | undefined,
  entity_id: undefined as number | undefined,
  payee_id: undefined as number | undefined,
  contract_type: "outbound_service",
  handler_userid: "",
  contract_date: "",
  remark: ""
});

const firstPaymentForm = ref({
  amount: undefined as number | undefined,
  category: "prepayment",
  content: "首笔预付款",
  payment_method: "对公转账",
  expected_payment_date: "",
  remark: ""
});

type AttachmentDraft = {
  file_key: string;
  file_name: string;
  file_size?: number | null;
};

const contractAttachments = ref<AttachmentDraft[]>([]);
const directPaymentAttachments = ref<AttachmentDraft[]>([]);
const firstPaymentAttachments = ref<AttachmentDraft[]>([]);
const uploadingAttachment = ref(false);
const quickPayeeDialogVisible = ref(false);
const quickPayeeSubmitting = ref(false);
const quickPayeeForm = ref({
  name: "",
  bank_name: "",
  bank_account: "",
  phone: ""
});

let checkTimer: ReturnType<typeof setTimeout> | null = null;

type SubmitAttemptKeys = {
  fingerprint: string;
  createKey: string;
  submitKey: string;
};

const directSubmitAttempt = ref<SubmitAttemptKeys | null>(null);
const contractFirstPaymentAttempt = ref<SubmitAttemptKeys | null>(null);

const createIdempotencyKey = (scope: string) => {
  const fallback = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : fallback;
  return `${scope}-${randomPart}`;
};

const resolveSubmitAttemptKeys = (
  current: SubmitAttemptKeys | null,
  fingerprint: string,
  scope: string
): SubmitAttemptKeys => {
  if (current && current.fingerprint === fingerprint) {
    return current;
  }
  return {
    fingerprint,
    createKey: createIdempotencyKey(`${scope}-create`),
    submitKey: createIdempotencyKey(`${scope}-submit`)
  };
};

const buildDirectSubmitFingerprint = () => {
  return JSON.stringify({
    contract_id: directForm.value.contract_id,
    project_id: directForm.value.project_id,
    expected_payment_date: directForm.value.expected_payment_date,
    category: directForm.value.category,
    payee_id: directForm.value.payee_id,
    amount: Number(amountInput.value ?? 0),
    content: directForm.value.content.trim(),
    payment_method: directForm.value.payment_method,
    attachments_json: serializeAttachments(directPaymentAttachments.value),
    remark: directForm.value.remark?.trim() ?? ""
  });
};

const buildContractFirstPaymentFingerprint = () => {
  return JSON.stringify({
    contract_project_id: contractForm.value.project_id,
    contract_payee_id: contractForm.value.payee_id,
    first_payment_amount: Number(firstPaymentForm.value.amount ?? 0),
    first_payment_expected_date: firstPaymentForm.value.expected_payment_date,
    first_payment_category: firstPaymentForm.value.category,
    first_payment_content: firstPaymentForm.value.content.trim(),
    first_payment_method: firstPaymentForm.value.payment_method,
    first_payment_attachments: serializeAttachments(
      firstPaymentAttachments.value
    ),
    first_payment_remark: firstPaymentForm.value.remark?.trim() ?? ""
  });
};

const thresholdHint = computed(() =>
  exceedsThreshold.value
    ? `金额超过阈值 ${thresholdLimit.value.toLocaleString()}，请走合同流程`
    : `金额未超过阈值 ${thresholdLimit.value.toLocaleString()}，可直接走付款申请`
);

const shouldUseContractFlow = computed(
  () => exceedsThreshold.value && !directForm.value.contract_id
);

watch(
  shouldUseContractFlow,
  value => {
    step.value = value ? 1 : 0;
  },
  { immediate: true }
);

const inWorkspaceRoute = computed(() => route.path.startsWith("/workspace/"));

const goBackAfterSubmit = () => {
  if (typeof window !== "undefined" && window.history.state?.back) {
    router.back();
    return;
  }
  router.push(
    inWorkspaceRoute.value ? "/workspace/payment/wizard" : "/finance/payment"
  );
};

const toChineseAmount = (amount: number): string => {
  if (!Number.isFinite(amount) || amount < 0) return "金额格式错误";
  if (amount === 0) return "零元整";

  const fractionUnits = ["角", "分"];
  const digit = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const intUnits = ["", "拾", "佰", "仟"];
  const sectionUnits = ["", "万", "亿", "兆"];

  let value = Math.round(amount * 100);
  const fraction = value % 100;
  let result = "";

  if (fraction === 0) {
    result = "整";
  } else {
    const jiao = Math.floor(fraction / 10);
    const fen = fraction % 10;
    if (jiao > 0) result += `${digit[jiao]}${fractionUnits[0]}`;
    if (fen > 0) result += `${digit[fen]}${fractionUnits[1]}`;
  }

  value = Math.floor(value / 100);
  let sectionIndex = 0;
  let intResult = "";

  while (value > 0 && sectionIndex < sectionUnits.length) {
    const sectionValue = value % 10000;
    if (sectionValue !== 0) {
      let sectionText = "";
      let unitIndex = 0;
      let section = sectionValue;
      let zeroPending = false;
      while (section > 0) {
        const num = section % 10;
        if (num === 0) {
          if (!zeroPending && sectionText) {
            zeroPending = true;
            sectionText = `零${sectionText}`;
          }
        } else {
          zeroPending = false;
          sectionText = `${digit[num]}${intUnits[unitIndex]}${sectionText}`;
        }
        unitIndex += 1;
        section = Math.floor(section / 10);
      }
      sectionText = sectionText.replace(/零+/g, "零").replace(/零$/g, "");
      intResult = `${sectionText}${sectionUnits[sectionIndex]}${intResult}`;
    } else if (intResult && !intResult.startsWith("零")) {
      intResult = `零${intResult}`;
    }
    sectionIndex += 1;
    value = Math.floor(value / 10000);
  }

  intResult = intResult.replace(/零+/g, "零").replace(/零([万亿兆])/g, "$1");
  intResult = intResult.replace(/亿万/g, "亿").replace(/零$/g, "");
  return `${intResult || "零"}元${result}`;
};

const amountDisplay = computed(() => {
  const value = Number(amountInput.value ?? 0);
  return `${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}（${toChineseAmount(value)}）`;
});

const firstPaymentAmountDisplay = computed(() => {
  const value = Number(firstPaymentForm.value.amount ?? 0);
  return `${value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}（${toChineseAmount(value)}）`;
});

const selectedContractCounterparty = computed(() => {
  const target = payees.value.find(
    item => item.id === contractForm.value.payee_id
  );
  return target ? target.name : "";
});

const selectedDirectContract = computed(() => {
  if (!directForm.value.contract_id) return null;
  return (
    contracts.value.find(item => item.id === directForm.value.contract_id) ??
    null
  );
});

const sortedContracts = computed(() => {
  return [...contracts.value].sort((a, b) => {
    const timeA = new Date(a.created_at || a.contract_date || "").getTime();
    const timeB = new Date(b.created_at || b.contract_date || "").getTime();
    if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
      return timeB - timeA;
    }
    return b.id - a.id;
  });
});

const selectedDirectPayee = computed(() => {
  if (!directForm.value.payee_id) return null;
  return (
    payees.value.find(item => item.id === directForm.value.payee_id) ?? null
  );
});

const selectedContractPayee = computed(() => {
  if (!contractForm.value.payee_id) return null;
  return (
    payees.value.find(item => item.id === contractForm.value.payee_id) ?? null
  );
});

const selectedDirectContractRemaining = computed(() => {
  const target = selectedDirectContract.value;
  if (!target) return null;
  return Number((target.total_amount - target.paid_amount).toFixed(2));
});

const userStore = useUserStoreHook();
const showAllContracts = ref(false);
const contractEntryOpen = ref(false);

const handlerNameMap = computed(() => {
  const map: Record<string, string> = {};
  wecomUsers.value.forEach(item => {
    if (item.userid) map[item.userid] = item.name || item.userid;
  });
  return map;
});

const contractRemaining = (contract: Contract): number =>
  Number((contract.total_amount - contract.paid_amount).toFixed(2));

// 合同摘要：对方单位｜合同类型｜剩余额度｜提交人（经办人近似）
const contractSummary = (contract: Contract): string => {
  const counterparty = (contract.counterparty || "").trim() || "未填对方单位";
  const contractType = (contract.contract_type || "").trim() || "其他";
  const remaining = contractRemaining(contract).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const handler =
    handlerNameMap.value[contract.handler_userid] ||
    contract.handler_userid ||
    "未知提交人";
  return `${counterparty}｜${contractType}｜剩余 ${remaining}｜${handler}`;
};

// 默认仅显示"自己经办 + 剩余额度>0"的合同；加载全部时显示所有剩余>0 的合同
const visibleContracts = computed(() => {
  const mine = (userStore.username || "").trim();
  return sortedContracts.value.filter(item => {
    if (contractRemaining(item) <= 0) return false;
    if (showAllContracts.value) return true;
    return (item.handler_userid || "").trim() === mine;
  });
});

// 合同优先入口：选定合同后带入直付流程（项目预填、尽量匹配收款方）
const pickContractForPayment = (contractId: number | null) => {
  directForm.value.contract_id = contractId ?? null;
  if (!contractId) return;
  const contract = contracts.value.find(item => item.id === contractId);
  if (!contract) return;
  directForm.value.project_id = contract.project_id;
  const counterparty = (contract.counterparty || "").trim();
  const matchedPayee = counterparty
    ? payees.value.find(item => (item.name || "").trim() === counterparty)
    : undefined;
  if (matchedPayee) {
    directForm.value.payee_id = matchedPayee.id;
  }
};

const serializeAttachments = (items: AttachmentDraft[]): string => {
  return JSON.stringify(
    items.map(item => ({
      file_key: item.file_key,
      file_name: item.file_name,
      file_size: item.file_size ?? undefined
    }))
  );
};

const uploadAttachment = async (
  options: UploadRequestOptions,
  category: "contract" | "payment",
  target: AttachmentDraft[]
) => {
  uploadingAttachment.value = true;
  const rawFile = options.file;
  try {
    const signRes = await createUploadSignature({
      fileName: rawFile.name,
      contentType: rawFile.type,
      category
    });

    const uploadResp = await fetch(resolveUploadUrl(signRes.data.uploadUrl), {
      method: "PUT",
      headers: {
        "content-type": rawFile.type || "application/octet-stream",
        Authorization: formatToken(getToken().accessToken)
      },
      body: rawFile
    });

    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }

    target.unshift({
      file_key: signRes.data.key,
      file_name: rawFile.name,
      file_size: rawFile.size
    });
    message("附件上传成功", { type: "success" });
    options.onSuccess?.({});
  } catch {
    message("附件上传失败", { type: "error" });
    options.onError?.(new Error("upload_failed") as never);
  } finally {
    uploadingAttachment.value = false;
  }
};

const removeAttachment = (target: AttachmentDraft[], index: number) => {
  target.splice(index, 1);
};

const resetQuickPayeeForm = () => {
  quickPayeeForm.value = {
    name: "",
    bank_name: "",
    bank_account: "",
    phone: ""
  };
};

const loadPayees = async () => {
  const payeeRes = await listPayees({ type: "external" });
  payees.value = payeeRes.data;
};

const openQuickExternalPayeeDialog = () => {
  quickPayeeDialogVisible.value = true;
};

const submitQuickExternalPayee = async () => {
  const payload = {
    name: quickPayeeForm.value.name.trim(),
    bank_name: quickPayeeForm.value.bank_name.trim(),
    bank_account: quickPayeeForm.value.bank_account.trim(),
    phone: quickPayeeForm.value.phone.trim()
  };

  if (!payload.name || !payload.bank_name || !payload.bank_account) {
    message("请填写外部收款人名称、开户行和银行账号", { type: "warning" });
    return;
  }

  quickPayeeSubmitting.value = true;
  try {
    const created = await createPayee({
      name: payload.name,
      bank_name: payload.bank_name,
      bank_account: payload.bank_account,
      phone: payload.phone || undefined,
      type: "external"
    });
    const createdId = created.data?.id;
    quickPayeeDialogVisible.value = false;
    resetQuickPayeeForm();
    try {
      await loadPayees();
    } catch {
      payees.value = [
        {
          id: createdId,
          name: payload.name,
          bank_name: payload.bank_name,
          bank_account: payload.bank_account,
          phone: payload.phone,
          type: "external",
          status: "active"
        } as any,
        ...payees.value
      ];
    }
    if (shouldUseContractFlow.value) {
      contractForm.value.payee_id = createdId;
    } else {
      directForm.value.payee_id = createdId;
    }
    message("外部收款人已添加，并自动选中", { type: "success" });
  } catch {
    message("添加收款人失败，请重试", { type: "error" });
  } finally {
    quickPayeeSubmitting.value = false;
  }
};

const loadMeta = async () => {
  const [thresholdRes, contractRes, entityRes] = await Promise.all([
    listBizThresholds({ biz_type: "payment_request" }).catch(error => {
      message(
        error instanceof Error
          ? error.message
          : "付款阈值加载失败，已按默认值继续",
        {
          type: "warning"
        }
      );
      return null;
    }),
    listContracts({ direction: "outbound", page: 1, pageSize: 200 }),
    listEntities()
  ]);

  if (thresholdRes?.data?.length) {
    const min = thresholdRes.data.reduce(
      (acc, cur) => (cur.threshold_value < acc ? cur.threshold_value : acc),
      Number.POSITIVE_INFINITY
    );
    if (Number.isFinite(min)) {
      thresholdLimit.value = min;
    }
  }

  await loadPayees();
  contracts.value = contractRes.data;
  entities.value = entityRes.data;
  await Promise.all([loadProjects(), loadWecomUsers()]);
};

const checkAmount = () => {
  if (checkTimer) clearTimeout(checkTimer);
  checkTimer = setTimeout(() => {
    checking.value = true;
    const value = Number(amountInput.value ?? 0);
    exceedsThreshold.value = value > thresholdLimit.value;
    checking.value = false;
  }, 350);
};

const submitDirectPayment = async () => {
  if (submitting.value) return;
  const amount = Number(amountInput.value ?? 0);
  if (amount > thresholdLimit.value && !directForm.value.contract_id) {
    exceedsThreshold.value = true;
    step.value = 1;
    message(
      `金额超过阈值 ${thresholdLimit.value.toLocaleString()}，请先关联已审批合同，或改走新建合同流程`,
      {
        type: "warning"
      }
    );
    return;
  }
  if (
    !amountInput.value ||
    !directForm.value.project_id ||
    !directForm.value.payee_id
  ) {
    message("请先填写金额、项目、收款人", { type: "warning" });
    return;
  }
  if (
    selectedDirectContractRemaining.value !== null &&
    amount > selectedDirectContractRemaining.value
  ) {
    message(
      `当前合同可用额度为 ${selectedDirectContractRemaining.value}，申请金额不能超过可用额度`,
      { type: "warning" }
    );
    return;
  }
  if (!directPaymentAttachments.value.length) {
    message("请先上传付款附件后再发起", { type: "warning" });
    return;
  }
  if (
    !directForm.value.expected_payment_date ||
    !directForm.value.category ||
    !directForm.value.content.trim() ||
    !directForm.value.payment_method
  ) {
    message("直接付款需完整填写付款审批字段（类别/日期/方式/内容）", {
      type: "warning"
    });
    return;
  }

  submitting.value = true;
  try {
    directSubmitAttempt.value = resolveSubmitAttemptKeys(
      directSubmitAttempt.value,
      buildDirectSubmitFingerprint(),
      "payment-wizard-direct"
    );

    const created = await createPaymentRequest(
      {
        contract_id: directForm.value.contract_id,
        project_id: directForm.value.project_id,
        expected_payment_date: directForm.value.expected_payment_date,
        category: directForm.value.category,
        payee_id: directForm.value.payee_id,
        amount: amountInput.value,
        content: directForm.value.content,
        payment_method: directForm.value.payment_method,
        attachments_json: serializeAttachments(directPaymentAttachments.value),
        remark: directForm.value.remark
      },
      {
        idempotencyKey: directSubmitAttempt.value.createKey
      }
    );
    await submitPaymentApproval(
      created.data.id,
      {
        biz_summary: "智能发单台-直接付款",
        instance_config: { note: "阈值内直接付款" }
      },
      {
        idempotencyKey: directSubmitAttempt.value.submitKey
      }
    );
    directSubmitAttempt.value = null;
    message("提交成功", { type: "success" });
    goBackAfterSubmit();
  } catch {
    message("提交失败，请重试", { type: "error" });
  } finally {
    submitting.value = false;
  }
};

const submitContractFlow = async () => {
  if (submitting.value) return;
  if (
    !amountInput.value ||
    !contractForm.value.project_id ||
    !contractForm.value.entity_id ||
    !contractForm.value.payee_id ||
    !contractForm.value.handler_userid ||
    !contractForm.value.contract_type ||
    !contractForm.value.contract_date
  ) {
    message(
      "合同流程需完整填写合同审查字段（类型/经办人/日期/项目/主体/对方单位/金额）",
      {
        type: "warning"
      }
    );
    return;
  }
  if (!contractAttachments.value.length) {
    message("请先上传合同附件后再发起", { type: "warning" });
    return;
  }
  if (withFirstPayment.value && !firstPaymentAttachments.value.length) {
    message("已开启首笔预付款，请先上传首笔付款附件", { type: "warning" });
    return;
  }
  if (
    withFirstPayment.value &&
    (!firstPaymentForm.value.amount ||
      !firstPaymentForm.value.expected_payment_date ||
      !firstPaymentForm.value.category ||
      !firstPaymentForm.value.content.trim() ||
      !firstPaymentForm.value.payment_method)
  ) {
    message("首笔付款需填写额外付款字段（金额/类别/日期/方式/内容）", {
      type: "warning"
    });
    return;
  }

  submitting.value = true;
  try {
    if (!withFirstPayment.value) {
      contractFirstPaymentAttempt.value = null;
    }

    const contract = await createContract({
      direction: "outbound",
      project_id: contractForm.value.project_id,
      entity_id: contractForm.value.entity_id,
      counterparty: selectedContractCounterparty.value,
      contract_type: contractForm.value.contract_type,
      handler_userid: contractForm.value.handler_userid,
      contract_date: contractForm.value.contract_date,
      total_amount: amountInput.value,
      attachments_json: serializeAttachments(contractAttachments.value),
      remark: contractForm.value.remark
    });

    let paymentId: number | null = null;
    if (withFirstPayment.value) {
      contractFirstPaymentAttempt.value = resolveSubmitAttemptKeys(
        contractFirstPaymentAttempt.value,
        buildContractFirstPaymentFingerprint(),
        "payment-wizard-contract-first-payment"
      );

      const payment = await createPaymentRequest(
        {
          contract_id: contract.data.id,
          project_id: contractForm.value.project_id,
          expected_payment_date: firstPaymentForm.value.expected_payment_date,
          category: firstPaymentForm.value.category,
          payee_id: contractForm.value.payee_id,
          amount: firstPaymentForm.value.amount,
          content: firstPaymentForm.value.content,
          payment_method: firstPaymentForm.value.payment_method,
          attachments_json: serializeAttachments(firstPaymentAttachments.value),
          remark: firstPaymentForm.value.remark
        },
        {
          idempotencyKey: contractFirstPaymentAttempt.value.createKey
        }
      );
      paymentId = payment.data.id;
    }

    await submitContractApproval(contract.data.id, {
      biz_summary: "智能发单台-超阈值合同创建",
      instance_config: { note: "超阈值付款自动走合同审批" }
    });

    if (paymentId) {
      await submitPaymentApproval(
        paymentId,
        {
          biz_summary: "智能发单台-首笔预付款",
          instance_config: { note: "合同创建后同步发起首笔付款" }
        },
        {
          idempotencyKey: contractFirstPaymentAttempt.value?.submitKey
        }
      );
    }

    contractFirstPaymentAttempt.value = null;
    message("提交成功", { type: "success" });
    goBackAfterSubmit();
  } catch {
    message("提交失败，请重试", { type: "error" });
  } finally {
    submitting.value = false;
  }
};

onMounted(async () => {
  loading.value = true;
  try {
    await loadMeta();
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div v-loading="loading" class="wizard-wrap">
    <el-card class="wizard-card" shadow="never">
      <template #header>
        <div class="wizard-title">资金流出智能发单台</div>
      </template>

      <el-form label-width="140px">
        <el-form-item label="预计付款总额">
          <el-input-number
            v-model="amountInput"
            :min="0"
            :precision="2"
            :step="1000"
            style="width: 300px"
            @blur="checkAmount"
          />
          <el-tag :type="exceedsThreshold ? 'danger' : 'success'" class="ml-3">
            {{ thresholdHint }}
          </el-tag>
          <span style="margin-left: 12px; font-weight: 700; color: #6b4f2a">
            {{ amountDisplay }}
          </span>
        </el-form-item>
        <el-form-item label="按合同付款">
          <el-button plain @click="contractEntryOpen = !contractEntryOpen">
            {{ contractEntryOpen ? "收起合同选择" : "💼 通过已有合同发起付款" }}
          </el-button>
          <el-text type="info" style="margin-left: 12px">
            不记得合同号？默认只显示你经办、且仍有可用额度的合同
          </el-text>
        </el-form-item>
        <el-form-item v-if="contractEntryOpen" label="选择合同">
          <div class="contract-entry-body">
            <el-button
              size="small"
              plain
              @click="showAllContracts = !showAllContracts"
            >
              {{ showAllContracts ? "只看我的合同" : "加载全部合同" }}
            </el-button>
            <el-select
              v-model="directForm.contract_id"
              filterable
              clearable
              placeholder="默认只显示你经办且有可用额度的合同"
              style="width: 420px; margin-left: 12px"
              @change="pickContractForPayment"
            >
              <el-option
                v-for="item in visibleContracts"
                :key="item.id"
                :label="contractSummary(item)"
                :value="item.id"
              />
            </el-select>
            <el-text
              v-if="selectedDirectContractRemaining !== null"
              type="warning"
              style="margin-left: 12px"
            >
              当前合同可用额度：{{ selectedDirectContractRemaining }}
            </el-text>
            <el-text
              v-if="visibleContracts.length === 0"
              type="info"
              style="margin-left: 12px"
            >
              暂无{{
                showAllContracts ? "" : "你经办的"
              }}可用合同，可点击“加载全部合同”
            </el-text>
          </div>
        </el-form-item>
      </el-form>

      <el-steps
        :active="step"
        finish-status="success"
        align-center
        class="mb-4"
      >
        <el-step title="金额识别" />
        <el-step
          title="合同流程"
          :description="exceedsThreshold ? '必经' : '跳过'"
        />
        <el-step
          title="首笔预付款"
          :description="withFirstPayment ? '启用' : '可选'"
        />
      </el-steps>

      <el-alert
        :type="exceedsThreshold ? 'warning' : 'info'"
        :closable="false"
        show-icon
      >
        <template #default>
          <span v-if="checking">阈值校验中...</span>
          <span v-else>{{ thresholdHint }}</span>
        </template>
      </el-alert>

      <el-divider />

      <template v-if="!shouldUseContractFlow">
        <el-form label-width="140px">
          <el-form-item label="合同">
            <el-select
              v-model="directForm.contract_id"
              filterable
              clearable
              placeholder="可选：无合同/无需合同，或选择已有关联合同"
              style="width: 360px"
            >
              <el-option label="无合同 / 无需合同" :value="null" />
              <el-option
                v-for="item in visibleContracts"
                :key="item.id"
                :label="contractSummary(item)"
                :value="item.id"
              />
            </el-select>
            <el-button
              size="small"
              plain
              style="margin-left: 12px"
              @click="showAllContracts = !showAllContracts"
            >
              {{ showAllContracts ? "只看我的合同" : "加载全部合同" }}
            </el-button>
            <el-text
              v-if="selectedDirectContractRemaining !== null"
              type="warning"
              style="margin-left: 12px"
            >
              当前合同可用额度：{{ selectedDirectContractRemaining }}
            </el-text>
          </el-form-item>
          <el-form-item label="所属项目">
            <el-select
              v-model="directForm.project_id"
              clearable
              filterable
              placeholder="按时间排序选择项目"
              style="width: 360px"
            >
              <el-option
                v-for="item in prioritizedProjects"
                :key="item.id"
                :label="`${item.project_name} (${item.project_code})`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="收款人">
            <div class="counterparty-field">
              <el-select
                v-model="directForm.payee_id"
                filterable
                style="width: 360px"
              >
                <el-option
                  v-for="item in payees"
                  :key="item.id"
                  :label="`${item.name} (${item.bank_name})`"
                  :value="item.id"
                />
              </el-select>
              <el-button
                plain
                type="primary"
                @click="openQuickExternalPayeeDialog"
              >
                快速添加外部收款人
              </el-button>
            </div>
            <el-descriptions
              v-if="selectedDirectPayee"
              :column="1"
              border
              size="small"
              class="payee-verify-card"
            >
              <el-descriptions-item label="收款人">{{
                selectedDirectPayee.name
              }}</el-descriptions-item>
              <el-descriptions-item label="开户行">{{
                selectedDirectPayee.bank_name
              }}</el-descriptions-item>
              <el-descriptions-item label="银行账号">{{
                selectedDirectPayee.bank_account
              }}</el-descriptions-item>
              <el-descriptions-item label="联系电话">{{
                selectedDirectPayee.phone || "-"
              }}</el-descriptions-item>
            </el-descriptions>
          </el-form-item>
          <el-form-item label="付款日期">
            <el-date-picker
              v-model="directForm.expected_payment_date"
              type="date"
              value-format="YYYY-MM-DD"
            />
          </el-form-item>
          <el-form-item label="付款类别">
            <el-select
              v-model="directForm.category"
              clearable
              style="width: 220px"
            >
              <el-option label="特殊审批" value="特殊审批" />
              <el-option label="行政费" value="行政费" />
              <el-option label="劳务费" value="劳务费" />
              <el-option label="机械费" value="机械费" />
              <el-option label="材料费" value="材料费" />
              <el-option label="其他费用" value="其他费用" />
            </el-select>
          </el-form-item>
          <el-form-item label="付款方式">
            <el-select
              v-model="directForm.payment_method"
              clearable
              style="width: 220px"
            >
              <el-option label="对公转账" value="对公转账" />
              <el-option label="现金" value="现金" />
              <el-option label="票据" value="票据" />
              <el-option label="其他" value="其他" />
            </el-select>
          </el-form-item>
          <el-form-item label="付款事由">
            <el-input v-model="directForm.content" />
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="directForm.remark" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="付款附件" required>
            <div style="width: 100%">
              <el-upload
                drag
                action="#"
                :show-file-list="false"
                :disabled="uploadingAttachment"
                :http-request="
                  (options: UploadRequestOptions) =>
                    uploadAttachment(
                      options,
                      'payment',
                      directPaymentAttachments
                    )
                "
                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
              >
                <div class="el-upload__text">
                  拖拽文件到这里，或 <em>点击上传</em>
                </div>
              </el-upload>
              <el-table
                :data="directPaymentAttachments"
                size="small"
                style="margin-top: 12px"
              >
                <el-table-column label="文件名" min-width="260">
                  <template #default="scope">{{
                    scope.row.file_name
                  }}</template>
                </el-table-column>
                <el-table-column label="大小" width="120">
                  <template #default="scope">{{
                    scope.row.file_size ?? "-"
                  }}</template>
                </el-table-column>
                <el-table-column label="操作" width="120" fixed="right">
                  <template #default="scope">
                    <el-button
                      link
                      type="danger"
                      @click="
                        removeAttachment(directPaymentAttachments, scope.$index)
                      "
                    >
                      移除
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </el-form-item>
        </el-form>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitDirectPayment"
        >
          创建付款并提审
        </el-button>
      </template>

      <template v-else>
        <el-form label-width="140px">
          <el-form-item label="已有关联合同（可选）">
            <el-select
              v-model="directForm.contract_id"
              filterable
              clearable
              placeholder="若本笔付款属于已审批合同，请先选择合同"
              style="width: 360px"
            >
              <el-option
                v-for="item in visibleContracts"
                :key="item.id"
                :label="contractSummary(item)"
                :value="item.id"
              />
            </el-select>
            <el-button
              size="small"
              plain
              style="margin-left: 12px"
              @click="showAllContracts = !showAllContracts"
            >
              {{ showAllContracts ? "只看我的合同" : "加载全部合同" }}
            </el-button>
            <el-text
              v-if="selectedDirectContractRemaining !== null"
              type="warning"
              style="margin-left: 12px"
            >
              当前合同可用额度：{{ selectedDirectContractRemaining }}
            </el-text>
          </el-form-item>
          <el-form-item label="所属项目">
            <el-select
              v-model="contractForm.project_id"
              clearable
              filterable
              placeholder="按时间排序选择项目"
              style="width: 360px"
            >
              <el-option
                v-for="item in prioritizedProjects"
                :key="item.id"
                :label="`${item.project_name} (${item.project_code})`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="我方主体">
            <el-select
              v-model="contractForm.entity_id"
              clearable
              filterable
              style="width: 360px"
            >
              <el-option
                v-for="item in entities"
                :key="item.id"
                :label="item.entity_name"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="对方单位" required>
            <div class="counterparty-field">
              <el-select
                v-model="contractForm.payee_id"
                clearable
                filterable
                placeholder="选择收款单位"
                style="width: 360px"
              >
                <el-option
                  v-for="item in payees"
                  :key="item.id"
                  :label="`${item.name} (${item.bank_name})`"
                  :value="item.id"
                />
              </el-select>
              <el-button
                plain
                type="primary"
                @click="openQuickExternalPayeeDialog"
              >
                快速添加外部收款人
              </el-button>
            </div>
            <el-descriptions
              v-if="selectedContractPayee"
              :column="1"
              border
              size="small"
              class="payee-verify-card"
            >
              <el-descriptions-item label="收款人">{{
                selectedContractPayee.name
              }}</el-descriptions-item>
              <el-descriptions-item label="开户行">{{
                selectedContractPayee.bank_name
              }}</el-descriptions-item>
              <el-descriptions-item label="银行账号">{{
                selectedContractPayee.bank_account
              }}</el-descriptions-item>
              <el-descriptions-item label="联系电话">{{
                selectedContractPayee.phone || "-"
              }}</el-descriptions-item>
            </el-descriptions>
          </el-form-item>
          <el-form-item label="经办人">
            <el-select
              v-model="contractForm.handler_userid"
              clearable
              filterable
              placeholder="选择公司人员"
              style="width: 360px"
            >
              <el-option
                v-for="item in wecomUsers"
                :key="item.userid"
                :label="`${item.name} (${item.userid})`"
                :value="item.userid"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="合同日期">
            <el-date-picker
              v-model="contractForm.contract_date"
              type="date"
              value-format="YYYY-MM-DD"
            />
          </el-form-item>
          <el-form-item label="合同类型">
            <el-select
              v-model="contractForm.contract_type"
              clearable
              style="width: 220px"
            >
              <el-option label="人工" value="人工" />
              <el-option label="机械" value="机械" />
              <el-option label="总包" value="总包" />
              <el-option label="材料" value="材料" />
              <el-option label="其他" value="其他" />
            </el-select>
          </el-form-item>
          <el-form-item label="备注">
            <el-input v-model="contractForm.remark" type="textarea" :rows="2" />
          </el-form-item>
          <el-form-item label="合同附件" required>
            <div style="width: 100%">
              <el-upload
                drag
                action="#"
                :show-file-list="false"
                :disabled="uploadingAttachment"
                :http-request="
                  (options: UploadRequestOptions) =>
                    uploadAttachment(options, 'contract', contractAttachments)
                "
                accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
              >
                <div class="el-upload__text">
                  拖拽文件到这里，或 <em>点击上传</em>
                </div>
              </el-upload>
              <el-table
                :data="contractAttachments"
                size="small"
                style="margin-top: 12px"
              >
                <el-table-column label="文件名" min-width="260">
                  <template #default="scope">{{
                    scope.row.file_name
                  }}</template>
                </el-table-column>
                <el-table-column label="大小" width="120">
                  <template #default="scope">{{
                    scope.row.file_size ?? "-"
                  }}</template>
                </el-table-column>
                <el-table-column label="操作" width="120" fixed="right">
                  <template #default="scope">
                    <el-button
                      link
                      type="danger"
                      @click="
                        removeAttachment(contractAttachments, scope.$index)
                      "
                    >
                      移除
                    </el-button>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </el-form-item>
        </el-form>

        <el-divider />
        <el-form label-width="140px">
          <el-form-item label="同时发起首笔预付款">
            <el-switch v-model="withFirstPayment" />
          </el-form-item>
          <template v-if="withFirstPayment">
            <el-form-item label="首笔金额">
              <el-input-number
                v-model="firstPaymentForm.amount"
                :min="0"
                :precision="2"
                :step="1000"
                style="width: 220px"
              />
              <span style="margin-left: 12px; font-weight: 700; color: #6b4f2a">
                {{ firstPaymentAmountDisplay }}
              </span>
            </el-form-item>
            <el-form-item label="首笔付款类别">
              <el-select
                v-model="firstPaymentForm.category"
                clearable
                style="width: 220px"
              >
                <el-option label="预付款" value="prepayment" />
                <el-option label="进度款" value="progress" />
                <el-option label="结算款" value="settlement" />
                <el-option label="其他费用" value="其他费用" />
              </el-select>
            </el-form-item>
            <el-form-item label="首笔付款日期">
              <el-date-picker
                v-model="firstPaymentForm.expected_payment_date"
                type="date"
                value-format="YYYY-MM-DD"
              />
            </el-form-item>
            <el-form-item label="首笔付款方式">
              <el-select
                v-model="firstPaymentForm.payment_method"
                clearable
                style="width: 220px"
              >
                <el-option label="对公转账" value="对公转账" />
                <el-option label="现金" value="现金" />
                <el-option label="票据" value="票据" />
                <el-option label="其他" value="其他" />
              </el-select>
            </el-form-item>
            <el-form-item label="首笔付款事由">
              <el-input v-model="firstPaymentForm.content" />
            </el-form-item>
            <el-form-item label="首笔备注">
              <el-input
                v-model="firstPaymentForm.remark"
                type="textarea"
                :rows="2"
              />
            </el-form-item>
            <el-form-item label="首笔付款附件" required>
              <div style="width: 100%">
                <el-upload
                  drag
                  action="#"
                  :show-file-list="false"
                  :disabled="uploadingAttachment"
                  :http-request="
                    (options: UploadRequestOptions) =>
                      uploadAttachment(
                        options,
                        'payment',
                        firstPaymentAttachments
                      )
                  "
                  accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx"
                >
                  <div class="el-upload__text">
                    拖拽文件到这里，或 <em>点击上传</em>
                  </div>
                </el-upload>
                <el-table
                  :data="firstPaymentAttachments"
                  size="small"
                  style="margin-top: 12px"
                >
                  <el-table-column label="文件名" min-width="260">
                    <template #default="scope">{{
                      scope.row.file_name
                    }}</template>
                  </el-table-column>
                  <el-table-column label="大小" width="120">
                    <template #default="scope">{{
                      scope.row.file_size ?? "-"
                    }}</template>
                  </el-table-column>
                  <el-table-column label="操作" width="120" fixed="right">
                    <template #default="scope">
                      <el-button
                        link
                        type="danger"
                        @click="
                          removeAttachment(
                            firstPaymentAttachments,
                            scope.$index
                          )
                        "
                      >
                        移除
                      </el-button>
                    </template>
                  </el-table-column>
                </el-table>
              </div>
            </el-form-item>
          </template>
        </el-form>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitContractFlow"
        >
          创建合同并提审
        </el-button>
      </template>
    </el-card>

    <el-dialog
      v-model="quickPayeeDialogVisible"
      title="快速添加外部收款人"
      width="520px"
      @closed="resetQuickPayeeForm"
    >
      <el-form label-width="110px">
        <el-form-item label="收款人名称" required>
          <el-input v-model="quickPayeeForm.name" placeholder="请输入名称" />
        </el-form-item>
        <el-form-item label="开户行" required>
          <el-input
            v-model="quickPayeeForm.bank_name"
            placeholder="请输入开户行"
          />
        </el-form-item>
        <el-form-item label="银行账号" required>
          <el-input
            v-model="quickPayeeForm.bank_account"
            placeholder="请输入银行账号"
          />
        </el-form-item>
        <el-form-item label="联系电话">
          <el-input v-model="quickPayeeForm.phone" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quickPayeeDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="quickPayeeSubmitting"
          :disabled="quickPayeeSubmitting"
          @click="submitQuickExternalPayee"
        >
          保存并选中
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.wizard-wrap {
  display: flex;
  justify-content: center;
  padding: 18px 12px;
}

.wizard-card {
  width: min(960px, 100%);
  background: #fffaf2;
}

.wizard-title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.counterparty-field {
  display: flex;
  align-items: center;
  gap: 12px;
}

.payee-verify-card {
  margin-top: 10px;
  width: min(640px, 100%);
}
</style>
