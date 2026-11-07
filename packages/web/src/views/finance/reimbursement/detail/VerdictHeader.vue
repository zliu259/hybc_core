<script setup lang="ts">
import type { Guidance, GuidanceActionKey } from "@/api/reimbursement";

defineProps<{
  guidance: Guidance;
  facts: string;
  loadingKeys: GuidanceActionKey[];
  busy: boolean;
  closeLabel: string;
}>();

const emit = defineEmits<{
  (event: "action", key: GuidanceActionKey): void;
  (event: "close"): void;
}>();
</script>

<template>
  <header class="rb-verdict">
    <div class="rb-verdict__text">
      <h1
        class="rb-title"
        :class="{ 'rb-title--warn': guidance.tone === 'warn' }"
      >
        {{ guidance.headline }}
      </h1>
      <p v-if="guidance.next_step" class="rb-next">{{ guidance.next_step }}</p>
      <p v-if="guidance.note" class="rb-note">{{ guidance.note }}</p>
      <p v-if="facts" class="rb-facts">{{ facts }}</p>
    </div>
    <div class="rb-verdict__actions">
      <el-button
        v-for="(action, index) in guidance.actions"
        :key="action.key"
        :type="index === 0 ? 'primary' : 'default'"
        :loading="loadingKeys.includes(action.key)"
        :disabled="busy || action.disabled"
        @click="emit('action', action.key)"
      >
        {{ action.label }}
      </el-button>
      <slot name="more" />
      <el-button text @click="emit('close')">{{ closeLabel }}</el-button>
    </div>
  </header>
</template>

<style scoped>
.rb-verdict {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 32px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 24px;
}

.rb-verdict__text {
  flex: 1 1 420px;
  min-width: 0;
}

.rb-verdict__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.rb-verdict__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.rb-title {
  margin: 0;
  font-size: 26px;
  font-weight: 600;
  line-height: 36px;
  color: #1f2329;
}

.rb-title--warn {
  color: #b4470c;
}

.rb-next {
  margin: 6px 0 0;
  font-size: 15px;
  font-weight: 500;
  line-height: 24px;
  color: #1361d8;
}

.rb-note {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: #b4470c;
}

.rb-facts {
  margin: 10px 0 0;
  font-size: 13px;
  line-height: 20px;
  color: #5c667a;
}

@container (max-width: 860px) {
  .rb-verdict {
    padding: 16px;
  }

  .rb-verdict__text {
    flex-basis: 100%;
  }

  .rb-title {
    font-size: 20px;
    line-height: 28px;
  }
}
</style>
