/**
 * 上传队列：同时传的数量、失败重试、重复文件。不碰 wx，node 直接跑。
 */
const assert = require("assert");
const { createUploadQueue } = require("./upload-queue");

const deferred = () => {
  const handlers = {};
  const promise = new Promise((resolve, reject) => {
    handlers.resolve = resolve;
    handlers.reject = reject;
  });
  return { promise, ...handlers };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

const file = (name, size = 100) => ({ name, size, path: `/tmp/${name}` });

const createHarness = (concurrency = 2) => {
  const calls = [];
  const changes = [];
  const queue = createUploadQueue({
    concurrency,
    uploadOne: (item) => {
      const call = { item, ...deferred() };
      calls.push(call);
      return call.promise;
    },
    onChange: (items) => changes.push(items)
  });
  return { queue, calls, changes };
};

const statuses = (queue) => queue.getItems().map((item) => item.status);

const tests = {
  async "同时最多 2 个"() {
    const { queue, calls } = createHarness();
    queue.add([file("a.pdf"), file("b.pdf"), file("c.pdf")]);
    await flush();
    assert.strictEqual(calls.length, 2);
    assert.deepStrictEqual(statuses(queue), ["uploading", "uploading", "waiting"]);

    calls[0].resolve();
    await flush();
    assert.strictEqual(calls.length, 3);
    assert.deepStrictEqual(statuses(queue), ["done", "uploading", "uploading"]);
  },

  async "一个失败其余继续，isBusy 到全部结束才为 false"() {
    const { queue, calls } = createHarness();
    queue.add([file("a.pdf"), file("b.pdf"), file("c.pdf")]);
    await flush();
    calls[0].reject(new Error("断网了"));
    await flush();
    assert.strictEqual(queue.getItems()[0].status, "failed");
    assert.strictEqual(queue.getItems()[0].error, "断网了");
    assert.strictEqual(queue.isBusy(), true);
    calls[1].resolve();
    await flush();
    assert.strictEqual(queue.isBusy(), true);
    calls[2].resolve();
    await flush();
    assert.strictEqual(queue.isBusy(), false);
    assert.deepStrictEqual(statuses(queue), ["failed", "done", "done"]);
  },

  async "retry 只重传失败的那个"() {
    const { queue, calls } = createHarness();
    queue.add([file("a.pdf"), file("b.pdf")]);
    await flush();
    calls[0].reject(new Error("断网了"));
    calls[1].resolve();
    await flush();
    const failed = queue.getItems()[0];
    queue.retry(failed.localId);
    await flush();
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[2].item.name, "a.pdf");
    assert.strictEqual(queue.getItems()[0].status, "uploading");
    assert.strictEqual(queue.getItems()[0].error, null);
    calls[2].resolve();
    await flush();
    assert.deepStrictEqual(statuses(queue), ["done", "done"]);
  },

  async "retry 对没失败的不起作用"() {
    const { queue, calls } = createHarness();
    queue.add([file("a.pdf")]);
    await flush();
    queue.retry(queue.getItems()[0].localId);
    await flush();
    assert.strictEqual(calls.length, 1);
  },

  async "重复文件被跳过"() {
    const { queue, calls } = createHarness();
    const first = queue.add([file("a.pdf", 100), file("a.pdf", 100), file("a.pdf", 200)]);
    assert.deepStrictEqual(first.skipped, ["a.pdf"]);
    await flush();
    assert.strictEqual(calls.length, 2);
    calls[0].resolve();
    await flush();
    const second = queue.add([file("a.pdf", 100)]);
    assert.deepStrictEqual(second.skipped, ["a.pdf"]);
    assert.strictEqual(queue.getItems().length, 2);
  },

  async "和已有附件相同的也跳过"() {
    const { queue, calls } = createHarness();
    const result = queue.add([file("a.pdf", 100), file("b.pdf", 100)], [{ name: "a.pdf", size: 100 }]);
    assert.deepStrictEqual(result.skipped, ["a.pdf"]);
    await flush();
    assert.strictEqual(calls.length, 1);
  },

  async "失败的文件可以重新选，不算重复"() {
    const { queue, calls } = createHarness();
    queue.add([file("a.pdf")]);
    await flush();
    calls[0].reject(new Error("x"));
    await flush();
    const result = queue.add([file("a.pdf")]);
    assert.deepStrictEqual(result.skipped, []);
  },

  async "每次变化都通知，拿到的是副本"() {
    const { queue, calls, changes } = createHarness();
    queue.add([file("a.pdf")]);
    await flush();
    calls[0].resolve();
    await flush();
    assert.ok(changes.length >= 2);
    const snapshot = changes[0];
    assert.notStrictEqual(snapshot, queue.getItems());
    assert.strictEqual(changes.at(-1)[0].status, "done");
  },

  async "uploadOne 同步抛错也算失败"() {
    const queue = createUploadQueue({
      concurrency: 2,
      uploadOne: () => {
        throw new Error("坏了");
      }
    });
    queue.add([file("a.pdf")]);
    await flush();
    assert.strictEqual(queue.getItems()[0].status, "failed");
    assert.strictEqual(queue.getItems()[0].error, "坏了");
  }
};

(async () => {
  for (const [name, test] of Object.entries(tests)) {
    await test();
    console.log(`ok - ${name}`);
  }
  console.log(`upload-queue tests passed (${Object.keys(tests).length})`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
