import { computed, type ComputedRef, type Ref } from "vue";

import type { ReimbursementEnvelopeDetail } from "@/api/reimbursement";
import {
  buildInfoSummary,
  formatYuan,
  withDeclaredAmount,
  type EnvelopeForm
} from "./view-model";

/** 顶部的事实行、「报销信息」卡片摘要和底部合计。还能改的单按表单里的数显示，那才是要提交的数。 */
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

  const findProjectName = (projectId: number | null | undefined) =>
    deps.projects.value.find(item => item.id === projectId)?.project_name ??
    null;

  const findUserName = (userid: string) =>
    deps.users.value.find(user => user.userid === userid)?.name || userid;

  const facts = computed(() => {
    if (!detail.value) return "";
    const who = findUserName(detail.value.applicant_userid);
    const projectName = findProjectName(detail.value.project_id);
    const projectText = projectName ? `，项目：${projectName}` : "";
    return `${who}报销 ${formatYuan(displayedAmount.value)}${projectText}。`;
  });

  const infoSummary = computed(() => {
    const source = canEdit.value || !detail.value ? form.value : detail.value;
    const applicantId =
      source.applicant_userid || detail.value?.applicant_userid || "";
    return buildInfoSummary({
      amount: displayedAmount.value,
      projectName: findProjectName(source.project_id),
      applicantName: applicantId ? findUserName(applicantId) : null
    });
  });

  return { facts, infoSummary, displayedTotals };
};
