from __future__ import annotations

import hashlib
import hmac
import time


def verify_wecom_signature(token: str, signature: str, timestamp: str, nonce: str) -> bool:
    if not token or not signature or not timestamp or not nonce:
        return False
    candidates = "".join(sorted([token, timestamp, nonce]))
    expected = hashlib.sha1(candidates.encode("utf-8")).hexdigest()
    return hmac.compare_digest(expected, signature)


def build_bridge_signature(secret: str, timestamp: str, nonce: str, body: bytes) -> str:
    msg = f"{timestamp}.{nonce}.".encode("utf-8") + body
    digest = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    return digest


class NonceCache:
    def __init__(self, ttl_seconds: int = 300) -> None:
        self.ttl_seconds = ttl_seconds
        self._cache: dict[str, float] = {}

    def seen(self, nonce: str) -> bool:
        now = time.time()
        expired = [k for k, v in self._cache.items() if v < now]
        for key in expired:
            self._cache.pop(key, None)
        if nonce in self._cache:
            return True
        self._cache[nonce] = now + self.ttl_seconds
        return False
