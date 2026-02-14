from __future__ import annotations

import uuid
from dataclasses import dataclass, field


@dataclass
class Settings:
    """Task runner configuration loaded from environment variables."""

    api_base_url: str = "http://127.0.0.1:8787"
    api_key: str = "local-dev-task-api-key"
    node_id: str = ""
    node_name: str = "default-node"
    node_type: str = "docker"
    poll_interval_seconds: float = 3.0
    heartbeat_interval_seconds: float = 30.0
    capabilities: list[str] = field(
        default_factory=lambda: [
            "contract_review",
            "risk_assessment",
            "reimbursement_check",
            "log_analysis",
            "equipment_recommend",
            "ocr_extract",
            "file_generate",
            "approval_ai_gate",
        ]
    )

    def __post_init__(self) -> None:
        if not self.node_id:
            self.node_id = str(uuid.uuid4())

    @classmethod
    def from_env(cls) -> Settings:
        import os

        raw_capabilities = os.getenv("CAPABILITIES", "")
        capabilities = (
            [c.strip() for c in raw_capabilities.split(",") if c.strip()]
            if raw_capabilities
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
        }
        if capabilities is not None:
            kwargs["capabilities"] = capabilities

        return cls(**kwargs)
