import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from "vue";

import {
  getReimbursementEnvelope,
  type ReimbursementEnvelopeDetail
} from "@/api/reimbursement";
import {
  buildEnvelopeForm,
  createDefaultForm,
  isEnvelopeFormDirty,
  refreshForm,
  type EnvelopeForm
} from "./view-model";

// 详情数据、表单和轮询。识别中才轮询，轮询只刷新数据：不动上传项，不冲掉正在填的表单。

const POLL_INTERVAL_MS = 3000;
const POLL_MAX_TICKS = 100;

export const useEnvelopeDetail = (options: {
  envelopeId: ComputedRef<number>;
  isCreate: ComputedRef<boolean>;
}) => {
  const detail = ref<ReimbursementEnvelopeDetail | null>(null);
  const form = ref<EnvelopeForm>(createDefaultForm());
  const baseline = ref<EnvelopeForm>(createDefaultForm());
  const amountTouched = ref(false);
  const loading = ref(false);
  const pollingPaused = ref(false);

  let timer: number | null = null;
  let ticks = 0;
  let loadSequence = 0;

  const dirty = computed(
    () =>
      !options.isCreate.value &&
      isEnvelopeFormDirty(form.value, baseline.value, amountTouched.value)
  );

  const stopPolling = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    ticks = 0;
  };

  const shouldPoll = () =>
    !pollingPaused.value &&
    (detail.value?.review_totals?.recognizing_count ?? 0) > 0;

  const syncPolling = () => {
    if (!shouldPoll()) {
      stopPolling();
      return;
    }
    if (timer !== null) return;
    timer = window.setInterval(() => {
      ticks += 1;
      if (ticks >= POLL_MAX_TICKS) {
        stopPolling();
        return;
      }
      void load({ silent: true }).catch(() => stopPolling());
    }, POLL_INTERVAL_MS);
  };

  const reset = () => {
    detail.value = null;
    form.value = createDefaultForm();
    baseline.value = createDefaultForm();
    amountTouched.value = false;
    stopPolling();
  };

  const load = async (loadOptions?: {
    silent?: boolean;
    resetForm?: boolean;
  }): Promise<void> => {
    if (options.isCreate.value) {
      reset();
      return;
    }
    const silent = loadOptions?.silent ?? false;
    loadSequence += 1;
    const sequence = loadSequence;
    if (!silent) loading.value = true;
    try {
      const result = await getReimbursementEnvelope(options.envelopeId.value);
      if (sequence !== loadSequence) return;
      const server = result.data;
      if (
        loadOptions?.resetForm ||
        !detail.value ||
        detail.value.id !== server.id
      ) {
        amountTouched.value = false;
        form.value = buildEnvelopeForm(server);
      } else {
        form.value = refreshForm({
          current: form.value,
          baseline: baseline.value,
          server,
          amountTouched: amountTouched.value
        });
      }
      baseline.value = buildEnvelopeForm(server);
      detail.value = server;
      syncPolling();
    } finally {
      if (!silent) loading.value = false;
    }
  };

  const patchForm = (patch: Partial<EnvelopeForm>) => {
    if ("amount" in patch) amountTouched.value = true;
    form.value = { ...form.value, ...patch };
  };

  watch(pollingPaused, syncPolling);
  onBeforeUnmount(stopPolling);

  return {
    detail,
    form,
    loading,
    dirty,
    amountTouched,
    pollingPaused,
    load,
    patchForm,
    reset
  };
};
