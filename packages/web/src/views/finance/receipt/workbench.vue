<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { message } from "@/utils/message";
import { listProjects, type Project } from "@/api/project";
import ProjectReceiptDrawer from "./components/ProjectReceiptDrawer.vue";
import InboundContractList from "./contract.vue";
import ReceiptDashboard from "./dashboard.vue";
import InvoiceList from "./invoice.vue";
import ReceiptList from "./list.vue";

defineOptions({ name: "ReceiptWorkbench" });

type ReceiptWorkflowStep = "contract" | "invoice" | "receipt" | "snapshot";

const route = useRoute();
const router = useRouter();
const activeStep = ref<ReceiptWorkflowStep>("contract");

const workflowSteps: Array<{
  name: ReceiptWorkflowStep;
  title: string;
  subtitle: string;
}> = [
  {
    name: "contract",
    title: "1. 收款合同",
    subtitle: "建档、审批、查合同"
  },
  {
    name: "invoice",
    title: "2. 开票处理",
    subtitle: "申请、审批、签发"
  },
  {
    name: "receipt",
    title: "3. 收款登记",
    subtitle: "到账、凭证、退款"
  },
  {
    name: "snapshot",
    title: "4. 收款看板",
    subtitle: "统计、追踪、对账"
  }
];

const titleMap: Record<ReceiptWorkflowStep, string> = {
  contract: "收款合同处理",
  invoice: "开票申请与发票签发",
  receipt: "到账收款登记",
  snapshot: "收款统计与对账"
};

const hintMap: Record<ReceiptWorkflowStep, string> = {
  contract:
    "办公室先在这里建立或核对收款合同，确认项目、客户、金额和审批状态。",
  invoice:
    "合同确认后在这里发起开票申请、提交审批，并在审批通过后签发正式发票。",
  receipt: "客户到账后在这里登记收款金额、收款账户和凭证，也可以处理退款。",
  snapshot: "查看收款合同、开票、到账和退款的整体数据，作为对账入口。"
};

const currentTitle = computed(() => titleMap[activeStep.value]);
const currentHint = computed(() => hintMap[activeStep.value]);

const projectOptions = ref<Project[]>([]);
const activeProjectId = ref<number | null>(null);
const drawerVisible = ref(false);

const loadProjectOptions = async () => {
  try {
    const res = await listProjects({ page: 1, pageSize: 500 });
    projectOptions.value = res.data;
  } catch {
    message("项目列表加载失败，收款全貌入口暂不可用", { type: "warning" });
  }
};

const openProjectDrawer = () => {
  if (!activeProjectId.value) return;
  drawerVisible.value = true;
};

const stepFromQuery = (): ReceiptWorkflowStep | null => {
  const step = String(route.query.step || "");
  if (["contract", "invoice", "receipt", "snapshot"].includes(step)) {
    return step as ReceiptWorkflowStep;
  }
  return null;
};

const switchStep = (step: ReceiptWorkflowStep) => {
  activeStep.value = step;
  router.replace({
    path: route.path,
    query: { ...route.query, step }
  });
};

onMounted(() => {
  activeStep.value = stepFromQuery() || "contract";
  void loadProjectOptions();
});

watch(
  () => route.query.step,
  () => {
    const target = stepFromQuery();
    if (!target || target === activeStep.value) return;
    activeStep.value = target;
  }
);
</script>

<template>
  <div class="receipt-workbench-page">
    <div class="page-header">
      <div>
        <div class="page-title">{{ currentTitle }}</div>
        <div class="page-subtitle">{{ currentHint }}</div>
      </div>
      <div class="page-header-actions">
        <el-select
          v-model="activeProjectId"
          filterable
          clearable
          placeholder="按项目查看收款全貌"
          style="width: 240px"
        >
          <el-option
            v-for="item in projectOptions"
            :key="item.id"
            :value="item.id"
            :label="item.project_name"
          />
        </el-select>
        <el-button
          type="primary"
          plain
          :disabled="!activeProjectId"
          @click="openProjectDrawer"
        >
          收款全貌
        </el-button>
      </div>
    </div>

    <nav class="workflow-steps">
      <button
        v-for="item in workflowSteps"
        :key="item.name"
        class="workflow-step"
        :class="{ 'workflow-step--active': activeStep === item.name }"
        type="button"
        @click="switchStep(item.name)"
      >
        <span>{{ item.title }}</span>
        <small>{{ item.subtitle }}</small>
      </button>
    </nav>

    <section class="embedded-workflow">
      <InboundContractList v-if="activeStep === 'contract'" />
      <InvoiceList v-else-if="activeStep === 'invoice'" />
      <ReceiptList v-else-if="activeStep === 'receipt'" />
      <ReceiptDashboard v-else />
    </section>

    <ProjectReceiptDrawer
      v-model:visible="drawerVisible"
      :project-id="activeProjectId"
    />
  </div>
</template>

<style scoped>
.receipt-workbench-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  padding: 16px;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  align-items: center;
  justify-content: space-between;
}

.page-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.page-subtitle {
  margin-top: 4px;
  color: #6b7280;
}

.page-header-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.workflow-steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.workflow-step {
  display: flex;
  min-height: 72px;
  padding: 12px 14px;
  text-align: left;
  cursor: pointer;
  background: #ffffff;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  flex-direction: column;
  justify-content: center;
}

.workflow-step span {
  font-weight: 600;
  color: #1f2937;
}

.workflow-step small {
  margin-top: 6px;
  color: #6b7280;
}

.workflow-step--active {
  background: #ecf5ff;
  border-color: #409eff;
}

@media (max-width: 960px) {
  .page-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .page-header-actions {
    margin-top: 12px;
    align-items: stretch;
    flex-direction: column;
  }

  .workflow-steps {
    grid-template-columns: 1fr;
  }
}
</style>
