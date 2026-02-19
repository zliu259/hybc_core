from __future__ import annotations

import json
import importlib
import logging
import time
from typing import Protocol, cast

from .base import AiProvider, ProviderResult

logger = logging.getLogger(__name__)


class _ClaudeUsage(Protocol):
    input_tokens: int
    output_tokens: int


class _ClaudeTextBlock(Protocol):
    text: str


class _ClaudeResponse(Protocol):
    content: list[_ClaudeTextBlock]
    usage: _ClaudeUsage


class _ClaudeMessagesClient(Protocol):
    def create(
        self,
        *,
        model: str,
        max_tokens: int,
        system: str,
        messages: list[dict[str, str]],
    ) -> _ClaudeResponse: ...


class _ClaudeClient(Protocol):
    messages: _ClaudeMessagesClient


class ClaudeProvider(AiProvider):
    """AI provider using Anthropic Claude API."""

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514") -> None:
        anthropic_module = importlib.import_module("anthropic")
        self.client: _ClaudeClient = cast(
            _ClaudeClient,
            anthropic_module.Anthropic(api_key=api_key),
        )
        self.model: str = model

    def supports(self, task_type: str) -> bool:
        return task_type in [
            "contract_review",
            "risk_assessment",
            "payment_risk_assessment",
            "reimbursement_check",
            "reimbursement_anomaly",
            "log_smart_fill",
            "log_analysis",
            "log_summary",
            "consumable_estimation",
            "inventory_alert_analysis",
            "consumption_anomaly",
            "approval_ai_gate",
        ]

    def execute(
        self,
        task_type: str,
        payload: dict[str, object],
        prompt: dict[str, str] | None = None,
    ) -> ProviderResult:
        system = prompt["system"] if prompt else "You are a helpful assistant."
        user_msg = prompt["user"] if prompt else json.dumps(payload, ensure_ascii=False)

        start = time.monotonic()
        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=2048,
                system=system,
                messages=[{"role": "user", "content": user_msg}],
            )
            latency = int((time.monotonic() - start) * 1000)

            output = response.content[0].text if response.content else ""
            return ProviderResult(
                output=output,
                tokens_input=response.usage.input_tokens,
                tokens_output=response.usage.output_tokens,
                latency_ms=latency,
            )
        except Exception as exc:
            latency = int((time.monotonic() - start) * 1000)
            logger.error("Claude API call failed: %s", exc)
            raise RuntimeError(f"Claude API error: {exc}") from exc
