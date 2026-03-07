const { request, uploadBinary } = require("./request");

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
    pdf: "application/pdf",
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

const uploadFileToR2 = async (filePath) => {
  const ext = (filePath.split(".").pop() || "bin").toLowerCase();
  const contentType = detectContentType(filePath);
  const sign = await signUpload(`miniapp-${Date.now()}.${ext}`, contentType);
  const buffer = await readFileAsArrayBuffer(filePath);

  await uploadBinary({
    path: sign.uploadUrl,
    arrayBuffer: buffer,
    contentType: sign.contentType
  });

  return sign;
};

module.exports = {
  signUpload,
  detectContentType,
  uploadFileToR2
};
