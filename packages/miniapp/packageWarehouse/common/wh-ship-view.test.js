/** 发货、返库、转场、入库录单页的视图模型。运行：node packageWarehouse/common/wh-ship-view.test.js */
const assert = require("assert");

const {
  SHIP_TYPES,
  newShipForm,
  prefillFromKit,
  prefillFromHoldings,
  addDevice,
  removeDevice,
  setDeviceField,
  addMaterial,
  removeMaterial,
  setMaterialQty,
  deviceNeedHints,
  shipProblem,
  toDocPayload,
  materialLabel
} = require("./wh-ship-view");

/** 调用前后表单不变：这些函数都不改传进来的对象。 */
const frozen = (form, fn) => {
  const before = JSON.stringify(form);
  const result = fn(form);
  assert.strictEqual(JSON.stringify(form), before, "不能改传进来的表单");
  return result;
};

// ---- 类型
assert.deepStrictEqual(Object.keys(SHIP_TYPES), ["out", "back", "transfer", "in"]);
assert.deepStrictEqual(
  Object.values(SHIP_TYPES).map((item) => [item.title, item.docType]),
  [
    ["发往项目", "out"],
    ["项目返库", "back"],
    ["项目间转场", "transfer"],
    ["入库", "inbound"]
  ]
);
assert.deepStrictEqual(newShipForm("out", "req-12345678"), {
  type: "out",
  requestId: "req-12345678",
  projectId: null,
  toProjectId: null,
  kitId: null,
  kitNo: "",
  devices: [],
  materials: [],
  deviceNeeds: [],
  counterparty: "",
  handoverName: "",
  remark: "",
  photoKeys: []
});
assert.strictEqual(newShipForm("weird", "req-12345678").type, "out");

// ---- 按清单带出：同一物资两行合并，现场采购的行不带，待发为 0 的不带，设备按类别汇总
const fulfilment = [
  { line_kind: "material", material_id: 1, name_text: "排泥钢管", material_name: "排泥钢管", material_spec: "Φ114", material_unit: "根", material_kind: "turnover", source: "warehouse", pending: 60, in_stock: 100 },
  { line_kind: "material", material_id: 1, name_text: "排泥钢管", material_name: "排泥钢管", material_spec: "Φ114", material_unit: "根", material_kind: "turnover", source: "warehouse", pending: 20.5, in_stock: 100 },
  { line_kind: "material", material_id: 2, name_text: "膨润土", material_name: "膨润土", material_spec: "", material_unit: "袋", material_kind: "consumable", source: "site_purchase", pending: 30, in_stock: 0 },
  { line_kind: "material", material_id: 3, name_text: "注浆管", material_name: "注浆管", material_spec: "DN25", material_unit: "根", material_kind: "turnover", source: "warehouse", pending: 0, in_stock: 50 },
  { line_kind: "material", material_id: null, name_text: "没选规格的", source: "warehouse", pending: 5, in_stock: null },
  { line_kind: "device", device_category_id: 9, category_name: "顶管机", spec_text: "DN1200", source: "warehouse", pending: 2, in_stock: 3 },
  { line_kind: "device", device_category_id: 9, category_name: "顶管机", spec_text: "DN1000", source: "warehouse", pending: 1, in_stock: 3 },
  { line_kind: "text", name_text: "记得带图纸", source: "warehouse", pending: 0, in_stock: null }
];
const outForm = frozen(newShipForm("out", "req-12345678"), (form) =>
  prefillFromKit(form, { id: 5, kit_no: "PT-1", project_id: 3 }, fulfilment)
);
assert.strictEqual(outForm.projectId, 3);
assert.strictEqual(outForm.kitId, 5);
assert.strictEqual(outForm.kitNo, "PT-1");
assert.deepStrictEqual(outForm.materials, [
  { materialId: 1, name: "排泥钢管", spec: "Φ114", unit: "根", kind: "turnover", available: 100, quantity: "80.5", returned: "", lost: "" }
]);
assert.deepStrictEqual(outForm.deviceNeeds, [
  { categoryId: 9, categoryName: "顶管机", specText: "DN1200、DN1000", count: 3, available: 3 }
]);
assert.deepStrictEqual(outForm.devices, []);

// ---- 加设备
const device = { id: 7, device_code: "DG-01", name: "顶管机", category_id: 9, state: "available", state_label: "可用", current_project_id: null };
let result = frozen(outForm, (form) => addDevice(form, device));
assert.deepStrictEqual(result.form.devices, [
  { id: 7, code: "DG-01", name: "顶管机", categoryId: 9, usageMeters: "", soilType: "" }
]);
assert.deepStrictEqual(addDevice(result.form, device), { error: "DG-01 已经加过了" });
assert.deepStrictEqual(addDevice(outForm, { ...device, state: "pending_inspection", state_label: "待检" }), {
  error: "DG-01 现在是待检，不能发出"
});
assert.deepStrictEqual(addDevice(newShipForm("in", "req-12345678"), device), {
  error: "入库单不加设备，新设备在 Web 的设备台账里新建"
});

// 设备还需几台
assert.deepStrictEqual(deviceNeedHints(outForm), [
  { categoryName: "顶管机", need: 3, picked: 0, text: "顶管机（DN1200、DN1000）：还需 3 台，库里可用 3 台" }
]);
assert.strictEqual(deviceNeedHints(result.form)[0].text, "顶管机（DN1200、DN1000）：还需 2 台（已选 1 台）");
const full = [8, 9].reduce(
  (form, id) => addDevice(form, { ...device, id, device_code: `DG-0${id}` }).form,
  result.form
);
assert.strictEqual(deviceNeedHints(full)[0].text, "顶管机（DN1200、DN1000）：已选够 3 台");
assert.deepStrictEqual(removeDevice(full, 8).devices.map((item) => item.id), [7, 9]);

// ---- 返库：整单带出，改一行报损
const onSite = { ...device, state: "on_project", state_label: "在项目", current_project_id: 3 };
const holdings = {
  devices: [onSite],
  materials: [{ material_id: 1, material_code: "M-1", name: "排泥钢管", spec: "Φ114", unit: "根", holding: 80 }]
};
let back = frozen({ ...newShipForm("back", "req-22345678"), projectId: 3 }, (form) =>
  prefillFromHoldings(form, holdings)
);
assert.strictEqual(back.devices.length, 1);
assert.deepStrictEqual(back.materials, [
  { materialId: 1, name: "排泥钢管", spec: "Φ114", unit: "根", kind: "turnover", available: 80, quantity: "", returned: "80", lost: "0" }
]);
back = frozen(back, (form) => setMaterialQty(form, 1, "returned", "70"));
back = setMaterialQty(back, 1, "lost", "11");
assert.strictEqual(shipProblem(back), "排泥钢管 Φ114 退回加报损超过在场数 80");
back = setMaterialQty(back, 1, "lost", "10");
assert.strictEqual(shipProblem(back), "");
assert.deepStrictEqual(toDocPayload(back).material_lines, [
  { material_id: 1, quantity: 70, outcome: "returned" },
  { material_id: 1, quantity: 10, outcome: "lost" }
]);
assert.deepStrictEqual(toDocPayload(back).device_lines, [{ device_id: 7 }]);
assert.strictEqual(toDocPayload(back).doc_type, "back");
assert.strictEqual(toDocPayload(back).project_id, 3);
assert.strictEqual(toDocPayload(back).client_request_id, "req-22345678");
// 改字段名不认识的不动
assert.deepStrictEqual(setMaterialQty(back, 1, "weird", "5"), back);

// 返库：别的项目的设备加不进来；没选项目时先让选项目
assert.deepStrictEqual(addDevice(back, { ...onSite, id: 8, device_code: "DG-02", current_project_id: 4 }), {
  error: "DG-02 不在这个项目"
});
assert.deepStrictEqual(addDevice(back, { ...device, id: 8, device_code: "DG-02" }), { error: "DG-02 不在这个项目" });
assert.deepStrictEqual(addDevice(newShipForm("back", "req-22345678"), onSite), { error: "请先选择项目" });

// 返库：设备顺手填顶进距离和土质
back = frozen(back, (form) => setDeviceField(form, 7, "usageMeters", "120.5"));
back = setDeviceField(back, 7, "soilType", " 粉质黏土 ");
assert.deepStrictEqual(toDocPayload(back).device_lines, [
  { device_id: 7, usage_meters: 120.5, soil_type: "粉质黏土" }
]);
assert.strictEqual(shipProblem(setDeviceField(back, 7, "usageMeters", "abc")), "DG-01 的顶进距离只填数字（米）");

// 返库：退没用完的耗材，只有"退回"，没有在场数上限
const bentonite = { id: 2, name: "膨润土", spec: "", unit: "袋", kind: "consumable", quantity: 40 };
result = frozen(back, (form) => addMaterial(form, bentonite));
assert.deepStrictEqual(result.form.materials[1], {
  materialId: 2, name: "膨润土", spec: "", unit: "袋", kind: "consumable", available: null, quantity: "", returned: "", lost: ""
});
let withConsumable = setMaterialQty(result.form, 2, "returned", "5");
assert.strictEqual(shipProblem(withConsumable), "");
assert.deepStrictEqual(toDocPayload(withConsumable).material_lines[2], { material_id: 2, quantity: 5, outcome: "returned" });
// 耗材的报损不带
withConsumable = setMaterialQty(withConsumable, 2, "lost", "3");
assert.strictEqual(toDocPayload(withConsumable).material_lines.length, 3);
// 返库：不在在场清单里的周转件加不进来
assert.deepStrictEqual(addMaterial(back, { id: 3, name: "注浆管", spec: "DN25", unit: "根", kind: "turnover", quantity: 50 }), {
  error: "注浆管 DN25 不在这个项目的在场清单里"
});
assert.deepStrictEqual(addMaterial(back, { id: 1, name: "排泥钢管", spec: "Φ114", unit: "根", kind: "turnover", quantity: 9 }), {
  error: "排泥钢管 Φ114 已经在单里"
});
assert.deepStrictEqual(removeMaterial(result.form, 2).materials.map((item) => item.materialId), [1]);

// ---- 发货
let out = addMaterial(newShipForm("out", "req-32345678"), { id: 3, name: "注浆管", spec: "DN25", unit: "根", kind: "turnover", quantity: 50 }).form;
assert.deepStrictEqual(out.materials[0], {
  materialId: 3, name: "注浆管", spec: "DN25", unit: "根", kind: "turnover", available: 50, quantity: "", returned: "", lost: ""
});
assert.strictEqual(shipProblem(out), "请选择项目");
out = { ...out, projectId: 3 };
assert.strictEqual(shipProblem(out), "请至少添加一行");
assert.strictEqual(shipProblem(setMaterialQty(out, 3, "quantity", "abc")), "注浆管 DN25 的数量不对");
assert.strictEqual(shipProblem(setMaterialQty(out, 3, "quantity", "51")), "注浆管 DN25 库存只有 50");
out = setMaterialQty(out, 3, "quantity", "20");
assert.strictEqual(shipProblem(out), "");
assert.deepStrictEqual(toDocPayload({ ...out, kitId: 5, handoverName: " 老王 ", remark: " 急 ", counterparty: "不该带" }), {
  doc_type: "out",
  client_request_id: "req-32345678",
  project_id: 3,
  project_kit_id: 5,
  handover_name: "老王",
  remark: "急",
  device_lines: [],
  material_lines: [{ material_id: 3, quantity: 20 }]
});
// 数量是 0 或空的行不带
assert.deepStrictEqual(toDocPayload(setMaterialQty(out, 3, "quantity", "0")).material_lines, []);
// 只有设备也能提交
assert.strictEqual(shipProblem(addDevice({ ...newShipForm("out", "req-32345678"), projectId: 3 }, device).form), "");

// ---- 转场
let transfer = prefillFromHoldings({ ...newShipForm("transfer", "req-42345678"), projectId: 3 }, holdings);
assert.deepStrictEqual(transfer.materials[0], {
  materialId: 1, name: "排泥钢管", spec: "Φ114", unit: "根", kind: "turnover", available: 80, quantity: "80", returned: "", lost: ""
});
assert.strictEqual(shipProblem(transfer), "请选择目的项目");
assert.strictEqual(shipProblem({ ...transfer, toProjectId: 3 }), "来源和目的不能是同一个项目");
transfer = { ...transfer, toProjectId: 4 };
assert.strictEqual(shipProblem(transfer), "");
assert.strictEqual(shipProblem(setMaterialQty(transfer, 1, "quantity", "81")), "排泥钢管 Φ114 在场只有 80");
assert.deepStrictEqual(toDocPayload(transfer), {
  doc_type: "transfer",
  client_request_id: "req-42345678",
  project_id: 3,
  to_project_id: 4,
  device_lines: [{ device_id: 7 }],
  material_lines: [{ material_id: 1, quantity: 80 }]
});
assert.deepStrictEqual(addMaterial(transfer, bentonite), { error: "转场不能加物资" });

// ---- 入库
let inbound = addMaterial(newShipForm("in", "req-52345678"), bentonite).form;
assert.strictEqual(inbound.materials[0].available, null);
assert.strictEqual(shipProblem(inbound), "请至少添加一行");
inbound = { ...setMaterialQty(inbound, 2, "quantity", "200"), counterparty: " 宏图建材 ", photoKeys: ["wh-doc/a.jpg"], handoverName: "不该带" };
assert.strictEqual(shipProblem(inbound), "");
assert.deepStrictEqual(toDocPayload(inbound), {
  doc_type: "inbound",
  client_request_id: "req-52345678",
  counterparty: "宏图建材",
  photo_keys: ["wh-doc/a.jpg"],
  device_lines: [],
  material_lines: [{ material_id: 2, quantity: 200 }]
});

assert.strictEqual(materialLabel({ name: "膨润土", spec: "" }), "膨润土");
assert.strictEqual(materialLabel({ name: "排泥钢管", spec: "Φ114" }), "排泥钢管 Φ114");

console.log("wh-ship-view tests passed");
