<script setup lang="ts">
/** 常用入口：实色方块配白色线条图标，颜色表示类别，和小程序工作台一致。 */
import type { Component } from "vue";
import { useRouter } from "vue-router";
import Activity from "~icons/lucide/activity";
import BadgeYen from "~icons/lucide/badge-japanese-yen";
import Boxes from "~icons/lucide/boxes";
import Building from "~icons/lucide/building-2";
import Car from "~icons/lucide/car";
import ChartLine from "~icons/lucide/chart-line";
import ChartPie from "~icons/lucide/chart-pie";
import ClipboardList from "~icons/lucide/clipboard-list";
import FilePen from "~icons/lucide/file-pen-line";
import FileText from "~icons/lucide/file-text";
import Flag from "~icons/lucide/flag";
import Fuel from "~icons/lucide/fuel";
import HandCoins from "~icons/lucide/hand-coins";
import HardHat from "~icons/lucide/hard-hat";
import LayoutDashboard from "~icons/lucide/layout-dashboard";
import NotebookPen from "~icons/lucide/notebook-pen";
import ReceiptText from "~icons/lucide/receipt-text";
import ShieldCheck from "~icons/lucide/shield-check";
import Wallet from "~icons/lucide/wallet";
import type { WorkbenchEntry } from "../workbench-view";

defineOptions({ name: "WorkbenchEntries" });

defineProps<{ entries: readonly WorkbenchEntry[] }>();

const router = useRouter();

const ICONS: Record<string, Component> = {
  projects: Building,
  contract: FilePen,
  payment: BadgeYen,
  receipt: HandCoins,
  reimbursementDesk: ReceiptText,
  snapshot: ChartPie,
  approvalMonitor: Activity,
  progress: ChartLine,
  managerLog: NotebookPen,
  operatorLog: HardHat,
  survey: ShieldCheck,
  breakthrough: Flag,
  logBoard: LayoutDashboard,
  ledger: Boxes,
  warehouseTasks: ClipboardList,
  fuelProcess: Fuel,
  maintenance: Car,
  myApplications: FileText,
  myReimbursement: Wallet
};
</script>

<template>
  <section class="entries">
    <h2 class="entries__title">常用</h2>
    <div class="entries__grid">
      <button
        v-for="entry in entries"
        :key="entry.key"
        type="button"
        class="entry"
        @click="router.push(entry.path)"
      >
        <span class="entry__tile" :class="`entry__tile--${entry.tone}`">
          <component :is="ICONS[entry.key]" class="entry__icon" />
        </span>
        <span class="entry__label">{{ entry.label }}</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.entries {
  padding: 12px 12px 8px;
  background: #fff;
  border: 1px solid #e7ebf0;
  border-radius: 10px;
}

.entries__title {
  margin: 0 6px 6px;
  font-size: 16px;
  font-weight: 600;
  line-height: 28px;
  color: #1f2329;
}

.entries__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 2px;
}

.entry {
  min-width: 0;
  padding: 8px 2px;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: 8px;
}

.entry:hover {
  background: #f2f5f9;
}

.entry:focus-visible {
  outline: 2px solid #2f7bf6;
  outline-offset: -2px;
}

.entry__tile {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  margin: 0 auto;
  border-radius: 11px;
}

.entry__tile--blue {
  background: #2f7bf6;
}

.entry__tile--green {
  background: #16a06f;
}

.entry__tile--orange {
  background: #e8750f;
}

.entry__tile--slate {
  background: #64748b;
}

.entry__icon {
  width: 23px;
  height: 23px;
  color: #fff;
}

.entry__label {
  display: block;
  margin-top: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 17px;
  color: #1f2329;
  text-align: center;
  white-space: nowrap;
}
</style>
