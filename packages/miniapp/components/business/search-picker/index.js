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
      const filtered = [];
      for (let i = 0; i < range.length; i += 1) {
        if (!matches(slots[i], nq)) continue;
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

    open() {
      if (this.data.disabled) return;
      this.setData({ visible: true, query: "" });
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
      this.rebuild(query);
    },

    clearQuery() {
      this.setData({ query: "" });
      this.rebuild("");
    },

    onPick(e) {
      const index = Number(e.currentTarget.dataset.index || 0);
      this.setData({ visible: false });
      // 与原生 picker 的 bindchange 对齐：detail.value = 选中下标。
      // 这样父页面已有的 onXxxChange(e) { e.detail.value } 无需改动。
      this.triggerEvent("change", { value: index });
    }
  }
});
