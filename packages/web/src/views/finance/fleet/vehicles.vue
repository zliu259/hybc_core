<script setup lang="ts">
import { onMounted, ref } from "vue";
import { message } from "@/utils/message";
import { listEntities, type Entity } from "@/api/entity";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import {
  bindFuelCardUser,
  createFleetVehicle,
  createFuelCard,
  createVehicleMileageLog,
  listFleetVehicles,
  listFuelCards,
  listFuelQuotaApplications,
  processFuelQuotaApplication,
  updateFleetVehicle,
  type FleetVehicle,
  type FuelCard,
  type FuelQuotaApplication
} from "@/api/fleet";

defineOptions({ name: "FleetVehicleOps" });

const entities = ref<Entity[]>([]);
const vehicles = ref<FleetVehicle[]>([]);
const cards = ref<FuelCard[]>([]);
const applications = ref<FuelQuotaApplication[]>([]);
const loading = ref(false);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const vehicleForm = ref({
  current_plate_no: "",
  vehicle_model: "",
  ownership_type: "company_owned" as "company_owned" | "employee_owned",
  owner_name: "",
  entity_id: undefined as number | undefined
});

const mileageForm = ref({
  vehicle_id: undefined as number | undefined,
  mileage_km: 0,
  remark: ""
});

const cardForm = ref({
  card_no: "",
  issued_to_entity_id: undefined as number | undefined,
  latest_balance: 0
});

const bindForm = ref({
  fuel_card_id: undefined as number | undefined,
  bind_userid: ""
});

const processDialogVisible = ref(false);
const processTarget = ref<FuelQuotaApplication | null>(null);
const processForm = ref({
  status: "processed" as "processed" | "rejected",
  fuel_card_id: undefined as number | undefined,
  latest_card_balance: 0,
  office_remark: ""
});

const loadData = async () => {
  loading.value = true;
  try {
    const [entityResult, vehicleResult, cardResult, appResult] = await Promise.all([
      listEntities({ status: "active" }),
      listFleetVehicles(),
      listFuelCards({ status: "active" }),
      listFuelQuotaApplications({ status: "pending" }),
      loadWecomUsers()
    ]);
    entities.value = entityResult.data;
    vehicles.value = vehicleResult.data;
    cards.value = cardResult.data;
    applications.value = appResult.data;
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
  message("车辆状态已更新", { type: "success" });
};

const submitMileage = async () => {
  if (!mileageForm.value.vehicle_id) {
    message("请选择车辆", { type: "warning" });
    return;
  }
  await createVehicleMileageLog(mileageForm.value.vehicle_id, {
    mileage_km: mileageForm.value.mileage_km,
    remark: mileageForm.value.remark
  });
  mileageForm.value = { vehicle_id: undefined, mileage_km: 0, remark: "" };
  message("里程记录已提交", { type: "success" });
};

const submitFuelCard = async () => {
  if (!cardForm.value.card_no) {
    message("请填写油卡号", { type: "warning" });
    return;
  }
  await createFuelCard({ ...cardForm.value });
  cardForm.value = { card_no: "", issued_to_entity_id: undefined, latest_balance: 0 };
  await loadData();
  message("油卡已创建", { type: "success" });
};

const submitBinding = async () => {
  if (!bindForm.value.fuel_card_id || !bindForm.value.bind_userid.trim()) {
    message("请选择油卡与员工", { type: "warning" });
    return;
  }
  await bindFuelCardUser(bindForm.value.fuel_card_id, { bind_userid: bindForm.value.bind_userid.trim() });
  bindForm.value = { fuel_card_id: undefined, bind_userid: "" };
  message("油卡绑定成功", { type: "success" });
};

const openProcess = (row: FuelQuotaApplication) => {
  processTarget.value = row;
  processForm.value = {
    status: "processed",
    fuel_card_id: undefined,
    latest_card_balance: 0,
    office_remark: ""
  };
  processDialogVisible.value = true;
};

const submitProcess = async () => {
  if (!processTarget.value) return;
  await processFuelQuotaApplication(processTarget.value.id, {
    ...processForm.value
  });
  processDialogVisible.value = false;
  await loadData();
  message("申请处理完成", { type: "success" });
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" :loading="loading">
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center">
        <span>公司车辆与油卡管理</span>
        <el-button type="primary" @click="loadData">刷新</el-button>
      </div>
    </template>

    <el-tabs>
      <el-tab-pane label="车辆档案">
        <el-form inline>
          <el-form-item label="车牌号"><el-input v-model="vehicleForm.current_plate_no" /></el-form-item>
          <el-form-item label="车型"><el-input v-model="vehicleForm.vehicle_model" /></el-form-item>
          <el-form-item label="归属">
            <el-select v-model="vehicleForm.ownership_type" style="width: 150px">
              <el-option label="公司车辆" value="company_owned" />
              <el-option label="员工车辆" value="employee_owned" />
            </el-select>
          </el-form-item>
          <el-form-item label="所属实体">
            <el-select v-model="vehicleForm.entity_id" clearable filterable style="width: 220px">
              <el-option v-for="item in entities" :key="item.id" :label="item.entity_name" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="权属人"><el-input v-model="vehicleForm.owner_name" /></el-form-item>
          <el-button type="primary" @click="submitVehicle">新增车辆</el-button>
        </el-form>

        <el-table :data="vehicles" style="margin-top: 12px">
          <el-table-column prop="vehicle_uuid" label="车辆UUID" min-width="220" />
          <el-table-column prop="current_plate_no" label="当前车牌" width="120" />
          <el-table-column prop="vehicle_model" label="车型" width="140" />
          <el-table-column prop="ownership_type" label="归属权" width="130" />
          <el-table-column prop="owner_name" label="权属人" width="140" />
          <el-table-column prop="status" label="状态" width="100" />
          <el-table-column label="操作" width="110" fixed="right">
            <template #default="scope">
              <el-button link type="danger" @click="markVehicleInactive(scope.row)">停用</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="油卡管理">
        <el-form inline>
          <el-form-item label="油卡号"><el-input v-model="cardForm.card_no" /></el-form-item>
          <el-form-item label="所属实体">
            <el-select v-model="cardForm.issued_to_entity_id" clearable filterable style="width: 220px">
              <el-option v-for="item in entities" :key="item.id" :label="item.entity_name" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="余额"><el-input-number v-model="cardForm.latest_balance" :min="0" /></el-form-item>
          <el-button type="primary" @click="submitFuelCard">新增油卡</el-button>
        </el-form>

        <el-form inline style="margin-top: 8px">
          <el-form-item label="绑定油卡">
            <el-select v-model="bindForm.fuel_card_id" clearable filterable style="width: 220px">
              <el-option v-for="item in cards" :key="item.id" :label="item.card_no" :value="item.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="绑定员工">
            <el-select v-model="bindForm.bind_userid" clearable filterable style="width: 280px">
              <el-option
                v-for="item in wecomUsers"
                :key="item.userid"
                :label="`${item.name} (${item.userid})`"
                :value="item.userid"
              />
            </el-select>
          </el-form-item>
          <el-button @click="submitBinding">执行绑定</el-button>
        </el-form>

        <el-table :data="cards" style="margin-top: 12px">
          <el-table-column prop="card_no" label="油卡号" min-width="180" />
          <el-table-column prop="latest_balance" label="最新余额" width="120" />
          <el-table-column prop="status" label="状态" width="100" />
          <el-table-column prop="updated_at" label="更新时间" width="180" />
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="办公室处理">
        <el-form inline>
          <el-form-item label="车辆"><el-select v-model="mileageForm.vehicle_id" clearable filterable style="width: 220px"><el-option v-for="item in vehicles" :key="item.id" :label="item.current_plate_no" :value="item.id" /></el-select></el-form-item>
          <el-form-item label="公里数"><el-input-number v-model="mileageForm.mileage_km" :min="0" /></el-form-item>
          <el-form-item label="备注"><el-input v-model="mileageForm.remark" /></el-form-item>
          <el-button @click="submitMileage">记录里程</el-button>
        </el-form>

        <el-table :data="applications" style="margin-top: 12px">
          <el-table-column prop="application_no" label="申请单号" min-width="160" />
          <el-table-column prop="applicant_userid" label="申请人" width="140" />
          <el-table-column prop="current_plate_no" label="车辆" width="120" />
          <el-table-column prop="vehicle_mileage_km" label="里程" width="100" />
          <el-table-column prop="requested_amount" label="额度" width="110" />
          <el-table-column prop="requested_at" label="申请时间" width="180" />
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="scope">
              <el-button type="primary" link @click="openProcess(scope.row)">处理</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-dialog v-model="processDialogVisible" title="处理油卡额度申请" width="520px">
    <el-form label-width="120px">
      <el-form-item label="处理结果">
        <el-select v-model="processForm.status" style="width: 100%">
          <el-option label="通过并处理" value="processed" />
          <el-option label="拒绝" value="rejected" />
        </el-select>
      </el-form-item>
      <el-form-item label="油卡">
        <el-select v-model="processForm.fuel_card_id" clearable filterable style="width: 100%">
          <el-option v-for="item in cards" :key="item.id" :label="item.card_no" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="最新余额">
        <el-input-number v-model="processForm.latest_card_balance" :min="0" />
      </el-form-item>
      <el-form-item label="处理备注">
        <el-input v-model="processForm.office_remark" type="textarea" :rows="3" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="processDialogVisible = false">取消</el-button>
      <el-button type="primary" @click="submitProcess">提交处理</el-button>
    </template>
  </el-dialog>
</template>
