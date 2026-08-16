const { buildSlots, normalizeQuery, matches } = require("../../../utils/pinyin");

// 把展示 label 拆成主/次两行，便于阅读：
//   "宏图建材 (工商银行深圳分行)"        -> 宏图建材 / 工商银行深圳分行
//   "对方单位｜材料｜剩余 100 元｜张三"  -> 对方单位 / 材料 · 剩余 100 元 · 张三
//   其它（占位/无分隔）                  -> 整串 / 空
const splitLabel = (label) => {
  const text = String(label == null ? "" : label);
  if (text.indexOf("｜") > -1) {
    const parts = text.split("｜").map((s) => s.trim()).filter(Boolean);
    return { primary: parts[0] || text, secondary: parts.slice(1).join(" · ") };
  }
  const open = text.lastIndexOf(" (");
  if (open > 0 && text.endsWith(")")) {
    return {
      primary: text.slice(0, open).trim(),
      secondary: text.slice(open + 2, -1).trim()
    };
  }
  return { primary: text, secondary: "" };
};

Component({
  options: {
    styleIsolation: "apply-shared"
  },

  properties: {
    // 展示用的候选项文案数组，与原生 <picker mode="selector"> 的 range 完全一致。
    range: {
      type: Array,
      value: [],
      observer(list) {
        this._slots = (Array.isArray(list) ? list : []).map((item) => buildSlots(item));
        this.updateSelected();
        if (this.data.visible) this.rebuild(this.data.query);
      }
    },
    // 选中项的下标，与原生 picker 的 value 一致（0 通常是占位/「无」项）。
    value: {
      type: Number,
      value: 0,
      observer() {
        this.updateSelected();
        if (this.data.visible) this.rebuild(this.data.query);
      }
    },
    // range[0] 是否为占位/「无」项（如「请选择…」「无合同」）。
    // true（默认）：下标 0 不算已选，字段显示 placeholder。
    // false：range 无占位项，下标 0 即首个真实选项（如项目选择器）。
    hasPlaceholderOption: {
      type: Boolean,
      value: true,
      observer() {
        this.updateSelected();
      }
    },
    // 未选中时字段显示的占位文案。
    placeholder: {
      type: String,
      value: "请选择"
    },
    // 弹层标题。
    title: {
      type: String,
      value: "请选择"
    },
    searchPlaceholder: {
      type: String,
      value: "输入名称 / 拼音 / 首字母搜索"
    },
    emptyText: {
      type: String,
      value: "暂无可选项"
    },
    disabled: {
      type: Boolean,
      value: false
    },
    // 打开弹层时是否自动聚焦搜索框（弹起键盘）。默认 false：多数场景是滚动+点选，
    // 不该强行遮挡列表；需要即打即搜时由调用方显式开启。
    autoFocus: {
      type: Boolean,
      value: false
    },
    // 远程搜索模式：输入防抖后抛 search 事件（detail.keyword），由调用方请求服务端
    // 并替换 range；此模式下不做本地拼音过滤——服务端可能按备注等 label 里不存在
    // 的字段命中，本地再筛会把合法结果滤掉。range/value/change 下标语义不变。
    remote: {
      type: Boolean,
      value: false
    },
    // 远程搜索请求进行中（由调用方控制），用于列表内展示"搜索中"占位。
    remoteLoading: {
      type: Boolean,
      value: false
    }
  },

  data: {
    visible: false,
    query: "",
    filtered: [],
    selectedLabel: "",
    selectedPrimary: "",
    selectedSecondary: "",
    hasSelection: false
  },

  lifetimes: {
    attached() {
      if (!this._slots) {
        const list = this.data.range || [];
        this._slots = list.map((item) => buildSlots(item));
      }
      this.updateSelected();
    },
    detached() {
      if (this._remoteTimer) clearTimeout(this._remoteTimer);
    }
  },

  methods: {
    updateSelected() {
      const range = this.data.range || [];
      const value = Number(this.data.value || 0);
      const label = range[value] || "";
      // 有占位项时下标 0 不算已选；无占位项时只要有对应文案即为已选。
      const hasSelection = this.data.hasPlaceholderOption
        ? value > 0 && Boolean(label)
        : Boolean(label);
      // 字段展示与下拉行一致：拆成主/次，避免直接甩出带｜的原始串。
      const parts = hasSelection ? splitLabel(label) : { primary: "", secondary: "" };
      this.setData({
        selectedLabel: label,
        selectedPrimary: parts.primary,
        selectedSecondary: parts.secondary,
        hasSelection
      });
    },

    rebuild(query) {
      const range = this.data.range || [];
      const slots = this._slots || [];
      const nq = normalizeQuery(query);
      const value = Number(this.data.value || 0);
      // 远程模式下 range 已由调用方按服务端结果收敛，本地不再二次过滤
      const skipLocalFilter = Boolean(this.data.remote);
      const filtered = [];
      for (let i = 0; i < range.length; i += 1) {
        if (!skipLocalFilter && !matches(slots[i], nq)) continue;
        const parts = splitLabel(range[i]);
        filtered.push({
          index: i,
          primary: parts.primary,
          secondary: parts.secondary,
          checked: i === value
        });
      }
      this.setData({ filtered });
    },

    emitRemoteSearch(keyword, immediate) {
      if (!this.data.remote) return;
      if (this._remoteTimer) clearTimeout(this._remoteTimer);
      if (immediate) {
        this.triggerEvent("search", { keyword });
        return;
      }
      this._remoteTimer = setTimeout(() => {
        this.triggerEvent("search", { keyword });
      }, 300);
    },

    open() {
      if (this.data.disabled) return;
      this.setData({ visible: true, query: "" });
      // 上次搜索态可能仍残留在调用方 range 里，打开时通知其恢复默认列表
      this.emitRemoteSearch("", true);
      this.rebuild("");
    },

    close() {
      this.setData({ visible: false });
    },

    onVisibleChange(e) {
      const visible = Boolean(e.detail && e.detail.visible);
      this.setData({ visible });
    },

    onQueryInput(e) {
      const query = (e.detail && e.detail.value) || "";
      this.setData({ query });
      this.emitRemoteSearch(query.trim(), false);
      this.rebuild(query);
    },

    clearQuery() {
      this.setData({ query: "" });
      this.emitRemoteSearch("", true);
      this.rebuild("");
    },

    onPick(e) {
      const index = Number(e.currentTarget.dataset.index || 0);
      this.setData({ visible: false });
      // 与原生 picker 的 bindchange 对齐：detail.value = 选中下标。
      // 这样父页面已有的 onXxxChange(e) { e.detail.value } 无需改动。
      this.triggerEvent("change", { value: index });
      // 远程模式：选完立即让调用方退出搜索态恢复默认 range（change 先于 search
      // 触发，调用方先落选中值、再重建视图，选中项由其置顶逻辑保留）
      this.emitRemoteSearch("", true);
    }
  }
});
