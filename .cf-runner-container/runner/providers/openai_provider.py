from __future__ import annotations

import importlib
import json
import logging
import time
from typing import Any

from .base import AiProvider, ProviderResult

logger = logging.getLogger(__name__)


class OpenAIProvider(AiProvider):
    provider_key = "openai"

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4.1",
        base_url: str | None = None,
        organization: str | None = None,
        project: str | None = None,
        timeout_seconds: float = 30.0,
        max_retries: int = 2,
    ) -> None:
        openai_module = importlib.import_module("openai")
        kwargs: dict[str, Any] = {
            "api_key": api_key,
            "timeout": timeout_seconds,
            "max_retries": max_retries,
        }
        if base_url:
            kwargs["base_url"] = base_url
        if organization:
            kwargs["organization"] = organization
        if project:
            kwargs["project"] = project

        self.client = openai_module.OpenAI(**kwargs)
        self.model = model

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
            "approval_ai_gate",
        ]

    def execute(
        self,
        task_type: str,
        payload: dict,
        prompt: dict | None = None,
    ) -> ProviderResult:
        system_prompt = (
            prompt.get("system")
            if isinstance(prompt, dict) and isinstance(prompt.get("system"), str)
            else "You are a helpful enterprise assistant. Return concise structured output."
        )
        user_prompt = (
            prompt.get("user")
            if isinstance(prompt, dict) and isinstance(prompt.get("user"), str)
            else json.dumps(payload, ensure_ascii=False)
        )

        start = time.monotonic()
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.2,
                max_tokens=2048,
            )
            latency = int((time.monotonic() - start) * 1000)
            content = ""
            if response.choices:
                first = response.choices[0]
                if first.message and first.message.content:
                    content = first.message.content

            usage = response.usage
            tokens_input = int(getattr(usage, "prompt_tokens", 0) or 0) if usage else 0
            tokens_output = int(getattr(usage, "completion_tokens", 0) or 0) if usage else 0

            return ProviderResult(
                output=content,
                tokens_input=tokens_input,
                tokens_output=tokens_output,
                latency_ms=latency,
                metadata={"provider": self.provider_key, "model": self.model},
            )
        except Exception as exc:
            latency = int((time.monotonic() - start) * 1000)
            logger.error("OpenAI API call failed: %s", exc)
            raise RuntimeError(f"OpenAI API error: {exc} ({latency}ms)") from exc
