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

const signUpload = (fileName, contentType = "image/jpeg", category = "miniapp") => {
  return request({
    method: "POST",
    path: "/api/v1/upload/sign",
    data: { fileName, contentType, category }
  }).then((res) => res.data || res);
};

const uploadFileToR2 = async (filePath) => {
  const ext = (filePath.split(".").pop() || "jpg").toLowerCase();
  const sign = await signUpload(`miniapp-${Date.now()}.${ext}`, `image/${ext}`);
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
  uploadFileToR2
};
