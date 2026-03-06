from __future__ import annotations

import json
import asyncio
import time
import uuid
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException, Request, Response

from .config import Settings
from .security import NonceCache, build_bridge_signature, verify_wecom_signature

settings = Settings()
nonce_cache = NonceCache(ttl_seconds=300)
app = FastAPI(title="HYBC WeCom Bridge", version="0.1.0", redirect_slashes=False)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "azure-wecom-bridge",
        "now": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
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

    last_error = ""
    retries = max(settings.worker_max_retries, 1)
    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(timeout=settings.worker_timeout_seconds) as client:
                resp = await client.post(settings.worker_ingest_url, content=body, headers=forward_headers)
                if 200 <= resp.status_code < 300:
                    return {"success": True, "trace_id": payload["trace_id"]}
                last_error = f"status={resp.status_code} body={resp.text[:300]}"
        except Exception as exc:
            last_error = str(exc)
        if attempt + 1 < retries:
            await asyncio.sleep(0.5 * (attempt + 1))

    raise HTTPException(status_code=502, detail=f"forward failed: {last_error}")


@app.post("/wecom/proxy")
@app.post("/wecom/proxy/")
async def wecom_proxy(request: Request) -> Response:
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

    async with httpx.AsyncClient(timeout=settings.worker_timeout_seconds) as client:
        upstream = await client.request(**request_kwargs)
        return Response(
            content=upstream.text,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "application/json"),
        )
