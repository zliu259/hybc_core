const { request, uploadBinary } = require("./request");
const { localizeNetworkErrorMessage } = require("./error-message");

const sanitizeDebugValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeDebugValue(item)).join(",");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const buildDebugMetaSuffix = (meta = {}) => {
  const entries = Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${sanitizeDebugValue(value)}`);
  return entries.length ? ` | ${entries.join(" | ")}` : "";
};

const toChineseUploadMessage = (error) => {
  // wx 各 fail 回调 reject 的是 {errMsg} 普通对象，String() 会得 "[object Object]"；
  // Error 的 message 也可能是英文，一律收口成中文（原文挂 __raw* 供排查）。
  if (error instanceof Error) {
    const msg = String(error.message || "");
    return /[一-鿿]/.test(msg) ? msg : localizeNetworkErrorMessage(msg || "上传失败");
  }
  if (typeof error === "string") {
    return /[一-鿿]/.test(error) ? error : localizeNetworkErrorMessage(error);
  }
  if (error && typeof error === "object" && typeof error.errMsg === "string") {
    return localizeNetworkErrorMessage(error.errMsg);
  }
  return "上传失败";
};

// 原文提取：包装链上可能已有内层 __raw*（request.js 抛出的错误），一并透传
const rawUploadErrorText = (error) => {
  if (!error) return "";
  if (typeof error === "string") return error;
  return String(
    error.__rawErrMsg || error.__rawMessage || error.errMsg || error.message || ""
  );
};

const buildUploadDebugError = (debugContext, stage, error, meta = {}) => {
  if (!debugContext) {
    const wrapped = new Error(toChineseUploadMessage(error));
    wrapped.__rawErrMsg = rawUploadErrorText(error);
    return wrapped;
  }
  const message = toChineseUploadMessage(error);
  const rawText = rawUploadErrorText(error);
  // message 会被各页 `error.message || "中文兜底"` 直接塞进 toast，
  // 所以只能放中文；排查用的英文原文挂 __rawErrMsg / 调试串并打控制台。
  const debugText = `[upload-debug:${debugContext}:${stage}] ${rawText || message}${buildDebugMetaSuffix(meta)}`;
  const wrapped = new Error(message);
  wrapped.__rawErrMsg = rawText;
  wrapped.__uploadDebugText = debugText;
  wrapped.__uploadDebugContext = debugContext;
  wrapped.__uploadDebugStage = stage;
  wrapped.__uploadDebugMeta = meta;
  console.warn(debugText);
  return wrapped;
};

const readFileAsArrayBuffer = (filePath) => {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success(res) {
        resolve(res.data);
      },
      fail(err) {
        reject(err);
      }
    });
  });
};

const detectContentType = (fileNameOrPath) => {
  const lower = String(fileNameOrPath || "").toLowerCase();
  const byExt = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
    ofd: "application/ofd",
    xml: "application/xml",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
    csv: "text/csv",
    zip: "application/zip"
  };
  const ext = lower.includes(".") ? lower.split(".").pop() : "";
  return byExt[ext] || "application/octet-stream";
};

const signUpload = (fileName, contentType = "image/jpeg", category = "miniapp") => {
  return request({
    method: "POST",
    path: "/api/v1/upload/sign",
    data: { fileName, contentType, category }
  }).then((res) => res.data || res);
};

const getFileExtension = (fileNameOrPath) => {
  const normalized = String(fileNameOrPath || "").trim().replace(/\\/g, "/");
  if (!normalized) return "";
  const tail = normalized.split("/").pop() || "";
  const source = tail || normalized;
  if (!source.includes(".")) return "";
  return (source.split(".").pop() || "").toLowerCase();
};

const uploadFileToR2 = async (filePath, options = {}) => {
  const debugContext = options.debugContext || "";
  if (!filePath) {
    throw buildUploadDebugError(debugContext, "validate-file-path", "文件路径为空", {
      fileName: options.fileName,
      category: options.category
    });
  }
  const ext = getFileExtension(options.fileName) || getFileExtension(filePath) || "bin";
  const contentType = options.contentType || detectContentType(options.fileName || filePath);
  const category = options.category || "miniapp";
  const uploadName = options.fileName || `文件-${Date.now()}.${ext}`;
  let sign;
  try {
    sign = await signUpload(uploadName, contentType, category);
  } catch (error) {
    throw buildUploadDebugError(debugContext, "sign-upload", error, {
      filePath,
      uploadName,
      contentType,
      category
    });
  }

  let buffer;
  try {
    buffer = await readFileAsArrayBuffer(filePath);
  } catch (error) {
    throw buildUploadDebugError(debugContext, "read-file", error, {
      filePath,
      uploadName
    });
  }

  try {
    await uploadBinary({
      path: sign.uploadUrl,
      arrayBuffer: buffer,
      contentType: sign.contentType
    });
  } catch (error) {
    throw buildUploadDebugError(debugContext, "put-binary", error, {
      filePath,
      uploadName,
      uploadUrl: sign && sign.uploadUrl,
      contentType: sign && sign.contentType
    });
  }

  return sign;
};

module.exports = {
  signUpload,
  detectContentType,
  uploadFileToR2
};
