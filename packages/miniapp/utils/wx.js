const wxLogin = () =>
  new Promise((resolve, reject) => {
    const qyLogin = wx?.qy && typeof wx.qy.login === "function" ? wx.qy.login : null;
    if (qyLogin) {
      qyLogin({
        success: resolve,
        fail() {
          wx.login({
            success: resolve,
            fail: reject
          });
        }
      });
      return;
    }

    wx.login({
      success: resolve,
      fail: reject
    });
  });

const wxScanCode = () =>
  new Promise((resolve, reject) => {
    wx.scanCode({
      onlyFromCamera: false,
      success: resolve,
      fail: reject
    });
  });

const normalizePathValue = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const inferFileNameFromPath = (filePath, fallbackPrefix = "file") => {
  const normalizedPath = normalizePathValue(filePath).replace(/\\/g, "/");
  if (!normalizedPath) return `${fallbackPrefix}-${Date.now()}`;
  const tail = normalizedPath.split("/").pop() || "";
  if (tail) return tail;
  return `${fallbackPrefix}-${Date.now()}`;
};

const normalizePickedFile = (file, fallbackPrefix = "file") => {
  const source = file && typeof file === "object" ? file : {};
  const path =
    normalizePathValue(source.path) ||
    normalizePathValue(source.tempFilePath) ||
    normalizePathValue(source.tempPath);
  const nameSource =
    (typeof source.name === "string" && source.name.trim()) ||
    (typeof source.fileName === "string" && source.fileName.trim()) ||
    inferFileNameFromPath(path, fallbackPrefix);
  const sizeCandidate =
    Number.isFinite(source.size) && source.size >= 0
      ? Number(source.size)
      : Number.isFinite(source.fileSize) && source.fileSize >= 0
        ? Number(source.fileSize)
        : undefined;

  return {
    ...source,
    path,
    tempFilePath: path,
    tempPath: path,
    name: nameSource,
    fileName: typeof source.fileName === "string" && source.fileName.trim() ? source.fileName.trim() : nameSource,
    size: sizeCandidate,
    fileSize: sizeCandidate
  };
};

const normalizeTempFileResult = (res, fallbackPrefix = "file") => {
  const raw = res && typeof res === "object" ? res : {};
  let tempFiles = [];
  if (Array.isArray(raw.tempFiles)) {
    tempFiles = raw.tempFiles.map((item) => normalizePickedFile(item, fallbackPrefix));
  } else if (Array.isArray(raw.tempFilePaths)) {
    tempFiles = raw.tempFilePaths.map((item) => normalizePickedFile({
      path: item,
      tempFilePath: item,
      name: inferFileNameFromPath(item, fallbackPrefix)
    }, fallbackPrefix));
  }
  tempFiles = tempFiles.filter((item) => Boolean(item.path));
  return {
    ...raw,
    tempFiles
  };
};

const wxChooseMediaImage = ({ count = 1 } = {}) =>
  new Promise((resolve, reject) => {
    const resolveWithNormalized = (res) => resolve(normalizeTempFileResult(res, "image"));

    const chooseImageFallback = () => {
      if (typeof wx.chooseImage !== "function") {
        reject(new Error("当前客户端不支持图片选择，请升级企业微信后重试"));
        return;
      }
      wx.chooseImage({
        count,
        sourceType: ["album", "camera"],
        success: resolveWithNormalized,
        fail: reject
      });
    };

    if (typeof wx.chooseMedia !== "function") {
      chooseImageFallback();
      return;
    }

    wx.chooseMedia({
      count,
      mediaType: ["image"],
      success: resolveWithNormalized,
      fail(err) {
        const message = String((err && err.errMsg) || (err && err.message) || "").toLowerCase();
        if (message.includes("not support") || message.includes("not supported")) {
          chooseImageFallback();
          return;
        }
        reject(err);
      }
    });
  });

const wxChooseMessageFile = ({ count = 1, type = "file" } = {}) =>
  new Promise((resolve, reject) => {
    const chooseMessageFileApi =
      typeof wx.chooseMessageFile === "function"
        ? wx.chooseMessageFile
        : wx?.qy && typeof wx.qy.chooseMessageFile === "function"
          ? wx.qy.chooseMessageFile
          : null;

    if (!chooseMessageFileApi) {
      reject(new Error("当前客户端不支持文件选择，请升级企业微信后重试或改用图片上传"));
      return;
    }

    chooseMessageFileApi({
      count,
      type,
      success(res) {
        resolve(normalizeTempFileResult(res, "file"));
      },
      fail: reject
    });
  });

const wxGetLocation = () =>
  new Promise((resolve, reject) => {
    reject(new Error("当前版本未开通定位权限"));
  });

const wxRecordAudioOnce = ({
  duration = 6000,
  format = "mp3",
  sampleRate = 16000,
  numberOfChannels = 1,
  encodeBitRate = 96000
} = {}) =>
  new Promise((resolve, reject) => {
    const recorder = wx.getRecorderManager();
    let settled = false;

    const cleanup = () => {
      if (typeof recorder.offStop === "function") {
        recorder.offStop();
      }
      if (typeof recorder.offError === "function") {
        recorder.offError();
      }
    };

    recorder.onStop((res) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(res);
    });

    recorder.onError((err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    recorder.start({
      duration,
      sampleRate,
      numberOfChannels,
      encodeBitRate,
      format
    });
  });

module.exports = {
  wxLogin,
  wxScanCode,
  wxChooseMediaImage,
  wxChooseMessageFile,
  wxGetLocation,
  wxRecordAudioOnce
};
