from __future__ import annotations

import json
import asyncio
import time
import uuid
from collections import deque
from threading import Lock
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request, Response

from .config import Settings
from .security import NonceCache, build_bridge_signature, verify_wecom_signature

settings = Settings()
nonce_cache = NonceCache(ttl_seconds=300)
app = FastAPI(title="HYBC WeCom Bridge", version="0.1.0", redirect_slashes=False)


class RelayRuntimeStats:
    def __init__(self) -> None:
        self.inflight = 0
        self.cooldown_until = 0.0
        self.window_total: deque[float] = deque()
        self.window_timeout: deque[float] = deque()
        self.window_upstream_error: deque[float] = deque()
        self.window_local_reject: deque[float] = deque()
        self.lock = Lock()

    def _trim(self, now: float) -> None:
        cutoff = now - _safe_positive_int(settings.relay_error_window_seconds, 60)
        while self.window_total and self.window_total[0] < cutoff:
            self.window_total.popleft()
        while self.window_timeout and self.window_timeout[0] < cutoff:
            self.window_timeout.popleft()
        while self.window_upstream_error and self.window_upstream_error[0] < cutoff:
            self.window_upstream_error.popleft()
        while self.window_local_reject and self.window_local_reject[0] < cutoff:
            self.window_local_reject.popleft()

    def _is_overloaded_no_lock(self, now: float) -> tuple[bool, str]:
        self._trim(now)
        if now < self.cooldown_until:
            return True, "cooldown"
        if self.inflight >= _safe_positive_int(settings.relay_max_inflight, 120):
            return True, "inflight_limit"
        total = len(self.window_total)
        timeout_rate = (len(self.window_timeout) / total) if total > 0 else 0.0
        error_rate = (len(self.window_upstream_error) / total) if total > 0 else 0.0
        min_samples = _safe_positive_int(settings.relay_min_samples, 10)
        if total >= min_samples:
            if timeout_rate >= _safe_float(settings.relay_timeout_rate_threshold, 0.3):
                return True, "timeout_rate"
            if error_rate >= _safe_float(settings.relay_error_rate_threshold, 0.5):
                return True, "error_rate"
        return False, "ok"

    def status(self) -> dict[str, Any]:
        try:
            with self.lock:
                now = time.time()
                overloaded, reason = self._is_overloaded_no_lock(now)
                total = len(self.window_total)
                timeout_rate = (len(self.window_timeout) / total) if total > 0 else 0.0
                error_rate = (len(self.window_upstream_error) / total) if total > 0 else 0.0
                cooldown_left = max(0, int(self.cooldown_until - now))
                return {
                    "overloaded": overloaded,
                    "reason": reason,
                    "inflight_requests": self.inflight,
                    "max_inflight": _safe_positive_int(settings.relay_max_inflight, 120),
                    "window_seconds": _safe_positive_int(settings.relay_error_window_seconds, 60),
                    "sample_size": total,
                    "timeout_rate": round(timeout_rate, 4),
                    "upstream_error_rate": round(error_rate, 4),
                    "cooldown_seconds_left": cooldown_left,
                    "admission_state": "hard_limit" if overloaded else "accepting",
                }
        except Exception:
            return {
                "overloaded": False,
                "reason": "status_error",
                "inflight_requests": 0,
                "max_inflight": _safe_positive_int(settings.relay_max_inflight, 120),
                "window_seconds": _safe_positive_int(settings.relay_error_window_seconds, 60),
                "sample_size": 0,
                "timeout_rate": 0.0,
                "upstream_error_rate": 0.0,
                "cooldown_seconds_left": 0,
                "admission_state": "accepting",
            }

    def reject_if_overloaded(self) -> tuple[bool, str]:
        try:
            with self.lock:
                now = time.time()
                overloaded, reason = self._is_overloaded_no_lock(now)
                if overloaded:
                    self.window_local_reject.append(now)
                    return True, reason
                self.inflight += 1
                return False, "ok"
        except Exception:
            return False, "status_error"

    def finish_request(self, *, timeout: bool, upstream_error: bool) -> None:
        try:
            with self.lock:
                now = time.time()
                self.inflight = max(0, self.inflight - 1)
                self.window_total.append(now)
                if timeout:
                    self.window_timeout.append(now)
                if upstream_error:
                    self.window_upstream_error.append(now)
                overloaded, reason = self._is_overloaded_no_lock(now)
                if overloaded and reason in {"inflight_limit", "timeout_rate", "error_rate"}:
                    self.cooldown_until = max(
                        self.cooldown_until,
                        now + _safe_positive_int(settings.relay_cooldown_seconds, 20),
                    )
        except Exception:
            self.inflight = max(0, self.inflight - 1)


relay_stats = RelayRuntimeStats()


def _safe_positive_int(value: Any, fallback: int) -> int:
    try:
        ivalue = int(value)
        if ivalue > 0:
            return ivalue
    except Exception:
        pass
    return fallback


def _safe_float(value: Any, fallback: float) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


async def reject_when_overloaded() -> None:
    overloaded, reason = relay_stats.reject_if_overloaded()
    if overloaded:
        retry_after = str(_safe_positive_int(settings.relay_cooldown_seconds, 20))
        payload = {
            "ok": False,
            "error": {
                "code": "relay_overloaded",
                "message": "relay is overloaded, skip and try next relay",
                "reason": reason,
                "retry_after_seconds": int(retry_after),
            },
        }
        raise HTTPException(
            status_code=503,
            detail=payload,
            headers={"Retry-After": retry_after},
        )


@app.get("/health")
async def health() -> dict[str, Any]:
    relay = relay_stats.status()
    return {
        "ok": True,
        "service": "azure-wecom-bridge",
        "now": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "relay": relay,
    }


@app.get("/relay/status")
@app.get("/relay/status/")
async def relay_status() -> dict[str, Any]:
    relay = relay_stats.status()
    return {
        "ok": True,
        "service": "azure-wecom-bridge",
        "now": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        **relay,
    }


@app.get("/wecom/callback")
async def wecom_verify(
    msg_signature: str = "",
    timestamp: str = "",
    nonce: str = "",
    echostr: str = "",
) -> Response:
    if not verify_wecom_signature(settings.wecom_verify_token, msg_signature, timestamp, nonce):
        raise HTTPException(status_code=403, detail="invalid signature")
    return Response(content=echostr, media_type="text/plain")


@app.post("/wecom/callback")
async def wecom_callback(request: Request) -> dict[str, Any]:
    if not settings.bridge_hmac_secret:
        raise HTTPException(status_code=500, detail="bridge secret not configured")

    raw_body = await request.body()
    query = dict(request.query_params)
    msg_signature = query.get("msg_signature", "")
    timestamp = query.get("timestamp", "")
    nonce = query.get("nonce", "")

    if not verify_wecom_signature(settings.wecom_verify_token, msg_signature, timestamp, nonce):
        raise HTTPException(status_code=403, detail="invalid signature")

    payload = {
        "trace_id": f"bridge-{uuid.uuid4()}",
        "source": settings.bridge_source,
        "received_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "query": query,
        "body": raw_body.decode("utf-8", errors="replace"),
        "headers": {
            "x-forwarded-for": request.headers.get("x-forwarded-for", ""),
            "user-agent": request.headers.get("user-agent", ""),
            "content-type": request.headers.get("content-type", ""),
        },
    }

    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ts = str(int(time.time()))
    forward_nonce = uuid.uuid4().hex

    if nonce_cache.seen(forward_nonce):
        raise HTTPException(status_code=409, detail="duplicate nonce")

    signature = build_bridge_signature(settings.bridge_hmac_secret, ts, forward_nonce, body)
    forward_headers = {
        "Content-Type": "application/json",
        "X-Bridge-Source": settings.bridge_source,
        "X-Bridge-Timestamp": ts,
        "X-Bridge-Nonce": forward_nonce,
        "X-Bridge-Signature": signature,
        "User-Agent": "HYBC-Azure-Bridge/0.1",
    }

    await reject_when_overloaded()
    last_error = ""
    timeout_error = False
    upstream_error = False
    retries = max(settings.worker_max_retries, 1)
    try:
        for attempt in range(retries):
            try:
                async with httpx.AsyncClient(timeout=settings.worker_timeout_seconds) as client:
                    resp = await client.post(settings.worker_ingest_url, content=body, headers=forward_headers)
                    if 200 <= resp.status_code < 300:
                        return {"success": True, "trace_id": payload["trace_id"]}
                    upstream_error = True
                    last_error = f"status={resp.status_code} body={resp.text[:300]}"
            except httpx.TimeoutException as exc:
                timeout_error = True
                last_error = str(exc)
            except Exception as exc:
                upstream_error = True
                last_error = str(exc)
            if attempt + 1 < retries:
                await asyncio.sleep(0.5 * (attempt + 1))

        raise HTTPException(status_code=502, detail=f"forward failed: {last_error}")
    finally:
        relay_stats.finish_request(timeout=timeout_error, upstream_error=upstream_error)


def _build_target_url(base_url: str, full_path: str, query: str) -> str:
    normalized_base = (base_url or "").rstrip("/")
    suffix = full_path.lstrip("/")
    url = f"{normalized_base}/api/{suffix}"
    if query:
        return f"{url}?{query}"
    return url


def _filter_request_headers(headers: Any) -> dict[str, str]:
    blocked = {
        "connection",
        "content-length",
        "host",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    }
    safe_headers: dict[str, str] = {}
    for k, v in headers.items():
        lk = str(k).lower()
        if lk in blocked:
            continue
        safe_headers[str(k)] = str(v)
    safe_headers["X-Relay-Source"] = settings.bridge_source
    return safe_headers


def _append_forwarded_for(existing: str, client_host: str) -> str:
    if existing and client_host:
        return f"{existing}, {client_host}"
    return existing or client_host


def _inject_forward_headers(request: Request, headers: dict[str, str]) -> dict[str, str]:
    forwarded_headers = dict(headers)
    client_host = request.client.host if request.client else ""
    forwarded_headers["X-Forwarded-For"] = _append_forwarded_for(
        request.headers.get("x-forwarded-for", ""), client_host
    )
    forwarded_headers["X-Forwarded-Proto"] = request.url.scheme
    host_header = request.headers.get("host", "")
    if host_header:
        forwarded_headers["X-Forwarded-Host"] = host_header
    forwarded_headers["X-Request-Id"] = request.headers.get("x-request-id", uuid.uuid4().hex)
    return forwarded_headers


def _filter_response_headers(headers: Any) -> dict[str, str]:
    blocked = {
        "connection",
        "content-length",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    }
    safe_headers: dict[str, str] = {}
    for k, v in headers.items():
        lk = str(k).lower()
        if lk in blocked:
            continue
        safe_headers[str(k)] = str(v)
    return safe_headers


async def _relay_api_request(request: Request, full_path: str) -> Response:
    await reject_when_overloaded()
    timeout_error = False
    upstream_error = False
    try:
        query = request.url.query
        target_url = _build_target_url(settings.worker_api_base_url, full_path, query)
        method = request.method.upper()
        body = await request.body()
        headers = _inject_forward_headers(request, _filter_request_headers(request.headers))

        async with httpx.AsyncClient(timeout=settings.relay_api_timeout_seconds) as client:
            upstream = await client.request(
                method=method,
                url=target_url,
                content=body,
                headers=headers,
            )
        if upstream.status_code >= 500:
            upstream_error = True
        response_headers = _filter_response_headers(upstream.headers)
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            headers=response_headers,
        )
    except httpx.TimeoutException:
        timeout_error = True
        raise HTTPException(status_code=504, detail="relay upstream timeout")
    except HTTPException:
        raise
    except Exception as exc:
        upstream_error = True
        raise HTTPException(status_code=502, detail=f"relay proxy failed: {exc}")
    finally:
        relay_stats.finish_request(timeout=timeout_error, upstream_error=upstream_error)


@app.api_route("/api/{full_path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def relay_api(full_path: str, request: Request) -> Response:
    return await _relay_api_request(request, full_path)


@app.post("/wecom/proxy")
@app.post("/wecom/proxy/")
async def wecom_proxy(request: Request) -> Response:
    await reject_when_overloaded()
    token_required = bool(settings.bridge_proxy_token and settings.bridge_proxy_token != "replace-me")
    if token_required:
        token = request.headers.get("x-bridge-token", "")
        if token != settings.bridge_proxy_token:
            raise HTTPException(status_code=401, detail="invalid bridge proxy token")

    body = await request.json()
    target_url = str(body.get("url") or "")
    method = str(body.get("method") or "GET").upper()
    request_body = body.get("body")
    request_headers = body.get("headers") if isinstance(body.get("headers"), dict) else {}

    if not target_url:
        raise HTTPException(status_code=400, detail="missing url")
    if method not in {"GET", "POST"}:
        raise HTTPException(status_code=400, detail="method not allowed")

    parsed = urlparse(target_url)
    if parsed.scheme != "https" or parsed.netloc != "qyapi.weixin.qq.com":
        raise HTTPException(status_code=400, detail="target host not allowed")
    if not parsed.path.startswith("/cgi-bin/"):
        raise HTTPException(status_code=400, detail="target path not allowed")

    outbound_headers = {"User-Agent": "HYBC-Azure-Bridge/0.1"}
    if isinstance(request_headers, dict):
        content_type = request_headers.get("content-type") or request_headers.get("Content-Type")
        if isinstance(content_type, str) and content_type:
            outbound_headers["Content-Type"] = content_type

    request_kwargs: dict[str, Any] = {
        "method": method,
        "url": target_url,
        "headers": outbound_headers,
    }

    if method == "POST":
        if isinstance(request_body, str):
            request_kwargs["content"] = request_body.encode("utf-8")
        elif request_body is not None:
            request_kwargs["json"] = request_body

    timeout_error = False
    upstream_error = False
    try:
        async with httpx.AsyncClient(timeout=settings.worker_timeout_seconds) as client:
            upstream = await client.request(**request_kwargs)
            if upstream.status_code >= 500:
                upstream_error = True
            return Response(
                content=upstream.text,
                status_code=upstream.status_code,
                media_type=upstream.headers.get("content-type", "application/json"),
            )
    except httpx.TimeoutException:
        timeout_error = True
        raise HTTPException(status_code=504, detail="wecom proxy timeout")
    finally:
        relay_stats.finish_request(timeout=timeout_error, upstream_error=upstream_error)
