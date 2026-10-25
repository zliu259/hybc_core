import type { FleetVehicle, FuelCard } from "@/api/fleet";

/**
 * 按车选卡后应选中的油卡：上一张仍在列表里就保留，否则只有一张时自动选中，
 * 多张时留空让申请人自己选。小程序 utils/fuel-card-selection.js 规则一致。
 */
export const resolveFuelCardSelection = (
  cards: FuelCard[],
  previousCardId?: number
): number | undefined => {
  if (
    previousCardId !== undefined &&
    cards.some(card => card.id === previousCardId)
  ) {
    return previousCardId;
  }
  return cards.length === 1 ? cards[0].id : undefined;
};

export const fuelCardOptionLabel = (card: FuelCard): string =>
  `${card.card_no}（余额 ${Number(card.latest_balance || 0).toFixed(2)}）`;

export const vehicleOptionLabel = (vehicle: FleetVehicle): string => {
  const base = vehicle.vehicle_model
    ? `${vehicle.current_plate_no} · ${vehicle.vehicle_model}`
    : vehicle.current_plate_no;
  return vehicle.fuel_card_count === 0 ? `${base}（未配卡）` : base;
};
