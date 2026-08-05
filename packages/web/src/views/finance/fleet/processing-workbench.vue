<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import {
  fuelApplicationStatusLabel,
  fuelRiskLabel,
  fuelRiskTagType
} from "@/utils/enum-labels";
import {
  listFuelQuotaApplications,
  listFuelQuotaRuleHits,
  processFuelQuotaApplication,
  requestFuelQuotaApplicationInfo,
  type FuelQuotaApplication,
  type FuelQuotaRuleHit
} from "@/api/fleet";
import { resolveViewableFileUrl } from "@/api/upload";
import { countPhotoKeys, parsePhotoKeys } from "@/utils/photo-keys";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";

defineOptions({ name: "FleetFuelProcessingWorkbench" });

const loading = ref(false);
const activeQueue = ref<"pending" | "needs_info" | "processed" | "rejected">(
  "pending"
);
const rows = ref<FuelQuotaApplication[]>([]);
const selected = ref<FuelQuotaApplication | null>(null);
const ruleHits = ref<FuelQuotaRuleHit[]>([]);
const photoUrls = ref<string[]>([]);
const photoLoading = ref(false);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();
// 详情区（规则命中 + 照片）共用一个序号，防止快速切换行时旧请求覆盖新选中项
let detailRequestSeq = 0;

const processForm = ref({
  latest_card_balance: 0,
  office_remark: ""
});

const queueRows = computed(() =>
  rows.value.filter(item => item.status === activeQueue.value)
);

const photoCount = (row: FuelQuotaApplication) =>
  countPhotoKeys(row.photo_keys_json);

const resolveUserName = (userid: string | null | undefined) => {
  if (!userid) return "-";
  const matched = wecomUsers.value.find(item => item.userid === userid);
  return matched?.name?.trim() ? `${matched.name} (${userid})` : userid;
};

const loadData = async (options?: { autoSelect?: boolean }) => {
  loading.value = true;
  try {
    const [appResult] = await Promise.all([
      listFuelQuotaApplications(),
      loadWecomUsers()
    ]);
    rows.value = appResult.data;
    if (
      options?.autoSelect !== false &&
      !selected.value &&
      queueRows.value.length > 0
    ) {
      await selectRow(queueRows.value[0]);
    }
  } finally {
    loading.value = false;
  }
};

const refreshData = () => loadData();

const isCurrentDetailRequest = (requestSeq: number, rowId: number) =>
  requestSeq === detailRequestSeq && selected.value?.id === rowId;

const loadRuleHits = async (row: FuelQuotaApplication, requestSeq: number) => {
  const hitResult = await listFuelQuotaRuleHits(row.id);
  if (isCurrentDetailRequest(requestSeq, row.id)) {
    ruleHits.value = hitResult.data;
  }
};

const loadPhotos = async (row: FuelQuotaApplication, requestSeq: number) => {
  const keys = parsePhotoKeys(row.photo_keys_json);
  if (keys.length === 0) {
    if (isCurrentDetailRequest(requestSeq, row.id)) {
      photoUrls.value = [];
      photoLoading.value = false;
    }
    return;
  }

  photoLoading.value = true;
  try {
    const urls = await Promise.all(
      keys.map(key => resolveViewableFileUrl(key))
    );
    if (isCurrentDetailRequest(requestSeq, row.id)) {
      photoUrls.value = urls;
    }
  } finally {
    if (isCurrentDetailRequest(requestSeq, row.id)) {
      photoLoading.value = false;
    }
  }
};

const selectRow = async (row: FuelQuotaApplication) => {
  const requestSeq = ++detailRequestSeq;
  selected.value = row;
  ruleHits.value = [];
  photoUrls.value = [];
  processForm.value = {
    latest_card_balance:
      row.card_latest_balance ?? row.latest_card_balance ?? 0,
    office_remark: row.office_remark || ""
  };
  await Promise.all([
    loadRuleHits(row, requestSeq),
    loadPhotos(row, requestSeq)
  ]);
};

const clearSelected = () => {
  detailRequestSeq += 1;
  selected.value = null;
  ruleHits.value = [];
  photoUrls.value = [];
  photoLoading.value = false;
};

const approveSelected = async () => {
  if (!selected.value) return;
  await processFuelQuotaApplication(selected.value.id, {
    status: "processed",
    fuel_card_id: selected.value.fuel_card_id || undefined,
    latest_card_balance: processForm.value.latest_card_balance,
    office_remark: processForm.value.office_remark
  });
  message("油卡申请已通过", { type: "success" });
  clearSelected();
  await loadData({ autoSelect: false });
};

const rejectSelected = async () => {
  if (!selected.value) return;
  await processFuelQuotaApplication(selected.value.id, {
    status: "rejected",
    fuel_card_id: selected.value.fuel_card_id || undefined,
    office_remark: processForm.value.office_remark
  });
  message("油卡申请已拒绝", { type: "success" });
  clearSelected();
  await loadData({ autoSelect: false });
};

const requestInfoSelected = async () => {
  if (!selected.value) return;
  let reason = "";
  try {
    const result = await ElMessageBox.prompt(
      "请输入需要申请人补充的资料说明",
      "退回补充",
      {
        confirmButtonText: "退回补充",
        cancelButtonText: "取消",
        inputType: "textarea",
        inputPattern: /\S+/,
        inputErrorMessage: "请填写补充说明"
      }
    );
    reason =
      typeof result === "object" && result && "value" in result
        ? String(result.value)
        : "";
  } catch {
    return;
  }
  if (!reason.trim()) return;
  await requestFuelQuotaApplicationInfo(selected.value.id, {
    reason
  });
  message("已退回补充", { type: "success" });
  clearSelected();
  await loadData({ autoSelect: false });
};

const onQueueChange = () => clearSelected();

onMounted(loadData);
</script>

<template>
  <el-card shadow="never" :loading="loading">
    <template #header>
      <div
        style="
          display: flex;
          align-items: center;
          justify-content: space-between;
        "
      >
        <div>
          <div style="font-size: 18px; font-weight: 700">油卡处理工作台</div>
          <div style="font-size: 13px; color: #6b7280">
            办公室处理待办、核对风险、回写余额
          </div>
        </div>
        <el-button type="primary" @click="refreshData">刷新</el-button>
      </div>
    </template>

    <el-tabs v-model="activeQueue" @tab-change="onQueueChange">
      <el-tab-pane label="待处理" name="pending" />
      <el-tab-pane label="待补充" name="needs_info" />
      <el-tab-pane label="已通过" name="processed" />
      <el-tab-pane label="已拒绝" name="rejected" />
    </el-tabs>

    <el-row :gutter="12">
      <el-col :md="16" :xs="24">
        <el-table :data="queueRows" stripe height="560" @row-click="selectRow">
          <el-table-column
            prop="application_no"
            label="申请单号"
            min-width="170"
          />
          <el-table-column label="申请人" width="180">
            <template #default="scope">{{
              resolveUserName(scope.row.applicant_userid)
            }}</template>
          </el-table-column>
          <el-table-column prop="current_plate_no" label="车辆" width="120" />
          <el-table-column prop="requested_amount" label="额度" width="110" />
          <el-table-column label="照片" width="90">
            <template #default="scope">
              <el-tag v-if="photoCount(scope.row) > 0" size="small" type="info">
                {{ photoCount(scope.row) }} 张
              </el-tag>
              <span v-else class="fuel-photo-empty-text">无</span>
            </template>
          </el-table-column>
          <el-table-column label="风险" width="110">
            <template #default="scope">
              <el-tag
                :type="fuelRiskTagType(scope.row.risk_level)"
                size="small"
              >
                {{ fuelRiskLabel(scope.row.risk_level) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="130">
            <template #default="scope">{{
              fuelApplicationStatusLabel(scope.row.status)
            }}</template>
          </el-table-column>
          <el-table-column prop="requested_at" label="申请时间" width="180" />
        </el-table>
      </el-col>

      <el-col :md="8" :xs="24">
        <el-empty v-if="!selected" description="选择一条申请查看详情" />
        <div v-else>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="申请单">{{
              selected.application_no
            }}</el-descriptions-item>
            <el-descriptions-item label="申请人">{{
              resolveUserName(selected.applicant_userid)
            }}</el-descriptions-item>
            <el-descriptions-item label="车辆">{{
              selected.current_plate_no
            }}</el-descriptions-item>
            <el-descriptions-item label="油卡">{{
              selected.card_no || "-"
            }}</el-descriptions-item>
            <el-descriptions-item label="申请额度">{{
              selected.requested_amount
            }}</el-descriptions-item>
            <el-descriptions-item label="里程">{{
              selected.vehicle_mileage_km
            }}</el-descriptions-item>
            <el-descriptions-item label="风险摘要">{{
              selected.risk_summary || "未命中风险规则"
            }}</el-descriptions-item>
          </el-descriptions>

          <el-divider>申请照片</el-divider>
          <el-skeleton v-if="photoLoading" :rows="2" animated />
          <template v-else-if="photoUrls.length > 0">
            <div class="fuel-photo-grid">
              <el-image
                v-for="(url, index) in photoUrls"
                :key="url"
                :src="url"
                :preview-src-list="photoUrls"
                :initial-index="index"
                preview-teleported
                hide-on-click-modal
                fit="cover"
                class="fuel-photo-item"
              >
                <template #error>
                  <div class="fuel-photo-error">加载失败</div>
                </template>
              </el-image>
            </div>
            <div class="fuel-photo-tip">
              共 {{ photoUrls.length }} 张，点击可全屏查看（支持缩放与旋转）
            </div>
          </template>
          <el-empty v-else description="申请人未上传照片" :image-size="60" />

          <el-divider>规则命中</el-divider>
          <el-tag
            v-for="hit in ruleHits"
            :key="hit.id"
            :type="fuelRiskTagType(hit.severity)"
            style="margin: 0 6px 6px 0"
          >
            {{ hit.hit_message }}
          </el-tag>
          <el-empty
            v-if="ruleHits.length === 0"
            description="无规则命中"
            :image-size="60"
          />

          <el-form label-width="100px" style="margin-top: 12px">
            <el-form-item label="处理后余额">
              <el-input-number
                v-model="processForm.latest_card_balance"
                :min="0"
              />
            </el-form-item>
            <el-form-item label="处理备注">
              <el-input
                v-model="processForm.office_remark"
                type="textarea"
                :rows="3"
              />
            </el-form-item>
          </el-form>

          <el-space v-if="selected.status === 'pending'">
            <el-button type="success" @click="approveSelected">通过</el-button>
            <el-button type="warning" @click="requestInfoSelected"
              >退回补充</el-button
            >
            <el-button type="danger" @click="rejectSelected">拒绝</el-button>
          </el-space>
        </div>
      </el-col>
    </el-row>
  </el-card>
</template>

<style scoped>
.fuel-photo-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.fuel-photo-item {
  width: 100%;
  height: 96px;
  cursor: zoom-in;
  background: #f5f7fa;
  border: 1px solid #ebeef5;
  border-radius: 4px;
}

.fuel-photo-error {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 12px;
  color: #909399;
}

.fuel-photo-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}

.fuel-photo-empty-text {
  color: #c0c4cc;
}
</style>
