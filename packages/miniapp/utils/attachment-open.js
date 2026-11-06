/**
 * 查询详情页（付款、合同）共用的附件解析与打开逻辑。
 * 存量附件形态不一：有的只有 R2 key，有的是完整地址；legacy/fin 等受保护前缀要签名才能访问。
 */
const { request, buildUrl } = require("./request");
const { getToken } = require("./auth");

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"];
const DOCUMENT_TYPES = {
  ".pdf": "pdf",
  ".doc": "doc",
  ".docx": "docx",
  ".xls": "xls",
  ".xlsx": "xlsx",
  ".ppt": "ppt",
  ".pptx": "pptx",
  ".txt": "txt"
};

const lowerName = (name) => String(name || "").toLowerCase();

const isImageFile = (name) => IMAGE_EXTENSIONS.some((ext) => lowerName(name).endsWith(ext));

const inferDocumentType = (name) => {
  const matched = Object.keys(DOCUMENT_TYPES).find((ext) => lowerName(name).endsWith(ext));
  return matched ? DOCUMENT_TYPES[matched] : "";
};

const buildPersistentFilePath = (fileName) => {
  const userDataPath = (wx.env && wx.env.USER_DATA_PATH) || "";
  if (!userDataPath) return "";
  const docType = inferDocumentType(fileName);
  const suffix = docType ? `.${docType}` : "";
  return `${userDataPath}/hybc-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`;
};

const inferFileName = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return "附件";
  const cleaned = raw.split("?")[0].split("#")[0];
  const segments = cleaned.split("/").filter(Boolean);
  const last = segments.length ? segments[segments.length - 1] : raw;
  try {
    return decodeURIComponent(last) || "附件";
  } catch {
    return last || "附件";
  }
};

const parseSource = (raw) => {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const fromString = (value) => {
  const text = value.trim();
  if (!text) return null;
  const isUrl = /^https?:\/\//i.test(text) || text.startsWith("/");
  return {
    file_key: isUrl ? "" : text,
    file_name: inferFileName(text),
    file_url: isUrl ? text : ""
  };
};

const fromObject = (item) => {
  const fileKey = item.file_key || item.key || "";
  const fileUrl = item.file_url || item.url || "";
  if (!fileKey && !fileUrl) return null;
  return {
    file_key: fileKey,
    file_name: item.file_name || item.name || inferFileName(fileKey || fileUrl),
    file_size: item.file_size || item.size || 0,
    file_url: fileUrl
  };
};

/**
 * @param {unknown} raw attachments_json，字符串或已解析的数组
 * @returns {Array<{ file_key: string, file_name: string, file_size?: number, file_url: string }>}
 */
const parseQueryAttachments = (raw) => {
  const source = raw ? parseSource(raw) : null;
  if (!Array.isArray(source)) return [];
  return source
    .map((item) => {
      if (typeof item === "string") return fromString(item);
      return item && typeof item === "object" ? fromObject(item) : null;
    })
    .filter(Boolean);
};

const resolveAttachmentUrl = (fileUrl, fileKey) => {
  if (fileUrl) {
    if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
    return buildUrl(fileUrl.startsWith("/") ? fileUrl : `/${fileUrl}`);
  }
  return fileKey ? buildUrl(`/api/v1/upload/object/${encodeURIComponent(fileKey)}`) : "";
};

/** previewImage 不能带请求头，统一先取签名地址；取不到时回退直连，不让整块附件失效 */
const signAttachmentUrl = async (key, fallbackUrl) => {
  if (!key) return fallbackUrl;
  try {
    const res = await request({ method: "POST", path: "/api/v1/upload/sign-download", data: { key } });
    const signed = res && res.data && res.data.url;
    if (!signed) return fallbackUrl;
    return /^https?:\/\//i.test(signed) ? signed : buildUrl(signed);
  } catch (error) {
    console.warn("[attachment] sign-download failed, fallback to direct url", error);
    return fallbackUrl;
  }
};

const authHeader = () => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const failWith = (title, logTag, step, { name, url }, err) => {
  console.error(`[${logTag}] ${step} failed`, {
    name,
    url,
    errMsg: (err && (err.errMsg || err.message)) || ""
  });
  wx.showToast({ title, icon: "none" });
};

const documentOptions = (filePath, name, fail) => {
  const docType = inferDocumentType(name);
  return { filePath, showMenu: true, ...(docType ? { fileType: docType } : {}), fail };
};

/** 部分机型 downloadFile 拿不到可用路径，退回到手动写文件再打开 */
const openFromArrayBuffer = ({ url, name }, logTag) => {
  const fs = typeof wx.getFileSystemManager === "function" ? wx.getFileSystemManager() : null;
  const targetPath = buildPersistentFilePath(name);
  if (!fs || typeof fs.writeFile !== "function" || !targetPath) {
    wx.showToast({ title: "附件打开失败", icon: "none" });
    return;
  }
  const context = { name, url };
  wx.request({
    url,
    method: "GET",
    responseType: "arraybuffer",
    header: authHeader(),
    success: (resp) => {
      if (!(resp.statusCode >= 200 && resp.statusCode < 300) || !resp.data) {
        wx.showToast({ title: "附件下载失败", icon: "none" });
        return;
      }
      fs.writeFile({
        filePath: targetPath,
        data: resp.data,
        success: () =>
          wx.openDocument(
            documentOptions(targetPath, name, (err) =>
              failWith("附件打开失败", logTag, "openDocument fallback", context, err)
            )
          ),
        fail: (err) => failWith("附件打开失败", logTag, "writeFile fallback", context, err)
      });
    },
    fail: (err) => failWith("附件下载失败", logTag, "request fallback", context, err)
  });
};

const openDocumentFile = ({ url, name }, logTag) => {
  const target = { url, name };
  wx.downloadFile({
    url,
    header: authHeader(),
    success: (res) => {
      if (!(res.statusCode >= 200 && res.statusCode < 300)) {
        wx.showToast({ title: "附件下载失败", icon: "none" });
        return;
      }
      const localPath = res.tempFilePath || res.filePath || res.apFilePath || "";
      if (!localPath) {
        openFromArrayBuffer(target, logTag);
        return;
      }
      wx.openDocument(
        documentOptions(localPath, name, (err) => {
          failWith("附件打开失败", logTag, "openDocument", target, err);
          openFromArrayBuffer(target, logTag);
        })
      );
    },
    fail: (err) => failWith("附件下载失败", logTag, "downloadFile", target, err)
  });
};

/**
 * 打开附件：图片走预览，其余下载后用系统文档打开。
 * @param {{ key?: string, url?: string, name?: string }} file
 * @param {string} logTag 日志里的页面名
 */
const openQueryAttachment = async ({ key, url: fileUrl, name }, logTag) => {
  const fileName = name || "附件";
  if (!key && !fileUrl) {
    wx.showToast({ title: "附件链接无效", icon: "none" });
    return;
  }
  const url = await signAttachmentUrl(key, resolveAttachmentUrl(fileUrl, key));
  if (!url) {
    wx.showToast({ title: "附件链接无效", icon: "none" });
    return;
  }
  if (isImageFile(fileName)) {
    wx.previewImage({ urls: [url], current: url });
    return;
  }
  openDocumentFile({ url, name: fileName }, logTag);
};

module.exports = {
  parseQueryAttachments,
  openQueryAttachment,
  inferFileName
};
