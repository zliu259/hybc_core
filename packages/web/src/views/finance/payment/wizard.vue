<script setup lang="ts">
import type { UploadRequestOptions } from "element-plus";
import { computed, onMounted, ref } from "vue";
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
import {
  createPaymentRequest,
  listPayees,
  submitPaymentApproval,
  type Payee
} from "@/api/payment";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { listEntities, type Entity } from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

defineOptions({ name: "SmartPaymentWizard" });

const router = useRouter();
const route = useRoute();
const loading = ref(false);
const checking = ref(false);
const submitting = ref(false);
const step = ref(0);
const thresholdLimit = ref(50000);
const exceedsThreshold = ref(false);

const contracts = ref<Contract[]>([]);
const payees = ref<Payee[]>([]);
const entities = ref<Entity[]>([]);
const { projects, loadProjects } = useProjectOptions();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

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

let checkTimer: ReturnType<typeof setTimeout> | null = null;

const thresholdHint = computed(() =>
  exceedsThreshold.value
    ? `金额超过阈值 ${thresholdLimit.value.toLocaleString()}，请走合同流程`
    : `金额未超过阈值 ${thresholdLimit.value.toLocaleString()}，可直接走付款申请`
);

const inWorkspaceRoute = computed(() => route.path.startsWith("/workspace/"));

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

const loadMeta = async () => {
  const [thresholdRes, payeeRes, contractRes, entityRes] = await Promise.all([
    listBizThresholds({ biz_type: "payment_request" }).catch(() => null),
    listPayees(),
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

  payees.value = payeeRes.data;
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
    step.value = exceedsThreshold.value ? 1 : 0;
    checking.value = false;
  }, 350);
};

const submitDirectPayment = async () => {
  const amount = Number(amountInput.value ?? 0);
  if (amount > thresholdLimit.value) {
    exceedsThreshold.value = true;
    step.value = 1;
    message(
      `金额超过阈值 ${thresholdLimit.value.toLocaleString()}，请走合同流程`,
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
    const created = await createPaymentRequest({
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
    });
    await submitPaymentApproval(created.data.id, {
      biz_summary: "智能发单台-直接付款",
      instance_config: { note: "阈值内直接付款" }
    });
    message("付款申请已创建并提交审批", { type: "success" });
    router.replace(
      inWorkspaceRoute.value
        ? `/workspace/payment/detail/${created.data.id}`
        : `/finance/payment/detail/${created.data.id}`
    );
  } finally {
    submitting.value = false;
  }
};

const submitContractFlow = async () => {
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
      const payment = await createPaymentRequest({
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
      });
      paymentId = payment.data.id;
    }

    await submitContractApproval(contract.data.id, {
      biz_summary: "智能发单台-超阈值合同创建",
      instance_config: { note: "超阈值付款自动走合同审批" }
    });

    if (paymentId) {
      await submitPaymentApproval(paymentId, {
        biz_summary: "智能发单台-首笔预付款",
        instance_config: { note: "合同创建后同步发起首笔付款" }
      });
    }

    message("流程已提交：合同审批" + (paymentId ? " + 首笔付款审批" : ""), {
      type: "success"
    });
    router.replace(`/finance/contract/detail/${contract.data.id}`);
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

      <template v-if="!exceedsThreshold">
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
                v-for="item in contracts"
                :key="item.id"
                :label="`${item.contract_no} - ${item.counterparty}`"
                :value="item.id"
              />
            </el-select>
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
                v-for="item in projects"
                :key="item.id"
                :label="`${item.project_name} (${item.project_code})`"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="收款人">
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
          <el-form-item label="所属项目">
            <el-select
              v-model="contractForm.project_id"
              clearable
              filterable
              placeholder="按时间排序选择项目"
              style="width: 360px"
            >
              <el-option
                v-for="item in projects"
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
</style>
