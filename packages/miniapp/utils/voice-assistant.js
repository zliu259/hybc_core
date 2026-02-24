const { request, uploadBinary } = require("./request");
const { signUpload } = require("./upload");
const { wxRecordAudioOnce } = require("./wx");
const { sayToast, vibrateSuccess, vibrateWarning } = require("./interaction");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readFileAsArrayBuffer = (filePath) =>
  new Promise((resolve, reject) => {
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

const audioContentType = (filePath) => {
  const ext = (filePath.split(".").pop() || "").toLowerCase();
  if (ext === "wav") return "audio/wav";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "aac") return "audio/aac";
  if (ext === "m4a") return "audio/mp4";
  if (ext === "amr") return "audio/amr";
  if (ext === "silk") return "audio/silk";
  return "application/octet-stream";
};

const uploadAudio = async (filePath) => {
  const ext = (filePath.split(".").pop() || "mp3").toLowerCase();
  const contentType = audioContentType(filePath);
  const sign = await signUpload(`miniapp-voice-${Date.now()}.${ext}`, contentType, "voice");
  const buffer = await readFileAsArrayBuffer(filePath);

  await uploadBinary({
    path: sign.uploadUrl,
    arrayBuffer: buffer,
    contentType: sign.contentType || contentType
  });

  return sign;
};

const pollTranscript = async (taskId) => {
  const maxAttempts = 12;
  for (let i = 0; i < maxAttempts; i += 1) {
    const statusRes = await request({
      method: "GET",
      path: `/api/v1/voice/stt/${taskId}`
    });
    const data = statusRes.data || {};
    const status = data.status;
    if (status === "completed") {
      return (data.transcript || "").trim();
    }
    if (status === "failed" || status === "timeout") {
      throw new Error(data.error_message || "语音识别失败");
    }
    await wait(1200);
  }
  throw new Error("语音识别超时，请重试");
};

const applyCommand = async (command) => {
  if (!command || command.type === "none" || !command.route) return false;
  if (command.type === "switchTab") {
    await new Promise((resolve, reject) => {
      wx.switchTab({
        url: command.route,
        success: resolve,
        fail: reject
      });
    });
    return true;
  }

  await new Promise((resolve, reject) => {
    wx.navigateTo({
      url: command.route,
      success: resolve,
      fail: reject
    });
  });
  return true;
};

const runVoiceAssistant = async ({ scene = "miniapp", hints = [] } = {}) => {
  sayToast({ title: "开始录音，请说出指令", icon: "none" });
  const recordResult = await wxRecordAudioOnce({ duration: 6000, format: "mp3" });
  const tempFilePath = recordResult && recordResult.tempFilePath ? recordResult.tempFilePath : "";
  if (!tempFilePath) {
    throw new Error("未获取到录音文件");
  }

  sayToast({ title: "录音完成，上传中", icon: "none" });
  const sign = await uploadAudio(tempFilePath);

  const sttRes = await request({
    method: "POST",
    path: "/api/v1/voice/stt",
    data: {
      file_key: sign.key,
      file_name: sign.key,
      scene,
      hints
    }
  });
  const taskId = Number((sttRes.data || {}).task_id || 0);
  if (!taskId) {
    throw new Error("语音任务创建失败");
  }

  sayToast({ title: "语音识别中", icon: "none" });
  const transcript = await pollTranscript(taskId);
  if (!transcript) {
    throw new Error("未识别到有效语音内容");
  }

  const parseRes = await request({
    method: "POST",
    path: "/api/v1/voice/command-parse",
    data: {
      text: transcript,
      scene
    }
  });

  const command = ((parseRes.data || {}).command || null);
  const message = (command && command.message) || "识别完成";
  const handled = await applyCommand(command);
  if (handled) {
    vibrateSuccess();
    sayToast({ title: message, icon: "success" });
  } else {
    vibrateWarning();
    sayToast({ title: `${message}：${transcript}`, icon: "none" });
  }

  return { transcript, command, handled };
};

module.exports = {
  runVoiceAssistant
};
