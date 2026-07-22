<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  deleteDraft,
  listDrafts,
  type ContractDraft
} from "@/api/contract-draft";
import {
  draftStatusLabelMap,
  draftStatusTagType,
  familyLabelMap
} from "../draft-labels";

const emit = defineEmits<{
  (e: "open", id: number): void;
}>();

const drafts = ref<ContractDraft[]>([]);
const loading = ref(false);

const load = async () => {
  loading.value = true;
  try {
    drafts.value = await listDrafts();
  } catch {
    ElMessage.error("历史草稿加载失败，请刷新重试");
  } finally {
    loading.value = false;
  }
};

/** ISO 时间截取到分钟展示 */
const formatMinute = (iso: string): string =>
  iso ? iso.replace("T", " ").slice(0, 16) : "—";

const deletable = (row: ContractDraft): boolean =>
  ["drafting", "finalized"].includes(row.status);

const onDelete = async (row: ContractDraft) => {
  try {
    await ElMessageBox.confirm(
      `确认删除草稿「${row.title}」吗？删除后不可在列表继续编辑。`,
      "删除草稿",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" }
    );
  } catch {
    return; // 用户取消
  }
  try {
    await deleteDraft(row.id);
    ElMessage.success("已删除");
  } catch {
    ElMessage.error("删除失败，请重试");
    return;
  }
  await load();
};

onMounted(load);
</script>

<template>
  <el-card class="draft-list-card">
    <template #header>
      <div class="list-header">
        <span>历史草稿</span>
        <el-button size="small" link type="primary" @click="load"
          >刷新</el-button
        >
      </div>
    </template>
    <el-table v-loading="loading" :data="drafts" size="default">
      <el-table-column
        prop="title"
        label="标题"
        min-width="220"
        show-overflow-tooltip
      />
      <el-table-column label="类型" width="140">
        <template #default="{ row }">
          {{ familyLabelMap[row.family] ?? row.family }}
        </template>
      </el-table-column>
      <el-table-column label="立场" width="100">
        <template #default="{ row }">
          {{ row.direction === "inbound" ? "对甲方" : "对分包商" }}
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <el-tag size="small" :type="draftStatusTagType[row.status] ?? 'info'">
            {{ draftStatusLabelMap[row.status] ?? row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="更新时间" width="150">
        <template #default="{ row }">
          {{ formatMinute(row.updated_at) }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            size="small"
            @click="emit('open', row.id)"
            >继续编辑</el-button
          >
          <el-tooltip
            :disabled="deletable(row)"
            content="已转正式合同的草稿作为溯源依据保留，不可删除"
            placement="top"
          >
            <span>
              <el-button
                link
                type="danger"
                size="small"
                :disabled="!deletable(row)"
                @click="onDelete(row)"
                >删除</el-button
              >
            </span>
          </el-tooltip>
        </template>
      </el-table-column>
    </el-table>
  </el-card>
</template>

<style scoped>
.draft-list-card {
  margin-top: 12px;
}

.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
