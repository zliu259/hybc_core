<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import {
  createFleetFuelRulePolicy,
  listFleetAuditLogs,
  listFleetFuelRulePolicies,
  listFleetWecomNotifications,
  retryFleetWecomNotification,
  toggleFleetFuelRulePolicy,
  type FleetAuditLog,
  type FleetFuelRulePolicy,
  type FleetWecomNotification
} from "@/api/fleet";
import { fleetNotificationStatusLabel } from "@/utils/enum-labels";

defineOptions({ name: "FleetRulesAuditCenter" });

const loading = ref(false);
const policies = ref<FleetFuelRulePolicy[]>([]);
const notifications = ref<FleetWecomNotification[]>([]);
const auditLogs = ref<FleetAuditLog[]>([]);
const policyForm = ref({
  policy_name: "",
  policy_type: "amount_limit" as FleetFuelRulePolicy["policy_type"],
  severity: "warning" as FleetFuelRulePolicy["severity"],
  config_json: '{"max_amount":1000}'
});

const loadData = async () => {
  loading.value = true;
  try {
    const [policyResult, notificationResult, auditResult] = await Promise.all([
      listFleetFuelRulePolicies(),
      listFleetWecomNotifications(),
      listFleetAuditLogs()
    ]);
    policies.value = policyResult.data;
    notifications.value = notificationResult.data;
    auditLogs.value = auditResult.data;
  } finally {
    loading.value = false;
  }
};

const createPolicy = async () => {
  JSON.parse(policyForm.value.config_json);
  await createFleetFuelRulePolicy({
    policy_name: policyForm.value.policy_name,
    policy_type: policyForm.value.policy_type,
    severity: policyForm.value.severity,
    config_json: policyForm.value.config_json,
    enabled: 1
  });
  policyForm.value.policy_name = "";
  await loadData();
  ElMessage.success("规则已创建");
};

const togglePolicy = async (row: FleetFuelRulePolicy) => {
  await toggleFleetFuelRulePolicy(row.id, {
    enabled: row.enabled === 1 ? 0 : 1
  });
  await loadData();
};

const retryNotification = async (row: FleetWecomNotification) => {
  await retryFleetWecomNotification(row.id);
  await loadData();
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" :loading="loading">
    <template #header>
      <div
        style="
          display: flex;
          justify-content: space-between;
          align-items: center;
        "
      >
        <div>
          <div style="font-size: 18px; font-weight: 700">规则与审计中心</div>
          <div style="font-size: 13px; color: #6b7280">
            油卡规则、企微通知、操作审计
          </div>
        </div>
        <el-button type="primary" @click="loadData">刷新</el-button>
      </div>
    </template>

    <el-tabs>
      <el-tab-pane label="规则配置">
        <el-form inline>
          <el-form-item label="规则名称">
            <el-input v-model="policyForm.policy_name" style="width: 220px" />
          </el-form-item>
          <el-form-item label="类型">
            <el-select v-model="policyForm.policy_type" style="width: 180px">
              <el-option label="单次额度" value="amount_limit" />
              <el-option label="月度频次" value="monthly_frequency" />
              <el-option label="里程差" value="mileage_delta" />
              <el-option label="油卡余额" value="card_balance" />
              <el-option label="照片必填" value="photo_required" />
            </el-select>
          </el-form-item>
          <el-form-item label="风险">
            <el-select v-model="policyForm.severity" style="width: 140px">
              <el-option label="提示" value="info" />
              <el-option label="需关注" value="warning" />
              <el-option label="高风险" value="high" />
            </el-select>
          </el-form-item>
          <el-form-item label="配置 JSON">
            <el-input v-model="policyForm.config_json" style="width: 260px" />
          </el-form-item>
          <el-button type="primary" @click="createPolicy">新增规则</el-button>
        </el-form>

        <el-table :data="policies" stripe>
          <el-table-column
            prop="policy_name"
            label="规则名称"
            min-width="220"
          />
          <el-table-column prop="policy_type" label="类型" width="160" />
          <el-table-column prop="severity" label="风险" width="120" />
          <el-table-column prop="config_json" label="配置" min-width="260" />
          <el-table-column label="状态" width="100">
            <template #default="scope">
              {{ scope.row.enabled === 1 ? "启用" : "停用" }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="togglePolicy(scope.row)">
                {{ scope.row.enabled === 1 ? "停用" : "启用" }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="企微通知">
        <el-table :data="notifications" stripe>
          <el-table-column prop="notification_type" label="类型" width="130" />
          <el-table-column
            prop="message_summary"
            label="摘要"
            min-width="320"
          />
          <el-table-column label="状态" width="120">
            <template #default="scope">
              {{ fleetNotificationStatusLabel(scope.row.status) }}
            </template>
          </el-table-column>
          <el-table-column
            prop="error_message"
            label="失败原因"
            min-width="220"
          />
          <el-table-column prop="retry_count" label="重试" width="80" />
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="scope">
              <el-button
                v-if="scope.row.status === 'failed'"
                link
                type="primary"
                @click="retryNotification(scope.row)"
              >
                重试
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="操作审计">
        <el-table :data="auditLogs" stripe>
          <el-table-column prop="created_at" label="时间" width="180" />
          <el-table-column prop="actor_userid" label="操作人" width="160" />
          <el-table-column prop="action" label="动作" width="220" />
          <el-table-column prop="target_type" label="对象" width="180" />
          <el-table-column prop="target_id" label="对象ID" width="120" />
          <el-table-column prop="detail_json" label="详情" min-width="320" />
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </el-card>
</template>
