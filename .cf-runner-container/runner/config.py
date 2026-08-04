from __future__ import annotations

import uuid
from dataclasses import dataclass, field


@dataclass
class Settings:
    """Task runner configuration loaded from environment variables."""

    api_base_url: str = "http://127.0.0.1:8787"
    api_base_url_fallbacks: list[str] = field(default_factory=list)
    api_key: str = "local-dev-task-api-key"
    node_id: str = ""
    node_name: str = "default-node"
    node_type: str = "docker"
    poll_interval_seconds: float = 3.0
    heartbeat_interval_seconds: float = 30.0
    tls_ca_cert_path: str = ""
    tls_client_cert_path: str = ""
    tls_client_key_path: str = ""
    capabilities: list[str] = field(
        default_factory=lambda: [
            "contract_review",
            "risk_assessment",
            "payment_risk_assessment",
            "reimbursement_check",
            "reimbursement_anomaly",
            "log_smart_fill",
            "log_analysis",
            "log_summary",
            "external_log_audit",
            "equipment_recommend",
            "consumable_estimation",
            "inventory_alert_analysis",
            "consumption_anomaly",
            "ocr_extract",
            "file_generate",
            "voice_stt",
            "approval_ai_gate",
            "bidding_dedup_rewrite",
            "contract_precheck_extract",
        ]
    )

    def __post_init__(self) -> None:
        if not self.node_id:
            self.node_id = str(uuid.uuid4())

    @classmethod
    def from_env(cls) -> Settings:
        import os

        raw_capabilities = os.getenv("CAPABILITIES", "")
        raw_fallbacks = os.getenv("API_BASE_URL_FALLBACKS", "")
        capabilities = (
            [c.strip() for c in raw_capabilities.split(",") if c.strip()]
            if raw_capabilities
            else None
        )
        fallbacks = (
            [v.strip() for v in raw_fallbacks.split(",") if v.strip()]
            if raw_fallbacks
            else None
        )

        kwargs: dict = {
            "api_base_url": os.getenv("API_BASE_URL", "http://127.0.0.1:8787"),
            "api_key": os.getenv("API_KEY", "local-dev-task-api-key"),
            "node_id": os.getenv("NODE_ID", ""),
            "node_name": os.getenv("NODE_NAME", "default-node"),
            "node_type": os.getenv("NODE_TYPE", "docker"),
            "poll_interval_seconds": float(
                os.getenv("POLL_INTERVAL_SECONDS", "3.0")
            ),
            "heartbeat_interval_seconds": float(
                os.getenv("HEARTBEAT_INTERVAL_SECONDS", "30.0")
            ),
            "tls_ca_cert_path": os.getenv("TLS_CA_CERT_PATH", ""),
            "tls_client_cert_path": os.getenv("TLS_CLIENT_CERT_PATH", ""),
            "tls_client_key_path": os.getenv("TLS_CLIENT_KEY_PATH", ""),
        }
        if capabilities is not None:
            kwargs["capabilities"] = capabilities
        if fallbacks is not None:
            kwargs["api_base_url_fallbacks"] = fallbacks

        return cls(**kwargs)
