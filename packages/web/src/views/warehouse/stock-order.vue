<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { message } from "@/utils/message";
import {
  listAssetRentalTerms,
  listAssetTypes,
  type AssetRentalTerm,
  type AssetType
} from "@/api/asset";
import { listProjects, type Project } from "@/api/project";
import {
  cancelStockOrder,
  createStockOrder,
  executeStockOrder,
  gateCheckStockOrder,
  listStockOrders,
  listWarehouses,
  reviewStockOrderOverride,
  submitStockOrderApproval,
  type StockOrder,
  type StockOrderItemInput,
  type Warehouse
} from "@/api/warehouse";

defineOptions({ name: "WarehouseStockOrder" });

const loading = ref(false);
const rows = ref<StockOrder[]>([]);
const warehouses = ref<Warehouse[]>([]);
const assetTypes = ref<AssetType[]>([]);
const projects = ref<Project[]>([]);
const rentalTerms = ref<AssetRentalTerm[]>([]);

const filters = ref({ status: "", order_type: "" });
const assetKeyword = ref("");
const quickAddKeyword = ref("");
const quickAddQty = ref(1);
const submitting = ref(false);
const actionId = ref<number | null>(null);
const overrideVisible = ref(false);
const overrideSubmitting = ref(false);
const overrideForm = ref({
  order_id: 0,
  order_no: "",
  override_reason: "",
  override_risk_acknowledged: false
});

const presetTemplates = [
  {
    id: "tbm-standard",
    name: "标准顶管掘进组",
    items: [
      { keyword: "主机", qty: 1 },
      { keyword: "泥浆泵", qty: 2 },
      { keyword: "刀盘", qty: 20 },
      { keyword: "连接件", qty: 50 }
    ]
  },
  {
    id: "safety-pack",
    name: "现场安全巡检包",
    items: [
      { keyword: "安全", qty: 10 },
      { keyword: "警示", qty: 20 },
      { keyword: "照明", qty: 4 }
    ]
  }
] as const;
const selectedTemplateId = ref<(typeof presetTemplates)[number]["id"]>(
  presetTemplates[0].id
);

const form = ref({
  order_type: "outbound" as "inbound" | "outbound" | "transfer",
  project_id: undefined as number | undefined,
  from_warehouse_id: undefined as number | undefined,
  to_warehouse_id: undefined as number | undefined,
  rental_term_id: undefined as number | undefined,
  remark: "",
  items: [] as Array<{
    asset_type_id: number;
    configuration_role?: StockOrderItemInput["configuration_role"];
    requires_modification: number;
    quantity: number;
  }>
});

const configurationRoleOptions: Array<{
  label: string;
  value: NonNullable<StockOrderItemInput["configuration_role"]>;
}> = [
  { label: "整机", value: "whole_machine" },
  { label: "机壳", value: "shell" },
  { label: "机芯", value: "core" },
  { label: "操作台", value: "console" },
  { label: "通用", value: "generic" }
];

const filteredAssetTypes = computed(() => {
  const q = assetKeyword.value.trim().toLowerCase();
  if (!q) return assetTypes.value;
  return assetTypes.value.filter(item => {
    const source = `${item.type_name} ${item.type_code}`.toLowerCase();
    return source.includes(q);
  });
});

const canSubmit = computed(() => {
  return form.value.items.length > 0 && !submitting.value;
});

const totalCartQty = computed(() =>
  form.value.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
);

const activeRentalTerms = computed(() =>
  rentalTerms.value.filter(item => ["active", "overdue"].includes(item.status))
);

const rentalTermMap = computed(() => {
  const map: Record<number, AssetRentalTerm> = {};
  activeRentalTerms.value.forEach(item => {
    map[item.id] = item;
  });
  return map;
});

const orderTypeLabel = (value: StockOrder["order_type"]) => {
  if (value === "inbound") return "入库";
  if (value === "outbound") return "出库";
  return "调拨";
};

const statusTag = (status: string) => {
  if (status === "executed") return "success";
  if (status === "approved") return "primary";
  if (status === "pending_approval") return "warning";
  if (status === "rejected") return "danger";
  if (status === "cancelled") return "info";
  return "info";
};

const overrideTag = (status: StockOrder["override_status"]) => {
  if (status === "approved") return "danger";
  if (status === "requested") return "warning";
  if (status === "rejected") return "info";
  return "info";
};

const loadMeta = async () => {
  const [warehouseRes, typeRes, projectRes] = await Promise.all([
    listWarehouses(),
    listAssetTypes(),
    listProjects({ page: 1, pageSize: 500 })
  ]);
  warehouses.value = warehouseRes.data;
  assetTypes.value = typeRes.data;
  projects.value = projectRes.data;
  const rentalRes = await listAssetRentalTerms({ status: "active" });
  rentalTerms.value = rentalRes.data;
};

const loadData = async () => {
  loading.value = true;
  try {
    const result = await listStockOrders({
      status: filters.value.status || undefined,
      order_type: filters.value.order_type || undefined
    });
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const resetCreator = () => {
  form.value = {
    order_type: "outbound",
    project_id: undefined,
    from_warehouse_id: undefined,
    to_warehouse_id: undefined,
    rental_term_id: undefined,
    remark: "",
    items: []
  };
};

const addAssetToCart = (assetTypeId: number) => {
  if (form.value.items.some(item => item.asset_type_id === assetTypeId)) {
    message("该资产类型已在制单清单中", { type: "info" });
    return;
  }
  form.value.items.push({
    asset_type_id: assetTypeId,
    configuration_role: "generic",
    requires_modification: 0,
    quantity: 1
  });
};

const addAssetToCartWithQty = (assetTypeId: number, qty: number) => {
  const safeQty = Number(qty || 0);
  if (safeQty <= 0) return;
  const hit = form.value.items.find(item => item.asset_type_id === assetTypeId);
  if (hit) {
    hit.quantity = Number(hit.quantity || 0) + safeQty;
    return;
  }
  form.value.items.push({
    asset_type_id: assetTypeId,
    configuration_role: "generic",
    requires_modification: 0,
    quantity: safeQty
  });
};

const matchAssetTypeByKeyword = (keyword: string) => {
  const q = keyword.trim().toLowerCase();
  if (!q) return null;
  const exact = assetTypes.value.find(item => {
    const code = item.type_code.toLowerCase();
    const name = item.type_name.toLowerCase();
    return code === q || name === q;
  });
  if (exact) return exact;
  return assetTypes.value.find(item => {
    const source = `${item.type_name} ${item.type_code}`.toLowerCase();
    return source.includes(q);
  });
};

const quickAddByKeyword = () => {
  if (!quickAddKeyword.value.trim()) {
    message("请输入设备/耗材关键字或扫码结果", { type: "warning" });
    return;
  }
  if (quickAddQty.value <= 0) {
    message("快速加入数量必须大于 0", { type: "warning" });
    return;
  }
  const match = matchAssetTypeByKeyword(quickAddKeyword.value);
  if (!match) {
    message("未匹配到资产类型，请改用左侧检索列表", { type: "warning" });
    return;
  }
  addAssetToCartWithQty(match.id, quickAddQty.value);
  message(`已加入：${match.type_name}`, { type: "success" });
  quickAddKeyword.value = "";
  quickAddQty.value = 1;
};

const applyPresetTemplate = () => {
  const tpl = presetTemplates.find(
    item => item.id === selectedTemplateId.value
  );
  if (!tpl) return;
  let matched = 0;
  tpl.items.forEach(row => {
    const match = matchAssetTypeByKeyword(row.keyword);
    if (match) {
      addAssetToCartWithQty(match.id, row.qty);
      matched += 1;
    }
  });
  if (!matched) {
    message("模板未匹配到任何资产类型，请维护资产类型后重试", {
      type: "warning"
    });
    return;
  }
  message(`模板已套用：${tpl.name}（匹配 ${matched} 项）`, { type: "success" });
};

const removeCartItem = (index: number) => {
  form.value.items.splice(index, 1);
};

const getAssetTypeName = (assetTypeId: number) => {
  const found = assetTypes.value.find(item => item.id === assetTypeId);
  return found ? found.type_name : `资产类型#${assetTypeId}`;
};

const validateOrder = () => {
  if (!form.value.items.length) {
    message("请先从左侧选择资产加入制单清单", { type: "warning" });
    return false;
  }
  if (form.value.order_type === "outbound" && !form.value.from_warehouse_id) {
    message("出库单必须选择来源仓库", { type: "warning" });
    return false;
  }
  if (form.value.order_type === "inbound" && !form.value.to_warehouse_id) {
    message("入库单必须选择目标仓库", { type: "warning" });
    return false;
  }
  if (
    form.value.order_type === "transfer" &&
    (!form.value.from_warehouse_id ||
      !form.value.to_warehouse_id ||
      form.value.from_warehouse_id === form.value.to_warehouse_id)
  ) {
    message("调拨单必须选择不同的来源/目标仓库", { type: "warning" });
    return false;
  }
  if (form.value.items.some(item => item.quantity <= 0)) {
    message("数量必须大于 0", { type: "warning" });
    return false;
  }
  if (form.value.order_type === "outbound" && form.value.rental_term_id) {
    const term = rentalTermMap.value[form.value.rental_term_id];
    if (term?.status === "overdue") {
      message("该租赁周期已逾期，禁止继续出库", { type: "error" });
      return false;
    }
  }
  return true;
};

const submit = async () => {
  if (!validateOrder()) return;

  const items: StockOrderItemInput[] = form.value.items.map(item => ({
    asset_type_id: item.asset_type_id,
    configuration_role: item.configuration_role,
    requires_modification: item.requires_modification,
    quantity: item.quantity
  }));

  submitting.value = true;
  try {
    const result = await createStockOrder({
      order_type: form.value.order_type,
      project_id: form.value.project_id,
      from_warehouse_id: form.value.from_warehouse_id,
      to_warehouse_id: form.value.to_warehouse_id,
      rental_term_id: form.value.rental_term_id,
      remark: form.value.remark || undefined,
      items
    });
    message(`制单成功: ${result.data.order_no}`, { type: "success" });
    resetCreator();
    await loadData();
  } finally {
    submitting.value = false;
  }
};

const submitApproval = async (row: StockOrder) => {
  actionId.value = row.id;
  try {
    await submitStockOrderApproval(row.id, {
      biz_summary: `${row.order_no} ${row.order_type}`
    });
    message("已提交审批", { type: "success" });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

const executeOrder = async (row: StockOrder) => {
  actionId.value = row.id;
  try {
    const gate = await gateCheckStockOrder(row.id);
    if (!gate.data.pass) {
      message(`出库检查未通过：${gate.data.issues.join("；")}`, {
        type: "error"
      });
      return;
    }
    await executeStockOrder(row.id);
    message("执行成功", { type: "success" });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

const checkGate = async (row: StockOrder) => {
  actionId.value = row.id;
  try {
    const gate = await gateCheckStockOrder(row.id);
    if (gate.data.pass) {
      message("出库检查通过", { type: "success" });
      return;
    }
    message(`出库检查未通过：${gate.data.issues.join("；")}`, {
      type: "warning"
    });
  } finally {
    actionId.value = null;
  }
};

const openOverride = (row: StockOrder) => {
  overrideForm.value = {
    order_id: row.id,
    order_no: row.order_no,
    override_reason: row.override_reason || "",
    override_risk_acknowledged: row.override_risk_acknowledged === 1
  };
  overrideVisible.value = true;
};

const submitOverride = async () => {
  if (!overrideForm.value.override_reason.trim()) {
    message("请填写特殊放行原因", { type: "warning" });
    return;
  }
  if (!overrideForm.value.override_risk_acknowledged) {
    message("请确认已知悉并承担本次放行风险", { type: "warning" });
    return;
  }
  overrideSubmitting.value = true;
  try {
    await reviewStockOrderOverride(overrideForm.value.order_id, {
      action: "approve",
      override_reason: overrideForm.value.override_reason.trim(),
      override_risk_acknowledged: 1
    });
    message("特殊放行已审批", { type: "success" });
    overrideVisible.value = false;
    await loadData();
  } finally {
    overrideSubmitting.value = false;
  }
};

const cancelOrder = async (row: StockOrder) => {
  actionId.value = row.id;
  try {
    await cancelStockOrder(row.id);
    message("已取消", { type: "success" });
    await loadData();
  } finally {
    actionId.value = null;
  }
};

onMounted(async () => {
  await loadMeta();
  await loadData();
});
</script>

<template>
  <el-card v-loading="loading" shadow="never" class="order-creator">
    <template #header>
      <div class="order-creator__header">
        <div>
          <div class="title">出入库制单工作台</div>
          <div class="sub">左侧检索资源，右侧购物车式制单</div>
        </div>
      </div>
    </template>

    <div class="creator-layout">
      <div class="resource-panel">
        <div class="quick-create">
          <el-input
            v-model="quickAddKeyword"
            clearable
            placeholder="扫码值/关键字快速加入（编码、名称）"
            @keyup.enter="quickAddByKeyword"
          />
          <el-input-number
            v-model="quickAddQty"
            :min="1"
            :precision="0"
            :step="1"
          />
          <el-button type="primary" @click="quickAddByKeyword"
            >快速加入</el-button
          >
        </div>

        <div class="template-row">
          <el-select v-model="selectedTemplateId" style="width: 220px">
            <el-option
              v-for="tpl in presetTemplates"
              :key="tpl.id"
              :label="tpl.name"
              :value="tpl.id"
            />
          </el-select>
          <el-button @click="applyPresetTemplate">套用模板</el-button>
        </div>

        <el-input
          v-model="assetKeyword"
          clearable
          placeholder="搜索资产类型（名称/编码）"
        />

        <el-scrollbar max-height="540px" class="resource-list">
          <div
            v-for="asset in filteredAssetTypes"
            :key="asset.id"
            class="resource-item"
          >
            <div>
              <div class="resource-item__name">{{ asset.type_name }}</div>
              <div class="resource-item__meta">
                {{ asset.type_code }} · {{ asset.unit || "件" }}
              </div>
            </div>
            <el-button type="primary" plain @click="addAssetToCart(asset.id)"
              >加入</el-button
            >
          </div>
        </el-scrollbar>
      </div>

      <div class="cart-panel">
        <el-form label-position="top">
          <el-row :gutter="10">
            <el-col :xs="24" :sm="8">
              <el-form-item label="调拨类型">
                <el-select v-model="form.order_type" style="width: 100%">
                  <el-option label="入库" value="inbound" />
                  <el-option label="出库" value="outbound" />
                  <el-option label="调拨" value="transfer" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="16">
              <el-form-item label="关联项目">
                <el-select
                  v-model="form.project_id"
                  clearable
                  filterable
                  style="width: 100%"
                >
                  <el-option
                    v-for="item in projects"
                    :key="item.id"
                    :label="`${item.project_name} (${item.project_code})`"
                    :value="item.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="10">
            <el-col :xs="24" :sm="24">
              <el-form-item label="关联租赁周期（可选）">
                <el-select
                  v-model="form.rental_term_id"
                  clearable
                  filterable
                  style="width: 100%"
                  placeholder="选择租赁周期以启用逾期校验与回库自动归还"
                >
                  <el-option
                    v-for="item in activeRentalTerms"
                    :key="item.id"
                    :label="`${item.rental_no} | 资产#${item.tracked_asset_id} | ${item.rental_mode === 'lease_in' ? '租入' : '外租'} | 到期${item.due_date}`"
                    :value="item.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <el-row :gutter="10">
            <el-col :xs="24" :sm="12">
              <el-form-item label="来源仓库">
                <el-select
                  v-model="form.from_warehouse_id"
                  clearable
                  filterable
                  style="width: 100%"
                >
                  <el-option
                    v-for="item in warehouses"
                    :key="item.id"
                    :label="item.warehouse_name"
                    :value="item.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :xs="24" :sm="12">
              <el-form-item label="目标仓库">
                <el-select
                  v-model="form.to_warehouse_id"
                  clearable
                  filterable
                  style="width: 100%"
                >
                  <el-option
                    v-for="item in warehouses"
                    :key="item.id"
                    :label="item.warehouse_name"
                    :value="item.id"
                  />
                </el-select>
              </el-form-item>
            </el-col>
          </el-row>

          <el-form-item label="备注">
            <el-input v-model="form.remark" type="textarea" :rows="2" />
          </el-form-item>
        </el-form>

        <el-table
          :data="form.items"
          size="small"
          empty-text="请从左侧加入资产"
          border
        >
          <el-table-column label="资产类型" min-width="240">
            <template #default="scope">
              {{ getAssetTypeName(scope.row.asset_type_id) }}
            </template>
          </el-table-column>
          <el-table-column label="数量" width="150">
            <template #default="scope">
              <el-input-number
                v-model="scope.row.quantity"
                :min="0.01"
                :precision="2"
                :controls="true"
              />
            </template>
          </el-table-column>
          <el-table-column label="组合角色" width="170">
            <template #default="scope">
              <el-select
                v-model="scope.row.configuration_role"
                style="width: 100%"
              >
                <el-option
                  v-for="item in configurationRoleOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </template>
          </el-table-column>
          <el-table-column label="需改装" width="110" align="center">
            <template #default="scope">
              <el-switch
                :model-value="scope.row.requires_modification === 1"
                @update:model-value="
                  scope.row.requires_modification = $event ? 1 : 0
                "
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="90">
            <template #default="scope">
              <el-button
                link
                type="danger"
                @click="removeCartItem(scope.$index)"
                >删除</el-button
              >
            </template>
          </el-table-column>
        </el-table>

        <div class="cart-actions">
          <span class="cart-summary"
            >已选 {{ form.items.length }} 项，合计数量 {{ totalCartQty }}</span
          >
          <el-button @click="resetCreator">清空</el-button>
          <el-button
            type="primary"
            :disabled="!canSubmit"
            :loading="submitting"
            @click="submit"
          >
            提交制单
          </el-button>
        </div>
      </div>
    </div>
  </el-card>

  <el-card v-loading="loading" shadow="never" class="order-list">
    <template #header>
      <div class="order-list__header">
        <span>出入库单列表</span>
        <el-form inline>
          <el-form-item label="类型">
            <el-select
              v-model="filters.order_type"
              clearable
              style="width: 140px"
            >
              <el-option label="入库" value="inbound" />
              <el-option label="出库" value="outbound" />
              <el-option label="调拨" value="transfer" />
            </el-select>
          </el-form-item>
          <el-form-item label="状态">
            <el-select v-model="filters.status" clearable style="width: 160px">
              <el-option label="draft" value="draft" />
              <el-option label="pending_approval" value="pending_approval" />
              <el-option label="approved" value="approved" />
              <el-option label="executed" value="executed" />
              <el-option label="rejected" value="rejected" />
              <el-option label="cancelled" value="cancelled" />
            </el-select>
          </el-form-item>
          <el-button type="primary" @click="loadData">查询</el-button>
        </el-form>
      </div>
    </template>

    <el-table :data="rows">
      <el-table-column prop="order_no" label="单号" width="170" />
      <el-table-column label="类型" width="90">
        <template #default="scope">
          {{ orderTypeLabel(scope.row.order_type) }}
        </template>
      </el-table-column>
      <el-table-column prop="project_id" label="项目ID" width="100" />
      <el-table-column prop="from_warehouse_id" label="来源仓库" width="110" />
      <el-table-column prop="to_warehouse_id" label="目标仓库" width="110" />
      <el-table-column label="租赁周期" width="130">
        <template #default="scope">
          {{ scope.row.rental_term_id || "-" }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="scope">
          <el-tag :type="statusTag(scope.row.status)">{{
            scope.row.status
          }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="特殊放行" width="130">
        <template #default="scope">
          <el-tag
            v-if="scope.row.override_status !== 'none'"
            :type="overrideTag(scope.row.override_status)"
            effect="plain"
          >
            {{ scope.row.override_status }}
          </el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column prop="updated_at" label="更新时间" width="190" />
      <el-table-column label="操作" width="340" fixed="right">
        <template #default="scope">
          <el-button
            v-if="scope.row.status === 'draft'"
            link
            type="primary"
            :loading="actionId === scope.row.id"
            @click="submitApproval(scope.row)"
          >
            提交审批
          </el-button>
          <el-button
            v-if="scope.row.status === 'approved'"
            link
            type="success"
            :loading="actionId === scope.row.id"
            @click="executeOrder(scope.row)"
          >
            执行
          </el-button>
          <el-button
            v-if="scope.row.status === 'approved'"
            link
            type="warning"
            :loading="actionId === scope.row.id"
            @click="checkGate(scope.row)"
          >
            检查
          </el-button>
          <el-button
            v-if="
              scope.row.status === 'approved' &&
              scope.row.order_type === 'outbound'
            "
            link
            type="danger"
            @click="openOverride(scope.row)"
          >
            特殊放行
          </el-button>
          <el-button
            v-if="
              scope.row.status === 'draft' ||
              scope.row.status === 'pending_approval'
            "
            link
            type="danger"
            :loading="actionId === scope.row.id"
            @click="cancelOrder(scope.row)"
          >
            取消
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog
    v-model="overrideVisible"
    title="特殊放行审批"
    width="520px"
    destroy-on-close
  >
    <el-alert
      type="warning"
      show-icon
      :closable="false"
      title="特殊放行会绕过返库状态或未完成阻塞任务，只能由库房负责人或超级管理员审批。"
    />
    <el-form label-position="top" class="override-form">
      <el-form-item label="出入库单">
        <el-input :model-value="overrideForm.order_no" disabled />
      </el-form-item>
      <el-form-item label="放行原因">
        <el-input
          v-model="overrideForm.override_reason"
          type="textarea"
          :rows="4"
          placeholder="说明为什么必须在检查/维护未完成前放行，以及现场风险控制措施"
        />
      </el-form-item>
      <el-checkbox v-model="overrideForm.override_risk_acknowledged">
        已确认本次放行风险，并由审批人承担审批责任
      </el-checkbox>
    </el-form>
    <template #footer>
      <el-button @click="overrideVisible = false">取消</el-button>
      <el-button
        type="danger"
        :loading="overrideSubmitting"
        @click="submitOverride"
      >
        确认放行
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.order-creator,
.order-list {
  background: #fffaf2;
  margin-bottom: 12px;
}

.title {
  font-size: 18px;
  font-weight: 700;
  color: #2a241d;
}

.sub {
  margin-top: 4px;
  font-size: 13px;
  color: #6e6458;
}

.creator-layout {
  display: grid;
  grid-template-columns: 34% 66%;
  gap: 12px;
}

.resource-panel,
.cart-panel {
  border: 1px solid #d9ceb9;
  border-radius: 10px;
  background: #fff;
  padding: 10px;
}

.resource-list {
  margin-top: 10px;
}

.quick-create {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  margin-bottom: 10px;
}

.template-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.resource-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 1px solid #e8ddc8;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
}

.resource-item__name {
  font-weight: 600;
  color: #2a241d;
}

.resource-item__meta {
  margin-top: 4px;
  font-size: 12px;
  color: #6e6458;
}

.cart-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.override-form {
  margin-top: 12px;
}

.cart-summary {
  margin-right: auto;
  color: #6e6458;
  font-size: 13px;
}

.order-list__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

@media (max-width: 980px) {
  .creator-layout {
    grid-template-columns: 1fr;
  }

  .quick-create {
    grid-template-columns: 1fr;
  }

  .template-row {
    flex-direction: column;
  }

  .order-list__header {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }
}
</style>
