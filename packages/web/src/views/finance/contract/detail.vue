<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import {
  createContract,
  getAiReview,
  getContract,
  submitAmountChangeApproval,
  submitContractApproval,
  triggerAiReview,
  updateContract,
  type InstanceConfig,
  type ContractAmountChange,
  type ContractDetail
} from "@/api/contract";
import { listEntities, type Entity } from "@/api/entity";
import { useProjectOptions } from "@/composables/useProjectOptions";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

defineOptions({ name: "ContractDetail" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const route = useRoute();
const router = useRouter();
const loading = ref(false);
const saving = ref(false);

const { projects, loadProjects } = useProjectOptions();
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
const entities = ref<Entity[]>([]);
const detail = ref<ContractDetail | null>(null);

const form = ref({
  direction: "outbound",
  project_id: undefined as number | undefined,
  entity_id: undefined as number | undefined,
  counterparty: "",
  contract_type: "",
  handler_userid: "",
  contract_date: "",
  total_amount: 0,
  attachments_json: "[]",
  remark: ""
});

const aiReviewData = ref<Record<string, unknown> | null>(null);
const aiStatus = ref("none");
const aiStatusTagType: Record<string, TagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};

const isCreate = computed(() => route.params.id === "create");
const contractId = computed(() => Number(route.params.id));
const remainingAmount = computed(() => {
  if (!detail.value) return 0;
  return detail.value.total_amount - detail.value.paid_amount;
});

const approvalDialogVisible = ref(false);
const approvalSummary = ref("");
const approvalConfigText = ref("{}");

const loadBaseData = async () => {
  const [entityRes] = await Promise.all([listEntities(), loadProjects(), loadWecomUsers()]);
  entities.value = entityRes.data;
};

const loadDetail = async () => {
  if (isCreate.value) return;
  loading.value = true;
  try {
    const result = await getContract(contractId.value);
    detail.value = result.data;
    form.value = {
      direction: result.data.direction,
      project_id: result.data.project_id,
      entity_id: result.data.entity_id,
      counterparty: result.data.counterparty,
      contract_type: result.data.contract_type,
      handler_userid: result.data.handler_userid,
      contract_date: result.data.contract_date,
      total_amount: result.data.total_amount,
      attachments_json: result.data.attachments_json ?? "[]",
      remark: result.data.remark ?? ""
    };
    await loadAiReview();
  } finally {
    loading.value = false;
  }
};

const loadAiReview = async () => {
  if (isCreate.value) return;
  const result = await getAiReview(contractId.value);
  aiStatus.value = result.data.status;
  aiReviewData.value = result.data.result;
};

const onSave = async () => {
  if (
    !form.value.project_id ||
    !form.value.entity_id ||
    !form.value.counterparty
  ) {
    message("请先填写必填项", { type: "warning" });
    return;
  }
  saving.value = true;
  try {
    if (isCreate.value) {
      const result = await createContract({
        direction: form.value.direction,
        project_id: form.value.project_id,
        entity_id: form.value.entity_id,
        counterparty: form.value.counterparty,
        contract_type: form.value.contract_type,
        handler_userid: form.value.handler_userid,
        contract_date: form.value.contract_date,
        total_amount: form.value.total_amount,
        attachments_json: form.value.attachments_json,
        remark: form.value.remark
      });
      message("合同创建成功", { type: "success" });
      router.replace(`/finance/contract/detail/${result.data.id}`);
      return;
    }
    await updateContract(contractId.value, {
      counterparty: form.value.counterparty,
      contract_type: form.value.contract_type,
      handler_userid: form.value.handler_userid,
      contract_date: form.value.contract_date,
      total_amount: form.value.total_amount,
      attachments_json: form.value.attachments_json,
      remark: form.value.remark
    });
    message("保存成功", { type: "success" });
    await loadDetail();
  } catch {
    message("保存失败", { type: "error" });
  } finally {
    saving.value = false;
  }
};

const onSubmitApproval = async () => {
  if (isCreate.value) {
    message("请先保存合同", { type: "warning" });
    return;
  }
  approvalSummary.value = detail.value?.contract_no
    ? `${detail.value.contract_no} | ${detail.value.counterparty} | ${detail.value.total_amount}`
    : "";
  approvalConfigText.value = "{}";
  approvalDialogVisible.value = true;
};

const confirmSubmitApproval = async () => {
  if (isCreate.value) return;

  let instanceConfig: InstanceConfig | undefined;
  const trimmed = approvalConfigText.value.trim();
  if (trimmed && trimmed !== "{}") {
    try {
      instanceConfig = JSON.parse(trimmed) as InstanceConfig;
    } catch {
      message("实例级配置 JSON 格式不正确", { type: "warning" });
      return;
    }
  }

  await submitContractApproval(contractId.value, {
    biz_summary: approvalSummary.value.trim() || undefined,
    instance_config: instanceConfig
  });
  approvalDialogVisible.value = false;
  message("已提交审批", { type: "success" });
  await loadDetail();
};

const onTriggerAiReview = async () => {
  if (isCreate.value) {
    message("请先保存合同", { type: "warning" });
    return;
  }
  await triggerAiReview(contractId.value);
  message("已触发AI审查", { type: "success" });
  await loadAiReview();
};

const onSubmitAmountChange = async (row: ContractAmountChange) => {
  if (isCreate.value) return;
  await submitAmountChangeApproval(contractId.value, row.id);
  message("金额变更已提交审批", { type: "success" });
  await loadDetail();
};

const goBack = () => {
  router.push("/finance/contract");
};

onMounted(async () => {
  if (isCreate.value && typeof route.query.direction === "string") {
    if (
      route.query.direction === "inbound" ||
      route.query.direction === "outbound"
    ) {
      form.value.direction = route.query.direction;
    }
  }
  await loadBaseData();
  await loadDetail();
});
</script>

<template>
  <el-card shadow="never" :loading="loading" style="background: #fffaf2">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <span>{{
          isCreate ? "新建合同" : `合同详情 - ${detail?.contract_no || ""}`
        }}</span>
        <div>
          <el-button @click="goBack">返回</el-button>
          <el-button type="primary" :loading="saving" @click="onSave"
            >保存</el-button
          >
          <el-button
            type="warning"
            :disabled="isCreate"
            @click="onSubmitApproval"
          >
            提交审批
          </el-button>
          <el-button
            type="success"
            :disabled="isCreate"
            @click="onTriggerAiReview"
          >
            触发AI审查
          </el-button>
        </div>
      </div>
    </template>

    <el-form label-width="110px" style="max-width: 900px">
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
        >
          <el-option
            v-for="item in entities"
            :key="item.id"
            :value="item.id"
            :label="item.entity_name"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="对方单位">
        <el-input v-model="form.counterparty" placeholder="请输入对方单位" />
      </el-form-item>
      <el-form-item label="合同类型">
        <el-select v-model="form.contract_type" clearable style="width: 220px">
          <el-option label="人工" value="人工" />
          <el-option label="机械" value="机械" />
          <el-option label="总包" value="总包" />
          <el-option label="材料" value="材料" />
          <el-option label="其他" value="其他" />
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
            :label="`${item.name} (${item.userid})`"
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
        <el-input-number
          v-model="form.total_amount"
          :min="0"
          :precision="2"
          :step="1000"
        />
      </el-form-item>
      <el-form-item label="附件JSON">
        <el-input
          v-model="form.attachments_json"
          type="textarea"
          :rows="3"
          placeholder='例如 ["contracts/a.pdf"]'
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" type="textarea" :rows="3" />
      </el-form-item>
    </el-form>

    <el-divider v-if="detail">财务摘要</el-divider>
    <el-row v-if="detail" :gutter="12" style="margin-bottom: 8px">
      <el-col :span="6"
        ><el-statistic title="合同总额" :value="detail.total_amount"
      /></el-col>
      <el-col :span="6"
        ><el-statistic title="已付金额" :value="detail.paid_amount"
      /></el-col>
      <el-col :span="6"
        ><el-statistic title="剩余额度" :value="remainingAmount"
      /></el-col>
      <el-col :span="6">
        <div style="margin-top: 8px">
          AI审查状态
          <el-tag
            :type="aiStatusTagType[aiStatus] || 'info'"
            style="margin-left: 8px"
          >
            {{ aiStatus }}
          </el-tag>
        </div>
      </el-col>
    </el-row>

    <el-divider v-if="aiReviewData">AI审查报告</el-divider>
    <el-descriptions v-if="aiReviewData" :column="2" border>
      <el-descriptions-item label="风险等级">
        {{ aiReviewData.overall_risk || "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="风险分数">
        {{ aiReviewData.score ?? "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="总结" :span="2">
        {{ aiReviewData.summary || "-" }}
      </el-descriptions-item>
      <el-descriptions-item label="建议" :span="2">
        {{
          Array.isArray(aiReviewData.recommendations)
            ? aiReviewData.recommendations.join("；")
            : "-"
        }}
      </el-descriptions-item>
    </el-descriptions>

    <el-divider v-if="detail">金额变更记录</el-divider>
    <el-table v-if="detail" :data="detail.amount_changes" size="small">
      <el-table-column prop="created_at" label="创建时间" width="180" />
      <el-table-column prop="change_type" label="类型" width="100" />
      <el-table-column prop="old_amount" label="原金额" width="120" />
      <el-table-column prop="new_amount" label="新金额" width="120" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="reason" label="原因" min-width="220" />
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="scope">
          <el-button
            v-if="scope.row.status === 'pending'"
            link
            type="primary"
            @click="onSubmitAmountChange(scope.row)"
          >
            提交审批
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="approvalDialogVisible"
      title="实例级二次设置"
      width="560px"
    >
      <el-form label-width="120px">
        <el-form-item label="审批摘要">
          <el-input
            v-model="approvalSummary"
            placeholder="可选，留空则使用系统默认摘要"
          />
        </el-form-item>
        <el-form-item label="实例配置(JSON)">
          <el-input
            v-model="approvalConfigText"
            type="textarea"
            :rows="7"
            placeholder='例如 {"default_assignee_userids":["zhangsan"]}'
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="approvalDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSubmitApproval"
          >确认提交</el-button
        >
      </template>
    </el-dialog>

    <el-divider v-if="detail">关联付款申请</el-divider>
    <el-table v-if="detail" :data="detail.payment_requests" size="small">
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="serial_no" label="流水号" width="160" />
      <el-table-column prop="amount" label="金额" width="120" />
      <el-table-column prop="status" label="状态" width="120" />
      <el-table-column prop="created_at" label="创建时间" width="180" />
    </el-table>
  </el-card>
</template>
