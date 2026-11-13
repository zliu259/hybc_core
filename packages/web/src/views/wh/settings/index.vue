<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { getWhSettings, saveWhSettings } from "@/api/wh/settings";
import { useWecomUserOptions } from "@/composables/useWecomUserOptions";
import { useWhAction } from "../shared/useWhAction";
import { useWhCapabilities } from "../shared/useWhCapabilities";
import CategoryPanel from "./components/CategoryPanel.vue";
import MemberPanel from "./components/MemberPanel.vue";
import WedriveMirrorCard from "./components/WedriveMirrorCard.vue";

defineOptions({ name: "WhSettings" });

const { caps, load: loadCaps } = useWhCapabilities();
const { wecomUsers, loadUserNames } = useWecomUserOptions();
const { busy, run } = useWhAction();
const inspector = ref<string>("");
const photoCount = ref(3);
const notifyEnabled = ref(false);

const canManage = computed(() => Boolean(caps.value?.can_manage_settings));
const canEditCategories = computed(() => Boolean(caps.value?.is_keeper));
/** 微盘镜像的状态只给管资料的人和能改设置的人看（后端也是这么限的） */
const canSeeMirror = computed(
  () => canManage.value || Boolean(caps.value?.is_doc_admin)
);

const loadSettings = async () => {
  const result = await run(() => getWhSettings());
  if (!result) return;
  inspector.value = result.data.default_inspector_userid ?? "";
  photoCount.value = result.data.return_inspection_photo_count;
  notifyEnabled.value = result.data.notify_enabled;
};

const save = async () => {
  await run(
    () =>
      saveWhSettings({
        default_inspector_userid: inspector.value || null,
        return_inspection_photo_count: photoCount.value
      }),
    { success: "已保存" }
  );
  await loadSettings();
};

/** 开关一拨就保存；失败时重新读一遍，把开关拨回实际的状态。 */
const saveNotify = async (value: string | number | boolean) => {
  const enabled = value === true;
  await run(() => saveWhSettings({ notify_enabled: enabled }), {
    success: enabled ? "企微通知已打开" : "企微通知已关闭"
  });
  await loadSettings();
};

onMounted(async () => {
  await Promise.all([loadCaps(), loadSettings(), loadUserNames()]);
});
</script>

<template>
  <div class="wh-settings">
    <MemberPanel v-if="caps" :can-manage="canManage" />
    <CategoryPanel v-if="caps" :can-edit="canEditCategories" />
    <el-card v-loading="busy" shadow="never">
      <template #header>返库检查</template>
      <el-form label-width="120px" :disabled="!canManage">
        <el-form-item label="默认检查人">
          <el-select
            v-model="inspector"
            filterable
            clearable
            placeholder="不设置时派给办理返库的库管"
            style="width: 260px"
          >
            <el-option
              v-for="user in wecomUsers"
              :key="user.userid"
              :label="user.name"
              :value="user.userid"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="要求照片数">
          <el-input-number v-model="photoCount" :min="0" :max="9" />
        </el-form-item>
        <el-form-item v-if="canManage">
          <el-button type="primary" @click="save">保存</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    <el-card v-loading="busy" shadow="never">
      <template #header>企微通知</template>
      <el-form label-width="120px" :disabled="!canManage">
        <el-form-item label="发企微卡片">
          <el-switch :model-value="notifyEnabled" @change="saveNotify" />
          <div class="hint">
            新版小程序发布后再打开。打开后，清单待确认和已确认、任务派工和退回、发货返库转场会给相关的人发企微卡片，点开进小程序对应的页面。
          </div>
        </el-form-item>
      </el-form>
    </el-card>
    <WedriveMirrorCard v-if="canSeeMirror" :can-manage="canManage" />
  </div>
</template>

<style scoped>
.wh-settings {
  display: grid;
  gap: 16px;
}

.hint {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}
</style>
