<script setup lang="ts">
/**
 * 合同管理总览：合同台账和原「合同执行监控」合在一页。
 * 汇总和按档筛选都在服务端算，不受分页限制；项目和关键字同时影响汇总与列表，
 * 状态和进度档位是列表的两种看法，二选一。
 */
import { useDebounceFn } from "@vueuse/core";
import { ElMessageBox } from "element-plus";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  deleteContract,
  getContractOverview,
  listContracts,
  type Contract,
  type ContractOverview,
  type ExecutionBand
} from "@/api/contract";
import { listProjects, type Project } from "@/api/project";
import { useUserStoreHook } from "@/store/modules/user";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { contractTypeLabel } from "@/utils/enum-labels";
import { message } from "@/utils/message";
import AmountChangeDrawer from "./components/AmountChangeDrawer.vue";
import ContractDetailDrawer from "./components/ContractDetailDrawer.vue";
import ContractGauge from "./components/ContractGauge.vue";
import ContractOverviewHead from "./components/ContractOverviewHead.vue";
import {
  CONTRACT_STATUS_LABELS,
  CONTRACT_STATUS_TAGS,
  resolveContractCapabilities
} from "./contract-detail-view";
import { visibleStatusTabs } from "./contract-overview-view";

defineOptions({ name: "ContractList" });

type TagType = "primary" | "success" | "warning" | "danger" | "info";

const DIRECTION_OPTIONS = [
  { label: "付款合同", value: "outbound" },
  { label: "收款合同", value: "inbound" }
];

const AI_REVIEW_TAGS: Record<string, TagType> = {
  none: "info",
  pending: "warning",
  completed: "success",
  failed: "danger"
};

const AI_REVIEW_LABELS: Record<string, string> = {
  none: "未触发",
  pending: "审查中",
  completed: "已完成",
  failed: "失败"
};

const PAGE_SIZE = 20;

const router = useRouter();
const userStore = useUserStoreHook();
const roles = computed<readonly string[]>(() => userStore.roles ?? []);

const direction = ref<Contract["direction"]>("outbound");
const projectId = ref<number | undefined>(undefined);
const keyword = ref("");
const status = ref("");
const band = ref<ExecutionBand | "">("");
const page = ref(1);

const overview = ref<ContractOverview | null>(null);
const overviewError = ref("");
const list = ref<Contract[]>([]);
const total = ref(0);
const loading = ref(false);
const listError = ref("");

const projects = ref<Project[]>([]);
const projectsLoading = ref(false);

const detailVisible = ref(false);
const activeContractId = ref<number | null>(null);
const amountDrawerVisible = ref(false);
const amountDrawerContract = ref<Contract | null>(null);

const scoped = computed(
  () => projectId.value !== undefined || keyword.value.trim() !== ""
);
const hasListFilter = computed(
  () => scoped.value || status.value !== "" || band.value !== ""
);
const statusTabs = computed(() =>
  visibleStatusTabs(overview.value?.status_counts ?? {}, status.value)
);
const progressColumnLabel = computed(() =>
  direction.value === "inbound" ? "回款进度" : "付款进度"
);

const canChangeAmount = (row: Contract): boolean =>
  resolveContractCapabilities({
    detail: row,
    approvalDetail: null,
    roles: roles.value,
    superEditMode: false
  }).canRequestAmountChange;

const scopeParams = () => ({
  direction: direction.value,
  project_id: projectId.value,
  keyword: keyword.value.trim() || undefined
});

// 切筛选很快时，先发出去的请求可能后回来，只认最新一次
let overviewRequest = 0;
let listRequest = 0;

const loadOverview = async () => {
  const request = ++overviewRequest;
  overviewError.value = "";
  try {
    const result = await getContractOverview(scopeParams());
    if (request === overviewRequest) overview.value = result.data;
  } catch (error) {
    if (request !== overviewRequest) return;
    overview.value = null;
    overviewError.value = resolveApiErrorMessage(error, "合同汇总加载失败");
  }
};

const loadList = async () => {
  const request = ++listRequest;
  loading.value = true;
  listError.value = "";
  try {
    const result = await listContracts({
      ...scopeParams(),
      status: status.value || undefined,
      band: band.value || undefined,
      page: page.value,
      pageSize: PAGE_SIZE
    });
    if (request !== listRequest) return;
    const { total: nextTotal } = result.pagination;
    // 删掉最后一页唯一一条后，当前页已不存在，退回新的最后一页
    if (result.data.length === 0 && nextTotal > 0 && page.value > 1) {
      page.value = Math.ceil(nextTotal / PAGE_SIZE);
      await loadList();
      return;
    }
    list.value = result.data;
    total.value = nextTotal;
  } catch (error) {
    if (request !== listRequest) return;
    list.value = [];
    total.value = 0;
    listError.value = resolveApiErrorMessage(error, "合同列表加载失败");
  } finally {
    if (request === listRequest) loading.value = false;
  }
};

const refreshAll = () => Promise.all([loadOverview(), loadList()]);

const onScopeChange = () => {
  page.value = 1;
  return refreshAll();
};

const onKeywordInput = useDebounceFn(onScopeChange, 300);

const onDirectionChange = (value: string | number | boolean) => {
  direction.value = value === "inbound" ? "inbound" : "outbound";
  status.value = "";
  band.value = "";
  // 换方向时上一个方向的数字不能留在屏幕上
  overview.value = null;
  return onScopeChange();
};

const selectStatus = (value: string) => {
  status.value = value;
  band.value = "";
  page.value = 1;
  return loadList();
};

const selectBand = (value: ExecutionBand) => {
  band.value = band.value === value ? "" : value;
  status.value = "";
  page.value = 1;
  return loadList();
};

const clearFilters = () => {
  projectId.value = undefined;
  keyword.value = "";
  status.value = "";
  band.value = "";
  return onScopeChange();
};

const onPageChange = (value: number) => {
  page.value = value;
  return loadList();
};

const searchProjects = async (query: string) => {
  projectsLoading.value = true;
  try {
    const result = await listProjects({
      page: 1,
      pageSize: 50,
      keyword: query.trim() || undefined
    });
    // 已选项目不在搜索结果里时要留着，否则选择框只显示编号
    const selected = projects.value.find(item => item.id === projectId.value);
    projects.value =
      selected && !result.data.some(item => item.id === selected.id)
        ? [selected, ...result.data]
        : result.data;
  } catch (error) {
    message(resolveApiErrorMessage(error, "项目列表加载失败"), {
      type: "error"
    });
  } finally {
    projectsLoading.value = false;
  }
};

const goCreate = () => {
  router.push(
    direction.value === "inbound"
      ? "/finance/contract/detail/create?direction=inbound"
      : "/finance/contract/detail/create"
  );
};

const goDraft = () => {
  router.push("/finance/contract/draft");
};

const openDetail = (row: Contract) => {
  activeContractId.value = row.id;
  detailVisible.value = true;
};

const openAmountChange = (row: Contract) => {
  amountDrawerContract.value = row;
  amountDrawerVisible.value = true;
};

const confirmDelete = async (row: Contract): Promise<boolean> => {
  try {
    await ElMessageBox.confirm(`确认删除合同 ${row.contract_no} 吗？`, "提示", {
      type: "warning"
    });
    return true;
  } catch {
    return false;
  }
};

const onDelete = async (row: Contract) => {
  if (!(await confirmDelete(row))) return;
  try {
    await deleteContract(row.id);
    message("已删除合同", { type: "success" });
    await refreshAll();
  } catch (error) {
    message(resolveApiErrorMessage(error, "删除合同失败"), { type: "error" });
  }
};

onMounted(() => {
  searchProjects("");
  refreshAll();
});
</script>

<template>
  <div class="contract-overview">
    <section class="contract-overview__head">
      <header class="contract-overview__top">
        <div class="contract-overview__title">
          <h1>合同管理总览</h1>
          <el-segmented
            class="contract-overview__direction"
            :model-value="direction"
            :options="DIRECTION_OPTIONS"
            @change="onDirectionChange"
          />
        </div>
        <div class="contract-overview__actions">
          <el-button @click="goDraft">合同生成</el-button>
          <el-button type="primary" @click="goCreate">新建合同</el-button>
        </div>
      </header>

      <ContractOverviewHead
        :overview="overview"
        :band="band"
        :scoped="scoped"
        :error="overviewError"
        @select-band="selectBand"
        @retry="loadOverview"
      />
    </section>

    <section class="contract-overview__list">
      <div class="contract-overview__toolbar">
        <div
          class="contract-overview__tabs"
          role="group"
          aria-label="按合同状态筛选"
        >
          <button
            type="button"
            class="contract-overview__tab"
            :class="{
              'contract-overview__tab--active': status === '' && band === ''
            }"
            :aria-pressed="status === '' && band === ''"
            @click="selectStatus('')"
          >
            全部 <span>{{ overview?.total_count ?? "" }}</span>
          </button>
          <button
            v-for="item in statusTabs"
            :key="item.value"
            type="button"
            class="contract-overview__tab"
            :class="{
              'contract-overview__tab--active': status === item.value
            }"
            :aria-pressed="status === item.value"
            @click="selectStatus(item.value)"
          >
            {{ item.label }} <span>{{ item.count }}</span>
          </button>
        </div>
        <div class="contract-overview__filters">
          <el-select
            v-model="projectId"
            class="contract-overview__project"
            aria-label="所属项目"
            placeholder="所属项目"
            clearable
            filterable
            remote
            :remote-method="searchProjects"
            :loading="projectsLoading"
            @change="onScopeChange"
          >
            <el-option
              v-for="item in projects"
              :key="item.id"
              :label="item.project_name"
              :value="item.id"
            />
          </el-select>
          <el-input
            v-model="keyword"
            class="contract-overview__keyword"
            aria-label="搜索合同"
            placeholder="合同号、对方单位、备注"
            clearable
            @input="onKeywordInput"
            @keyup.enter="onScopeChange"
          />
        </div>
      </div>

      <el-table
        v-loading="loading"
        class="contract-overview__table"
        :data="list"
        row-key="id"
        @row-click="openDetail"
      >
        <el-table-column label="对方单位 / 合同号" min-width="200">
          <template #default="{ row }">
            <div class="contract-overview__party">{{ row.counterparty }}</div>
            <div class="contract-overview__no">
              {{ row.contract_no }}
              <el-tag v-if="row.legacy_data_id" size="small" type="info">
                历史数据
              </el-tag>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="所属项目" min-width="150">
          <template #default="{ row }">
            {{ row.project_name || `项目#${row.project_id}` }}
          </template>
        </el-table-column>
        <el-table-column label="类型" width="70">
          <template #default="{ row }">
            {{ contractTypeLabel(row.contract_type) }}
          </template>
        </el-table-column>
        <el-table-column :label="progressColumnLabel" min-width="340">
          <template #default="{ row }">
            <ContractGauge :row="row" />
          </template>
        </el-table-column>
        <el-table-column label="状态" width="84">
          <template #default="{ row }">
            <el-tag :type="CONTRACT_STATUS_TAGS[row.status] ?? 'info'">
              {{ CONTRACT_STATUS_LABELS[row.status] ?? row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="AI 审查" width="84">
          <template #default="{ row }">
            <el-tag :type="AI_REVIEW_TAGS[row.ai_review_status] ?? 'info'">
              {{ AI_REVIEW_LABELS[row.ai_review_status] ?? "未知" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click.stop="openDetail(row)">
              详情
            </el-button>
            <el-button
              v-if="canChangeAmount(row)"
              link
              type="primary"
              @click.stop="openAmountChange(row)"
            >
              变更金额
            </el-button>
            <el-button link type="danger" @click.stop="onDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <div class="contract-overview__empty">
            <template v-if="listError">
              <p>{{ listError }}</p>
              <el-button link type="primary" @click="loadList">重试</el-button>
            </template>
            <template v-else-if="loading">
              <p>正在加载合同</p>
            </template>
            <template v-else-if="hasListFilter">
              <p>没有符合筛选条件的合同</p>
              <el-button link type="primary" @click="clearFilters">
                清除筛选
              </el-button>
            </template>
            <template v-else>
              <p>还没有合同</p>
              <el-button link type="primary" @click="goCreate">
                新建合同
              </el-button>
            </template>
          </div>
        </template>
      </el-table>

      <el-pagination
        v-if="total > PAGE_SIZE"
        class="contract-overview__pagination"
        background
        layout="prev, pager, next, total"
        :current-page="page"
        :page-size="PAGE_SIZE"
        :total="total"
        @current-change="onPageChange"
      />
    </section>

    <ContractDetailDrawer
      v-model:visible="detailVisible"
      :contract-id="activeContractId"
      @closed="refreshAll"
    />
    <AmountChangeDrawer
      v-model:visible="amountDrawerVisible"
      :contract="amountDrawerContract"
      note="合同金额变更发起自合同管理总览"
      @changed="refreshAll"
    />
  </div>
</template>

<style scoped>
.contract-overview {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.contract-overview__head {
  padding: 18px 22px 14px;
  background: #fffaf2;
  border: 1px solid #e3d5b8;
  border-radius: 10px;
}

.contract-overview__top {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.contract-overview__title {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  align-items: center;
}

.contract-overview__title h1 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 24px;
  color: #6b4f2a;
}

.contract-overview__direction {
  --el-segmented-bg-color: #f3e9d4;
  --el-segmented-color: #6b4f2a;
  --el-segmented-item-selected-bg-color: #6b4f2a;
  --el-segmented-item-selected-color: #fff;
  --el-segmented-item-hover-bg-color: #eadcbc;
  --el-segmented-item-hover-color: #3f3527;
}

.contract-overview__list {
  padding: 6px 16px 14px;
  background: #fff;
  border: 1px solid #efe6d3;
  border-radius: 10px;
}

.contract-overview__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
}

.contract-overview__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 4px;
}

.contract-overview__tab {
  padding: 6px 10px;
  font-size: 14px;
  line-height: 20px;
  color: #6e6458;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 4px;
}

.contract-overview__tab span {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #8c8171;
}

.contract-overview__tab:hover {
  color: #3f3527;
  background: #f9f1e0;
}

.contract-overview__tab:focus-visible {
  outline: 2px solid #8c6a2f;
  outline-offset: 1px;
}

.contract-overview__tab--active {
  font-weight: 600;
  color: #3f3527;
  box-shadow: inset 0 -2px 0 #8c6a2f;
}

.contract-overview__filters {
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}

.contract-overview__project {
  width: 220px;
}

.contract-overview__keyword {
  width: 230px;
}

.contract-overview__table {
  --el-table-header-bg-color: #f9f1e0;
  --el-table-header-text-color: #6b4f2a;
  --el-table-row-hover-bg-color: #fdf6e6;
  --el-table-border-color: #efe6d3;
}

.contract-overview__table :deep(.el-table__row) {
  cursor: pointer;
}

.contract-overview__party {
  font-weight: 500;
  line-height: 20px;
  color: #3f3527;
}

.contract-overview__no {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  line-height: 20px;
  color: #6e6458;
}

.contract-overview__empty {
  padding: 28px 0;
  line-height: 22px;
  color: #6e6458;
}

.contract-overview__empty p {
  margin: 0;
}

.contract-overview__pagination {
  justify-content: flex-end;
  margin-top: 12px;
}

@media (width <= 720px) {
  .contract-overview__head {
    padding: 14px;
  }

  .contract-overview__list {
    padding: 6px 10px 12px;
  }

  .contract-overview__project,
  .contract-overview__keyword {
    width: 100%;
  }

  .contract-overview__filters {
    flex: 1 1 100%;
  }
}
</style>
