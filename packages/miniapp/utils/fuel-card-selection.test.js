const assert = require("assert");

const { resolveFuelCardIndex, fuelCardLabel, vehicleLabel } = require("./fuel-card-selection");

const card = (id, extra) => Object.assign({ id, card_no: `CARD-${id}`, latest_balance: 0 }, extra);

// 选卡下标：0 是「请选择油卡」占位，真实卡从 1 开始
// 上一张卡仍在列表里 → 保留
assert.strictEqual(resolveFuelCardIndex([card(3), card(5)], 5), 2);
// 只有一张卡 → 自动选中（不论上一张是什么）
assert.strictEqual(resolveFuelCardIndex([card(7)]), 1);
assert.strictEqual(resolveFuelCardIndex([card(7)], 99), 1);
// 多张卡且没有有效的上一张 → 留在占位
assert.strictEqual(resolveFuelCardIndex([card(3), card(5)]), 0);
assert.strictEqual(resolveFuelCardIndex([card(3), card(5)], 99), 0);
assert.strictEqual(resolveFuelCardIndex([]), 0);
// 接口返回的 id 可能是字符串，按数值比较
assert.strictEqual(resolveFuelCardIndex([card(3), card(5)], "5"), 2);

// 卡号 + 两位小数余额，与 Web fuelCardOptionLabel 一致
assert.strictEqual(
  fuelCardLabel(card(5, { card_no: "1000111300013742430", latest_balance: 1000 })),
  "1000111300013742430（余额 1000.00）"
);
assert.strictEqual(fuelCardLabel(card(5, { card_no: "X", latest_balance: 1136.27 })), "X（余额 1136.27）");

// 车牌 · 车型，无卡加（未配卡），与 Web vehicleOptionLabel 一致
const vehicle = (extra) =>
  Object.assign({ current_plate_no: "京MKG902", vehicle_model: "福田（轻型普通货车）", fuel_card_count: 2 }, extra);
assert.strictEqual(vehicleLabel(vehicle()), "京MKG902 · 福田（轻型普通货车）");
assert.strictEqual(vehicleLabel(vehicle({ fuel_card_count: 0 })), "京MKG902 · 福田（轻型普通货车）（未配卡）");
assert.strictEqual(vehicleLabel(vehicle({ vehicle_model: null })), "京MKG902");

console.log("fuel-card-selection tests passed");
