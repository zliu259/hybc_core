import { computed, ref } from "vue";
import type { FuelCard } from "@/api/fleet";
import { resolveFuelCardSelection } from "./fuel-card-selection";

export type VehicleCardSelection =
  | { applied: false }
  | { applied: true; cardId: number | undefined; error?: unknown };

/**
 * 油卡申请页「选车 → 拉该车的卡」状态（油卡跟车走）。
 * - 每次选车递增请求序号，快速换车时丢弃上一辆车晚到的结果（applied: false）；
 * - 加载失败只记 loadFailed，不算"该车未配卡"，免得把网络抖动说成配置问题；
 * - cardId 是按 resolveFuelCardSelection 自动选中的卡（单卡时），由调用方写回表单。
 */
export const useVehicleFuelCards = (
  loadCards: (vehicleId: number) => Promise<FuelCard[]>
) => {
  const cards = ref<FuelCard[]>([]);
  const loading = ref(false);
  const loadFailed = ref(false);
  const vehicleId = ref<number | undefined>(undefined);
  let requestSeq = 0;

  const noCard = computed(
    () =>
      Boolean(vehicleId.value) &&
      !loading.value &&
      !loadFailed.value &&
      cards.value.length === 0
  );

  const selectVehicle = async (
    nextVehicleId: number | undefined
  ): Promise<VehicleCardSelection> => {
    const seq = ++requestSeq;
    vehicleId.value = nextVehicleId;
    cards.value = [];
    loadFailed.value = false;
    loading.value = Boolean(nextVehicleId);
    if (!nextVehicleId) return { applied: true, cardId: undefined };

    try {
      const result = await loadCards(nextVehicleId);
      if (seq !== requestSeq) return { applied: false };
      cards.value = result;
      return { applied: true, cardId: resolveFuelCardSelection(result) };
    } catch (error) {
      if (seq !== requestSeq) return { applied: false };
      loadFailed.value = true;
      return { applied: true, cardId: undefined, error };
    } finally {
      if (seq === requestSeq) loading.value = false;
    }
  };

  return { cards, loading, loadFailed, noCard, selectVehicle };
};
