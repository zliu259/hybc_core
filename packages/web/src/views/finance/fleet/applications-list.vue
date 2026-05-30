<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessageBox, ElMessage } from "element-plus";
import {
  listFuelQuotaApplications,
  voidFuelQuotaApplication,
  type FuelQuotaApplication
} from "@/api/fleet";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import { fuelApplicationStatusLabel } from "@/utils/enum-labels";

defineOptions({ name: "FuelQuotaApplicationAllList" });

const loading = ref(false);
const status = ref<string | undefined>(undefined);
const rows = ref<FuelQuotaApplication[]>([]);
const { wecomUsers, loadWecomUsers } = useWecomUserOptions();

const userStore = useUserStoreHook();
const roleSet = computed(() => new Set(userStore.roles ?? []));
const isSuperAdmin = computed(() => roleSet.value.has("super_admin"));

const canVoidApplication = (row: FuelQuotaApplication) =>
  row.status === "pending" || row.status === "needs_info";

const fuelStatusType = (
  value: string
): "warning" | "success" | "danger" | "info" => {
  if (value === "pending") return "warning";
  if (value === "needs_info") return "danger";
  if (value === "processed") return "success";
  if (value === "rejected") return "danger";
  return "info";
};

const resolveUserName = (userid: string | null | undefined) => {
  if (!userid) return "-";
  const matched = wecomUsers.value.find(item => item.userid === userid);
  return matched?.name?.trim() ? `${matched.name} (${userid})` : userid;
};

const loadData = async () => {
  loading.value = true;
  try {
    const [result] = await Promise.all([
      listFuelQuotaApplications({ status: status.value }),
      loadWecomUsers()
    ]);
    rows.value = result.data;
  } finally {
    loading.value = false;
  }
};

const voidingId = ref<number | null>(null);

const handleVoid = async (row: FuelQuotaApplication) => {
  try {
    await ElMessageBox.confirm(
      `确认废除申请单 ${row.application_no}？废除后该申请将不再参与后续处理。`,
      "废除油卡额度申请",
      {
        confirmButtonText: "确认废除",
        cancelButtonText: "取消",
        type: "warning"
      }
    );
  } catch {
    return;
  }

  voidingId.value = row.id;
  try {
    await voidFuelQuotaApplication(row.id);
    ElMessage.success("申请已废除");
    await loadData();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "废除失败";
    ElMessage.error(msg);
  } finally {
    voidingId.value = null;
  }
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
        <span>油卡申请全量记录</span>
        <el-space>
          <el-select
            v-model="status"
            clearable
            placeholder="全部状态"
            style="width: 140px"
            @change="loadData"
          >
            <el-option label="待处理" value="pending" />
            <el-option label="待补充资料" value="needs_info" />
            <el-option label="已处理" value="processed" />
            <el-option label="已拒绝" value="rejected" />
            <el-option label="已废除" value="cancelled" />
          </el-select>
          <el-button type="primary" @click="loadData">刷新</el-button>
        </el-space>
      </div>
    </template>

    <el-table :data="rows" stripe>
      <el-table-column prop="application_no" label="申请单号" min-width="170" />
      <el-table-column label="申请人" width="180">
        <template #default="scope">{{
          resolveUserName(scope.row.applicant_userid)
        }}</template>
      </el-table-column>
      <el-table-column prop="current_plate_no" label="车辆" width="120" />
      <el-table-column prop="requested_amount" label="申请额度" width="120" />
      <el-table-column label="状态" width="120">
        <template #default="scope">
          <el-tag :type="fuelStatusType(scope.row.status)" size="small">
            {{ fuelApplicationStatusLabel(scope.row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="processed_at" label="处理时间" width="180" />
      <el-table-column label="处理人" width="180">
        <template #default="scope">{{
          resolveUserName(scope.row.processed_by_userid)
        }}</template>
      </el-table-column>
      <el-table-column
        prop="latest_card_balance"
        label="处理后余额"
        width="120"
      />
      <el-table-column prop="office_remark" label="处理备注" min-width="220" />
      <el-table-column prop="requested_at" label="申请时间" width="180" />
      <el-table-column
        v-if="isSuperAdmin"
        label="操作"
        width="100"
        fixed="right"
      >
        <template #default="scope">
          <el-button
            v-if="canVoidApplication(scope.row)"
            type="danger"
            size="small"
            text
            :loading="voidingId === scope.row.id"
            @click="handleVoid(scope.row)"
          >
            废除
          </el-button>
          <span v-else class="text-gray-400">-</span>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>
