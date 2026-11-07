import { computed, type ComputedRef, type Ref } from "vue";

import type { ReimbursementEnvelopeDetail } from "@/api/reimbursement";
import {
  formatYuan,
  withDeclaredAmount,
  type EnvelopeForm
} from "./view-model";

/** 顶部的事实行和底部合计。还能改的单按表单里的金额显示，那才是要提交的数。 */
export const useEnvelopeSummary = (deps: {
  detail: Ref<ReimbursementEnvelopeDetail | null>;
  form: Ref<EnvelopeForm>;
  canEdit: ComputedRef<boolean>;
  projects: Ref<{ id: number; project_name: string }[]>;
  users: Ref<{ userid: string; name?: string }[]>;
}) => {
  const { detail, form, canEdit } = deps;

  const displayedAmount = computed(() =>
    canEdit.value ? form.value.amount : (detail.value?.amount ?? 0)
  );

  const displayedTotals = computed(() => {
    const totals = detail.value?.review_totals;
    if (!totals) return null;
    return canEdit.value
      ? withDeclaredAmount(totals, form.value.amount)
      : totals;
  });

  const facts = computed(() => {
    if (!detail.value) return "";
    const applicant = deps.users.value.find(
      user => user.userid === detail.value?.applicant_userid
    );
    const project = deps.projects.value.find(
      item => item.id === detail.value?.project_id
    );
    const who = applicant?.name || detail.value.applicant_userid;
    const projectText = project ? `，项目：${project.project_name}` : "";
    return `${who}报销 ${formatYuan(displayedAmount.value)}${projectText}。`;
  });

  return { facts, displayedTotals };
};
