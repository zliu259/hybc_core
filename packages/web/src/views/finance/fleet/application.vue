<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { UploadRequestOptions } from "element-plus";
import { message } from "@/utils/message";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import {
  createFuelQuotaApplication,
  listFleetVehicles,
  listFuelQuotaApplications,
  type FleetVehicle,
  type FuelQuotaApplication
} from "@/api/fleet";

defineOptions({ name: "FuelQuotaApplicationPage" });

const loading = ref(false);
const vehicles = ref<FleetVehicle[]>([]);
const myApplications = ref<FuelQuotaApplication[]>([]);
const photoKeys = ref<string[]>([]);

const form = ref({
  vehicle_id: undefined as number | undefined,
  requested_amount: 0,
  vehicle_mileage_km: 0
});

const loadData = async () => {
  loading.value = true;
  try {
    const [vehicleResult, appResult] = await Promise.all([
      listFleetVehicles({ status: "active" }),
      listFuelQuotaApplications({ mine: true })
    ]);
    vehicles.value = vehicleResult.data;
    myApplications.value = appResult.data;
  } finally {
    loading.value = false;
  }
};

const uploadPhoto = async (options: UploadRequestOptions) => {
  try {
    const signResult = await createUploadSignature({
      fileName: options.file.name,
      contentType: options.file.type || undefined,
      category: "fuel-application"
    });
    const uploadResp = await fetch(resolveUploadUrl(signResult.data.uploadUrl), {
      method: "PUT",
      headers: {
        "content-type": options.file.type || "application/octet-stream"
      },
      body: options.file
    });

    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }

    photoKeys.value.push(signResult.data.key);
    options.onSuccess?.({} as never);
    message("照片上传成功", { type: "success" });
  } catch {
    options.onError?.(new Error("upload_failed") as never);
    message("照片上传失败", { type: "error" });
  }
};

const submitApplication = async () => {
  if (!form.value.vehicle_id) {
    message("请选择车辆", { type: "warning" });
    return;
  }
  if (form.value.requested_amount <= 0) {
    message("请输入申请额度", { type: "warning" });
    return;
  }
  await createFuelQuotaApplication({
    vehicle_id: form.value.vehicle_id,
    requested_amount: form.value.requested_amount,
    vehicle_mileage_km: form.value.vehicle_mileage_km,
    photo_keys_json: JSON.stringify(photoKeys.value)
  });
  form.value = { vehicle_id: undefined, requested_amount: 0, vehicle_mileage_km: 0 };
  photoKeys.value = [];
  await loadData();
  message("油卡额度申请已提交", { type: "success" });
};

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" :loading="loading">
    <template #header>
      <div style="display: flex; justify-content: space-between; align-items: center">
        <span>油卡额度申请</span>
        <el-button @click="loadData">刷新</el-button>
      </div>
    </template>

    <el-form label-width="110px" style="max-width: 720px">
      <el-form-item label="所用车辆">
        <el-select v-model="form.vehicle_id" filterable style="width: 100%">
          <el-option v-for="item in vehicles" :key="item.id" :label="`${item.current_plate_no} (${item.vehicle_uuid})`" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="申请额度">
        <el-input-number v-model="form.requested_amount" :min="0" :step="100" />
      </el-form-item>
      <el-form-item label="车辆里程(km)">
        <el-input-number v-model="form.vehicle_mileage_km" :min="0" />
      </el-form-item>
      <el-form-item label="现场照片">
        <el-upload drag multiple :show-file-list="true" :http-request="uploadPhoto">
          <div class="el-upload__text">上传加油申请照片</div>
        </el-upload>
      </el-form-item>
      <el-button type="primary" @click="submitApplication">提交申请</el-button>
    </el-form>

    <el-divider />

    <el-table :data="myApplications" stripe>
      <el-table-column prop="application_no" label="申请单号" min-width="160" />
      <el-table-column prop="current_plate_no" label="车辆" width="120" />
      <el-table-column prop="vehicle_mileage_km" label="里程" width="100" />
      <el-table-column prop="requested_amount" label="申请额度" width="120" />
      <el-table-column prop="status" label="状态" width="100" />
      <el-table-column prop="requested_at" label="申请日期" width="180" />
      <el-table-column prop="processed_by_userid" label="处理人" width="140" />
      <el-table-column prop="latest_card_balance" label="卡余额" width="120" />
    </el-table>
  </el-card>
</template>
