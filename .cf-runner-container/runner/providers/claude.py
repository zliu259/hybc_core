from __future__ import annotations

import base64
import json
import importlib
import logging
import time
from typing import Any, Protocol, cast

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
        messages: list[dict[str, Any]],
    ) -> _ClaudeResponse: ...


class _ClaudeClient(Protocol):
    messages: _ClaudeMessagesClient


class ClaudeProvider(AiProvider):
    provider_key = "claude"

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
            "ocr_extract",
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

        attachment_context = payload.get("_attachment_context")
        user_content: str | list[dict[str, Any]] = user_msg
        use_multimodal = False
        if isinstance(attachment_context, dict):
            text_blocks = attachment_context.get("text_blocks")
            image_data_urls = attachment_context.get("image_data_urls")
            if isinstance(text_blocks, list) or isinstance(image_data_urls, list):
                parts: list[dict[str, Any]] = [
                    {
                        "type": "text",
                        "text": (
                            f"{user_msg}\n\n"
                            "以下为系统从附件中提取的正文/图像证据，请必须结合这些证据做审查判断；"
                            "若业务描述与附件证据不一致，必须拒绝或要求补充材料。"
                        ),
                    }
                ]

                if isinstance(text_blocks, list):
                    for index, block in enumerate(text_blocks[:8]):
                        if not isinstance(block, dict):
                            continue
                        block_text = block.get("text")
                        if not isinstance(block_text, str) or not block_text.strip():
                            continue
                        source = (
                            block.get("source")
                            if isinstance(block.get("source"), str)
                            else "attachment"
                        )
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
                        image_part = self._data_url_to_claude_image_part(data_url)
                        if image_part is not None:
                            parts.append(image_part)

                if len(parts) > 1:
                    user_content = parts
                    use_multimodal = True

        start = time.monotonic()
        try:
            response = self.client.messages.create(
                model=self.model,
                max_tokens=2048,
                system=system,
                messages=[{"role": "user", "content": user_content}],
            )
            latency = int((time.monotonic() - start) * 1000)

            output = response.content[0].text if response.content else ""
            return ProviderResult(
                output=output,
                tokens_input=response.usage.input_tokens,
                tokens_output=response.usage.output_tokens,
                latency_ms=latency,
                metadata={"input_mode": "multimodal" if use_multimodal else "text"},
            )
        except Exception as exc:
            latency = int((time.monotonic() - start) * 1000)
            logger.error("Claude API call failed: %s", exc)
            raise RuntimeError(f"Claude API error: {exc}") from exc

    def _data_url_to_claude_image_part(self, data_url: str) -> dict[str, Any] | None:
        try:
            header, encoded = data_url.split(",", 1)
        except ValueError:
            return None
        if not header.startswith("data:image/") or ";base64" not in header:
            return None
        media_type = header[5 : header.index(";")]
        if media_type not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
            return None
        try:
            base64.b64decode(encoded, validate=True)
        except Exception:
            return None
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media_type,
                "data": encoded,
            },
        }
