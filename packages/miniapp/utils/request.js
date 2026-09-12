const {
  getBaseUrl,
  setBaseUrl,
  buildFallbackCandidates,
  DEFAULT_RELAY_STATUS_PATH,
} = require("./config");
const { getToken, setToken, clearToken } = require("./auth");
const { localizeErrorMessage, localizeNetworkErrorMessage } = require("./error-message");

const DEFAULT_TIMEOUT_MS = 20000;
const LOGIN_TIMEOUT_MS = 30000;
const UPLOAD_TIMEOUT_MS = 60000;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const pendingMutationRequests = new Map();

const toRequestMethod = (method) => String(method || "GET").toUpperCase();

const buildRandomKey = (scope) => {
  return `${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const getHeaderValueCaseInsensitive = (header, targetName) => {
  const normalizedTarget = String(targetName || "").toLowerCase();
  const source = header || {};
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (String(key).toLowerCase() === normalizedTarget) {
      return source[key];
    }
  }
  return undefined;
};

const stableSerialize = (value) => {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  const valueType = typeof value;
  if (valueType === "string") return JSON.stringify(value);
  if (valueType === "number" || valueType === "boolean" || valueType === "bigint") {
    return String(value);
  }
  if (valueType === "function") return "[function]";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value instanceof Date) {
    return `date:${value.toISOString()}`;
  }
  if (valueType === "object") {
    const keys = Object.keys(value).sort();
    const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
    return `{${pairs.join(",")}}`;
  }
  return String(value);
};

const buildMutationDedupKey = ({ method, path, data, dedupeKey, idempotencyKey }) => {
  if (dedupeKey) {
    return `${method}|${path}|dedupe:${String(dedupeKey)}`;
  }
  if (idempotencyKey) {
    return `${method}|${path}|idem:${String(idempotencyKey)}`;
  }
  return `${method}|${path}|data:${stableSerialize(data)}`;
};

// message 现在一律是中文化后的文案，重试判定必须看原始 errMsg（__rawErrMsg），
// 否则改文案就会悄悄改掉降级/重试行为。
const rawErrMsgOf = (error) =>
  String(
    (error && error.__rawErrMsg) ||
      (error && error.__rawMessage) ||
      (error && error.message) ||
      ""
  );

const isRetryableNetworkError = (error) => {
  const msg = rawErrMsgOf(error);
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("请求超时") ||
    msg.includes("无法连接服务器")
  );
};

const isConnectionRefusedError = (error) => {
  const msg = rawErrMsgOf(error);
  return msg.includes("ERR_CONNECTION_REFUSED") || msg.includes("无法连接服务器");
};

const isNetworkLayerFailure = (error) => {
  if (error && error.__networkFail) return true;
  return rawErrMsgOf(error).includes("request:fail");
};

const normalizeMiniappNetworkErrorMessage = (rawMessage) =>
  localizeNetworkErrorMessage(rawMessage);

const buildUrlWithBase = (baseUrl, path) => {
  if (!path) return baseUrl;
  if (/^https?:\/\//.test(path)) return path;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
};

const buildUrl = (path) => {
  if (!path) return getBaseUrl();
  if (/^https?:\/\//.test(path)) return path;
  return `${getBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
};

// Strip scheme + host from an absolute URL, keeping path + query. Used so an
// absolute upload URL signed by the Worker can be re-based onto the current
// API base (the HK bridge) instead of pinning the request to the Worker origin.
const toRelativeApiPath = (rawPath) => {
  const value = String(rawPath || "");
  if (!value || !/^https?:\/\//i.test(value)) return value;
  const withoutScheme = value.replace(/^https?:\/\//i, "");
  const slashIndex = withoutScheme.indexOf("/");
  return slashIndex === -1 ? "/" : withoutScheme.slice(slashIndex);
};

const isArrayBuffer = (value) => {
  return typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer;
};

const decodeArrayBufferToText = (buffer) => {
  if (!isArrayBuffer(buffer)) return "";
  try {
    if (typeof TextDecoder === "function") {
      return new TextDecoder("utf-8").decode(buffer);
    }
  } catch (_error) {
    // fallback below
  }
  const bytes = new Uint8Array(buffer);
  let ascii = "";
  for (let i = 0; i < bytes.length; i += 1) {
    ascii += String.fromCharCode(bytes[i]);
  }
  try {
    return decodeURIComponent(escape(ascii));
  } catch (_error) {
    return ascii;
  }
};

const parseResponseData = (data, header = {}) => {
  if (!isArrayBuffer(data)) {
    return data;
  }

  const decodedText = decodeArrayBufferToText(data).trim();
  if (!decodedText) {
    return {};
  }

  const contentType = String(getHeaderValueCaseInsensitive(header, "content-type") || "").toLowerCase();
  const shouldTryJson =
    contentType.includes("application/json") ||
    decodedText.startsWith("{") ||
    decodedText.startsWith("[");

  if (!shouldTryJson) {
    return decodedText;
  }

  try {
    return JSON.parse(decodedText);
  } catch (_error) {
    return decodedText;
  }
};

const probeRelayStatus = (candidate) => {
  if (!candidate || !candidate.isRelay) return Promise.resolve(true);
  const statusPath =
    typeof candidate.statusPath === "string" && candidate.statusPath.trim()
      ? candidate.statusPath
      : DEFAULT_RELAY_STATUS_PATH;
  const statusUrl = buildUrlWithBase(candidate.baseUrl, statusPath);
  const timeout =
    Number.isFinite(candidate.probeTimeoutMs) && Number(candidate.probeTimeoutMs) > 0
      ? Number(candidate.probeTimeoutMs)
      : 1200;

  return new Promise((resolve) => {
    wx.request({
      url: statusUrl,
      method: "GET",
      timeout,
      success(res) {
        if (!(res.statusCode >= 200 && res.statusCode < 300)) {
          resolve(false);
          return;
        }
        const body = res.data || {};
        if (body.overloaded === true) {
          resolve(false);
          return;
        }
        if (typeof body.cooldown_seconds_left === "number" && body.cooldown_seconds_left > 0) {
          resolve(false);
          return;
        }
        resolve(true);
      },
      fail() {
        resolve(false);
      }
    });
  });
};

const executeRequest = ({
  url,
  method,
  data,
  timeout,
  header,
  responseType,
}) =>
  new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      timeout,
      header,
      responseType,
      success(res) {
        const body = parseResponseData(res.data, res.header) || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && body.success !== false) {
          resolve({ body, url });
          return;
        }
        if (res.statusCode === 401) {
          clearToken();
        }
        // toast 直接吃 error.message，所以这里必须已经是中文；英文原文挂在
        // __rawMessage 上，出问题时看控制台/日志即可。url 同理不进文案。
        const rawMessage = (body && body.error && body.error.message) || "";
        const requestError = new Error(localizeErrorMessage(rawMessage, res.statusCode));
        requestError.__statusCode = res.statusCode;
        requestError.__responseBody = body;
        requestError.__rawMessage = rawMessage;
        requestError.__url = url;
        reject(
          requestError
        );
      },
      fail(err) {
        const rawMessage = (err && err.errMsg) || (err && err.message) || "request:fail";
        const error = new Error(normalizeMiniappNetworkErrorMessage(rawMessage));
        error.__networkFail = true;
        error.__rawErrMsg = rawMessage;
        error.__url = url;
        reject(error);
      }
    });
  });

const canAutoFallback = (method, header = {}) => {
  const m = String(method || "GET").toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return true;
  const keys = Object.keys(header || {});
  return keys.some((k) => k.toLowerCase() === "idempotency-key");
};

const isUnauthorizedError = (error) => {
  if (!error) return false;
  if (Number(error.__statusCode) === 401) return true;
  // message 已中文化，只能拿后端原文（__rawMessage）判定
  const message = String((error && error.__rawMessage) || (error && error.message) || "");
  return (
    message.includes("Request failed (401)") ||
    message.includes("Missing authorization header") ||
    message.includes("Invalid bearer token") ||
    message.includes("Session expired") ||
    message.includes("Unauthorized") ||
    message.includes("登录已过期") ||
    message.includes("登录状态")
  );
};

const canRetryAfterReauth = ({ method, path }) => {
  const normalizedMethod = String(method || "GET").toUpperCase();
  if (!(normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS")) {
    return false;
  }
  const requestPath = String(path || "");
  return !requestPath.startsWith("/api/v1/auth/login");
};

const requestWithFallback = ({ method, path, data, header = {}, timeout, authToken = "" }) => {
  const currentBase = getBaseUrl();
  const candidates = buildFallbackCandidates(currentBase, {
    includeLocal: false,
    method,
  });
  const shouldFallback = canAutoFallback(method, header);

  const doRequest = (index = 0) => {
    if (index >= candidates.length) {
      return Promise.reject(new Error("暂时无法连接服务器，请检查网络后重试"));
    }
    const candidate = candidates[index];
    if (!candidate || !candidate.baseUrl) {
      return doRequest(index + 1);
    }

    return probeRelayStatus(candidate).then((eligible) => {
      if (!eligible) {
        return doRequest(index + 1);
      }
      const url = buildUrlWithBase(candidate.baseUrl, path);
      const activeToken = authToken || getToken();
      const authHeader = activeToken ? { Authorization: `Bearer ${activeToken}` } : {};
      return executeRequest({
        url,
        method,
        data,
        timeout,
        header: {
          "content-type": "application/json",
          ...authHeader,
          ...header,
          ...(candidate.isRelay ? { "X-Relay-Fallback": "1" } : {})
        },
      })
        .then(({ body }) => {
          setBaseUrl(candidate.baseUrl);
          return body;
        })
        .catch((error) => {
          if (
            shouldFallback &&
            index + 1 < candidates.length &&
            (isConnectionRefusedError(error) || isNetworkLayerFailure(error) || isRetryableNetworkError(error))
          ) {
            return doRequest(index + 1);
          }
          throw error;
        });
    });
  };

  return doRequest(0);
};

const ensureSessionReady = () => {
  const token = getToken();
  if (token) return Promise.resolve(token);

  const app = typeof getApp === "function" ? getApp() : null;
  if (!app || typeof app.ensureSession !== "function") {
    return Promise.resolve("");
  }

  return app.ensureSession()
    .then((resolvedToken) => {
      const tokenFromSession =
        typeof resolvedToken === "string" && resolvedToken.trim()
          ? resolvedToken.trim()
          : "";
      const tokenFromStorage = getToken();
      const effectiveToken = tokenFromSession || tokenFromStorage;
      if (effectiveToken) {
        setToken(effectiveToken);
      }
      return effectiveToken;
    })
    .catch((error) => {
      clearToken();
      throw error;
    });
};

const request = ({ method = "GET", path, data, header = {}, antiDuplicate = true, dedupeKey, idempotencyKey }) => {
  const normalizedMethod = toRequestMethod(method);
  const normalizedHeader = { ...(header || {}) };
  const shouldProtectMutation = antiDuplicate !== false && MUTATION_METHODS.has(normalizedMethod);
  const existingIdempotencyKey = getHeaderValueCaseInsensitive(normalizedHeader, "Idempotency-Key");
  const explicitIdempotencyKey = existingIdempotencyKey || idempotencyKey;
  const effectiveIdempotencyKey = explicitIdempotencyKey || buildRandomKey("miniapp-idem");

  if (MUTATION_METHODS.has(normalizedMethod) && !existingIdempotencyKey) {
    normalizedHeader["Idempotency-Key"] = effectiveIdempotencyKey;
  }

  const mutationDedupKey = shouldProtectMutation
    ? buildMutationDedupKey({
        method: normalizedMethod,
        path,
        data,
        dedupeKey,
        idempotencyKey: explicitIdempotencyKey
      })
    : "";

  const resolveAuthToken = (candidateToken) => {
    const normalizedCandidate =
      typeof candidateToken === "string" ? candidateToken.trim() : "";
    if (normalizedCandidate) return normalizedCandidate;
    const stored = getToken();
    return typeof stored === "string" ? stored.trim() : "";
  };

  const executeWithAuthRecovery = (enableRetry = true, candidateToken = "") => {
    const authToken = resolveAuthToken(candidateToken);
    return requestWithFallback({
      method: normalizedMethod,
      path,
      data,
      header: normalizedHeader,
      timeout: DEFAULT_TIMEOUT_MS,
      authToken,
    }).catch((error) => {
      if (
        !enableRetry ||
        !canRetryAfterReauth({ method: normalizedMethod, path }) ||
        !isUnauthorizedError(error)
      ) {
        throw error;
      }

      clearToken();
      return ensureSessionReady().then((renewedToken) => executeWithAuthRecovery(false, renewedToken));
    });
  };

  return ensureSessionReady().then((sessionToken) => {
    if (shouldProtectMutation && pendingMutationRequests.has(mutationDedupKey)) {
      return pendingMutationRequests.get(mutationDedupKey);
    }

    const requestPromise = executeWithAuthRecovery(true, sessionToken);

    if (shouldProtectMutation) {
      const wrappedPromise = requestPromise.finally(() => {
        pendingMutationRequests.delete(mutationDedupKey);
      });
      pendingMutationRequests.set(mutationDedupKey, wrappedPromise);
      return wrappedPromise;
    }

    return requestPromise;
  });
};

const loginRequest = ({
  code: payload,
  endpoint = "/api/v1/auth/login/web",
  includeLocalFallback = false
}) => {
  const isOneTimeCodePayload = typeof payload === "string";
  const fallbackCandidates = buildFallbackCandidates(getBaseUrl(), {
    includeLocal: includeLocalFallback
  });

  const doRequest = (attempt, baseIndex = 0) =>
    Promise.resolve().then(() => {
      const candidate = fallbackCandidates[baseIndex] || { baseUrl: getBaseUrl() };
      return probeRelayStatus(candidate).then((eligible) => {
        if (!eligible && baseIndex + 1 < fallbackCandidates.length) {
          return doRequest(attempt, baseIndex + 1);
        }
        const targetBase = candidate.baseUrl || getBaseUrl();
        const url = buildUrlWithBase(targetBase, endpoint);
        return executeRequest({
          url,
          method: "POST",
          data: typeof payload === "string" ? { code: payload } : payload,
          timeout: LOGIN_TIMEOUT_MS,
          responseType: "arraybuffer",
          header: {
            "content-type": "application/json",
            ...(candidate.isRelay ? { "X-Relay-Fallback": "1" } : {})
          },
        }).then(({ body }) => {
          const responseBody = body && body.data ? body.data : body;
          if (!responseBody || typeof responseBody !== "object") {
            throw new Error("登录响应格式异常，请稍后重试或联系管理员");
          }
          if (responseBody && responseBody.accessToken) {
            setToken(responseBody.accessToken);
          }
          setBaseUrl(targetBase);
          return responseBody || {};
        });
      });
    }).catch((error) => {
      if (
        !isOneTimeCodePayload &&
        baseIndex + 1 < fallbackCandidates.length &&
        (isConnectionRefusedError(error) || isNetworkLayerFailure(error))
      ) {
        return doRequest(attempt, baseIndex + 1);
      }
      if (!isOneTimeCodePayload && attempt < 2 && isRetryableNetworkError(error)) {
        return doRequest(attempt + 1, baseIndex);
      }
      if (
        isOneTimeCodePayload &&
        (isConnectionRefusedError(error) ||
          isNetworkLayerFailure(error) ||
          isRetryableNetworkError(error))
      ) {
        throw new Error(
          `${(error && error.message) || "登录请求失败"}\n企业微信登录凭证为一次性且有效期很短，请重新发起登录。`
        );
      }
      throw error;
    });

  return doRequest(1);
};

const uploadBinary = ({ path, arrayBuffer, contentType }) => {
  // The backend signs an absolute Worker URL (https://api.hybcdg.com/...).
  // Using it verbatim makes the PUT bypass the HK bridge and hit Cloudflare
  // directly — exactly the unreliable mainland-China path the bridge exists to
  // avoid, and the path every other request is routed away from via
  // FORCE_HK_BRIDGE_PRIMARY. The upload signature only covers key + expiry
  // (host-independent), so re-basing onto a relative path lets the upload
  // follow the same bridge + fallback route as the rest of the app.
  const relativePath = toRelativeApiPath(path);
  return ensureSessionReady().then(() => {
    return requestWithFallback({
      method: "PUT",
      path: relativePath,
      data: arrayBuffer,
      timeout: UPLOAD_TIMEOUT_MS,
      header: {
        "content-type": contentType || "application/octet-stream",
        // PUT to a fixed object key is idempotent; this header also opts the
        // upload into bridge -> direct-Worker fallback (see canAutoFallback).
        "Idempotency-Key": buildRandomKey("miniapp-upload")
      }
    });
  });
};

module.exports = {
  request,
  loginRequest,
  uploadBinary,
  buildUrl
};
