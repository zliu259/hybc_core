const { request } = require("./request");

const signUpload = (fileName, contentType = "image/jpeg", category = "miniapp") => {
  return request({
    method: "POST",
    path: "/api/v1/upload/sign",
    data: { fileName, contentType, category }
  }).then((res) => res.data);
};

const uploadFileToR2 = async (filePath) => {
  const ext = (filePath.split(".").pop() || "jpg").toLowerCase();
  const sign = await signUpload(`miniapp-${Date.now()}.${ext}`, `image/${ext}`);

  await new Promise((resolve, reject) => {
    wx.uploadFile({
      url: sign.uploadUrl,
      filePath,
      name: "file",
      formData: {
        key: sign.key,
        signature: sign.signature,
        expiresAt: String(sign.expiresAt),
        contentType: sign.contentType
      },
      success() {
        resolve();
      },
      fail(err) {
        reject(err);
      }
    });
  });

  return sign;
};

module.exports = {
  signUpload,
  uploadFileToR2
};
