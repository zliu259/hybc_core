/**
 * 报销页的流程测试：真实页面代码 + 真实上传队列和视图模型，只替换接口、R2 上传和 wx。
 * 界面仍要在开发者工具和真机上看。
 */
const assert = require("assert");
const path = require("path");

const flush = async () => {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

const ENVELOPE_ID = 77;
const VALID_UUID = "6a96f901-2c4b-4b65-8bcb-8a50d72b276c";

const state = {};

const guidanceOf = (fields = {}) => ({
  tone: "normal",
  headline: "还有 1 张发票在识别",
  next_step: "可以等识别完再确认金额，也可以自己填好直接提交。",
  note: null,
  actions: [{ key: "submit", label: "提交报销" }],
  ...fields
});

const baseDetail = (fields = {}) => ({
  id: ENVELOPE_ID,
  status: "draft",
  channel: "electronic",
  project_id: 5,
  amount: 0,
  envelope_uuid: VALID_UUID,
  precheck_status: "none",
  category: "办公费用",
  description: "",
  expense_date: null,
  attachments: [],
  attachment_views: [],
  review_totals: {
    attachment_count: 0,
    recognized_count: 0,
    recognizing_count: 0,
    failed_count: 0,
    no_amount_count: 0,
    not_invoice_count: 0,
    extracted_total: 0,
    declared_amount: 0,
    complete: false,
    delta: null,
    mismatch: false
  },
  guidance: { applicant: guidanceOf({ headline: "还差发票，传完就能提交" }), office: null },
  batch: null,
  ...fields
});

const viewOf = (id, stateName, fields = {}) => ({
  attachment_id: id,
  file_key: `reimbursement/${id}.pdf`,
  file_name: `${id}.pdf`,
  file_size: 100,
  state: stateName,
  display_name: `${id}.pdf`,
  amount: null,
  invoice_no: null,
  invoice_date: null,
  seller_name: null,
  raw_text_summary: null,
  duplicates: [],
  attention: null,
  ...fields
});

const resetState = () => {
  state.calls = [];
  state.toasts = [];
  state.modals = [];
  state.modalConfirm = true;
  state.uploads = [];
  state.autoUpload = true;
  state.pickedImages = [];
  state.pickedFiles = [];
  state.detail = baseDetail();
  state.bound = [];
  state.submitResponses = [];
  state.createFails = false;
  state.sheetIndex = 0;
  state.sheetItems = [];
  state.previewed = [];
  state.bindFailsOnce = undefined;
  state.uploadCount = 0;
};

const call = (method, url) => state.calls.filter((item) => item.method === method && item.path === url);

const respond = (options) => {
  const { method, path: url, data, header } = options;
  state.calls.push({ method, path: url, data, header });

  if (method === "POST" && url === "/api/v1/reimbursement") {
    if (state.createFails) throw new Error("建草稿失败");
    return { data: { id: ENVELOPE_ID, envelope_no: "NO", envelope_uuid: VALID_UUID } };
  }
  if (method === "POST" && url === `/api/v1/reimbursement/${ENVELOPE_ID}/attachments`) {
    if (state.bindFailsOnce) {
      state.bindFailsOnce = false;
      throw new Error("网络不太好");
    }
    state.bound = [...state.bound, ...data.attachments];
    return { data: { attachment_ids: state.bound.map((_, index) => index + 1) } };
  }
  if (method === "PUT" && url === `/api/v1/reimbursement/${ENVELOPE_ID}`) return { success: true };
  if (method === "GET" && url === `/api/v1/reimbursement/${ENVELOPE_ID}`) return { data: state.detail };
  if (method === "POST" && url === `/api/v1/reimbursement/${ENVELOPE_ID}/submit`) {
    const next = state.submitResponses.shift();
    if (next && next.error) throw next.error;
    return next || { data: { id: ENVELOPE_ID, status: "submitted" } };
  }
  if (method === "POST" && url.endsWith("/delete")) return { data: {} };
  if (method === "POST" && url.endsWith("/rerecognize")) return { data: { task_id: 99 } };
  if (method === "POST" && url === "/api/v1/upload/sign-download") {
    return { data: { url: `/signed/${data.key}` } };
  }
  throw new Error(`未预期的请求 ${method} ${url}`);
};

global.wx = {
  showToast: (options) => state.toasts.push(options.title),
  showModal: (options) => {
    state.modals.push(options);
    options.success({ confirm: state.modalConfirm });
  },
  showActionSheet: (options) => {
    state.sheetItems = options.itemList;
    options.success({ tapIndex: state.sheetIndex });
  },
  showLoading: () => {},
  hideLoading: () => {},
  vibrateShort: () => {},
  vibrateLong: () => {},
  redirectTo: () => {},
  navigateTo: () => {},
  previewImage: (options) => state.previewed.push(options.current),
  downloadFile: (options) => options.success({ statusCode: 200, tempFilePath: "/tmp/doc.pdf" }),
  openDocument: () => {},
  getStorageSync: () => "",
  setStorageSync: () => {},
  env: {}
};

const stubModule = (file, exports) => {
  const resolved = path.join(__dirname, file);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stubModule("request.js", {
  request: async (options) => respond(options),
  buildUrl: (url) => `https://api.test${url}`
});
stubModule("auth.js", { getToken: () => "token", getUserProfile: () => ({ username: "me", roles: ["operator"] }) });
stubModule("upload.js", {
  uploadFileToR2: (filePath, options) => {
    state.uploadCount = (state.uploadCount || 0) + 1;
    if (state.autoUpload) return Promise.resolve({ key: `reimbursement/${options.fileName}` });
    return new Promise((resolve, reject) => {
      state.uploads.push({ filePath, options, resolve: () => resolve({ key: `reimbursement/${options.fileName}` }), reject });
    });
  }
});
stubModule("wx.js", {
  wxScanCode: async () => ({ result: VALID_UUID }),
  wxChooseMediaImage: async (options) => {
    state.mediaOptions = options;
    return { tempFiles: state.pickedImages };
  },
  wxChooseLocalFile: async (options) => {
    state.localOptions = options;
    return { tempFiles: state.pickedFiles };
  },
  wxChooseMessageFile: async (options) => {
    state.messageOptions = options;
    return { tempFiles: state.pickedFiles };
  },
  isMessageFilePickerSupported: () => true
});

let pageConfig = null;
global.Page = (config) => {
  pageConfig = config;
};
require("../packageFinance/reimbursement/index.js");

const openPage = async (options = {}) => {
  const page = {
    ...pageConfig,
    data: JSON.parse(JSON.stringify(pageConfig.data)),
    setData(patch, callback) {
      const next = { ...this.data };
      Object.entries(patch).forEach(([key, value]) => {
        if (key.startsWith("draft.")) {
          next.draft = { ...next.draft, [key.slice(6)]: value };
        } else {
          next[key] = value;
        }
      });
      this.data = next;
      if (callback) callback();
    }
  };
  await page.onLoad(options);
  await flush();
  return page;
};

const openExisting = async (fields = {}) => {
  state.detail = baseDetail(fields);
  return openPage({ id: String(ENVELOPE_ID) });
};

const newElectronicPage = async () => {
  const page = await openPage();
  page.onChannelChange({ detail: { value: 1 } });
  page.onProjectChange({ detail: { projectId: 5 } });
  return page;
};

const event = (dataset) => ({ currentTarget: { dataset } });
const image = (name, size = 100) => ({ path: `/tmp/${name}`, name, size });

const tests = {
  async "一次选 3 张：3 次绑定，只调 POST /attachments，不调 /electronic-upload"() {
    const page = await newElectronicPage();
    state.pickedImages = [image("a.jpg"), image("b.jpg"), image("c.jpg")];
    await page.pickImages();
    await flush();
    assert.strictEqual(state.mediaOptions.count, 9);
    assert.strictEqual(call("POST", `/api/v1/reimbursement/${ENVELOPE_ID}/attachments`).length, 3);
    assert.strictEqual(state.calls.filter((item) => item.path.includes("electronic-upload")).length, 0);
    assert.deepStrictEqual(state.bound.map((item) => item.file_name).sort(), ["a.jpg", "b.jpg", "c.jpg"]);
    page.onUnload();
  },

  async "电子通道第一张传完自动建草稿，后面传到同一单"() {
    const page = await newElectronicPage();
    state.pickedImages = [image("a.jpg"), image("b.jpg"), image("c.jpg")];
    await page.pickImages();
    await flush();
    assert.strictEqual(call("POST", "/api/v1/reimbursement").length, 1);
    assert.strictEqual(page.data.latestEnvelopeId, ENVELOPE_ID);
    page.onUnload();
  },

  async "绑定时带 file_size"() {
    const page = await newElectronicPage();
    state.pickedImages = [image("a.jpg", 2048)];
    await page.pickImages();
    await flush();
    assert.strictEqual(state.bound[0].file_size, 2048);
    assert.strictEqual(state.bound[0].attachment_type, undefined);
    page.onUnload();
  },

  async "没选项目不能传"() {
    const page = await openPage();
    page.onChannelChange({ detail: { value: 1 } });
    state.pickedImages = [image("a.jpg")];
    await page.onUploadTap();
    await flush();
    assert.strictEqual(state.calls.length, 0);
    assert.ok(state.toasts[0].includes("所属项目"));
    page.onUnload();
  },

  async "实物信封没有识别号不能传"() {
    const page = await openPage();
    page.onProjectChange({ detail: { projectId: 5 } });
    await page.onUploadTap();
    await flush();
    assert.strictEqual(state.calls.length, 0);
    assert.ok(state.toasts[0].includes("识别号"));
    page.onUnload();
  },

  async "选文件走本地文件和会话文件，放开数量"() {
    const page = await newElectronicPage();
    state.pickedFiles = [image("a.PDF")];
    state.sheetIndex = 2;
    await page.onUploadTap();
    await flush();
    assert.strictEqual(state.localOptions.count, 30);
    assert.deepStrictEqual(state.localOptions.extension, [".pdf", ".jpg", ".jpeg", ".png"]);
    state.pickedFiles = [image("b.pdf")];
    state.sheetIndex = 1;
    await page.onUploadTap();
    await flush();
    assert.strictEqual(state.messageOptions.count, 30);
    assert.strictEqual(state.bound.length, 2);
    page.onUnload();
  },

  async "格式不对的不传，其余继续"() {
    const page = await newElectronicPage();
    state.pickedFiles = [image("a.heic"), image("b.pdf")];
    await page.pickLocalFiles();
    await flush();
    assert.deepStrictEqual(state.bound.map((item) => item.file_name), ["b.pdf"]);
    assert.ok(state.toasts.some((title) => title.includes("只支持 PDF、JPG、PNG")));
    page.onUnload();
  },

  async "和已有附件相同的跳过并提示"() {
    const page = await openExisting({
      attachment_views: [viewOf(1, "recognized", { file_name: "a.pdf", file_size: 100, amount: 5 })]
    });
    state.pickedFiles = [image("a.pdf", 100), image("b.pdf", 100)];
    await page.pickLocalFiles();
    await flush();
    assert.deepStrictEqual(state.bound.map((item) => item.file_name), ["b.pdf"]);
    assert.ok(state.toasts.some((title) => title.includes("a.pdf")));
    page.onUnload();
  },

  async "传的过程中提交不可点，传完可点"() {
    const page = await openExisting({
      attachment_views: [viewOf(1, "recognized", { amount: 5 })],
      guidance: { applicant: guidanceOf(), office: null }
    });
    assert.strictEqual(page.data.canSubmit, true);
    state.autoUpload = false;
    state.pickedImages = [image("a.jpg"), image("b.jpg")];
    await page.pickImages();
    await flush();
    assert.strictEqual(page.data.canSubmit, false);
    assert.strictEqual(page.data.headline, "还有 2 张发票没传完");
    assert.strictEqual(page.data.nextStep, "传完确认金额，就可以提交了。");
    assert.ok(page.data.rows[0].kind === "upload");

    state.uploads[0].resolve();
    await flush();
    assert.strictEqual(page.data.headline, "还有 1 张发票没传完");
    state.uploads[1].resolve();
    await flush();
    assert.strictEqual(page.data.canSubmit, true);
    assert.strictEqual(page.data.headline, "还有 1 张发票在识别");
    page.onUnload();
  },

  async "失败的可重试，成功后提交可点"() {
    const page = await openExisting({ guidance: { applicant: guidanceOf(), office: null } });
    state.autoUpload = false;
    state.pickedImages = [image("a.jpg"), image("b.jpg")];
    await page.pickImages();
    await flush();
    state.uploads[0].reject(new Error("断网了"));
    state.uploads[1].resolve();
    await flush();
    assert.strictEqual(page.data.canSubmit, false);
    const failed = page.data.rows.find((row) => row.kind === "upload");
    assert.strictEqual(failed.canRetry, true);
    assert.strictEqual(failed.error, "断网了");

    page.retryUpload(event({ id: failed.localId }));
    await flush();
    state.uploads[2].resolve();
    await flush();
    assert.strictEqual(page.data.canSubmit, true);
    assert.strictEqual(state.bound.length, 2);
    page.onUnload();
  },

  async "建草稿失败时每个文件都算失败，重试会再建"() {
    const page = await newElectronicPage();
    state.createFails = true;
    state.pickedImages = [image("a.jpg")];
    await page.pickImages();
    await flush();
    assert.strictEqual(page.data.rows[0].canRetry, true);
    state.createFails = false;
    page.retryUpload(event({ id: page.data.rows[0].localId }));
    await flush();
    assert.strictEqual(page.data.latestEnvelopeId, ENVELOPE_ID);
    assert.strictEqual(state.bound.length, 1);
    page.onUnload();
  },

  async "一直失败的文件可以移除，移除后能提交"() {
    const page = await openExisting({ amount: 10, guidance: { applicant: guidanceOf(), office: null } });
    state.autoUpload = false;
    state.pickedImages = [image("a.jpg")];
    await page.pickImages();
    await flush();
    state.uploads[0].reject(new Error("一张报销最多 30 个附件"));
    await flush();
    assert.strictEqual(page.data.canSubmit, false);
    page.dismissUpload(event({ id: page.data.rows[0].localId }));
    await flush();
    assert.strictEqual(page.data.rows.filter((row) => row.kind === "upload").length, 0);
    assert.strictEqual(page.data.canSubmit, true);
    page.onUnload();
  },

  async "绑定失败后重试不重传，用同一个 file_key"() {
    const page = await openExisting({ guidance: { applicant: guidanceOf(), office: null } });
    const realRespond = state.bindFailsOnce;
    assert.strictEqual(realRespond, undefined);
    state.bindFailsOnce = true;
    state.pickedImages = [image("a.jpg")];
    await page.pickImages();
    await flush();
    const failed = page.data.rows.find((row) => row.kind === "upload");
    assert.strictEqual(failed.canRetry, true);
    state.uploadCount = 0;
    page.retryUpload(event({ id: failed.localId }));
    await flush();
    assert.strictEqual(state.uploadCount, 0, "不能再传一次 R2");
    assert.strictEqual(state.bound.length, 1);
    assert.strictEqual(state.bound[0].file_key, "reimbursement/a.jpg");
    page.onUnload();
  },

  async "保存时没改过的金额不写回，提交时才写"() {
    const totals = { ...baseDetail().review_totals, attachment_count: 1, recognized_count: 1, extracted_total: 120, complete: true };
    const page = await openExisting({ amount: 0, review_totals: totals, guidance: { applicant: guidanceOf(), office: null } });
    assert.strictEqual(page.data.draft.amount, "120");
    await page.saveDraft();
    assert.strictEqual(call("PUT", `/api/v1/reimbursement/${ENVELOPE_ID}`)[0].data.amount, undefined);

    page.onDraftInput({ currentTarget: { dataset: { key: "amount" } }, detail: { value: "99" } });
    await page.saveDraft();
    assert.strictEqual(call("PUT", `/api/v1/reimbursement/${ENVELOPE_ID}`)[1].data.amount, 99);
    page.onUnload();
  },

  async "提交时写回默认带出的金额"() {
    const totals = { ...baseDetail().review_totals, attachment_count: 1, recognized_count: 1, extracted_total: 120, complete: true };
    const page = await openExisting({ amount: 0, review_totals: totals, guidance: { applicant: guidanceOf(), office: null } });
    await page.submitEnvelope();
    assert.strictEqual(call("PUT", `/api/v1/reimbursement/${ENVELOPE_ID}`)[0].data.amount, 120);
    page.onUnload();
  },

  async "被退回时显示办公室原话，按钮是重新提交，并能删除附件"() {
    const page = await openExisting({
      status: "submitted",
      precheck_status: "supplement",
      amount: 100,
      attachment_views: [viewOf(1, "recognized", { amount: 100 })],
      guidance: {
        applicant: guidanceOf({
          headline: "办公室要求补充材料",
          next_step: "请补餐费发票，补完重新提交。",
          actions: [{ key: "resubmit", label: "重新提交" }]
        }),
        office: null
      }
    });
    assert.strictEqual(page.data.nextStep, "请补餐费发票，补完重新提交。");
    assert.deepStrictEqual(page.data.actions.map((action) => action.key), ["resubmit"]);
    assert.strictEqual(page.data.rows[0].canDelete, true);

    await page.removeAttachment(event({ id: 1 }));
    assert.strictEqual(call("POST", `/api/v1/reimbursement/${ENVELOPE_ID}/attachments/1/delete`).length, 1);

    await page.onGuidanceAction(event({ key: "resubmit" }));
    assert.strictEqual(call("POST", `/api/v1/reimbursement/${ENVELOPE_ID}/submit`).length, 1);
    page.onUnload();
  },

  async "再次提交不复用上一次的幂等键"() {
    const page = await openExisting({ amount: 10, guidance: { applicant: guidanceOf(), office: null } });
    await page.submitEnvelope();
    state.detail = baseDetail({
      status: "submitted",
      precheck_status: "supplement",
      amount: 10,
      guidance: { applicant: guidanceOf({ actions: [{ key: "resubmit", label: "重新提交" }] }), office: null }
    });
    await page.loadEnvelopeDetail(ENVELOPE_ID);
    await page.submitEnvelope();
    const keys = call("POST", `/api/v1/reimbursement/${ENVELOPE_ID}/submit`).map((item) => item.header["Idempotency-Key"]);
    assert.strictEqual(keys.length, 2);
    assert.notStrictEqual(keys[0], keys[1]);
    page.onUnload();
  },

  async "已提交时没有提交按钮，也不能删除"() {
    const page = await openExisting({
      status: "submitted",
      precheck_status: "pending",
      attachment_views: [viewOf(1, "recognized", { amount: 100 })],
      guidance: { applicant: guidanceOf({ headline: "已提交，等办公室核查", next_step: "现在不用做什么。", actions: [] }), office: null }
    });
    assert.deepStrictEqual(page.data.actions, []);
    assert.strictEqual(page.data.canSubmit, false);
    assert.strictEqual(page.data.rows[0].canDelete, false);
    assert.strictEqual(page.data.canUpload, true);
    page.onUnload();
  },

  async "已打款的单只能看"() {
    const page = await openExisting({
      status: "paid",
      guidance: { applicant: guidanceOf({ headline: "已打款 ¥10.00", tone: "done", actions: [] }), office: null }
    });
    assert.strictEqual(page.data.canUpload, false);
    assert.strictEqual(page.data.editLocked, true);
    page.onUnload();
  },

  async "提交返回 require_force_submit 时仍走坚持提交确认"() {
    const page = await openExisting({ amount: 10, guidance: { applicant: guidanceOf(), office: null } });
    const duplicateError = new Error("重复");
    duplicateError.__statusCode = 409;
    duplicateError.__responseBody = {
      data: { require_force_submit: true, duplicate_total: 1, duplicate_checks: [{ summary: "和别单重复", risk_level: "high" }] }
    };
    state.submitResponses = [{ error: duplicateError }];
    await page.submitEnvelope();
    assert.strictEqual(state.modals[0].confirmText, "坚持提交");
    const submits = call("POST", `/api/v1/reimbursement/${ENVELOPE_ID}/submit`);
    assert.strictEqual(submits.length, 2);
    assert.strictEqual(submits[1].data.force_submit, true);
    assert.notStrictEqual(submits[0].header["Idempotency-Key"], submits[1].header["Idempotency-Key"]);
    page.onUnload();
  },

  async "金额为空不能提交，提交前先保存表单"() {
    const page = await openExisting({ amount: 0, guidance: { applicant: guidanceOf(), office: null } });
    await page.submitEnvelope();
    assert.strictEqual(call("POST", `/api/v1/reimbursement/${ENVELOPE_ID}/submit`).length, 0);
    assert.ok(state.toasts.some((title) => title.includes("报销金额")));

    page.onDraftInput({ currentTarget: { dataset: { key: "amount" } }, detail: { value: "88" } });
    await page.submitEnvelope();
    const put = call("PUT", `/api/v1/reimbursement/${ENVELOPE_ID}`);
    assert.strictEqual(put.length, 1);
    assert.strictEqual(put[0].data.amount, 88);
    assert.strictEqual(put[0].data.invoice_no, undefined);
    assert.strictEqual(call("POST", `/api/v1/reimbursement/${ENVELOPE_ID}/submit`).length, 1);
    page.onUnload();
  },

  async "金额默认等于已识别合计，手动改过不覆盖"() {
    const totals = { ...baseDetail().review_totals, attachment_count: 1, recognized_count: 1, extracted_total: 120, complete: true };
    const page = await openExisting({ amount: 0, review_totals: totals, guidance: { applicant: guidanceOf(), office: null } });
    assert.strictEqual(page.data.draft.amount, "120");

    page.onDraftInput({ currentTarget: { dataset: { key: "amount" } }, detail: { value: "99" } });
    state.detail = baseDetail({ amount: 0, review_totals: { ...totals, extracted_total: 150 } });
    await page.loadEnvelopeDetail(ENVELOPE_ID);
    assert.strictEqual(page.data.draft.amount, "99");
    page.onUnload();
  },

  async "已保存的金额优先于识别合计"() {
    const totals = { ...baseDetail().review_totals, attachment_count: 1, recognized_count: 1, extracted_total: 120, complete: true };
    const page = await openExisting({ amount: 100, review_totals: totals, guidance: { applicant: guidanceOf(), office: null } });
    assert.strictEqual(page.data.draft.amount, "100");
    page.onUnload();
  },

  async "重新识别按钮只重跑失败的"() {
    const page = await openExisting({
      attachment_views: [viewOf(1, "failed"), viewOf(2, "failed"), viewOf(3, "recognized", { amount: 5 })],
      guidance: {
        applicant: guidanceOf({ headline: "2 张发票没读出来", actions: [{ key: "rerecognize_failed", label: "重新识别" }, { key: "submit", label: "提交报销" }] }),
        office: null
      }
    });
    await page.onGuidanceAction(event({ key: "rerecognize_failed" }));
    assert.strictEqual(call("POST", `/api/v1/reimbursement/${ENVELOPE_ID}/attachments/1/rerecognize`).length, 1);
    assert.strictEqual(call("POST", `/api/v1/reimbursement/${ENVELOPE_ID}/attachments/2/rerecognize`).length, 1);
    assert.strictEqual(call("POST", `/api/v1/reimbursement/${ENVELOPE_ID}/attachments/3/rerecognize`).length, 0);
    page.onUnload();
  },

  async "点开文件看详情和原件"() {
    const page = await openExisting({
      attachment_views: [viewOf(1, "not_invoice", { raw_text_summary: "手写收据", file_name: "1.jpg" })]
    });
    const row = page.data.rows[0];
    assert.strictEqual(row.expanded, false);
    page.toggleRow(event({ key: row.key }));
    assert.strictEqual(page.data.rows[0].expanded, true);
    assert.strictEqual(page.data.rows[0].rawTextSummary, "手写收据");
    await page.openAttachment(event({ key: row.key }));
    await flush();
    assert.strictEqual(state.previewed.length, 1);
    page.onUnload();
  },

  async "识别中会自动刷新，离开页面就停"() {
    const page = await openExisting({
      attachment_views: [viewOf(1, "recognizing")],
      review_totals: { ...baseDetail().review_totals, attachment_count: 1, recognizing_count: 1 },
      guidance: { applicant: guidanceOf(), office: null }
    });
    assert.ok(page._pollTimer);
    page.onHide();
    assert.strictEqual(page._pollTimer, null);
    page.onUnload();
  },

  async "去掉了旧的元素"() {
    const page = await openPage();
    assert.strictEqual(page.data.attachmentTypeOptions, undefined);
    assert.strictEqual(page.data.draft.invoice_no, undefined);
    page.onUnload();
  }
};

const run = async () => {
  const onlyErrors = [];
  for (const [name, test] of Object.entries(tests)) {
    resetState();
    try {
      await test();
      console.log(`ok - ${name}`);
    } catch (error) {
      onlyErrors.push(name);
      console.error(`FAILED - ${name}`);
      console.error(error);
    }
  }
  if (onlyErrors.length > 0) process.exit(1);
  console.log(`reimbursement-page tests passed (${Object.keys(tests).length})`);
  process.exit(0);
};

run();
