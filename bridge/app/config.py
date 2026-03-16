from __future__ import annotations

import os
from dataclasses import dataclass


def _int_env(name: str, default: int) -> int:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _float_env(name: str, default: float) -> float:
    value = os.getenv(name)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


@dataclass(slots=True)
class Settings:
    host: str = os.getenv("BRIDGE_HOST", "0.0.0.0")
    port: int = _int_env("BRIDGE_PORT", 9001)
    wecom_verify_token: str = os.getenv("WECOM_VERIFY_TOKEN", "")
    worker_ingest_url: str = os.getenv(
        "WORKER_INGEST_URL", "https://api.hybcdg.com/api/v1/system/bridge/wecom-ingest"
    )
    bridge_hmac_secret: str = os.getenv("BRIDGE_HMAC_SECRET", "")
    bridge_source: str = os.getenv("BRIDGE_SOURCE", "azure_wecom_bridge")
    bridge_proxy_token: str = os.getenv("BRIDGE_PROXY_TOKEN", "")
    worker_timeout_seconds: int = _int_env("WORKER_TIMEOUT_SECONDS", 10)
    worker_max_retries: int = _int_env("WORKER_MAX_RETRIES", 3)
    worker_api_base_url: str = os.getenv("WORKER_API_BASE_URL", "https://api.hybcdg.com")
    relay_api_timeout_seconds: int = _int_env("RELAY_API_TIMEOUT_SECONDS", 30)
    relay_max_inflight: int = _int_env("RELAY_MAX_INFLIGHT", 120)
    relay_error_window_seconds: int = _int_env("RELAY_ERROR_WINDOW_SECONDS", 60)
    relay_min_samples: int = _int_env("RELAY_MIN_SAMPLES", 10)
    relay_timeout_rate_threshold: float = _float_env("RELAY_TIMEOUT_RATE_THRESHOLD", 0.3)
    relay_error_rate_threshold: float = _float_env("RELAY_ERROR_RATE_THRESHOLD", 0.5)
    relay_cooldown_seconds: int = _int_env("RELAY_COOLDOWN_SECONDS", 20)
