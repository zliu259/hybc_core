<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import {
  createReimbursementBatch,
  listReimbursementBatchProposals,
  submitBatchApproval,
  triggerBatchAudit,
  type ReimbursementBatchProposal
} from "@/api/reimbursement";
import { listPayees, type Payee } from "@/api/payment";
import { invoiceTitleDisplay } from "../reimbursement-title";

defineOptions({ name: "AiBatchProposalsDrawer" });

const props = defineProps<{
  visible: boolean;
  projectNameMap: Record<number, string>;
  userNameMap: Map<string, string>;
}>();

const emit = defineEmits<{
  (event: "update:visible", value: boolean): void;
  (event: "done"): void;
  (event: "open-batch", id: number): void;
}>();

type ProposalRow = ReimbursementBatchProposal & {
  key: string;
  selected: boolean;
  payment_method: string;
  payee_id: number | undefined;
  payeeOptions: Payee[];
  result?: {
    ok: boolean;
    batch_no?: string;
    batch_id?: number;
    error?: string;
  };
};

const loading = ref(false);
const confirming = ref(false);
const rows = ref<ProposalRow[]>([]);
const finished = ref(false);

const selectedRows = computed(() => rows.value.filter(row => row.selected));
const selectedTotal = computed(() =>
  selectedRows.value.reduce((sum, row) => sum + row.total_amount, 0)
);

const toProjectLabel = (id: number) => props.projectNameMap[id] || `项目#${id}`;
const toUserLabel = (userid: string) => props.userNameMap.get(userid) ?? userid;

const titleTagOf = (row: ProposalRow) => {
  const display = invoiceTitleDisplay(row);
  if (display.tag === "matched")
    return { text: display.text, type: "primary" as const };
  if (display.tag === "unmatched")
    return { text: `未匹配主体：${display.text}`, type: "warning" as const };
  return { text: "未识别抬头", type: "warning" as const };
};

const riskSummary = (row: ProposalRow) => {
  const high = row.envelopes.filter(
    e => e.duplicate_risk_level === "high"
  ).length;
  const medium = row.envelopes.filter(
    e => e.duplicate_risk_level === "medium"
  ).length;
  if (high > 0)
    return { label: `高风险重复 x${high}`, type: "danger" as const };
  if (medium > 0)
    return { label: `中风险重复 x${medium}`, type: "warning" as const };
  return null;
};

const load = async () => {
  loading.value = true;
  finished.value = false;
  try {
    const res = await listReimbursementBatchProposals();
    const applicants = [
      ...new Set(res.data.map(item => item.applicant_userid))
    ];
    const payeesByUser = new Map<string, Payee[]>();
    await Promise.all(
      applicants.map(async userid => {
        try {
          const payeeRes = await listPayees({
            type: "internal",
            linked_userid: userid
          });
          payeesByUser.set(userid, payeeRes.data);
        } catch {
          payeesByUser.set(userid, []);
        }
      })
    );
    rows.value = res.data.map(item => ({
      ...item,
      key: `${item.applicant_userid}-${item.project_id}-${item.invoice_title_entity_id ?? "none"}`,
      selected: true,
      payment_method: item.suggested_payment_method || "personal_transfer",
      payee_id: item.matched_payee?.id,
      payeeOptions: payeesByUser.get(item.applicant_userid) ?? []
    }));
  } catch {
    message("加载建议批次失败，请稍后重试", { type: "error" });
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.visible,
  value => {
    if (value) load();
  }
);

const close = () => emit("update:visible", false);

const confirmAll = async () => {
  const targets = selectedRows.value;
  if (targets.length === 0) {
    message("请至少保留一个建议批次", { type: "warning" });
    return;
  }
  const missingPayee = targets.filter(
    row => row.payee_required && !row.payee_id
  );
  if (missingPayee.length > 0) {
    message(
      `有 ${missingPayee.length} 个批次缺少收款人（系统要求必填），请先补充`,
      { type: "warning" }
    );
    return;
  }
  try {
    await ElMessageBox.confirm(
      `即将创建并送审 ${targets.length} 个批次，合计 ¥${selectedTotal.value.toFixed(2)}。每个批次创建后将自动触发 AI 审计摘要供审批人查看。`,
      "二次确认：一键创建并送审",
      {
        type: "warning",
        confirmButtonText: "确认执行",
        cancelButtonText: "取消"
      }
    );
  } catch {
    return;
  }

  confirming.value = true;
  try {
    for (const row of targets) {
      try {
        const created = await createReimbursementBatch(
          {
            project_id: row.project_id,
            applicant_userid: row.applicant_userid,
            envelope_ids: row.envelopes.map(item => item.id),
            payment_method: row.payment_method,
            payee_id: row.payee_id
          },
          { idempotencyKey: `ai-batch-create-${crypto.randomUUID()}` }
        );
        await submitBatchApproval(
          created.data.id,
          { payment_method: row.payment_method, payee_id: row.payee_id },
          { idempotencyKey: `ai-batch-submit-${crypto.randomUUID()}` }
        );
        try {
          await triggerBatchAudit(created.data.id);
        } catch {
          // AI 审计触发失败不阻断：批次详情内可手动触发
        }
        row.result = {
          ok: true,
          batch_no: created.data.batch_no,
          batch_id: created.data.id
        };
      } catch (error) {
        const err = error as {
          response?: { data?: { error?: { message?: string } } };
        };
        row.result = {
          ok: false,
          error: err.response?.data?.error?.message || "创建或送审失败"
        };
      }
    }
    finished.value = true;
    const failed = targets.filter(row => row.result && !row.result.ok).length;
    message(
      failed === 0
        ? `全部 ${targets.length} 个批次已创建并送审`
        : `完成：成功 ${targets.length - failed} 个，失败 ${failed} 个（详见列表）`,
      { type: failed === 0 ? "success" : "warning" }
    );
    emit("done");
  } finally {
    confirming.value = false;
  }
};
</script>

<template>
  <el-drawer
    :model-value="props.visible"
    title="AI 一键成批（同人同项目同抬头）"
    size="60%"
    append-to-body
    @update:model-value="value => emit('update:visible', value)"
  >
    <el-alert
      type="info"
      :closable="false"
      class="mb-3"
      title="系统已按「同人 + 同项目 + 同发票抬头 + 复核通过 + 未入批」自动分组。确认后逐组创建批次并送审，AI 审计摘要将自动附加到批次供审批人查看。"
    />

    <div v-loading="loading">
      <el-empty
        v-if="!loading && rows.length === 0"
        description="当前没有可成批的报销"
      />

      <div v-for="row in rows" :key="row.key" class="proposal-card">
        <div class="proposal-card__head">
          <el-checkbox
            v-model="row.selected"
            :disabled="confirming || finished"
          >
            <strong>{{ toUserLabel(row.applicant_userid) }}</strong>
            · {{ toProjectLabel(row.project_id) }}
          </el-checkbox>
          <div class="proposal-card__meta">
            <el-tag
              v-if="riskSummary(row)"
              :type="riskSummary(row)!.type"
              size="small"
            >
              {{ riskSummary(row)!.label }}
            </el-tag>
            <el-tag size="small" :type="titleTagOf(row).type" effect="plain">
              {{ titleTagOf(row).text }}
            </el-tag>
            <span>{{ row.item_count }} 条</span>
            <strong>¥{{ row.total_amount.toFixed(2) }}</strong>
          </div>
        </div>

        <div class="proposal-card__body">
          <el-select
            v-model="row.payment_method"
            size="small"
            style="width: 140px"
            :disabled="confirming || finished"
          >
            <el-option label="转账" value="personal_transfer" />
            <el-option label="对公转账" value="transfer" />
            <el-option label="现金" value="cash" />
            <el-option label="票据" value="bill" />
            <el-option label="其他" value="other" />
          </el-select>
          <el-select
            v-model="row.payee_id"
            size="small"
            clearable
            filterable
            :placeholder="
              row.payee_required ? '收款人（必填）' : '收款人（可选）'
            "
            style="width: 280px"
            :disabled="confirming || finished"
          >
            <el-option
              v-for="p in row.payeeOptions"
              :key="p.id"
              :label="`${p.name} | ${p.bank_name} | ${p.bank_account}`"
              :value="p.id"
            />
          </el-select>
          <el-tag
            v-if="row.matched_payee && row.payee_id === row.matched_payee.id"
            type="success"
            size="small"
          >
            已自动匹配收款人
          </el-tag>
        </div>

        <el-table :data="row.envelopes" size="small" max-height="180">
          <el-table-column prop="envelope_no" label="信封编号" width="180" />
          <el-table-column prop="amount" label="金额" width="100" />
          <el-table-column
            prop="description"
            label="报销内容"
            min-width="160"
            show-overflow-tooltip
          />
          <el-table-column label="风险" width="110">
            <template #default="scope">
              <el-tag
                v-if="scope.row.duplicate_risk_level"
                :type="
                  scope.row.duplicate_risk_level === 'high'
                    ? 'danger'
                    : scope.row.duplicate_risk_level === 'medium'
                      ? 'warning'
                      : 'success'
                "
                size="small"
              >
                {{
                  scope.row.duplicate_risk_level === "high"
                    ? "高风险"
                    : scope.row.duplicate_risk_level === "medium"
                      ? "中风险"
                      : "低风险"
                }}
              </el-tag>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>

        <el-alert
          v-if="row.result"
          :type="row.result.ok ? 'success' : 'error'"
          :closable="false"
          class="proposal-card__result"
        >
          <template #title>
            <template v-if="row.result.ok">
              已创建并送审：{{ row.result.batch_no }}
              <el-link
                type="primary"
                style="margin-left: 8px"
                @click="emit('open-batch', row.result!.batch_id!)"
                >查看批次</el-link
              >
            </template>
            <template v-else>失败：{{ row.result.error }}</template>
          </template>
        </el-alert>
      </div>
    </div>

    <template #footer>
      <div class="drawer-footer">
        <span v-if="rows.length > 0">
          已选 {{ selectedRows.length }} / {{ rows.length }} 组，合计 ¥{{
            selectedTotal.toFixed(2)
          }}
        </span>
        <el-space>
          <el-button @click="close">{{ finished ? "关闭" : "取消" }}</el-button>
          <el-button
            v-if="!finished"
            type="primary"
            :loading="confirming"
            :disabled="rows.length === 0"
            @click="confirmAll"
          >
            确认全部创建并送审
          </el-button>
        </el-space>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.mb-3 {
  margin-bottom: 12px;
}
.proposal-card {
  padding: 12px;
  margin-bottom: 12px;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}
.proposal-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
.proposal-card__meta {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #374151;
}
.proposal-card__body {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.proposal-card__result {
  margin-top: 8px;
}
.drawer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
