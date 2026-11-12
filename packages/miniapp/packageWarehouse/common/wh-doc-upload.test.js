/** 小程序上传设备资料用的纯函数和分片上传。运行：node packageWarehouse/common/wh-doc-upload.test.js */
const assert = require("assert");

const {
  DATED_CATEGORIES,
  guessDocCategory,
  keepPartsAfter,
  newUploadForm,
  splitParts,
  titleFromFileName,
  toCompletePayload,
  uploadFormProblem,
  uploadInParts,
  uploadProblem
} = require("./wh-doc-upload");

const MB = 1024 * 1024;

const run = async () => {
  // 切片：同 Web
  assert.deepStrictEqual(splitParts(20 * MB, 8 * MB), [
    { partNumber: 1, start: 0, end: 8 * MB },
    { partNumber: 2, start: 8 * MB, end: 16 * MB },
    { partNumber: 3, start: 16 * MB, end: 20 * MB }
  ]);
  assert.deepStrictEqual(splitParts(1024, 8 * MB), [{ partNumber: 1, start: 0, end: 1024 }]);
  assert.strictEqual(splitParts(16 * MB, 8 * MB).length, 2);
  assert.deepStrictEqual(splitParts(0, 8 * MB), []);

  // 假的文件内容：每一段开头写着它的位置（真文件不同位置的内容不一样）
  const chunkAt = (position) => {
    const data = new ArrayBuffer(64);
    new DataView(data).setFloat64(0, position + 1);
    return data;
  };

  // 分片上传：一次只读一片
  const makeDeps = (putPart) => {
    const log = { reads: [], puts: [], inits: [], aborts: [] };
    return {
      log,
      deps: {
        init: async (input) => {
          log.inits.push(input);
          return { upload_token: "tok", part_size: 8 * MB, part_count: 3 };
        },
        readChunk: async (path, position, length) => {
          log.reads.push([path, position, length]);
          return chunkAt(position);
        },
        putPart: async (token, partNumber, chunk) => {
          log.puts.push(partNumber);
          return putPart ? putPart(token, partNumber, chunk) : { part_number: partNumber, etag: `e${partNumber}` };
        },
        abort: async (token) => {
          log.aborts.push(token);
        },
        retryDelayMs: 0
      }
    };
  };
  const file = { path: "/tmp/a.pdf", name: "合格证.pdf", size: 20 * MB };

  let ctx = makeDeps();
  let progress = [];
  let result = await uploadInParts(file, ctx.deps, (sent) => progress.push(sent));
  assert.deepStrictEqual(ctx.log.inits, [{ file_name: "合格证.pdf", file_size: 20 * MB, client: "miniapp" }]);
  assert.deepStrictEqual(ctx.log.reads, [
    ["/tmp/a.pdf", 0, 8 * MB],
    ["/tmp/a.pdf", 8 * MB, 8 * MB],
    ["/tmp/a.pdf", 16 * MB, 4 * MB]
  ]);
  assert.deepStrictEqual(progress, [8 * MB, 16 * MB, 20 * MB]);
  assert.deepStrictEqual(result, {
    upload_token: "tok",
    parts: [
      { part_number: 1, etag: "e1" },
      { part_number: 2, etag: "e2" },
      { part_number: 3, etag: "e3" }
    ]
  });
  assert.deepStrictEqual(ctx.log.aborts, []);

  // 某一片两次失败后成功：整体成功，那一片只读一次
  let failures = 2;
  ctx = makeDeps((_token, partNumber) => {
    if (partNumber === 2 && failures > 0) {
      failures -= 1;
      throw new Error("网络断了");
    }
    return { part_number: partNumber, etag: `e${partNumber}` };
  });
  result = await uploadInParts(file, ctx.deps, () => {});
  assert.strictEqual(result.parts.length, 3);
  assert.deepStrictEqual(ctx.log.puts, [1, 2, 2, 2, 3]);
  assert.strictEqual(ctx.log.reads.length, 3);

  // 三次都失败：报第几片、放弃这次上传、不读第 3 片
  ctx = makeDeps((_token, partNumber) => {
    if (partNumber === 2) throw new Error("网络断了");
    return { part_number: partNumber, etag: `e${partNumber}` };
  });
  progress = [];
  await assert.rejects(
    uploadInParts(file, ctx.deps, (sent) => progress.push(sent)),
    /第 2 片上传失败/
  );
  assert.deepStrictEqual(ctx.log.puts, [1, 2, 2, 2]);
  assert.deepStrictEqual(ctx.log.aborts, ["tok"]);
  assert.strictEqual(ctx.log.reads.length, 2);
  assert.deepStrictEqual(progress, [8 * MB]);

  // 中途离开页面：后面的片不读不传，放弃这次上传
  ctx = makeDeps();
  let left = false;
  ctx.deps.cancelled = () => left;
  progress = [];
  await assert.rejects(
    uploadInParts(file, ctx.deps, (sent) => {
      progress.push(sent);
      left = true;
    }),
    (error) => error.__cancelled === true
  );
  assert.deepStrictEqual(ctx.log.puts, [1]);
  assert.strictEqual(ctx.log.reads.length, 1);
  assert.deepStrictEqual(ctx.log.aborts, ["tok"]);

  // 手机没按位置读（每次读到的都是文件开头）：第二片一读出来就发现，不往下传，说清楚换电脑传
  ctx = makeDeps();
  ctx.deps.readChunk = async (path, position, length) => {
    ctx.log.reads.push([path, position, length]);
    return chunkAt(0);
  };
  await assert.rejects(
    uploadInParts(file, ctx.deps, () => {}),
    /这台手机读不了这么大的文件，请在电脑上用网页版上传/
  );
  assert.deepStrictEqual(ctx.log.puts, [1]);
  assert.strictEqual(ctx.log.reads.length, 2);
  assert.deepStrictEqual(ctx.log.aborts, ["tok"]);

  // 文件读不出来：不重试，直接报
  ctx = makeDeps();
  ctx.deps.readChunk = async () => {
    throw new Error("readFile:fail");
  };
  await assert.rejects(uploadInParts(file, ctx.deps, () => {}), /文件读不出来，请重新选一次/);
  assert.deepStrictEqual(ctx.log.puts, []);
  assert.deepStrictEqual(ctx.log.aborts, ["tok"]);

  // 初始化被拒绝：原样报原因
  ctx = makeDeps();
  ctx.deps.init = async () => {
    throw new Error("不支持这种文件：exe");
  };
  await assert.rejects(uploadInParts(file, ctx.deps, () => {}), /不支持这种文件：exe/);
  assert.deepStrictEqual(ctx.log.reads, []);

  // 放弃上传的请求自己失败了，报的还是哪一片
  ctx = makeDeps(() => {
    throw new Error("网络断了");
  });
  ctx.deps.abort = async () => {
    throw new Error("放弃也失败");
  };
  await assert.rejects(uploadInParts(file, ctx.deps, () => {}), /第 1 片上传失败/);

  // 选文件时就能看出来的问题
  const config = { extensions: ["pdf", "jpg", "docx"], max_bytes_miniapp: 200 * MB, max_bytes: 2048 * MB };
  assert.strictEqual(uploadProblem({ name: "合格证.PDF", size: 1024 }, config), "");
  assert.strictEqual(uploadProblem({ name: "a.pdf", size: 200 * MB }, config), "");
  assert.strictEqual(uploadProblem({ name: "a.exe", size: 10 }, config), "不支持 .exe 文件");
  assert.strictEqual(uploadProblem({ name: "README", size: 10 }, config), "不支持没有扩展名的文件");
  assert.strictEqual(uploadProblem({ name: "a.pdf", size: 0 }, config), "文件是空的");
  assert.strictEqual(
    uploadProblem({ name: "a.pdf", size: 201 * MB }, config),
    "文件超过 200 MB，手机上传不了，请在电脑上用网页版上传"
  );
  assert.strictEqual(uploadProblem({ name: "a.pdf", size: 10 }, null), "上传设置还没取到，请稍后再试");

  // 猜资料类别、默认标题：规则同 Web
  assert.strictEqual(guessDocCategory("1200顶管机合格证.pdf"), "cert");
  assert.strictEqual(guessDocCategory("第三方检测报告.pdf"), "report");
  assert.strictEqual(guessDocCategory("压力表检定证书.jpg"), "report");
  assert.strictEqual(guessDocCategory("技术参数表.xlsx"), "params");
  assert.strictEqual(guessDocCategory("操作手册.docx"), "manual");
  assert.strictEqual(guessDocCategory("保养使用记录.xlsx"), "maintenance");
  assert.strictEqual(guessDocCategory("IMG_0032.jpg"), "other");
  assert.strictEqual(titleFromFileName("合格证.pdf"), "合格证");
  assert.strictEqual(titleFromFileName("v1.2 说明书.final.PDF"), "v1.2 说明书.final");
  assert.strictEqual(titleFromFileName("没有扩展名"), "没有扩展名");
  assert.strictEqual(titleFromFileName(`${"长".repeat(200)}.pdf`).length, 120);

  // 表单
  assert.deepStrictEqual(newUploadForm(null), {
    file: null,
    title: "",
    category: "other",
    ownerKind: "device",
    deviceId: null,
    deviceText: "",
    deviceCategoryId: null,
    validUntil: "",
    locked: false
  });
  const locked = newUploadForm({ id: 7, device_code: "SB-0007", name: "唐兴" });
  assert.deepStrictEqual(
    [locked.ownerKind, locked.deviceId, locked.deviceText, locked.locked],
    ["device", 7, "SB-0007 唐兴", true]
  );

  const picked = { path: "/tmp/a.pdf", name: "合格证.pdf", size: 10 };
  const filled = { ...locked, file: picked, title: "合格证", category: "cert", validUntil: "2027-01-01" };
  assert.strictEqual(uploadFormProblem(newUploadForm(null)), "请选择文件");
  assert.strictEqual(uploadFormProblem({ ...filled, title: "  " }), "请填写标题");
  assert.strictEqual(uploadFormProblem({ ...filled, deviceId: null }), "请选择设备");
  assert.strictEqual(
    uploadFormProblem({ ...filled, ownerKind: "category", deviceCategoryId: null }),
    "请选择设备类别"
  );
  assert.strictEqual(uploadFormProblem({ ...filled, ownerKind: "general", deviceId: null }), "");
  assert.strictEqual(uploadFormProblem(filled), "");

  const uploaded = { upload_token: "tok", parts: [{ part_number: 1, etag: "e1" }] };
  assert.deepStrictEqual(toCompletePayload(filled, uploaded), {
    upload_token: "tok",
    parts: [{ part_number: 1, etag: "e1" }],
    title: "合格证",
    doc_category: "cert",
    device_id: 7,
    device_category_id: null,
    valid_until: "2027-01-01"
  });
  // 只带选中那一种归属；不是合格证、检测报告的不带有效期
  assert.deepStrictEqual(
    toCompletePayload(
      { ...filled, ownerKind: "category", deviceCategoryId: 3, category: "manual", title: " 说明书 " },
      uploaded
    ),
    {
      upload_token: "tok",
      parts: [{ part_number: 1, etag: "e1" }],
      title: "说明书",
      doc_category: "manual",
      device_id: null,
      device_category_id: 3,
      valid_until: null
    }
  );
  const general = toCompletePayload({ ...filled, ownerKind: "general", validUntil: "" }, uploaded);
  assert.deepStrictEqual([general.device_id, general.device_category_id, general.valid_until], [null, null, null]);
  assert.deepStrictEqual(DATED_CATEGORIES, ["cert", "report"]);

  // 完成请求失败后分片留不留：上传本身废了才丢，别的（超时、服务器出错、表单填错）都留着
  const failure = (status, message) => Object.assign(new Error(message), status ? { __statusCode: status } : {});
  assert.strictEqual(keepPartsAfter(failure(0, "网络错误")), true);
  assert.strictEqual(keepPartsAfter(failure(500, "服务器出错，请稍后重试")), true);
  assert.strictEqual(keepPartsAfter(failure(400, "标题不能为空")), true);
  assert.strictEqual(keepPartsAfter(failure(403, "上传已失效，请重新上传")), false);
  assert.strictEqual(keepPartsAfter(failure(400, "文件不完整，请重新上传")), false);

  console.log("wh-doc-upload tests passed");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
