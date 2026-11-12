/** 项目在场页和库存页的视图模型。纯函数。 */
const { formatQty, formatTime } = require("./wh-format");
const { canEditProject, statusLabelOf } = require("./wh-kit-view");
const { DOC_TYPE_LABELS, KIT_STATUS_THEME, MATERIAL_KIND_LABELS } = require("./wh-labels");

const labelOf = (item) => [item.name, item.spec].filter(Boolean).join(" ");

const docSummary = (doc) => {
  const lines = `${Number(doc.line_count || 0)} 行`;
  if (doc.reverses_doc_id) return `${lines} · 冲销单`;
  if (doc.reversed_by_doc_no) return `${lines} · 已冲销`;
  return doc.doc_type === "transfer"
    ? `${doc.project_name || ""} → ${doc.to_project_name || ""} · ${lines}`
    : lines;
};

/**
 * @param {object | null} ledger GET /warehouse/project/:id/ledger 的 data；没取到传 null
 * @param {object[] | null} docs GET /warehouse/doc?project_id= 的 data；没取到传 null
 * @param {{ userid: string, roles: string[], caps: object }} viewer
 */
const buildProjectView = (ledger, docs, viewer) => {
  const keeper = Boolean(viewer && viewer.caps && viewer.caps.is_keeper);
  const settled = Boolean(ledger && ledger.settled);
  const somethingOnSite = Boolean(ledger) && !settled;
  return {
    projectName: ledger ? ledger.project_name : "",
    settled,
    settledText: !ledger
      ? ""
      : settled
        ? "已结清"
        : `设备 ${Number(ledger.devices_on_site || 0)} 台、周转件 ${Number(ledger.turnover_kinds_on_site || 0)} 种在场`,
    devices: (ledger && Array.isArray(ledger.devices) ? ledger.devices : []).map((device) => ({
      id: device.id,
      code: device.device_code,
      name: device.name,
      stateLabel: device.state_label
    })),
    // 只列还在场的周转件；耗材发出即用掉，没有在场数
    materials: (ledger && Array.isArray(ledger.materials) ? ledger.materials : [])
      .filter((item) => item.kind === "turnover" && Number(item.on_site) > 0)
      .map((item) => ({
        materialId: item.material_id,
        label: labelOf(item),
        unit: item.unit || "",
        onSiteText: formatQty(item.on_site),
        shippedText: formatQty(item.shipped),
        returnedText: formatQty(item.returned),
        lostText: formatQty(item.lost)
      })),
    kits: (ledger && Array.isArray(ledger.kits) ? ledger.kits : []).map((kit) => ({
      id: kit.id,
      kitNo: kit.kit_no,
      title: kit.title,
      statusLabel: statusLabelOf(kit),
      statusTheme: KIT_STATUS_THEME[kit.status] || "default"
    })),
    docs: (Array.isArray(docs) ? docs : []).map((doc) => ({
      id: doc.id,
      docNo: doc.doc_no,
      typeLabel: DOC_TYPE_LABELS[doc.doc_type] || "库房单",
      timeText: formatTime(doc.occurred_at),
      summary: docSummary(doc),
      reversed: Boolean(doc.reverses_doc_id) || Boolean(doc.reversed_by_doc_no)
    })),
    actions: {
      canShip: keeper,
      // 有东西在场才有得返、有得转
      canReturn: keeper && somethingOnSite,
      canTransfer: keeper && somethingOnSite,
      canCreateKit: Boolean(ledger) && canEditProject(ledger.project_manager_userid, viewer)
    }
  };
};

/** 库存行：到了最低库存就标出来。 */
const toMaterialRow = (material) => {
  const hasMin = material.min_stock !== null && material.min_stock !== undefined;
  return {
    id: material.id,
    label: labelOf(material),
    unit: material.unit || "",
    kindLabel: MATERIAL_KIND_LABELS[material.kind] || "",
    quantityText: formatQty(material.quantity),
    low: hasMin && Number(material.quantity) <= Number(material.min_stock),
    minStockText: hasMin ? `最低 ${formatQty(material.min_stock)}` : ""
  };
};

module.exports = { buildProjectView, toMaterialRow };
