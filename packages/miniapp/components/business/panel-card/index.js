Component({
  properties: {
    title: {
      type: String,
      value: ""
    },
    subtitle: {
      type: String,
      value: ""
    },
    // 仅支持 emoji/中文符号。历史上有页面误传 t-icon 图标名（"app"/"list"…），
    // 本组件是文本节点渲染，英文词会直接上屏，所以含 ASCII 字母的值一律不显示。
    icon: {
      type: String,
      value: "",
      observer(value) {
        const text = String(value || "");
        this.setData({ iconText: /[A-Za-z]/.test(text) ? "" : text });
      }
    },
    divider: {
      type: Boolean,
      value: false
    }
  },

  data: {
    iconText: ""
  }
});
