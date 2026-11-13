<script setup lang="ts">
import { ElMessageBox, type MessageBoxInputData } from "element-plus";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";

import {
  closeKit,
  confirmKit,
  discardKit,
  getKit,
  getKitFulfilment,
  submitKit,
  updateKit
} from "@/api/wh/kit";
import type { KitFulfilmentLine, ProjectKitDetail } from "@/api/wh/kit-types";
import { listDeviceCategories } from "@/api/wh/settings";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useUserStoreHook } from "@/store/modules/user";
import { resolveApiErrorMessage } from "@/utils/api-error";
import { message } from "@/utils/message";
import { formatTime } from "../shared/ids";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import { isConflictError } from "../task/task-view";
import DocFormDialog from "../doc/components/DocFormDialog.vue";
import KitLineTable from "./components/KitLineTable.vue";
import KitPlanSummary from "./components/KitPlanSummary.vue";
import {
  editableFromKit,
  kitActions,
  kitLineProblems,
  KIT_STATUS_LABELS,
  saveThen,
  KIT_STATUS_TAG,
  toKitLines,
  type EditableKitLine
} from "./kit-view";

defineOptions({ name: "WhKitDetail" });

const route = useRoute();
const router = useRouter();
const userStore = useUserStoreHook();
const { caps, load: loadCaps } = useWhCapabilities();
const { userNameOf, loadUserNames } = useWecomUserOptions();

const kitId = computed(() => Number(route.params.id));
const kit = ref<ProjectKitDetail | null>(null);
const lines = ref<EditableKitLine[]>([]);
const fulfilment = ref<KitFulfilmentLine[] | undefined>(undefined);
const categories = ref<{ id: number; name: string }[]>([]);
const title = ref("");
const remark = ref("");
const busy = ref(false);
const triedSubmit = ref(false);
const shipOpen = ref(false);

const shipKit = computed(() =>
  kit.value && fulfilment.value
    ? {
        id: kit.value.id,
        kit_no: kit.value.kit_no,
        project_id: kit.value.project_id,
        fulfilment: fulfilment.value
      }
    : undefined
);

const actions = computed(() =>
  kit.value
    ? kitActions(kit.value, {
        userid: userStore.username || "",
        roles: userStore.roles ?? [],
        caps: caps.value
      })
    : null
);
const problems = computed(() =>
  triedSubmit.value
    ? kitLineProblems(
        lines.value.map(line => ({
          line_kind: line.line_kind,
          material_id: line.material_id,
          name_text: line.name_text,
          planned_qty: line.qty ?? 0
        }))
      )
    : []
);

const load = async () => {
  try {
    const detail = (await getKit(kitId.value)).data;
    kit.value = detail;
    lines.value = editableFromKit(detail.lines);
    title.value = detail.title;
    remark.value = detail.remark ?? "";
    fulfilment.value =
      detail.status === "confirmed" || detail.status === "closed"
        ? (await getKitFulfilment(kitId.value)).data
        : undefined;
  } catch (error) {
    message(resolveApiErrorMessage(error, "清单加载失败"), { type: "error" });
  }
};

/** 写操作统一：成功提示并刷新；409（别人先改了、或项目没结清）提示后端的话并刷新。 */
const act = async <T,>(
  action: () => Promise<T>,
  success?: string
): Promise<T | undefined> => {
  busy.value = true;
  try {
    const result = await action();
    if (success) message(success, { type: "success" });
    await load();
    return result;
  } catch (error) {
    message(resolveApiErrorMessage(error, "操作失败，请稍后重试"), {
      type: isConflictError(error) ? "warning" : "error"
    });
    if (isConflictError(error)) await load();
    return undefined;
  } finally {
    busy.value = false;
  }
};

const payload = () => ({
  title: title.value.trim(),
  remark: remark.value.trim() || null,
  lines: toKitLines(lines.value)
});

const save = () => {
  if (!kit.value) return;
  const { id, version } = kit.value;
  void act(() => updateKit(id, { version, ...payload() }), "已保存");
};

const scrollToProblem = async () => {
  await nextTick();
  document
    .querySelector(".problem-row")
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
};

/** 把表格里的改动存下；成功后 kit 已重新加载，版本号是新的。 */
const saveTable = async (): Promise<boolean> => {
  if (!kit.value) return false;
  const { id, version } = kit.value;
  return (
    (await act(() => updateKit(id, { version, ...payload() }))) !== undefined
  );
};

/** 提交和确认前先查行：有没选规格等问题就标红并停下。 */
const blockedByProblems = async (): Promise<boolean> => {
  triedSubmit.value = true;
  if (problems.value.length === 0) return false;
  message(`有 ${problems.value.length} 行要先处理`, { type: "warning" });
  await scrollToProblem();
  return true;
};

const submit = async () => {
  if (!kit.value || (await blockedByProblems())) return;
  const id = kit.value.id;
  // 先把表格里的改动存下，再用新版本号提交
  const result = await saveThen(
    Boolean(actions.value?.canEdit),
    saveTable,
    () => act(() => submitKit(id, kit.value!.version))
  );
  if (result)
    message(
      result.data.status === "confirmed"
        ? "已提交并确认"
        : "已提交，等库管确认",
      {
        type: "success"
      }
    );
};

const confirm = async () => {
  if (!kit.value) return;
  const editable = Boolean(actions.value?.canEdit);
  if (editable && (await blockedByProblems())) return;
  const id = kit.value.id;
  // 库管在待确认的清单上改过数量再点确认：先保存，改动不会被丢掉
  await saveThen(editable, saveTable, () =>
    act(() => confirmKit(id, kit.value!.version), "清单已确认")
  );
};

const discard = async () => {
  if (!kit.value) return;
  const { id, version } = kit.value;
  let reason: string;
  try {
    // prompt 的类型是 MessageBoxInputData | Action；确定时只会给前者，取消走 reject
    ({ value: reason } = (await ElMessageBox.prompt("作废原因：", "作废清单", {
      inputType: "textarea",
      inputValidator: (text: string) =>
        Boolean(text?.trim()) || "必须写作废原因",
      confirmButtonText: "作废",
      cancelButtonText: "取消"
    })) as MessageBoxInputData);
  } catch {
    return;
  }
  void act(() => discardKit(id, version, reason.trim()), "清单已作废");
};

const close = async () => {
  if (!kit.value) return;
  const { id, version } = kit.value;
  try {
    await ElMessageBox.confirm(
      "关闭后这份清单只能查看。项目要先结清（设备都离场、周转件都退回或报损）。",
      "关闭清单",
      {
        type: "warning",
        confirmButtonText: "关闭",
        cancelButtonText: "取消"
      }
    );
  } catch {
    return;
  }
  void act(() => closeKit(id, version), "清单已关闭");
};

// 从一份清单跳到另一份时路由只换参数、页面不重建，要自己重新加载
watch(kitId, () => {
  triedSubmit.value = false;
  shipOpen.value = false;
  void load();
});

onMounted(async () => {
  void loadUserNames();
  await loadCaps();
  await load();
  try {
    categories.value = (await listDeviceCategories()).data.filter(
      c => c.status === "active"
    );
  } catch (error) {
    console.error("[warehouse] 读取设备类别失败", error);
  }
});
</script>

<template>
  <el-card v-loading="busy" shadow="never">
    <template v-if="kit">
      <div class="head">
        <div class="title-line">
          <span class="kit-no">{{ kit.kit_no }}</span>
          <el-tag :type="KIT_STATUS_TAG[kit.status]">{{
            KIT_STATUS_LABELS[kit.status]
          }}</el-tag>
          <el-tag
            v-if="kit.status === 'closed' && kit.close_reason"
            type="danger"
            >作废</el-tag
          >
        </div>
        <div class="actions">
          <el-button @click="router.push(`/wh/kit/project/${kit.project_id}`)"
            >项目物资</el-button
          >
          <el-button
            v-if="actions?.canDiscard"
            type="danger"
            plain
            @click="discard"
            >作废</el-button
          >
          <el-button v-if="actions?.canEdit" @click="save">保存</el-button>
          <el-button v-if="actions?.canSubmit" type="primary" @click="submit"
            >提交</el-button
          >
          <el-button v-if="actions?.canConfirm" type="primary" @click="confirm"
            >确认</el-button
          >
          <el-button v-if="actions?.canClose" @click="close"
            >关闭清单</el-button
          >
          <el-button
            v-if="actions?.canShip && shipKit"
            type="primary"
            @click="shipOpen = true"
            >按清单发货</el-button
          >
        </div>
      </div>
      <el-descriptions :column="3" border size="small" class="info">
        <el-descriptions-item label="项目">{{
          kit.project_name
        }}</el-descriptions-item>
        <el-descriptions-item label="标题">
          <el-input v-if="actions?.canEdit" v-model="title" maxlength="60" />
          <span v-else>{{ kit.title }}</span>
        </el-descriptions-item>
        <el-descriptions-item label="来源">{{
          kit.template_name
            ? `模板：${kit.template_name}`
            : kit.copied_from_kit_id
              ? "复制"
              : "空白"
        }}</el-descriptions-item>
        <el-descriptions-item label="创建"
          >{{ userNameOf(kit.created_by_userid) }} ·
          {{ formatTime(kit.created_at) }}</el-descriptions-item
        >
        <el-descriptions-item label="提交">{{
          kit.submitted_by_userid
            ? `${userNameOf(kit.submitted_by_userid)} · ${formatTime(kit.submitted_at)}`
            : "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="确认">{{
          kit.confirmed_by_userid
            ? `${userNameOf(kit.confirmed_by_userid)} · ${formatTime(kit.confirmed_at)}`
            : "-"
        }}</el-descriptions-item>
        <el-descriptions-item label="备注" :span="3">
          <el-input v-if="actions?.canEdit" v-model="remark" maxlength="200" />
          <span v-else>{{ kit.remark ?? "-" }}</span>
        </el-descriptions-item>
        <el-descriptions-item
          v-if="kit.close_reason"
          label="作废原因"
          :span="3"
          >{{ kit.close_reason }}</el-descriptions-item
        >
      </el-descriptions>
      <KitPlanSummary v-if="kit.plan" :plan="kit.plan" />
      <KitLineTable
        v-model="lines"
        mode="kit"
        :categories="categories"
        :readonly="!actions?.canEdit"
        :fulfilment="fulfilment"
        :problems="problems"
      />
      <DocFormDialog
        v-if="shipKit"
        v-model="shipOpen"
        doc-type="out"
        :kit="shipKit"
        @created="load"
      />
    </template>
  </el-card>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.title-line {
  display: flex;
  gap: 8px;
  align-items: center;
}

.kit-no {
  font-size: 16px;
  font-weight: 600;
}

.actions {
  display: flex;
  gap: 8px;
}

.info {
  margin-bottom: 12px;
}
</style>
