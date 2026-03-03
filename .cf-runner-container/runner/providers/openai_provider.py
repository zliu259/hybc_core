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
        model: str = "gpt-5.2",
        base_url: str | None = None,
        organization: str | None = None,
        project: str | None = None,
        timeout_seconds: float = 30.0,
        max_retries: int = 2,
        model_overrides: dict[str, str] | None = None,
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
        self.model_overrides = model_overrides or {}

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
            else json.dumps(
                {k: v for k, v in payload.items() if not str(k).startswith("_")},
                ensure_ascii=False,
            )
        )

        attachment_context = payload.get("_attachment_context")
        use_multimodal = False
        user_message_content: str | list[dict[str, Any]] = user_prompt
        if isinstance(attachment_context, dict):
            text_blocks = attachment_context.get("text_blocks")
            image_data_urls = attachment_context.get("image_data_urls")
            if isinstance(text_blocks, list) or isinstance(image_data_urls, list):
                parts: list[dict[str, Any]] = [{"type": "text", "text": user_prompt}]

                if isinstance(text_blocks, list):
                    for index, block in enumerate(text_blocks[:8]):
                        if not isinstance(block, dict):
                            continue
                        block_text = block.get("text")
                        if not isinstance(block_text, str) or not block_text.strip():
                            continue
                        source = block.get("source") if isinstance(block.get("source"), str) else "attachment"
                        parts.append(
                            {
                                "type": "text",
                                "text": f"[Attachment Text {index + 1} | {source}]\n{block_text[:12000]}",
                            }
                        )

                if isinstance(image_data_urls, list):
                    for data_url in image_data_urls[:8]:
                        if not isinstance(data_url, str) or not data_url.startswith("data:image"):
                            continue
                        parts.append({"type": "image_url", "image_url": {"url": data_url}})

                if len(parts) > 1:
                    user_message_content = parts
                    use_multimodal = True

        selected_model = self._select_model(task_type, payload, use_multimodal)

        start = time.monotonic()
        try:
            response = self.client.chat.completions.create(
                model=selected_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message_content},
                ],
                temperature=0.2,
                max_completion_tokens=2048,
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
                metadata={
                    "provider": self.provider_key,
                    "model": selected_model,
                    "input_mode": "multimodal" if use_multimodal else "text",
                },
            )
        except Exception as exc:
            latency = int((time.monotonic() - start) * 1000)
            logger.error("OpenAI API call failed: %s", exc)
            raise RuntimeError(f"OpenAI API error: {exc} ({latency}ms)") from exc

    def _select_model(self, task_type: str, payload: dict[str, Any], use_multimodal: bool) -> str:
        input_mode = payload.get("_hy_input_mode")
        mode = input_mode if isinstance(input_mode, str) and input_mode else ("vision" if use_multimodal else "text")

        if task_type == "contract_review":
            direct_key = f"contract_review:{mode}"
            if direct_key in self.model_overrides:
                return self.model_overrides[direct_key]

        task_key = f"{task_type}:{mode}"
        if task_key in self.model_overrides:
            return self.model_overrides[task_key]

        default_mode_key = f"default:{mode}"
        if default_mode_key in self.model_overrides:
            return self.model_overrides[default_mode_key]

        if task_type in self.model_overrides:
            return self.model_overrides[task_type]

        return self.model
