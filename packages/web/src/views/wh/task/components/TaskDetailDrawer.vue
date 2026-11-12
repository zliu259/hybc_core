<script setup lang="ts">
import { ElMessageBox, type MessageBoxInputData } from "element-plus";
import { computed, ref, watch } from "vue";

import { resolveViewableFileUrl, uploadAttachmentFile } from "@/api/upload";
import {
  addTaskPhoto,
  assignTask,
  cancelTask,
  confirmTask,
  getTask,
  removeTaskPhoto,
  sendBackTask,
  submitTask,
  type SubmitTaskInput
} from "@/api/wh/task";
import type { TaskDetail, TaskSystem } from "@/api/wh/types";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import { formatTime } from "../../shared/ids";
import {
  TASK_KIND_LABELS,
  TASK_SYSTEM_LABELS,
  taskStatusLabel
} from "../../shared/labels";
import {
  beijingToday,
  isConflictError,
  isOverdue,
  taskActions
} from "../task-view";
import AssignDialog from "./AssignDialog.vue";
import DeviceDocsCard from "../../doc-library/components/DeviceDocsCard.vue";
import SubmitPanel from "./SubmitPanel.vue";

const props = defineProps<{ taskId: number | null; isKeeper: boolean }>();
const visible = defineModel<boolean>({ required: true });
const emit = defineEmits<{ changed: [] }>();

const userStore = useUserStoreHook();
const { userNameOf, loadUserNames } = useWecomUserOptions();
const task = ref<TaskDetail | null>(null);
const photoUrls = ref<Record<number, string>>({});
const busy = ref(false);
const uploading = ref(false);
const assignOpen = ref(false);

const actions = computed(() =>
  task.value
    ? taskActions(task.value, {
        userid: userStore.username || "",
        isKeeper: props.isKeeper
      })
    : null
);
const missingPhotos = computed(() =>
  task.value
    ? Math.max(0, task.value.required_photo_count - task.value.photos.length)
    : 0
);
const previewList = computed(() =>
  (task.value?.photos ?? []).map(p => photoUrls.value[p.id]).filter(Boolean)
);
const systemsText = computed(() => {
  const raw = task.value?.systems_json;
  if (!raw) return "";
  try {
    const list = JSON.parse(raw) as TaskSystem[];
    return list.map(item => TASK_SYSTEM_LABELS[item] ?? item).join("、");
  } catch {
    return raw;
  }
});

const loadPhotoUrls = async (detail: TaskDetail) => {
  const entries = await Promise.all(
    detail.photos.map(
      async p => [p.id, await resolveViewableFileUrl(p.file_key)] as const
    )
  );
  photoUrls.value = Object.fromEntries(entries);
};

const load = async () => {
  if (!props.taskId) return;
  try {
    const detail = (await getTask(props.taskId)).data;
    task.value = detail;
    void loadPhotoUrls(detail);
  } catch (error) {
    message(resolveApiErrorMessage(error, "任务加载失败"), { type: "error" });
  }
};

watch(visible, open => {
  if (!open) return;
  task.value = null;
  photoUrls.value = {};
  void loadUserNames();
  void load();
});

/** 所有写操作走这里：成功后刷新；409 说明别人先改了，提示后重新加载。 */
const act = async <T,>(
  action: () => Promise<T>,
  success?: (result: T) => string
): Promise<T | undefined> => {
  busy.value = true;
  try {
    const result = await action();
    if (success) message(success(result), { type: "success" });
    emit("changed");
    await load();
    return result;
  } catch (error) {
    if (isConflictError(error)) {
      message("数据已变化，请刷新后重试", { type: "warning" });
      await load();
    } else {
      message(resolveApiErrorMessage(error, "操作失败，请稍后重试"), {
        type: "error"
      });
    }
    return undefined;
  } finally {
    busy.value = false;
  }
};

const upload = async (options: { file: File }) => {
  if (!task.value) return;
  const id = task.value.id;
  uploading.value = true;
  try {
    const uploaded = await uploadAttachmentFile(options.file, "wh-task");
    await act(() => addTaskPhoto(id, uploaded.file_key));
  } catch (error) {
    message(resolveApiErrorMessage(error, "照片上传失败"), { type: "error" });
  } finally {
    uploading.value = false;
  }
};

const removePhoto = (photoId: number) => {
  if (!task.value) return;
  const id = task.value.id;
  void act(
    () => removeTaskPhoto(id, photoId),
    () => "照片已删除"
  );
};

const submit = (data: Omit<SubmitTaskInput, "version">) => {
  if (!task.value) return;
  const { id, version } = task.value;
  void act(
    () => submitTask(id, { ...data, version }),
    result =>
      result.data.status === "done"
        ? result.data.followup_task_id
          ? "已完成，已生成维修任务"
          : "已完成"
        : "已提交，等库管确认"
  );
};

const assign = async (userid: string) => {
  if (!task.value) return;
  const { id, version } = task.value;
  const result = await act(
    () => assignTask(id, { version, assignee_userid: userid }),
    () => `已派给 ${userNameOf(userid)}`
  );
  if (result) assignOpen.value = false;
};

const confirm = () => {
  if (!task.value) return;
  const { id, version } = task.value;
  void act(
    () => confirmTask(id, version),
    result =>
      result.data.followup_task_id ? "已确认完成，已生成维修任务" : "已确认完成"
  );
};

const askText = async (title: string, label: string, empty: string) => {
  try {
    // prompt 的类型是 MessageBoxInputData | Action；确定时只会给前者，取消走 reject
    const { value } = (await ElMessageBox.prompt(label, title, {
      inputType: "textarea",
      inputValidator: (text: string) => Boolean(text?.trim()) || empty,
      confirmButtonText: "确定",
      cancelButtonText: "取消"
    })) as MessageBoxInputData;
    return value.trim();
  } catch {
    return null;
  }
};

const sendBack = async () => {
  if (!task.value) return;
  const { id, version } = task.value;
  const note = await askText(
    "退回补充",
    "告诉执行人还要补什么：",
    "必须写退回要求"
  );
  if (note === null) return;
  void act(
    () => sendBackTask(id, { version, review_note: note }),
    () => "已退回"
  );
};

const cancel = async () => {
  if (!task.value) return;
  const { id, version } = task.value;
  const reason = await askText("取消任务", "取消原因：", "必须写取消原因");
  if (reason === null) return;
  void act(
    () => cancelTask(id, { version, reason }),
    () => "任务已取消"
  );
};
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="task ? `${task.task_no} ${task.title}` : '任务'"
    size="720px"
  >
    <div v-if="task" v-loading="busy">
      <el-alert
        v-if="task.review_note && task.status === 'todo'"
        :title="`退回要求：${task.review_note}`"
        type="error"
        show-icon
        :closable="false"
        class="review"
      />
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="类型">{{
          TASK_KIND_LABELS[task.kind]
        }}</el-descriptions-item>
        <el-descriptions-item label="状态">{{
          taskStatusLabel(task)
        }}</el-descriptions-item>
        <el-descriptions-item label="设备">
          <router-link
            v-if="task.device_id"
            :to="`/wh/device/${task.device_id}`"
            class="link"
            >{{ task.device_code }} {{ task.device_name }}</router-link
          >
          <span v-else>-</span>
        </el-descriptions-item>
        <el-descriptions-item label="执行人">{{
          userNameOf(task.assignee_userid, "未派工")
        }}</el-descriptions-item>
        <el-descriptions-item label="期限">
          <span :class="{ overdue: isOverdue(task, beijingToday()) }">{{
            task.due_date ?? "-"
          }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="挡住发出">{{
          task.blocking ? "是" : "否"
        }}</el-descriptions-item>
        <el-descriptions-item label="说明" :span="2">{{
          task.description ?? "-"
        }}</el-descriptions-item>
        <el-descriptions-item v-if="task.result" label="检查结果">{{
          task.result === "pass" ? "合格" : "不合格"
        }}</el-descriptions-item>
        <el-descriptions-item v-if="systemsText" label="涉及系统">{{
          systemsText
        }}</el-descriptions-item>
        <el-descriptions-item v-if="task.result_note" label="简报" :span="2">{{
          task.result_note
        }}</el-descriptions-item>
        <el-descriptions-item
          v-if="task.cancel_reason"
          label="取消原因"
          :span="2"
          >{{ task.cancel_reason }}</el-descriptions-item
        >
        <el-descriptions-item v-if="task.done_at" label="完成时间">{{
          formatTime(task.done_at)
        }}</el-descriptions-item>
      </el-descriptions>

      <template v-if="task.device_id">
        <div class="section-title">适用资料</div>
        <DeviceDocsCard
          :device-id="task.device_id"
          :task-kind="task.kind"
          compact
        />
      </template>

      <div class="section-title">
        照片 {{ task.photos.length }}
        <template v-if="task.required_photo_count > 0"
          >/ 要求 {{ task.required_photo_count }}</template
        >
      </div>
      <div class="photos">
        <div v-for="(p, index) in task.photos" :key="p.id" class="photo">
          <el-image
            :src="photoUrls[p.id]"
            :preview-src-list="previewList"
            :initial-index="index"
            fit="cover"
            preview-teleported
            class="thumb"
          />
          <el-button
            v-if="
              actions?.canWork && p.uploaded_by_userid === userStore.username
            "
            link
            type="danger"
            size="small"
            @click="removePhoto(p.id)"
            >删除</el-button
          >
        </div>
        <el-upload
          v-if="actions?.canWork"
          :show-file-list="false"
          accept="image/*"
          :http-request="upload"
          multiple
        >
          <el-button :loading="uploading">上传照片</el-button>
        </el-upload>
        <span v-if="task.photos.length === 0 && !actions?.canWork" class="muted"
          >没有照片</span
        >
      </div>

      <SubmitPanel
        v-if="actions?.canWork"
        :kind="task.kind"
        :task-id="task.id"
        :missing-photos="missingPhotos"
        :busy="busy"
        @submit="submit"
      />

      <div
        v-if="
          actions &&
          (actions.canAssign || actions.canReview || actions.canCancel)
        "
        class="keeper-actions"
      >
        <el-button v-if="actions.canAssign" @click="assignOpen = true">{{
          task.assignee_userid ? "改派" : "派工"
        }}</el-button>
        <el-button v-if="actions.canReview" @click="sendBack"
          >退回补充</el-button
        >
        <el-button v-if="actions.canReview" type="primary" @click="confirm"
          >确认完成</el-button
        >
        <el-button v-if="actions.canCancel" type="danger" plain @click="cancel"
          >取消任务</el-button
        >
      </div>
    </div>
    <AssignDialog
      v-model="assignOpen"
      :current="task?.assignee_userid ?? null"
      :busy="busy"
      @confirm="assign"
    />
  </el-drawer>
</template>

<style scoped>
.review {
  margin-bottom: 12px;
}

.link {
  color: var(--el-color-primary);
}

.overdue {
  font-weight: 600;
  color: var(--el-color-danger);
}

.section-title {
  margin: 16px 0 8px;
  font-weight: 600;
}

.photos {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-start;
}

.photo {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.thumb {
  width: 96px;
  height: 96px;
  border-radius: 4px;
}

.muted {
  color: var(--el-text-color-secondary);
}

.keeper-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
