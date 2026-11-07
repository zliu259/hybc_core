/**
 * 小程序报销页的视图模型：结论、文件列表、合计和能不能提交。不碰 wx，node 直接跑。
 */
const assert = require("assert");
const { buildReimbursementView, resolveDeclaredAmount, validatePickedFile } = require("./reimbursement-view");

const applicantGuidance = (fields = {}) => ({
  tone: "normal",
  headline: "1 张发票都识别了，票面合计 ¥100.00",
  next_step: "确认金额，就可以提交了。",
  note: null,
  actions: [{ key: "submit", label: "提交报销" }],
  ...fields
});

const attachmentView = (id, state, fields = {}) => ({
  attachment_id: id,
  file_key: `reimbursement/${id}.pdf`,
  file_name: `${id}.pdf`,
  file_size: 100,
  state,
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

const totals = (fields = {}) => ({
  attachment_count: 1,
  recognized_count: 1,
  recognizing_count: 0,
  failed_count: 0,
  no_amount_count: 0,
  not_invoice_count: 0,
  extracted_total: 100,
  declared_amount: 100,
  complete: true,
  delta: 0,
  mismatch: false,
  ...fields
});

const detail = (fields = {}) => ({
  id: 1,
  status: "draft",
  amount: 0,
  guidance: { applicant: applicantGuidance(), office: null },
  attachment_views: [attachmentView(1, "recognized", { amount: 100 })],
  review_totals: totals(),
  ...fields
});

const upload = (name, status, fields = {}) => ({ localId: name, name, size: 1, status, error: null, ...fields });

const tests = {
  "显示 guidance.applicant 的结论和按钮"() {
    const view = buildReimbursementView(detail());
    assert.strictEqual(view.headline, "1 张发票都识别了，票面合计 ¥100.00");
    assert.strictEqual(view.nextStep, "确认金额，就可以提交了。");
    assert.strictEqual(view.tone, "normal");
    assert.deepStrictEqual(view.actions, [{ key: "submit", label: "提交报销" }]);
    assert.strictEqual(view.canSubmit, true);
  },

  "办公室视图不用在小程序"() {
    const view = buildReimbursementView(
      detail({ guidance: { applicant: applicantGuidance(), office: applicantGuidance({ headline: "办公室的话" }) } })
    );
    assert.strictEqual(view.headline, "1 张发票都识别了，票面合计 ¥100.00");
  },

  "新建还没存时先选项目"() {
    const view = buildReimbursementView(null);
    assert.strictEqual(view.headline, "先选项目，再把发票传上来");
    assert.strictEqual(view.nextStep, "可以一次传多张。");
    assert.strictEqual(view.canSubmit, false);
    assert.strictEqual(view.actions[0].disabled, true);
  },

  "上传中覆盖结论为「还有 N 张发票没传完」，canSubmit=false"() {
    const view = buildReimbursementView(detail(), {
      uploadItems: [upload("a.pdf", "uploading"), upload("b.pdf", "waiting"), upload("c.pdf", "done")]
    });
    assert.strictEqual(view.headline, "还有 2 张发票没传完");
    assert.strictEqual(view.nextStep, "传完确认金额，就可以提交了。");
    assert.strictEqual(view.canSubmit, false);
    assert.strictEqual(view.actions[0].disabled, true);
  },

  "没保存时上传也是这个说法"() {
    const view = buildReimbursementView(null, { uploadItems: [upload("a.pdf", "uploading")] });
    assert.strictEqual(view.headline, "还有 1 张发票没传完");
    assert.strictEqual(view.canSubmit, false);
  },

  "有失败项时 canSubmit=false"() {
    const view = buildReimbursementView(detail(), { uploadItems: [upload("a.pdf", "failed", { error: "断网了" })] });
    assert.strictEqual(view.canSubmit, false);
    assert.strictEqual(view.headline, "还有 1 张发票没传完");
    const row = view.rows.find((item) => item.kind === "upload");
    assert.strictEqual(row.canRetry, true);
    assert.strictEqual(row.statusText, "上传失败");
    assert.strictEqual(row.tone, "warn");
  },

  "全部传完后回到服务端的结论"() {
    const view = buildReimbursementView(detail(), { uploadItems: [upload("a.pdf", "done")] });
    assert.strictEqual(view.headline, "1 张发票都识别了，票面合计 ¥100.00");
    assert.strictEqual(view.canSubmit, true);
    assert.strictEqual(view.rows.filter((item) => item.kind === "upload").length, 0);
  },

  "没有 guidance 时回退到中性文案（接口未升级）"() {
    const view = buildReimbursementView({ id: 1, status: "draft", amount: 0, attachments: [] });
    assert.strictEqual(view.headline, "请核对报销信息");
    assert.strictEqual(view.nextStep, "");
    assert.strictEqual(view.canSubmit, true);
    assert.deepStrictEqual(view.rows, []);
    const submitted = buildReimbursementView({ id: 1, status: "submitted", amount: 0 });
    assert.strictEqual(submitted.canSubmit, false);
    assert.deepStrictEqual(submitted.actions, []);
  },

  "已提交没有按钮，不能提交"() {
    const view = buildReimbursementView(
      detail({ status: "submitted", guidance: { applicant: applicantGuidance({ actions: [] }), office: null } })
    );
    assert.strictEqual(view.canSubmit, false);
    assert.deepStrictEqual(view.actions, []);
  },

  "重新提交算能提交"() {
    const view = buildReimbursementView(
      detail({
        status: "submitted",
        guidance: { applicant: applicantGuidance({ actions: [{ key: "resubmit", label: "重新提交" }] }), office: null }
      })
    );
    assert.strictEqual(view.canSubmit, true);
  },

  "按钮被标记不可点时不能提交"() {
    const view = buildReimbursementView(
      detail({
        guidance: { applicant: applicantGuidance({ actions: [{ key: "submit", label: "提交报销", disabled: true }] }), office: null }
      })
    );
    assert.strictEqual(view.canSubmit, false);
  },

  "每种状态的文字"() {
    const view = buildReimbursementView(
      detail({
        attachment_views: [
          attachmentView(1, "recognized", { amount: 1568.95 }),
          attachmentView(2, "recognizing"),
          attachmentView(3, "not_invoice"),
          attachmentView(4, "no_amount"),
          attachmentView(5, "failed"),
          attachmentView(6, "not_recognized")
        ]
      })
    );
    const byId = Object.fromEntries(view.rows.map((row) => [row.attachmentId, row]));
    assert.strictEqual(byId[1].statusText, "¥1,568.95");
    assert.strictEqual(byId[2].statusText, "识别中");
    assert.strictEqual(byId[3].statusText, "不是发票");
    assert.strictEqual(byId[4].statusText, "没读到金额");
    assert.strictEqual(byId[5].statusText, "没读出来");
    assert.strictEqual(byId[5].canRerecognize, true);
    assert.strictEqual(byId[1].canRerecognize, false);
    assert.strictEqual(byId[6].statusText, "未识别");
  },

  "上传中和失败的在最前，有问题的其次，再按金额从大到小"() {
    const view = buildReimbursementView(
      detail({
        attachment_views: [
          attachmentView(1, "recognized", { amount: 10 }),
          attachmentView(2, "recognized", { amount: 500 }),
          attachmentView(3, "failed"),
          attachmentView(4, "recognized", {
            amount: 1,
            duplicates: [{ match_type: "x", risk_level: "high", summary: "重复", matched_envelope_id: 9 }]
          }),
          attachmentView(5, "recognizing")
        ]
      }),
      { uploadItems: [upload("新.pdf", "uploading")] }
    );
    assert.deepStrictEqual(
      view.rows.map((row) => (row.kind === "upload" ? row.name : row.attachmentId)),
      ["新.pdf", 4, 3, 5, 2, 1]
    );
    const duplicated = view.rows.find((row) => row.attachmentId === 4);
    assert.strictEqual(duplicated.duplicateText, "重复");
    assert.strictEqual(duplicated.tone, "warn");
  },

  "合计文字"() {
    assert.strictEqual(buildReimbursementView(detail()).totalsText, "票面合计 ¥100.00");
    assert.strictEqual(
      buildReimbursementView(
        detail({ review_totals: totals({ attachment_count: 2, recognized_count: 0, extracted_total: 0, complete: false }) })
      ).totalsText,
      "票面合计算不出"
    );
    assert.strictEqual(
      buildReimbursementView(
        detail({ review_totals: totals({ attachment_count: 3, recognized_count: 2, extracted_total: 50, complete: false }) })
      ).totalsText,
      "票面合计 ¥50.00，另有 1 个没有金额"
    );
    assert.strictEqual(buildReimbursementView(detail({ review_totals: totals({ attachment_count: 0, recognized_count: 0, complete: false }) })).totalsText, "");
  },

  "金额默认等于已识别合计；手动改过不覆盖"() {
    const view = buildReimbursementView(detail({ amount: 0 }));
    assert.strictEqual(view.declaredAmountDefault, 100);
    assert.strictEqual(resolveDeclaredAmount({ storedAmount: 0, extractedTotal: 120, touched: false, currentValue: 0 }), 120);
    assert.strictEqual(resolveDeclaredAmount({ storedAmount: 0, extractedTotal: 120, touched: true, currentValue: 88 }), 88);
    assert.strictEqual(resolveDeclaredAmount({ storedAmount: 100, extractedTotal: 120, touched: false, currentValue: 100 }), 100);
    assert.strictEqual(buildReimbursementView(detail({ amount: 66 })).declaredAmountDefault, 66);
    assert.strictEqual(buildReimbursementView(null).declaredAmountDefault, 0);
  },

  "大写后缀通过；heic 报错"() {
    assert.strictEqual(validatePickedFile("A.PDF"), null);
    assert.strictEqual(validatePickedFile("a.JPG"), null);
    assert.strictEqual(validatePickedFile("发票.2026.10.png"), null);
    assert.strictEqual(validatePickedFile("a.heic"), "a.heic：只支持 PDF、JPG、PNG");
    assert.strictEqual(validatePickedFile("noext"), "noext：只支持 PDF、JPG、PNG");
    assert.strictEqual(validatePickedFile("a.pdf", 20 * 1024 * 1024), null);
    assert.strictEqual(validatePickedFile("大.pdf", 20 * 1024 * 1024 + 1), "大.pdf：不能超过 20MB");
  }
};

for (const [name, test] of Object.entries(tests)) {
  test();
  console.log(`ok - ${name}`);
}
console.log(`reimbursement-view tests passed (${Object.keys(tests).length})`);
