<script setup lang="ts">
/** 附件预览。多个附件可以直接前后翻，核对材料时不用反复关开抽屉。 */
import { computed } from "vue";
import { canPreviewInline } from "../formatters";

defineOptions({ name: "AttachmentPreviewDrawer" });

const visible = defineModel<boolean>("visible", { required: true });

const props = defineProps<{
  url: string;
  fileName: string;
  index: number;
  total: number;
}>();

const emit = defineEmits<{ step: [delta: number] }>();

const inline = computed(() => canPreviewInline(props.fileName));
</script>

<template>
  <el-drawer v-model="visible" size="70%" :with-header="true">
    <template #header>
      <div class="preview-drawer__head">
        <span class="preview-drawer__name">{{ fileName }}</span>
        <template v-if="total > 1">
          <span class="preview-drawer__count"
            >{{ index + 1 }} / {{ total }}</span
          >
          <el-button
            size="small"
            :disabled="index <= 0"
            @click="emit('step', -1)"
          >
            上一个
          </el-button>
          <el-button
            size="small"
            :disabled="index >= total - 1"
            @click="emit('step', 1)"
          >
            下一个
          </el-button>
        </template>
        <el-link :href="url" target="_blank" type="primary">下载</el-link>
      </div>
    </template>
    <iframe
      v-if="inline"
      :key="url"
      :src="url"
      :title="fileName"
      class="preview-drawer__frame"
    />
    <el-empty v-else description="这种文件不能在页面里打开，请下载后查看">
      <el-link :href="url" target="_blank" type="primary">下载附件</el-link>
    </el-empty>
  </el-drawer>
</template>

<style scoped>
.preview-drawer__head {
  display: flex;
  gap: 10px;
  align-items: center;
  min-width: 0;
}

.preview-drawer__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 15px;
  color: var(--el-text-color-primary);
  white-space: nowrap;
}

.preview-drawer__count {
  flex: none;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  color: var(--el-text-color-secondary);
}

.preview-drawer__frame {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
