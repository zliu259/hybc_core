/** 小程序上传设备资料：切片、一片一片读着传、选文件时的检查、表单。除了默认的读文件，都是纯函数。 */

const MB = 1024 * 1024;
const TITLE_MAX = 120;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1500;
/** 只有这两类资料有有效期 */
const DATED_CATEGORIES = ["cert", "report"];

/**
 * 按固定大小切片；最后一片是剩下的。
 * @param {number} size
 * @param {number} partSize
 * @returns {{ partNumber: number, start: number, end: number }[]}
 */
const splitParts = (size, partSize) => {
  if (!(size > 0) || !(partSize > 0)) return [];
  return Array.from({ length: Math.ceil(size / partSize) }, (_, index) => ({
    partNumber: index + 1,
    start: index * partSize,
    end: Math.min(size, (index + 1) * partSize)
  }));
};

const wait = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** 拿一段开头的这么多字节来比 */
const SAMPLE_BYTES = 4096;
const MIN_SAMPLE_BYTES = 16;

const sampleOf = (chunk) =>
  new Uint8Array(chunk.slice(0, Math.min(SAMPLE_BYTES, chunk.byteLength)));

/** 两段的开头是不是一模一样（太短的不比）。 */
const sameStart = (a, b) => {
  const length = Math.min(a.length, b.length);
  if (length < MIN_SAMPLE_BYTES) return false;
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
};

/**
 * 从文件里读一段，不把整个文件读进内存。
 * 老一点的客户端不认 position、length，会把整个文件给回来：那就从里面切出要的那一段。
 * @param {string} filePath
 * @param {number} position
 * @param {number} length
 * @returns {Promise<ArrayBuffer>}
 */
const readChunk = (filePath, position, length) =>
  new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      position,
      length,
      success: (res) => {
        const data = res && res.data;
        const size = data && typeof data.byteLength === "number" ? data.byteLength : -1;
        if (size === length) resolve(data);
        else if (size >= position + length) resolve(data.slice(position, position + length));
        else reject(new Error("读到的内容长度不对"));
      },
      fail: reject
    });
  });

/**
 * 初始化后一片一片地读、传。传不上的那一片自动重传，传满次数还不行就放弃这次上传，报「第 N 片上传失败」。
 * @param {{ path: string, name: string, size: number }} file
 * @param {{
 *   init: (input: { file_name: string, file_size: number, client: string }) => Promise<{ upload_token: string, part_size: number }>,
 *   putPart: (token: string, partNumber: number, chunk: ArrayBuffer) => Promise<{ part_number: number, etag: string }>,
 *   abort: (token: string) => Promise<unknown>,
 *   readChunk?: (path: string, position: number, length: number) => Promise<ArrayBuffer>,
 *   retries?: number,
 *   retryDelayMs?: number,
 *   cancelled?: () => boolean
 * }} deps cancelled 返回 true（人离开了页面）时不再往下传，放弃这次上传，抛出带 __cancelled 的错误
 * @param {(sentBytes: number) => void} onProgress 已经传完的字节数
 * @returns {Promise<{ upload_token: string, parts: { part_number: number, etag: string }[] }>}
 */
const uploadInParts = async (file, deps, onProgress) => {
  const started = await deps.init({ file_name: file.name, file_size: file.size, client: "miniapp" });
  const token = started.upload_token;
  const read = deps.readChunk || readChunk;
  const retries = Math.max(1, deps.retries || DEFAULT_RETRIES);
  const delay = deps.retryDelayMs === undefined ? DEFAULT_RETRY_DELAY_MS : deps.retryDelayMs;

  const cancelled = () => Boolean(deps.cancelled && deps.cancelled());

  const giveUp = async (message, extra = {}) => {
    // 放弃失败也不要紧：没完成的分片上传存储那边会自己清掉
    await Promise.resolve()
      .then(() => deps.abort(token))
      .catch(() => undefined);
    throw Object.assign(new Error(message), extra);
  };
  const giveUpCancelled = () => giveUp("已取消", { __cancelled: true });

  const sendPart = async (piece, chunk) => {
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        return await deps.putPart(token, piece.partNumber, chunk);
      } catch (error) {
        console.warn("[wh-doc-upload] 这一片没传上", piece.partNumber, attempt, error && error.message);
        if (cancelled()) return null;
        if (attempt < retries) await wait(delay);
      }
    }
    return null;
  };

  let parts = [];
  let firstStart = null;
  for (const piece of splitParts(file.size, started.part_size)) {
    if (cancelled()) return giveUpCancelled();
    // 每片只读一次，重传用的是同一份
    const chunk = await read(file.path, piece.start, piece.end - piece.start).catch((error) => {
      console.warn("[wh-doc-upload] 文件读不出来", error && (error.errMsg || error.message));
      return null;
    });
    if (!chunk) return giveUp("文件读不出来，请重新选一次");
    // 有的客户端认长度不认位置，每次读到的都是文件开头：大小对得上，服务端查不出来，传上去的文件是坏的。
    // 第二片的开头和第一片一模一样就按这种情况处理，不往下传。
    if (piece.partNumber === 1) firstStart = sampleOf(chunk);
    else if (piece.partNumber === 2 && sameStart(firstStart, sampleOf(chunk))) {
      return giveUp("这台手机读不了这么大的文件，请在电脑上用网页版上传");
    }
    const uploaded = await sendPart(piece, chunk);
    if (cancelled()) return giveUpCancelled();
    if (!uploaded) return giveUp(`第 ${piece.partNumber} 片上传失败`);
    parts = [...parts, uploaded];
    onProgress(piece.end);
  }
  return { upload_token: token, parts };
};

const extensionOf = (fileName) => {
  const name = String(fileName || "");
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : "";
};

/**
 * 选文件时就能看出来的问题；没有问题返回空串。
 * @param {{ name: string, size: number }} file
 * @param {{ extensions: string[], max_bytes_miniapp: number } | null} config GET /doc-library/config 的 data
 */
const uploadProblem = (file, config) => {
  if (!config) return "上传设置还没取到，请稍后再试";
  const extension = extensionOf(file.name);
  if (!extension) return "不支持没有扩展名的文件";
  if (!config.extensions.includes(extension)) return `不支持 .${extension} 文件`;
  if (!(file.size > 0)) return "文件是空的";
  if (file.size > config.max_bytes_miniapp) {
    return `文件超过 ${Math.floor(config.max_bytes_miniapp / MB)} MB，手机上传不了，请在电脑上用网页版上传`;
  }
  return "";
};

const CATEGORY_KEYWORDS = [
  ["cert", ["合格证"]],
  ["report", ["检测", "报告", "检定"]],
  ["params", ["参数"]],
  ["manual", ["说明书", "手册"]],
  ["maintenance", ["维修", "保养"]]
];

/** 按文件名里的关键字猜资料类别，猜不出来是「其他」。规则同 Web。 */
const guessDocCategory = (fileName) => {
  const text = String(fileName || "");
  const hit = CATEGORY_KEYWORDS.find(([, words]) => words.some((word) => text.includes(word)));
  return hit ? hit[0] : "other";
};

/** 文件名去掉扩展名当标题，最长 120 个字。 */
const titleFromFileName = (fileName) => {
  const name = String(fileName || "").trim();
  const dot = name.lastIndexOf(".");
  return (dot > 0 ? name.slice(0, dot) : name).slice(0, TITLE_MAX);
};

/**
 * @param {{ id: number, device_code?: string, name?: string } | null} device 从设备页进来时的那台设备
 */
const newUploadForm = (device) => ({
  file: null,
  title: "",
  category: "other",
  // device：某台设备；category：某类设备；general：通用
  ownerKind: "device",
  deviceId: device ? device.id : null,
  deviceText: device ? [device.device_code, device.name].filter(Boolean).join(" ") : "",
  deviceCategoryId: null,
  validUntil: "",
  // 从设备页进来：归属定死这台设备
  locked: Boolean(device)
});

const uploadFormProblem = (form) => {
  if (!form.file) return "请选择文件";
  if (!String(form.title || "").trim()) return "请填写标题";
  if (form.ownerKind === "device" && !form.deviceId) return "请选择设备";
  if (form.ownerKind === "category" && !form.deviceCategoryId) return "请选择设备类别";
  return "";
};

/**
 * @param {ReturnType<typeof newUploadForm>} form
 * @param {{ upload_token: string, parts: { part_number: number, etag: string }[] }} uploaded
 */
const toCompletePayload = (form, uploaded) => ({
  upload_token: uploaded.upload_token,
  parts: uploaded.parts,
  title: String(form.title || "").trim(),
  doc_category: form.category,
  device_id: form.ownerKind === "device" ? form.deviceId : null,
  device_category_id: form.ownerKind === "category" ? form.deviceCategoryId : null,
  valid_until: DATED_CATEGORIES.includes(form.category) && form.validUntil ? form.validUntil : null
});

/**
 * 完成请求失败后，已经传上去的分片留不留。
 * 上传本身废了（已失效、文件不完整）才丢，下次从头传；超时、服务器出错、表单填错都留着，改好再点只重发完成请求。
 * @param {{ __statusCode?: number, message?: string }} error
 */
const keepPartsAfter = (error) => {
  const status = Number(error && error.__statusCode) || 0;
  const message = String((error && error.message) || "");
  if (status === 403) return false;
  if (status === 400 && /不完整|已失效/.test(message)) return false;
  return true;
};

module.exports = {
  DATED_CATEGORIES,
  guessDocCategory,
  keepPartsAfter,
  newUploadForm,
  readChunk,
  splitParts,
  titleFromFileName,
  toCompletePayload,
  uploadFormProblem,
  uploadInParts,
  uploadProblem
};
