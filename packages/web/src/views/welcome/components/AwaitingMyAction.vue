<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { listApprovalInstances, type ApprovalInstance } from "@/api/approval";
import { toBizTypeLabel } from "@/views/approval/labels";
import { resolveBizEditRoute } from "@/views/approval/biz-edit-routes";

defineOptions({ name: "AwaitingMyAction" });

const emit = defineEmits<{ (e: "count", value: number): void }>();

const router = useRouter();
const loading = ref(false);
const items = ref<ApprovalInstance[]>([]);
const total = ref(0);

const load = async () => {
  loading.value = true;
  try {
    const result = await listApprovalInstances({
      initiator: "me",
      initiatedBucket: "returned_needs_action",
      page: 1,
      pageSize: 10
    });
    items.value = result.data || [];
    total.value = result.pagination?.total ?? items.value.length;
    emit("count", total.value);
  } finally {
    loading.value = false;
  }
};

const canEditBiz = (item: ApprovalInstance) =>
  resolveBizEditRoute(item.biz_type, item.biz_id, item.biz_summary) !== null;

const goEditBiz = (item: ApprovalInstance) => {
  const route = resolveBizEditRoute(
    item.biz_type,
    item.biz_id,
    item.biz_summary
  );
  if (route) {
    router.push(route);
    return;
  }
  router.push(`/approval/detail/${item.id}`);
};

const goApprovalDetail = (item: ApprovalInstance) => {
  router.push(`/approval/detail/${item.id}`);
};

onMounted(load);

defineExpose({ reload: load });
</script>

<template>
  <el-card
    v-loading="loading"
    shadow="never"
    class="workspace-card awaiting-card"
  >
    <template #header>
      <div class="card-header card-header--with-action">
        <span class="awaiting-card__title">
          等待我处理（被退回 {{ total }}）
        </span>
        <el-button
          link
          type="primary"
          @click="router.push('/workspace/my-applications')"
        >
          查看我的申请
        </el-button>
      </div>
    </template>

    <el-empty
      v-if="!items.length"
      description="没有等待处理的退回单据"
      :image-size="72"
    />
    <el-table v-else :data="items" stripe size="small">
      <el-table-column prop="instance_no" label="审批单号" min-width="160" />
      <el-table-column label="业务类型" width="120">
        <template #default="scope">{{
          toBizTypeLabel(scope.row.biz_type)
        }}</template>
      </el-table-column>
      <el-table-column prop="biz_summary" label="摘要" min-width="200" />
      <el-table-column prop="last_updated_at" label="退回时间" width="170">
        <template #default="scope">{{
          scope.row.last_updated_at || scope.row.updated_at
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="scope">
          <el-button
            v-if="canEditBiz(scope.row)"
            link
            type="danger"
            @click="goEditBiz(scope.row)"
            >去修改</el-button
          >
          <el-button link type="primary" @click="goApprovalDetail(scope.row)"
            >审批详情</el-button
          >
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<style scoped>
.awaiting-card__title {
  color: #f56c6c;
  font-weight: 600;
}
</style>
