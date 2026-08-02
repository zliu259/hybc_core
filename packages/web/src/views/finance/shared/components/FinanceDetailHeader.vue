<script setup lang="ts">
import { CopyDocument } from "@element-plus/icons-vue";
import { message } from "@/utils/message";
import { formatMoney } from "../format";

defineOptions({ name: "FinanceDetailHeader" });

const props = defineProps<{
  /** 单号标签，如「合同号」「流水号」「收款单号」 */
  serialLabel: string;
  /** 单号本体；未加载时传 null 显示占位 */
  serial: string | null;
  /** 金额标签，如「合同金额」「申请金额」「收款金额」 */
  amountLabel?: string;
  amount?: number | null;
  /** 金额大写，可选 */
  amountCn?: string | null;
}>();

const copySerial = async () => {
  if (!props.serial) return;
  try {
    await navigator.clipboard.writeText(props.serial);
    message(`已复制 ${props.serial}`, { type: "success" });
  } catch {
    message("复制失败，请手动选中复制", { type: "error" });
  }
};
</script>

<template>
  <header class="fin-masthead">
    <div class="fin-masthead__main">
      <div class="fin-masthead__serial-block">
        <span class="fin-masthead__label">{{ serialLabel }}</span>
        <div class="fin-masthead__serial-row">
          <span class="fin-masthead__serial">{{ serial || "—" }}</span>
          <el-button
            v-if="serial"
            class="fin-masthead__copy"
            link
            size="small"
            :icon="CopyDocument"
            title="复制单号"
            @click="copySerial"
          />
          <div class="fin-masthead__tags">
            <slot name="tags" />
          </div>
        </div>
        <div v-if="$slots.meta" class="fin-masthead__meta">
          <slot name="meta" />
        </div>
      </div>

      <div v-if="amount !== undefined" class="fin-masthead__amount-block">
        <span class="fin-masthead__label">{{ amountLabel || "金额" }}</span>
        <span class="fin-masthead__amount">¥ {{ formatMoney(amount) }}</span>
        <span v-if="amountCn" class="fin-masthead__amount-cn">{{
          amountCn
        }}</span>
      </div>
    </div>

    <div v-if="$slots.actions" class="fin-masthead__actions">
      <slot name="actions" />
    </div>

    <div v-if="$slots.extra" class="fin-masthead__extra">
      <slot name="extra" />
    </div>
  </header>
</template>

<style scoped>
.fin-masthead {
  position: relative;
  padding: 16px 20px 14px;
  margin-bottom: 16px;
  background: linear-gradient(180deg, #fffdf7 0%, #f9f1e0 100%);
  border: 1px solid #e3d5b8;
  border-radius: 10px;
}

/* 凭证式双细线收边 */
.fin-masthead::after {
  position: absolute;
  right: 12px;
  bottom: 5px;
  left: 12px;
  content: "";
  border-bottom: 3px double #d8c9a8;
}

.fin-masthead__main {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 32px;
  align-items: flex-start;
  justify-content: space-between;
}

.fin-masthead__label {
  display: block;
  font-size: 12px;
  color: #8c6a2f;
  letter-spacing: 0.12em;
}

.fin-masthead__serial-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 4px;
}

.fin-masthead__serial {
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 20px;
  font-weight: 700;
  color: #3f3527;
  letter-spacing: 0.02em;
}

.fin-masthead__copy {
  color: #8c6a2f;
}

.fin-masthead__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.fin-masthead__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin-top: 8px;
  font-size: 13px;
  color: #6e6458;
}

.fin-masthead__amount-block {
  text-align: right;
}

.fin-masthead__amount {
  display: block;
  margin-top: 2px;
  font-family:
    ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 26px;
  font-weight: 700;
  line-height: 1.2;
  color: #6b4f2a;
  font-variant-numeric: tabular-nums;
}

.fin-masthead__amount-cn {
  display: block;
  margin-top: 2px;
  font-size: 12px;
  color: #8c6a2f;
}

.fin-masthead__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  padding-top: 10px;
  margin-top: 12px;
  border-top: 1px dashed #e3d5b8;
}

.fin-masthead__extra {
  margin-top: 12px;
}

@media (max-width: 720px) {
  .fin-masthead__amount-block {
    text-align: left;
  }
}
</style>
