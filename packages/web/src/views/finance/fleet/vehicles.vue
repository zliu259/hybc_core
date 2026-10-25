<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { statusLabel } from "@/utils/enum-labels";
import { listEntities, type Entity } from "@/api/entity";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import {
  bindFuelCardVehicle,
  createFleetVehicle,
  createFuelCard,
  listFleetVehicles,
  listFuelCardBalanceLogs,
  listFuelCardVehicleBindings,
  listFuelCards,
  unbindFuelCardVehicle,
  updateFleetVehicle,
  type FleetVehicle,
  type FuelCard,
  type FuelCardBalanceLog,
  type FuelCardVehicleBinding
} from "@/api/fleet";
import { vehicleOptionLabel } from "./fuel-card-selection";

defineOptions({ name: "FleetVehicleOps" });

const entities = ref<Entity[]>([]);
const vehicles = ref<FleetVehicle[]>([]);
const cards = ref<FuelCard[]>([]);
const loading = ref(false);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const vehicleStatusFilter = ref<"all" | "active" | "inactive">("all");

const vehicleEditDialogVisible = ref(false);
const vehicleEditSubmitting = ref(false);
const editingVehicleId = ref<number | null>(null);
const vehicleEditForm = ref({
  current_plate_no: "",
  vehicle_model: "",
  ownership_type: "company_owned" as "company_owned" | "employee_owned",
  owner_name: "",
  entity_id: undefined as number | undefined,
  status: "active" as "active" | "inactive"
});

const vehicleForm = ref({
  current_plate_no: "",
  vehicle_model: "",
  ownership_type: "company_owned" as "company_owned" | "employee_owned",
  owner_name: "",
  entity_id: undefined as number | undefined
});

const cardForm = ref({
  card_no: "",
  issued_to_entity_id: undefined as number | undefined,
  latest_balance: 0
});

// 油卡跟车走：卡挂在车上，档案页负责绑定/转移/解绑
const bindDialogVisible = ref(false);
const bindSubmitting = ref(false);
const bindTargetCard = ref<FuelCard | null>(null);
const bindVehicleId = ref<number | undefined>(undefined);
const activeVehicles = computed(() =>
  vehicles.value.filter(item => item.status === "active")
);

const balanceLogDialogVisible = ref(false);
const selectedCard = ref<FuelCard | null>(null);
const balanceLogs = ref<FuelCardBalanceLog[]>([]);
const vehicleBindings = ref<FuelCardVehicleBinding[]>([]);

const ownershipText = (value: string) => {
  if (value === "company_owned") return "公司车辆";
  if (value === "employee_owned") return "员工车辆";
  return value;
};

const resolveUserName = (userid: string | null | undefined) => {
  if (!userid) return "-";
  const matched = wecomUsers.value.find(item => item.userid === userid);
  return matched?.name?.trim() ? `${matched.name} (${userid})` : userid;
};

const plateOfVehicle = (vehicleId: number | null | undefined) =>
  vehicles.value.find(item => item.id === vehicleId)?.current_plate_no ||
  `车辆 ${vehicleId}`;

const operationTypeLabel = (
  operationType: FuelCardBalanceLog["operation_type"]
) => {
  if (operationType === "card_created") return "建卡";
  if (operationType === "application_processed") return "申请处理";
  if (operationType === "manual_adjustment") return "人工调整";
  return operationType;
};

const loadData = async () => {
  loading.value = true;
  try {
    const [entityResult, vehicleResult, cardResult] = await Promise.all([
      listEntities({ status: "active" }),
      listFleetVehicles(
        vehicleStatusFilter.value === "all"
          ? undefined
          : { status: vehicleStatusFilter.value }
      ),
      listFuelCards({ status: "active" }),
      loadWecomUsers()
    ]);
    entities.value = entityResult.data;
    vehicles.value = vehicleResult.data;
    cards.value = cardResult.data;
  } finally {
    loading.value = false;
  }
};

const submitVehicle = async () => {
  if (!vehicleForm.value.current_plate_no) {
    message("请填写车牌号", { type: "warning" });
    return;
  }
  await createFleetVehicle({ ...vehicleForm.value });
  vehicleForm.value = {
    current_plate_no: "",
    vehicle_model: "",
    ownership_type: "company_owned",
    owner_name: "",
    entity_id: undefined
  };
  await loadData();
  message("车辆档案已创建", { type: "success" });
};

const markVehicleInactive = async (row: FleetVehicle) => {
  await updateFleetVehicle(row.id, { status: "inactive" });
  await loadData();
  message("车辆已停用", { type: "success" });
};

const markVehicleActive = async (row: FleetVehicle) => {
  await updateFleetVehicle(row.id, { status: "active" });
  await loadData();
  message("车辆已启用", { type: "success" });
};

const openVehicleEdit = (row: FleetVehicle) => {
  editingVehicleId.value = row.id;
  vehicleEditForm.value = {
    current_plate_no: row.current_plate_no || "",
    vehicle_model: row.vehicle_model || "",
    ownership_type: row.ownership_type,
    owner_name: row.owner_name || "",
    entity_id: typeof row.entity_id === "number" ? row.entity_id : undefined,
    status: row.status === "inactive" ? "inactive" : "active"
  };
  vehicleEditDialogVisible.value = true;
};

const submitVehicleEdit = async () => {
  if (!editingVehicleId.value) return;
  if (!vehicleEditForm.value.current_plate_no.trim()) {
    message("请填写车牌号", { type: "warning" });
    return;
  }

  vehicleEditSubmitting.value = true;
  try {
    await updateFleetVehicle(editingVehicleId.value, {
      current_plate_no: vehicleEditForm.value.current_plate_no.trim(),
      vehicle_model: vehicleEditForm.value.vehicle_model.trim() || null,
      ownership_type: vehicleEditForm.value.ownership_type,
      owner_name: vehicleEditForm.value.owner_name.trim() || null,
      entity_id:
        typeof vehicleEditForm.value.entity_id === "number"
          ? vehicleEditForm.value.entity_id
          : null,
      status: vehicleEditForm.value.status
    });
    vehicleEditDialogVisible.value = false;
    await loadData();
    message("车辆档案已更新", { type: "success" });
  } finally {
    vehicleEditSubmitting.value = false;
  }
};

const submitFuelCard = async () => {
  if (!cardForm.value.card_no) {
    message("请填写油卡号", { type: "warning" });
    return;
  }
  await createFuelCard({ ...cardForm.value });
  cardForm.value = {
    card_no: "",
    issued_to_entity_id: undefined,
    latest_balance: 0
  };
  await loadData();
  message("油卡已创建", { type: "success" });
};

const openBindDialog = (row: FuelCard) => {
  bindTargetCard.value = row;
  // 当前车已停用时不预选，避免下拉里出现不可选的值
  bindVehicleId.value = activeVehicles.value.some(
    item => item.id === row.vehicle_id
  )
    ? (row.vehicle_id ?? undefined)
    : undefined;
  bindDialogVisible.value = true;
};

const submitBindVehicle = async () => {
  const card = bindTargetCard.value;
  const vehicleId = bindVehicleId.value;
  if (!card || !vehicleId) {
    message("请选择车辆", { type: "warning" });
    return;
  }
  if (card.vehicle_id && card.vehicle_id !== vehicleId) {
    try {
      await ElMessageBox.confirm(
        `该油卡当前在 ${card.vehicle_plate_no || plateOfVehicle(card.vehicle_id)}，确定转移到 ${plateOfVehicle(vehicleId)}？`,
        "转移油卡",
        {
          confirmButtonText: "确定转移",
          cancelButtonText: "取消",
          type: "warning"
        }
      );
    } catch {
      return;
    }
  }

  bindSubmitting.value = true;
  try {
    const result = await bindFuelCardVehicle(card.id, {
      vehicle_id: vehicleId
    });
    bindDialogVisible.value = false;
    const outcome = result.data.outcome;
    message(
      outcome === "transferred"
        ? "油卡已转移"
        : outcome === "bound"
          ? "油卡已绑定车辆"
          : "油卡已在该车辆上",
      { type: "success" }
    );
  } catch (error) {
    message(resolveApiErrorMessage(error, "油卡绑定失败"), { type: "error" });
  } finally {
    bindSubmitting.value = false;
    await loadData();
  }
};

const confirmUnbindVehicle = async (row: FuelCard) => {
  try {
    await ElMessageBox.confirm(
      `确定将油卡 ${row.card_no} 从 ${row.vehicle_plate_no || plateOfVehicle(row.vehicle_id)} 解绑？解绑后该车不能再用这张卡申请额度。`,
      "解绑油卡",
      {
        confirmButtonText: "确定解绑",
        cancelButtonText: "取消",
        type: "warning"
      }
    );
  } catch {
    return;
  }
  try {
    await unbindFuelCardVehicle(row.id);
    message("油卡已解绑", { type: "success" });
  } catch (error) {
    message(resolveApiErrorMessage(error, "油卡解绑失败"), { type: "error" });
  } finally {
    await loadData();
  }
};

const openBalanceLogs = async (row: FuelCard) => {
  selectedCard.value = row;
  const [logResult, bindingResult] = await Promise.all([
    listFuelCardBalanceLogs(row.id, { page: 1, pageSize: 100 }),
    listFuelCardVehicleBindings(row.id)
  ]);
  balanceLogs.value = logResult.data;
  vehicleBindings.value = bindingResult.data;
  balanceLogDialogVisible.value = true;
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
        <span>车辆油卡档案</span>
        <el-button type="primary" @click="loadData">刷新</el-button>
      </div>
    </template>

    <el-tabs>
      <el-tab-pane label="车辆档案">
        <el-form inline>
          <el-form-item label="状态筛选">
            <el-select
              v-model="vehicleStatusFilter"
              style="width: 160px"
              @change="loadData"
            >
              <el-option label="全部" value="all" />
              <el-option label="启用中" value="active" />
              <el-option label="已停用" value="inactive" />
            </el-select>
          </el-form-item>
          <el-form-item label="车牌号"
            ><el-input v-model="vehicleForm.current_plate_no"
          /></el-form-item>
          <el-form-item label="车型"
            ><el-input v-model="vehicleForm.vehicle_model"
          /></el-form-item>
          <el-form-item label="归属">
            <el-select
              v-model="vehicleForm.ownership_type"
              style="width: 150px"
            >
              <el-option label="公司车辆" value="company_owned" />
              <el-option label="员工车辆" value="employee_owned" />
            </el-select>
          </el-form-item>
          <el-form-item label="所属实体">
            <el-select
              v-model="vehicleForm.entity_id"
              clearable
              filterable
              style="width: 220px"
            >
              <el-option
                v-for="item in entities"
                :key="item.id"
                :label="item.entity_name"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="权属人"
            ><el-input v-model="vehicleForm.owner_name"
          /></el-form-item>
          <el-button type="primary" @click="submitVehicle">新增车辆</el-button>
        </el-form>

        <el-table :data="vehicles" style="margin-top: 12px">
          <el-table-column
            prop="vehicle_uuid"
            label="车辆UUID"
            min-width="220"
          />
          <el-table-column
            prop="current_plate_no"
            label="当前车牌"
            width="120"
          />
          <el-table-column prop="vehicle_model" label="车型" width="140" />
          <el-table-column label="归属权" width="130">
            <template #default="scope">{{
              ownershipText(scope.row.ownership_type)
            }}</template>
          </el-table-column>
          <el-table-column prop="owner_name" label="权属人" width="140" />
          <el-table-column label="油卡" min-width="200">
            <template #default="scope">
              <span v-if="scope.row.fuel_card_nos">{{
                scope.row.fuel_card_nos.split(",").join("、")
              }}</span>
              <el-tag v-else type="info" size="small">未配卡</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="100">
            <template #default="scope">
              <el-tag
                :type="scope.row.status === 'active' ? 'success' : 'info'"
              >
                {{ scope.row.status === "active" ? "启用中" : "已停用" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="openVehicleEdit(scope.row)"
                >编辑</el-button
              >
              <el-button
                v-if="scope.row.status === 'active'"
                link
                type="danger"
                @click="markVehicleInactive(scope.row)"
              >
                停用
              </el-button>
              <el-button
                v-else
                link
                type="success"
                @click="markVehicleActive(scope.row)"
              >
                启用
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="油卡管理">
        <el-form inline>
          <el-form-item label="油卡号"
            ><el-input v-model="cardForm.card_no"
          /></el-form-item>
          <el-form-item label="所属实体">
            <el-select
              v-model="cardForm.issued_to_entity_id"
              clearable
              filterable
              style="width: 220px"
            >
              <el-option
                v-for="item in entities"
                :key="item.id"
                :label="item.entity_name"
                :value="item.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="余额"
            ><el-input-number v-model="cardForm.latest_balance" :min="0"
          /></el-form-item>
          <el-button type="primary" @click="submitFuelCard">新增油卡</el-button>
        </el-form>

        <el-table :data="cards" style="margin-top: 12px">
          <el-table-column prop="card_no" label="油卡号" min-width="180" />
          <el-table-column label="所属车辆" min-width="140">
            <template #default="scope">
              <span v-if="scope.row.vehicle_plate_no">{{
                scope.row.vehicle_plate_no
              }}</span>
              <el-tag v-else type="info" size="small">未绑定</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="latest_balance" label="最新余额" width="120" />
          <el-table-column label="状态" width="100">
            <template #default="scope">{{
              statusLabel(scope.row.status)
            }}</template>
          </el-table-column>
          <el-table-column prop="updated_at" label="更新时间" width="180" />
          <el-table-column label="操作" width="220" fixed="right">
            <template #default="scope">
              <el-button link type="primary" @click="openBindDialog(scope.row)">
                {{ scope.row.vehicle_id ? "转移" : "绑定车辆" }}
              </el-button>
              <el-button
                v-if="scope.row.vehicle_id"
                link
                type="danger"
                @click="confirmUnbindVehicle(scope.row)"
                >解绑</el-button
              >
              <el-button link type="primary" @click="openBalanceLogs(scope.row)"
                >查看记录</el-button
              >
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-dialog
    v-model="balanceLogDialogVisible"
    :title="`油卡操作记录 - ${selectedCard?.card_no || ''}`"
    width="880px"
  >
    <el-table :data="balanceLogs" size="small" stripe>
      <el-table-column label="类型" width="120">
        <template #default="scope">{{
          operationTypeLabel(scope.row.operation_type)
        }}</template>
      </el-table-column>
      <el-table-column prop="previous_balance" label="变更前" width="120" />
      <el-table-column prop="new_balance" label="变更后" width="120" />
      <el-table-column prop="change_amount" label="变动值" width="120" />
      <el-table-column
        prop="related_application_id"
        label="关联申请ID"
        width="120"
      />
      <el-table-column label="操作人" min-width="180">
        <template #default="scope">{{
          resolveUserName(scope.row.operator_userid)
        }}</template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="180" />
      <el-table-column prop="created_at" label="时间" width="180" />
    </el-table>

    <div style="margin: 16px 0 8px; font-weight: 600">车辆绑定记录</div>
    <el-table :data="vehicleBindings" size="small" stripe>
      <el-table-column label="车牌" width="120">
        <template #default="scope">{{
          scope.row.vehicle_plate_no || plateOfVehicle(scope.row.vehicle_id)
        }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="scope">
          <el-tag
            :type="scope.row.status === 'active' ? 'success' : 'info'"
            size="small"
          >
            {{ scope.row.status === "active" ? "当前" : "已解绑" }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="bound_at" label="绑定时间" width="180" />
      <el-table-column label="绑定人" min-width="140">
        <template #default="scope">{{
          resolveUserName(scope.row.bound_by_userid)
        }}</template>
      </el-table-column>
      <el-table-column label="解绑时间" width="180">
        <template #default="scope">{{ scope.row.unbound_at || "-" }}</template>
      </el-table-column>
      <el-table-column label="解绑人" min-width="140">
        <template #default="scope">{{
          resolveUserName(scope.row.unbound_by_userid)
        }}</template>
      </el-table-column>
    </el-table>
  </el-dialog>

  <el-dialog
    v-model="bindDialogVisible"
    :title="`油卡绑定车辆 - ${bindTargetCard?.card_no || ''}`"
    width="480px"
  >
    <el-form label-width="90px">
      <el-form-item label="当前车辆">
        <span>{{ bindTargetCard?.vehicle_plate_no || "未绑定" }}</span>
      </el-form-item>
      <el-form-item label="绑定到" required>
        <el-select
          v-model="bindVehicleId"
          filterable
          placeholder="请选择车辆"
          style="width: 100%"
        >
          <el-option
            v-for="item in activeVehicles"
            :key="item.id"
            :label="vehicleOptionLabel(item)"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="bindDialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="bindSubmitting"
        @click="submitBindVehicle"
      >
        保存
      </el-button>
    </template>
  </el-dialog>

  <el-dialog
    v-model="vehicleEditDialogVisible"
    title="编辑车辆档案"
    width="560px"
  >
    <el-form label-width="110px">
      <el-form-item label="车牌号" required>
        <el-input v-model="vehicleEditForm.current_plate_no" />
      </el-form-item>
      <el-form-item label="车型">
        <el-input v-model="vehicleEditForm.vehicle_model" />
      </el-form-item>
      <el-form-item label="归属">
        <el-select v-model="vehicleEditForm.ownership_type" style="width: 100%">
          <el-option label="公司车辆" value="company_owned" />
          <el-option label="员工车辆" value="employee_owned" />
        </el-select>
      </el-form-item>
      <el-form-item label="所属实体">
        <el-select
          v-model="vehicleEditForm.entity_id"
          clearable
          filterable
          style="width: 100%"
        >
          <el-option
            v-for="item in entities"
            :key="item.id"
            :label="item.entity_name"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="权属人">
        <el-input v-model="vehicleEditForm.owner_name" />
      </el-form-item>
      <el-form-item label="状态">
        <el-select v-model="vehicleEditForm.status" style="width: 100%">
          <el-option label="启用中" value="active" />
          <el-option label="已停用" value="inactive" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="vehicleEditDialogVisible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="vehicleEditSubmitting"
        @click="submitVehicleEdit"
      >
        保存
      </el-button>
    </template>
  </el-dialog>
</template>
