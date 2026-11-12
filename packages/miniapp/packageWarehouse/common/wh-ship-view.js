/**
 * 发货、返库、转场、入库录单页的视图模型。都是纯函数，不改传进来的表单。
 * 按清单带出的规则和 Web 的 views/wh/doc/doc-form-model.ts（prefillOutFromKit）一样。
 */
const { formatQty, toQty } = require("./wh-format");

const SHIP_TYPES = {
  out: { title: "发往项目", docType: "out", needsProject: true },
  back: { title: "项目返库", docType: "back", needsProject: true },
  transfer: { title: "项目间转场", docType: "transfer", needsProject: true, needsToProject: true },
  in: { title: "入库", docType: "inbound", needsProject: false }
};

const EPSILON = 1e-9;
const round3 = (value) => Math.round(value * 1000) / 1000;

const materialLabel = (material) => [material.name, material.spec].filter(Boolean).join(" ");

/** 空表单。type 不认识时按 out。 */
const newShipForm = (type, requestId) => ({
  type: SHIP_TYPES[type] ? type : "out",
  requestId,
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

const materialRow = (fields) => ({
  materialId: fields.materialId,
  name: fields.name,
  spec: fields.spec || "",
  unit: fields.unit || "",
  kind: fields.kind || "turnover",
  available: fields.available === undefined ? null : fields.available,
  quantity: fields.quantity || "",
  returned: fields.returned || "",
  lost: fields.lost || ""
});

const deviceEntry = (device) => ({
  id: device.id,
  code: device.device_code,
  name: device.name,
  categoryId: device.category_id,
  usageMeters: "",
  soilType: ""
});

/**
 * 按清单带出：只取来源是"库房发"且待发大于 0 的行；同一物资的几行合并；设备按类别汇总成"还需几台"。
 * @param {object} form
 * @param {{ id: number, kit_no: string, project_id: number }} kit
 * @param {object[]} fulfilment GET /warehouse/kit/:id/fulfilment 的 data
 */
const prefillFromKit = (form, kit, fulfilment) => {
  const pending = (Array.isArray(fulfilment) ? fulfilment : []).filter(
    (line) => line.source === "warehouse" && Number(line.pending) > 0
  );
  const materials = new Map();
  const needs = new Map();
  for (const line of pending) {
    if (line.line_kind === "material" && line.material_id) {
      const existing = materials.get(line.material_id);
      const quantity = round3((existing ? Number(existing.quantity) : 0) + Number(line.pending));
      materials.set(
        line.material_id,
        materialRow({
          materialId: line.material_id,
          name: line.material_name || line.name_text,
          spec: line.material_spec,
          unit: line.material_unit || line.unit,
          kind: line.material_kind,
          available: line.in_stock === null || line.in_stock === undefined ? null : Number(line.in_stock),
          quantity: formatQty(quantity)
        })
      );
    }
    if (line.line_kind === "device" && line.device_category_id) {
      const existing = needs.get(line.device_category_id);
      needs.set(line.device_category_id, {
        categoryId: line.device_category_id,
        categoryName: line.category_name || "",
        specText: [existing && existing.specText, line.spec_text].filter(Boolean).join("、"),
        count: (existing ? existing.count : 0) + Number(line.pending),
        available: Number(line.in_stock || 0)
      });
    }
  }
  return {
    ...form,
    projectId: kit.project_id,
    kitId: kit.id,
    kitNo: kit.kit_no,
    devices: [],
    materials: [...materials.values()],
    deviceNeeds: [...needs.values()]
  };
};

/**
 * 按项目在场带出，默认整单：返库是全部退回、报损 0；转场是全部转走。
 * @param {object} form
 * @param {{ devices: object[], materials: object[] }} holdings
 */
const prefillFromHoldings = (form, holdings) => {
  const devices = (holdings && Array.isArray(holdings.devices) ? holdings.devices : []).map(deviceEntry);
  const materials = (holdings && Array.isArray(holdings.materials) ? holdings.materials : []).map(
    (item) => {
      const holding = Number(item.holding);
      const whole = formatQty(holding);
      return materialRow({
        materialId: item.material_id,
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        kind: "turnover",
        available: holding,
        ...(form.type === "back" ? { returned: whole, lost: "0" } : { quantity: whole })
      });
    }
  );
  return { ...form, devices, materials, deviceNeeds: [] };
};

/**
 * 加一台设备。
 * @returns {{ form: object } | { error: string }}
 */
const addDevice = (form, device) => {
  const code = device.device_code;
  if (form.type === "in") return { error: "入库单不加设备，新设备在 Web 的设备台账里新建" };
  if (form.devices.some((item) => item.id === device.id)) return { error: `${code} 已经加过了` };
  if (form.type === "out") {
    if (device.state !== "available") {
      return { error: `${code} 现在是${device.state_label || "不可用"}，不能发出` };
    }
  } else {
    if (!form.projectId) return { error: "请先选择项目" };
    if (device.state !== "on_project" || device.current_project_id !== form.projectId) {
      return { error: `${code} 不在这个项目` };
    }
  }
  return { form: { ...form, devices: [...form.devices, deviceEntry(device)] } };
};

const removeDevice = (form, deviceId) => ({
  ...form,
  devices: form.devices.filter((item) => item.id !== deviceId)
});

/** 返库时设备顺手填的顶进距离和土质。 */
const setDeviceField = (form, deviceId, field, text) => {
  if (field !== "usageMeters" && field !== "soilType") return form;
  return {
    ...form,
    devices: form.devices.map((item) =>
      item.id === deviceId ? { ...item, [field]: String(text == null ? "" : text) } : item
    )
  };
};

/**
 * 加一条物资（GET /warehouse/material 的一行）。
 * @returns {{ form: object } | { error: string }}
 */
const addMaterial = (form, material) => {
  const label = materialLabel(material);
  if (form.type === "transfer") return { error: "转场不能加物资" };
  if (form.materials.some((item) => item.materialId === material.id)) {
    return { error: `${label} 已经在单里` };
  }
  // 返库只能另加耗材（退没用完的）；周转件要先在这个项目的在场清单里
  if (form.type === "back" && material.kind !== "consumable") {
    return { error: `${label} 不在这个项目的在场清单里` };
  }
  const row = materialRow({
    materialId: material.id,
    name: material.name,
    spec: material.spec,
    unit: material.unit,
    kind: material.kind,
    available: form.type === "out" ? Number(material.quantity || 0) : null
  });
  return { form: { ...form, materials: [...form.materials, row] } };
};

const removeMaterial = (form, materialId) => ({
  ...form,
  materials: form.materials.filter((item) => item.materialId !== materialId)
});

/** 改一行的数量。field: "quantity" | "returned" | "lost"；text 是输入框里的字符串。 */
const setMaterialQty = (form, materialId, field, text) => {
  if (field !== "quantity" && field !== "returned" && field !== "lost") return form;
  return {
    ...form,
    materials: form.materials.map((item) =>
      item.materialId === materialId ? { ...item, [field]: String(text == null ? "" : text) } : item
    )
  };
};

/** 设备还需几台的提示，随已加的设备减少。 */
const deviceNeedHints = (form) =>
  form.deviceNeeds.map((need) => {
    const picked = form.devices.filter((item) => item.categoryId === need.categoryId).length;
    const remaining = Math.max(0, need.count - picked);
    const name = need.specText ? `${need.categoryName}（${need.specText}）` : need.categoryName;
    const text =
      remaining === 0
        ? `${name}：已选够 ${picked} 台`
        : picked === 0
          ? `${name}：还需 ${remaining} 台，库里可用 ${need.available} 台`
          : `${name}：还需 ${remaining} 台（已选 ${picked} 台）`;
    return { categoryName: need.categoryName, need: need.count, picked, text };
  });

/** 一行物资里要用到的数量；空按 0，填错是 NaN。 */
const amountsOf = (form, row) => {
  const number = (text) => {
    const value = toQty(text);
    return value === null ? 0 : value;
  };
  if (form.type !== "back") return { quantity: number(row.quantity), returned: 0, lost: 0 };
  return {
    quantity: 0,
    returned: number(row.returned),
    // 耗材不报损
    lost: row.kind === "consumable" ? 0 : number(row.lost)
  };
};

const totalOf = (amounts) => amounts.quantity + amounts.returned + amounts.lost;

/** 提交前检查，返回第一条问题或 ""。 */
const shipProblem = (form) => {
  const config = SHIP_TYPES[form.type];
  if (config.needsProject && !form.projectId) return "请选择项目";
  if (config.needsToProject) {
    if (!form.toProjectId) return "请选择目的项目";
    if (form.toProjectId === form.projectId) return "来源和目的不能是同一个项目";
  }
  const rows = form.materials.map((row) => ({ row, amounts: amountsOf(form, row) }));
  const invalid = rows.find(({ amounts }) => Number.isNaN(totalOf(amounts)));
  if (invalid) return `${materialLabel(invalid.row)} 的数量不对`;
  if (form.type === "back") {
    const badDevice = form.devices.find((item) => Number.isNaN(toQty(item.usageMeters)));
    if (badDevice) return `${badDevice.code} 的顶进距离只填数字（米）`;
  }
  const filled = rows.filter(({ amounts }) => totalOf(amounts) > 0);
  if (form.devices.length + filled.length === 0) return "请至少添加一行";
  for (const { row, amounts } of filled) {
    if (row.available === null) continue;
    const label = materialLabel(row);
    const limit = formatQty(row.available);
    if (form.type === "out" && amounts.quantity > row.available + EPSILON) {
      return `${label} 库存只有 ${limit}`;
    }
    if (form.type === "transfer" && amounts.quantity > row.available + EPSILON) {
      return `${label} 在场只有 ${limit}`;
    }
    if (form.type === "back" && amounts.returned + amounts.lost > row.available + EPSILON) {
      return `${label} 退回加报损超过在场数 ${limit}`;
    }
  }
  return "";
};

const text = (value) => String(value || "").trim();

/** 请求体。数量为 0 的行不带；返库的周转件拆成退回和报损两行。 */
const toDocPayload = (form) => {
  const config = SHIP_TYPES[form.type];
  const back = form.type === "back";
  const materialLines = form.materials.flatMap((row) => {
    const amounts = amountsOf(form, row);
    if (!back) {
      return amounts.quantity > 0 ? [{ material_id: row.materialId, quantity: amounts.quantity }] : [];
    }
    return [
      ...(amounts.returned > 0
        ? [{ material_id: row.materialId, quantity: amounts.returned, outcome: "returned" }]
        : []),
      ...(amounts.lost > 0
        ? [{ material_id: row.materialId, quantity: amounts.lost, outcome: "lost" }]
        : [])
    ];
  });
  const deviceLines = form.devices.map((item) => {
    const meters = back ? toQty(item.usageMeters) : null;
    const soil = back ? text(item.soilType) : "";
    return {
      device_id: item.id,
      ...(meters !== null ? { usage_meters: meters } : {}),
      ...(soil ? { soil_type: soil } : {})
    };
  });
  return {
    doc_type: config.docType,
    client_request_id: form.requestId,
    ...(config.needsProject ? { project_id: form.projectId } : {}),
    ...(config.needsToProject ? { to_project_id: form.toProjectId } : {}),
    ...(form.type === "out" && form.kitId ? { project_kit_id: form.kitId } : {}),
    ...(form.type === "in" && text(form.counterparty) ? { counterparty: text(form.counterparty) } : {}),
    ...(form.type === "out" && text(form.handoverName) ? { handover_name: text(form.handoverName) } : {}),
    ...(text(form.remark) ? { remark: text(form.remark) } : {}),
    ...(form.photoKeys.length > 0 ? { photo_keys: [...form.photoKeys] } : {}),
    device_lines: deviceLines,
    material_lines: materialLines
  };
};

module.exports = {
  SHIP_TYPES,
  materialLabel,
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
  toDocPayload
};
