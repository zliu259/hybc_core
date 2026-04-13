const { request, uploadBinary } = require("./request");

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

const buildUploadDebugError = (debugContext, stage, error, meta = {}) => {
  if (!debugContext) {
    if (error instanceof Error) return error;
    return new Error(String(error || "上传失败"));
  }
  const message =
    error instanceof Error
      ? error.message || "上传失败"
      : typeof error === "string"
        ? error
        : "上传失败";
  const wrapped = new Error(
    `[upload-debug:${debugContext}:${stage}] ${message}${buildDebugMetaSuffix(meta)}`
  );
  wrapped.__uploadDebugContext = debugContext;
  wrapped.__uploadDebugStage = stage;
  wrapped.__uploadDebugMeta = meta;
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
  const uploadName = options.fileName || `miniapp-${Date.now()}.${ext}`;
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
