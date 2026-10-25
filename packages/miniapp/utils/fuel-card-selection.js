// 油卡申请「按车选卡」的展示与选择辅助（油卡跟车走）
// 规则与文案和 Web 的 views/finance/fleet/fuel-card-selection.ts 保持一致

/**
 * 按车拉卡后 picker 应选中的下标；0 是「请选择油卡」占位，真实卡从 1 开始。
 * 上一张卡仍在列表里就保留，否则只有一张时自动选中，多张时留在占位让申请人自己选。
 * @param {Array<{ id: number | string }>} cards
 * @param {number | string} [previousCardId]
 * @returns {number}
 */
const resolveFuelCardIndex = (cards, previousCardId) => {
  const list = Array.isArray(cards) ? cards : [];
  if (previousCardId !== undefined && previousCardId !== null && previousCardId !== "") {
    const keep = list.findIndex((card) => Number(card.id) === Number(previousCardId));
    if (keep >= 0) return keep + 1;
  }
  return list.length === 1 ? 1 : 0;
};

/**
 * @param {{ card_no?: string, latest_balance?: number | string | null }} card
 * @returns {string}
 */
const fuelCardLabel = (card) =>
  `${card.card_no}（余额 ${Number(card.latest_balance || 0).toFixed(2)}）`;

/**
 * @param {{ current_plate_no?: string, vehicle_model?: string | null, fuel_card_count?: number }} vehicle
 * @returns {string}
 */
const vehicleLabel = (vehicle) => {
  const base = vehicle.vehicle_model
    ? `${vehicle.current_plate_no} · ${vehicle.vehicle_model}`
    : `${vehicle.current_plate_no}`;
  return vehicle.fuel_card_count === 0 ? `${base}（未配卡）` : base;
};

module.exports = { resolveFuelCardIndex, fuelCardLabel, vehicleLabel };
