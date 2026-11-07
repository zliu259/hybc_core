<script setup lang="ts">
export type MoreActionKey =
  | "rebind"
  | "switch_channel"
  | "split"
  | "rerun_all"
  | "void";

defineProps<{
  items: { key: MoreActionKey; label: string; danger?: boolean }[];
  disabled: boolean;
}>();

const emit = defineEmits<{ (event: "select", key: MoreActionKey): void }>();
</script>

<template>
  <el-dropdown
    v-if="items.length > 0"
    trigger="click"
    @command="emit('select', $event)"
  >
    <el-button :disabled="disabled">更多</el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="item in items"
          :key="item.key"
          :command="item.key"
          :class="{ 'rb-more-danger': item.danger }"
        >
          {{ item.label }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style>
.el-dropdown-menu__item.rb-more-danger {
  color: #b4470c;
}
</style>
