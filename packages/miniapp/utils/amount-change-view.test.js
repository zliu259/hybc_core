const assert = require("assert");

const { amountChangeDeltaLabel, amountChangeAttachments } = require("./amount-change-view");

// 差额：按分取整，金额千分位
assert.strictEqual(amountChangeDeltaLabel(240000, 260000), "增加 20,000.00");
assert.strictEqual(amountChangeDeltaLabel(240000, 235000.5), "减少 4,999.50");
assert.strictEqual(amountChangeDeltaLabel(0.1 + 0.2, 0.3), "无变化");
assert.strictEqual(amountChangeDeltaLabel("abc", 100), "-");

// 附件：取接口返回的 attachments 数组，丢弃没有 file_key 的脏数据
assert.deepStrictEqual(
  amountChangeAttachments({
    attachments: [
      { file_key: "contract/1-a.pdf", file_name: "补充协议.pdf", file_size: 2048, file_url: "/x" },
      { file_key: "", file_name: "坏数据" },
      { file_key: "contract/2-b.jpg", file_name: "", file_size: null },
      null
    ]
  }),
  [
    { file_key: "contract/1-a.pdf", file_name: "补充协议.pdf", file_size: "2 KB" },
    { file_key: "contract/2-b.jpg", file_name: "未命名附件", file_size: null }
  ]
);
assert.deepStrictEqual(amountChangeAttachments({}), []);
assert.deepStrictEqual(amountChangeAttachments(null), []);

console.log("amount-change-view tests passed");
