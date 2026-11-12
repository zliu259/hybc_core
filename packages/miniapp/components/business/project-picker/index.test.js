/** 项目选择器：默认会自己选第一个项目；autoSelect 关掉后不选、不发事件。运行：node components/business/project-picker/index.test.js */
const assert = require("assert");
const path = require("path");

const PROJECTS = [
  { id: 1, project_name: "办公室", status: "active", project_code: "办公室" },
  { id: 3, project_name: "一号工程", status: "active", project_code: "P-3" }
];

const stub = (file, exports) => {
  const resolved = require.resolve(path.join(__dirname, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stub("../../../utils/request.js", { request: async () => ({ success: true, data: PROJECTS }) });

global.wx = { showToast: () => {} };
let config = null;
global.Component = (value) => {
  config = value;
};
require("./index.js");

const mount = (properties) => {
  const events = [];
  const instance = {
    properties: { value: 0, label: "所属项目", enableGps: true, excludeArchived: false, autoSelect: true, ...properties },
    data: { ...config.data },
    setData(patch) {
      this.data = { ...this.data, ...patch };
    },
    triggerEvent(name, detail) {
      events.push({ name, detail });
    },
    ...config.methods
  };
  return { instance, events };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

const run = async () => {
  assert.strictEqual(config.properties.autoSelect.value, true, "默认还是自己选第一个，老页面不受影响");

  // 默认：没有选中的项目时选第一个并通知页面
  let mounted = mount({});
  mounted.instance.loadProjects();
  await settle();
  assert.deepStrictEqual(mounted.events.map((event) => event.detail.projectId), [1]);
  assert.strictEqual(mounted.instance.data.hasSelection, true);

  // 关掉自动选：不发事件，显示"请选择项目"
  mounted = mount({ autoSelect: false });
  mounted.instance.loadProjects();
  await settle();
  assert.deepStrictEqual(mounted.events, []);
  assert.strictEqual(mounted.instance.data.selectedIndex, -1);
  assert.strictEqual(mounted.instance.data.hasSelection, false);
  assert.strictEqual(mounted.instance.data.projectNames.length, 2);

  // 关掉自动选，页面已经给了项目：选中它，不发事件
  mounted = mount({ autoSelect: false, value: 3 });
  mounted.instance.loadProjects();
  await settle();
  assert.deepStrictEqual(mounted.events, []);
  assert.strictEqual(mounted.instance.data.selectedIndex, 1);
  assert.strictEqual(mounted.instance.data.hasSelection, true);

  // 列表先到、页面后给项目：跟着选中
  mounted = mount({ autoSelect: false });
  mounted.instance.loadProjects();
  await settle();
  mounted.instance.syncSelectedIndex(3);
  assert.strictEqual(mounted.instance.data.selectedIndex, 1);
  assert.deepStrictEqual(mounted.events, []);

  // 人点了才发事件
  mounted.instance.onPickerChange({ detail: { value: 0 } });
  assert.deepStrictEqual(mounted.events.map((event) => event.detail.projectId), [1]);

  console.log("project-picker tests passed");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
