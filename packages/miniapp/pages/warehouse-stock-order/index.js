const { request } = require("../../utils/request");
const { wxScanCode } = require("../../utils/wx");

const ORDER_TYPES = [
  { label: "入库", value: "inbound" },
  { label: "出库", value: "outbound" },
  { label: "调拨", value: "transfer" }
];

const PRESET_TEMPLATES = [
  {
    id: "tbm-standard",
    name: "标准顶管掘进组",
    items: [
      { keyword: "主机", qty: 1 },
      { keyword: "泥浆泵", qty: 2 },
      { keyword: "刀盘", qty: 20 },
      { keyword: "连接件", qty: 50 }
    ]
  },
  {
    id: "safety-pack",
    name: "现场安全巡检包",
    items: [
      { keyword: "安全", qty: 10 },
      { keyword: "警示", qty: 20 },
      { keyword: "照明", qty: 4 }
    ]
  }
];

const lower = (text) => String(text || "").trim().toLowerCase();

const buildSearchText = (assetType) =>
  `${assetType.type_code || ""} ${assetType.type_name || ""}`.toLowerCase();

Page({
  data: {
    busy: false,
    warehouses: [],
    warehouseNames: [],
    assetTypes: [],
    filteredAssetTypes: [],
    orders: [],

    orderTypeNames: ORDER_TYPES.map((item) => item.label),
    orderTypeIndex: 1,
    fromWarehouseIndex: -1,
    toWarehouseIndex: -1,

    assetKeyword: "",
    currentAddQty: "1",
    cartItems: [],

    templates: PRESET_TEMPLATES,
    templateNames: PRESET_TEMPLATES.map((item) => item.name),
    templateIndex: 0
  },

  onShow() {
    this.loadData();
  },

  toOrderTypeLabel(value) {
    const hit = ORDER_TYPES.find((item) => item.value === value);
    return hit ? hit.label : value;
  },

  toStatusLabel(status) {
    if (status === "draft") return "草稿";
    if (status === "pending_approval") return "待审批";
    if (status === "approved") return "已通过";
    if (status === "executed") return "已执行";
    if (status === "rejected") return "已驳回";
    if (status === "cancelled") return "已取消";
    return status;
  },

  refreshFilteredAssetTypes(keyword = this.data.assetKeyword) {
    const q = lower(keyword);
    if (!q) {
      this.setData({ filteredAssetTypes: [] });
      return;
    }
    const list = this.data.assetTypes.filter((item) => (item.search_text || "").includes(q));
    this.setData({ filteredAssetTypes: list.slice(0, 50) });
  },

  async loadData() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const [warehouseRes, typeRes, orderRes] = await Promise.all([
        request({ method: "GET", path: "/api/v1/warehouse" }),
        request({ method: "GET", path: "/api/v1/asset/type" }),
        request({ method: "GET", path: "/api/v1/warehouse/stock-order" })
      ]);
      const warehouses = Array.isArray(warehouseRes.data) ? warehouseRes.data : [];
      const assetTypes = (Array.isArray(typeRes.data) ? typeRes.data : []).map((item) => ({
        ...item,
        search_text: buildSearchText(item)
      }));
      const orders = (Array.isArray(orderRes.data) ? orderRes.data : [])
        .slice()
        .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
        .slice(0, 40)
        .map((item) => ({
          ...item,
          orderTypeText: this.toOrderTypeLabel(item.order_type),
          statusText: this.toStatusLabel(item.status)
        }));
      this.setData({
        warehouses,
        warehouseNames: warehouses.map((item) => `${item.warehouse_code} · ${item.warehouse_name}`),
        assetTypes,
        orders
      });
      this.refreshFilteredAssetTypes();
    } catch (error) {
      wx.showToast({ title: error.message || "数据加载失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  },

  onOrderTypeChange(e) {
    this.setData({ orderTypeIndex: Number(e.detail.value || 0) });
  },

  onFromWarehouseChange(e) {
    this.setData({ fromWarehouseIndex: Number(e.detail.value || 0) });
  },

  onToWarehouseChange(e) {
    this.setData({ toWarehouseIndex: Number(e.detail.value || 0) });
  },

  onAssetKeywordInput(e) {
    const assetKeyword = e.detail.value || "";
    this.setData({ assetKeyword });
    this.refreshFilteredAssetTypes(assetKeyword);
  },

  onCurrentAddQtyInput(e) {
    this.setData({ currentAddQty: e.detail.value || "" });
  },

  addAssetToCart(assetTypeId, quantity = Number(this.data.currentAddQty || 1)) {
    const assetType = this.data.assetTypes.find((item) => Number(item.id) === Number(assetTypeId));
    if (!assetType) {
      wx.showToast({ title: "资产类型不存在", icon: "none" });
      return;
    }
    const qty = Number(quantity || 0);
    if (!qty || qty <= 0) {
      wx.showToast({ title: "数量必须大于0", icon: "none" });
      return;
    }

    const cartItems = [...this.data.cartItems];
    const hit = cartItems.find((item) => Number(item.asset_type_id) === Number(assetType.id));
    if (hit) {
      hit.quantity = Number(hit.quantity || 0) + qty;
    } else {
      cartItems.push({
        asset_type_id: Number(assetType.id),
        type_code: assetType.type_code,
        type_name: assetType.type_name,
        unit: assetType.unit || "",
        quantity: qty
      });
    }

    this.setData({ cartItems, currentAddQty: "1" });
    wx.showToast({ title: "已加入清单", icon: "success" });
  },

  onTapAddAsset(e) {
    const assetTypeId = Number(e.currentTarget.dataset.id || 0);
    if (!assetTypeId) return;
    this.addAssetToCart(assetTypeId);
  },

  async onScanAddAsset() {
    if (this.data.busy) return;
    try {
      const scan = await wxScanCode();
      const raw = String((scan && scan.result) || "").trim();
      if (!raw) {
        wx.showToast({ title: "未识别到有效内容", icon: "none" });
        return;
      }

      const normalized = raw.toLowerCase();
      const exact = this.data.assetTypes.find(
        (item) => lower(item.type_code) === normalized || lower(item.type_name) === normalized
      );
      if (exact) {
        this.addAssetToCart(exact.id);
        return;
      }

      const numeric = Number(raw.replace(/\D/g, "") || 0);
      if (numeric > 0) {
        try {
          const assetRes = await request({ method: "GET", path: `/api/v1/asset/${numeric}` });
          const typeId = Number(((assetRes || {}).data || {}).asset_type_id || 0);
          if (typeId > 0) {
            this.addAssetToCart(typeId);
            return;
          }
        } catch {
        }
      }

      const fuzzy = this.data.assetTypes.find((item) => (item.search_text || "").includes(normalized));
      if (fuzzy) {
        this.addAssetToCart(fuzzy.id);
        return;
      }

      wx.showToast({ title: "未匹配到资产类型，请改用关键字查询", icon: "none" });
    } catch {
      wx.showToast({ title: "扫码取消", icon: "none" });
    }
  },

  onTemplateChange(e) {
    this.setData({ templateIndex: Number(e.detail.value || 0) });
  },

  applyTemplate() {
    const template = this.data.templates[this.data.templateIndex];
    if (!template) return;

    const matches = [];
    template.items.forEach((rule) => {
      const keyword = lower(rule.keyword);
      const hit = this.data.assetTypes.find((item) => (item.search_text || "").includes(keyword));
      if (hit) {
        matches.push({ id: hit.id, qty: Number(rule.qty || 1) });
      }
    });

    if (!matches.length) {
      wx.showToast({ title: "模板未匹配到资产类型，请先完善资产类型库", icon: "none" });
      return;
    }

    const cartItems = [];
    matches.forEach((row) => {
      const item = this.data.assetTypes.find((it) => Number(it.id) === Number(row.id));
      if (!item) return;
      cartItems.push({
        asset_type_id: Number(item.id),
        type_code: item.type_code,
        type_name: item.type_name,
        unit: item.unit || "",
        quantity: Number(row.qty || 1)
      });
    });

    this.setData({ cartItems });
    wx.showToast({ title: `模板已套用：${template.name}`, icon: "success" });
  },

  onCartQtyInput(e) {
    const index = Number(e.currentTarget.dataset.index || -1);
    if (index < 0) return;
    const qty = Number(e.detail.value || 0);
    const cartItems = [...this.data.cartItems];
    if (!cartItems[index]) return;
    cartItems[index].quantity = qty;
    this.setData({ cartItems });
  },

  removeCartItem(e) {
    const index = Number(e.currentTarget.dataset.index || -1);
    if (index < 0) return;
    const cartItems = [...this.data.cartItems];
    cartItems.splice(index, 1);
    this.setData({ cartItems });
  },

  clearCart() {
    this.setData({ cartItems: [] });
  },

  validateOrder(orderType, fromWarehouse, toWarehouse) {
    if (!this.data.cartItems.length) {
      wx.showToast({ title: "请先添加设备/耗材到制单清单", icon: "none" });
      return false;
    }
    if (this.data.cartItems.some((item) => Number(item.quantity || 0) <= 0)) {
      wx.showToast({ title: "清单中数量必须大于0", icon: "none" });
      return false;
    }
    if (orderType.value === "inbound" && !toWarehouse) {
      wx.showToast({ title: "入库单需选择目标仓库", icon: "none" });
      return false;
    }
    if (orderType.value === "outbound" && !fromWarehouse) {
      wx.showToast({ title: "出库单需选择来源仓库", icon: "none" });
      return false;
    }
    if (orderType.value === "transfer") {
      if (!fromWarehouse || !toWarehouse) {
        wx.showToast({ title: "调拨单需选择来源与目标仓库", icon: "none" });
        return false;
      }
      if (Number(fromWarehouse.id) === Number(toWarehouse.id)) {
        wx.showToast({ title: "调拨来源与目标仓库不能相同", icon: "none" });
        return false;
      }
    }
    return true;
  },

  async createOrder() {
    if (this.data.busy) return;

    const orderType = ORDER_TYPES[this.data.orderTypeIndex] || ORDER_TYPES[0];
    const fromWarehouse =
      this.data.fromWarehouseIndex >= 0 ? this.data.warehouses[this.data.fromWarehouseIndex] : null;
    const toWarehouse =
      this.data.toWarehouseIndex >= 0 ? this.data.warehouses[this.data.toWarehouseIndex] : null;

    if (!this.validateOrder(orderType, fromWarehouse, toWarehouse)) return;

    this.setData({ busy: true });
    try {
      const items = this.data.cartItems.map((item) => ({
        asset_type_id: Number(item.asset_type_id),
        quantity: Number(item.quantity)
      }));

      const createRes = await request({
        method: "POST",
        path: "/api/v1/warehouse/stock-order",
        data: {
          order_type: orderType.value,
          from_warehouse_id: fromWarehouse ? Number(fromWarehouse.id) : undefined,
          to_warehouse_id: toWarehouse ? Number(toWarehouse.id) : undefined,
          items
        }
      });

      const createdId = Number((createRes.data || {}).id || 0);
      if (createdId) {
        await request({
          method: "POST",
          path: `/api/v1/warehouse/stock-order/${createdId}/submit-approval`,
          data: { biz_summary: `${orderType.label}制单（${items.length}项）` }
        }).catch(() => {});
      }

      wx.showToast({ title: "制单成功", icon: "success" });
      this.setData({ cartItems: [] });
      await this.loadData();
    } catch (error) {
      wx.showToast({ title: error.message || "制单失败", icon: "none" });
    } finally {
      this.setData({ busy: false });
    }
  }
});
