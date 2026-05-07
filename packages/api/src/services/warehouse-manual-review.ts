import type { WarehouseManualVersionStatus } from "../types/warehouse-manual";

export const assertWarehouseManualVersionCanSubmitReview = (
  status: WarehouseManualVersionStatus
) => {
  if (status !== "draft") {
    throw new Error("manual version must be draft before review");
  }
};

export const assertWarehouseManualVersionCanPublish = (status: WarehouseManualVersionStatus) => {
  if (status !== "reviewing") {
    throw new Error("manual version must be reviewing before publish");
  }
};
