<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import {
  listCcApprovals,
  listPendingApprovals,
  listProcessedApprovals,
  type ApprovalInstance,
  type PendingApprovalItem,
  type ProcessedApprovalItem
} from "@/api/approval";
import BellIcon from "~icons/ep/bell";

type NoticeItem = {
  id: number;
  title: string;
  description: string;
  datetime: string;
  extra?: string;
  status?: "primary" | "success" | "warning" | "info" | "danger";
};

type NoticeTab = {
  key: string;
  name: string;
  list: NoticeItem[];
  emptyText: string;
};

const router = useRouter();
const loading = ref(false);
const activeKey = ref("todo");
const notices = ref<NoticeTab[]>([
  { key: "notice", name: "通知", list: [], emptyText: "暂无通知" },
  { key: "message", name: "消息", list: [], emptyText: "暂无消息" },
  { key: "todo", name: "待办", list: [], emptyText: "暂无待办" }
]);

const formatTime = (raw?: string | null) => {
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const mapPending = (rows: PendingApprovalItem[]): NoticeItem[] =>
  rows.map(item => ({
    id: item.id,
    title: item.instance_no,
    description: item.biz_summary,
    datetime: formatTime(item.submitted_at),
    extra: item.current_node_name || "待处理",
    status: "warning"
  }));

const mapProcessed = (rows: ProcessedApprovalItem[]): NoticeItem[] =>
  rows.map(item => ({
    id: item.id,
    title: item.instance_no,
    description: item.biz_summary,
    datetime: formatTime(item.acted_at || item.submitted_at),
    extra: item.action || "processed",
    status: "success"
  }));

const mapCc = (rows: ApprovalInstance[]): NoticeItem[] =>
  rows.map(item => ({
    id: item.id,
    title: item.instance_no,
    description: item.biz_summary,
    datetime: formatTime(item.submitted_at),
    extra: "抄送",
    status: "info"
  }));

const loadData = async () => {
  loading.value = true;
  try {
    const [todoRes, messageRes, noticeRes] = await Promise.all([
      listPendingApprovals({ page: 1, pageSize: 20 }),
      listProcessedApprovals({ page: 1, pageSize: 20 }),
      listCcApprovals({ page: 1, pageSize: 20 })
    ]);

    notices.value = [
      {
        key: "notice",
        name: "通知",
        list: mapCc(noticeRes.data),
        emptyText: "暂无通知"
      },
      {
        key: "message",
        name: "消息",
        list: mapProcessed(messageRes.data),
        emptyText: "暂无消息"
      },
      {
        key: "todo",
        name: "待办",
        list: mapPending(todoRes.data),
        emptyText: "暂无待办"
      }
    ];
  } finally {
    loading.value = false;
  }
};

const noticesNum = computed(() => notices.value.reduce((sum, tab) => sum + tab.list.length, 0));
const getLabel = (item: NoticeTab) =>
  `${item.name}${item.list.length > 0 ? `(${item.list.length})` : ""}`;

const onOpen = (visible: boolean) => {
  if (visible) {
    void loadData();
  }
};

const openDetail = (id: number) => {
  router.push(`/approval/detail/${id}`);
};
</script>

<template>
  <el-dropdown trigger="click" placement="bottom-end" @visible-change="onOpen">
    <span
      :class="[
        'dropdown-badge',
        'navbar-bg-hover',
        'select-none',
        Number(noticesNum) !== 0 && 'mr-[10px]'
      ]"
    >
      <el-badge :value="Number(noticesNum) === 0 ? '' : noticesNum" :max="99">
        <span class="header-notice-icon">
          <IconifyIconOffline :icon="BellIcon" />
        </span>
      </el-badge>
    </span>
    <template #dropdown>
      <el-dropdown-menu>
        <el-tabs
          v-model="activeKey"
          :stretch="true"
          v-loading="loading"
          class="dropdown-tabs"
          :style="{ width: notices.length === 0 ? '200px' : '330px' }"
        >
          <el-empty
            v-if="notices.length === 0"
            description="暂无消息"
            :image-size="60"
          />
          <span v-else>
            <template v-for="item in notices" :key="item.key">
              <el-tab-pane :label="getLabel(item)" :name="`${item.key}`">
                <el-scrollbar max-height="330px">
                  <div class="noticeList-container">
                    <template v-if="item.list.length === 0">
                      <el-empty :description="item.emptyText" />
                    </template>
                    <template v-else>
                      <div
                        v-for="notice in item.list"
                        :key="notice.id"
                        class="notice-item"
                        @click="openDetail(notice.id)"
                      >
                        <div class="notice-item-title">
                          <span>{{ notice.title }}</span>
                          <el-tag v-if="notice.extra" size="small" :type="notice.status">
                            {{ notice.extra }}
                          </el-tag>
                        </div>
                        <div class="notice-item-desc">{{ notice.description }}</div>
                        <div class="notice-item-time">{{ notice.datetime }}</div>
                      </div>
                    </template>
                  </div>
                </el-scrollbar>
              </el-tab-pane>
            </template>
          </span>
        </el-tabs>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style lang="scss" scoped>
.dropdown-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 48px;
  cursor: pointer;

  .header-notice-icon {
    font-size: 18px;
  }
}

.dropdown-tabs {
  .noticeList-container {
    padding: 15px 24px 0;

    .notice-item {
      padding: 10px 0;
      border-bottom: 1px solid #f0f0f0;
      cursor: pointer;

      &:last-child {
        border-bottom: none;
      }
    }

    .notice-item-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 13px;
      color: #1f2d3d;
    }

    .notice-item-desc {
      margin-top: 4px;
      font-size: 12px;
      color: #606266;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .notice-item-time {
      margin-top: 2px;
      font-size: 12px;
      color: #909399;
    }
  }

  :deep(.el-tabs__header) {
    margin: 0;
  }

  :deep(.el-tabs__nav-wrap)::after {
    height: 1px;
  }

  :deep(.el-tabs__nav-wrap) {
    padding: 0 36px;
  }
}
</style>
