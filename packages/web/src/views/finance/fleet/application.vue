<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { UploadRequestOptions } from "element-plus";
import { message } from "@/utils/message";
import {
  fuelApplicationStatusLabel,
  fuelRiskLabel,
  fuelRiskTagType
} from "@/utils/enum-labels";
import { createUploadSignature, resolveUploadUrl } from "@/api/upload";
import { parsePhotoKeys } from "@/utils/photo-keys";
import {
  createFuelQuotaApplication,
  listFleetVehicles,
  listMyFuelCards,
  listFuelQuotaApplications,
  resubmitFuelQuotaApplication,
  type FuelCard,
  type FleetVehicle,
  type FuelQuotaApplication
} from "@/api/fleet";

defineOptions({ name: "FuelQuotaApplicationPage" });

const loading = ref(false);
const vehicles = ref<FleetVehicle[]>([]);
const fuelCards = ref<FuelCard[]>([]);
const myApplications = ref<FuelQuotaApplication[]>([]);
const photoKeys = ref<string[]>([]);

const form = ref({
  vehicle_id: undefined as number | undefined,
  fuel_card_id: undefined as number | undefined,
  requested_amount: 0,
  vehicle_mileage_km: 0
});
const resubmitDialogVisible = ref(false);
const resubmitTarget = ref<FuelQuotaApplication | null>(null);
const resubmitPhotoKeys = ref<string[]>([]);
const resubmitForm = ref({
  requested_amount: 0,
  vehicle_mileage_km: 0
});

const needsInfoApplications = computed(() =>
  myApplications.value.filter(item => item.status === "needs_info")
);

const fuelStatusTagType = (
  value: FuelQuotaApplication["status"]
): "success" | "warning" | "danger" | "info" => {
  if (value === "pending") return "warning";
  if (value === "needs_info") return "danger";
  if (value === "processed") return "success";
  return "info";
};

const loadData = async () => {
  loading.value = true;
  try {
    const [vehicleResult, cardResult, appResult] = await Promise.all([
      listFleetVehicles({ status: "active" }),
      listMyFuelCards(),
      listFuelQuotaApplications({ mine: true })
    ]);
    vehicles.value = vehicleResult.data;
    fuelCards.value = cardResult.data;
    myApplications.value = appResult.data;
  } finally {
    loading.value = false;
  }
};

const uploadPhotoTo = async (
  options: UploadRequestOptions,
  onUploaded: (key: string) => void
) => {
  try {
    const signResult = await createUploadSignature({
      fileName: options.file.name,
      contentType: options.file.type || undefined,
      category: "fuel-application"
    });
    const uploadResp = await fetch(
      resolveUploadUrl(signResult.data.uploadUrl),
      {
        method: "PUT",
        headers: {
          "content-type": options.file.type || "application/octet-stream"
        },
        body: options.file
      }
    );

    if (!uploadResp.ok) {
      throw new Error(`upload_failed_${uploadResp.status}`);
    }

    onUploaded(signResult.data.key);
    options.onSuccess?.({} as never);
    message("照片上传成功", { type: "success" });
  } catch {
    options.onError?.(new Error("upload_failed") as never);
    message("照片上传失败", { type: "error" });
  }
};

const uploadPhoto = (options: UploadRequestOptions) =>
  uploadPhotoTo(options, key => photoKeys.value.push(key));

const uploadResubmitPhoto = (options: UploadRequestOptions) =>
  uploadPhotoTo(options, key => resubmitPhotoKeys.value.push(key));

const submitApplication = async () => {
  if (!form.value.vehicle_id) {
    message("请选择车辆", { type: "warning" });
    return;
  }
  if (!form.value.fuel_card_id) {
    message("请选择油卡", { type: "warning" });
    return;
  }
  if (form.value.requested_amount <= 0) {
    message("请输入申请额度", { type: "warning" });
    return;
  }
  await createFuelQuotaApplication({
    vehicle_id: form.value.vehicle_id,
    fuel_card_id: form.value.fuel_card_id,
    requested_amount: form.value.requested_amount,
    vehicle_mileage_km: form.value.vehicle_mileage_km,
    photo_keys_json: JSON.stringify(photoKeys.value)
  });
  form.value = {
    vehicle_id: undefined,
    fuel_card_id: undefined,
    requested_amount: 0,
    vehicle_mileage_km: 0
  };
  photoKeys.value = [];
  await loadData();
  message("油卡额度申请已提交", { type: "success" });
};

const openResubmitApplication = (row: FuelQuotaApplication) => {
  resubmitTarget.value = row;
  resubmitForm.value = {
    requested_amount: row.requested_amount,
    vehicle_mileage_km: row.vehicle_mileage_km
  };
  resubmitPhotoKeys.value = [];
  resubmitDialogVisible.value = true;
};

const cancelResubmitApplication = () => {
  resubmitDialogVisible.value = false;
  resubmitTarget.value = null;
  resubmitPhotoKeys.value = [];
};

const resubmitApplication = async () => {
  if (!resubmitTarget.value) return;
  const existingPhotoKeys = parsePhotoKeys(
    resubmitTarget.value.photo_keys_json
  );
  const nextPhotoKeys = Array.from(
    new Set([...existingPhotoKeys, ...resubmitPhotoKeys.value])
  );
  if (nextPhotoKeys.length === 0) {
    message("请先上传补充照片", { type: "warning" });
    return;
  }

  await resubmitFuelQuotaApplication(resubmitTarget.value.id, {
    requested_amount:
      resubmitForm.value.requested_amount ||
      resubmitTarget.value.requested_amount,
    vehicle_mileage_km:
      resubmitForm.value.vehicle_mileage_km ||
      resubmitTarget.value.vehicle_mileage_km,
    photo_keys_json: JSON.stringify(nextPhotoKeys)
  });
  cancelResubmitApplication();
  await loadData();
  message("补充资料已重新提交", { type: "success" });
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
        <span>油卡额度申请</span>
        <el-button @click="loadData">刷新</el-button>
      </div>
    </template>

    <el-alert
      v-if="needsInfoApplications.length > 0"
      type="warning"
      show-icon
      :closable="false"
      style="margin-bottom: 12px"
      :title="`有 ${needsInfoApplications.length} 条油卡申请需要补充资料，请在下方记录中点击重新提交。`"
    />

    <el-form label-width="110px" style="max-width: 720px">
      <el-form-item label="所用车辆">
        <el-select v-model="form.vehicle_id" filterable style="width: 100%">
          <el-option
            v-for="item in vehicles"
            :key="item.id"
            :label="`${item.current_plate_no} (${item.vehicle_uuid})`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="油卡卡号">
        <el-select v-model="form.fuel_card_id" filterable style="width: 100%">
          <el-option
            v-for="item in fuelCards"
            :key="item.id"
            :label="`${item.card_no}（余额: ${item.latest_balance}）`"
            :value="item.id"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="申请额度">
        <el-input-number v-model="form.requested_amount" :min="0" :step="100" />
      </el-form-item>
      <el-form-item label="车辆里程(km)">
        <el-input-number v-model="form.vehicle_mileage_km" :min="0" />
      </el-form-item>
      <el-form-item label="现场照片">
        <el-upload
          drag
          multiple
          :show-file-list="true"
          :http-request="uploadPhoto"
        >
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
      <el-table-column prop="card_no" label="油卡卡号" width="180" />
      <el-table-column label="风险" width="110">
        <template #default="scope">
          <el-tag :type="fuelRiskTagType(scope.row.risk_level)" size="small">
            {{ fuelRiskLabel(scope.row.risk_level) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="risk_summary" label="风险摘要" min-width="180" />
      <el-table-column label="状态" width="130">
        <template #default="scope">
          <el-tag :type="fuelStatusTagType(scope.row.status)" size="small">
            {{ fuelApplicationStatusLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        prop="needs_info_reason"
        label="补充原因"
        min-width="180"
      />
      <el-table-column prop="requested_at" label="申请日期" width="180" />
      <el-table-column prop="processed_by_userid" label="处理人" width="140" />
      <el-table-column prop="processed_at" label="处理时间" width="180" />
      <el-table-column prop="office_remark" label="处理备注" min-width="180" />
      <el-table-column prop="latest_card_balance" label="卡余额" width="120" />
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="scope">
          <el-button
            v-if="scope.row.status === 'needs_info'"
            type="primary"
            link
            @click="openResubmitApplication(scope.row)"
          >
            重新提交
          </el-button>
          <span v-else class="text-gray-400">-</span>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog
    v-model="resubmitDialogVisible"
    title="补充油卡申请资料"
    width="560px"
  >
    <el-alert
      v-if="resubmitTarget?.needs_info_reason"
      type="warning"
      show-icon
      :closable="false"
      style="margin-bottom: 12px"
      :title="resubmitTarget.needs_info_reason"
    />
    <el-form label-width="120px">
      <el-form-item label="申请单">
        <span>{{ resubmitTarget?.application_no || "-" }}</span>
      </el-form-item>
      <el-form-item label="申请额度">
        <el-input-number
          v-model="resubmitForm.requested_amount"
          :min="0"
          :step="100"
        />
      </el-form-item>
      <el-form-item label="车辆里程(km)">
        <el-input-number v-model="resubmitForm.vehicle_mileage_km" :min="0" />
      </el-form-item>
      <el-form-item label="补充照片">
        <el-upload
          drag
          multiple
          :show-file-list="true"
          :http-request="uploadResubmitPhoto"
        >
          <div class="el-upload__text">上传补充照片</div>
        </el-upload>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="cancelResubmitApplication">取消</el-button>
      <el-button type="primary" @click="resubmitApplication">
        提交补充资料
      </el-button>
    </template>
  </el-dialog>
</template>
