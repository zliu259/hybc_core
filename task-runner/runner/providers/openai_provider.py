from __future__ import annotations

import importlib
import json
import logging
import time
from typing import Any

from ..evidence import build_attachment_note
from .base import AiProvider, ProviderResult

logger = logging.getLogger(__name__)

# 审批域任务输出结构化 findings/条款分析，且 gpt-5 系的 reasoning token
# 也计入 max_completion_tokens，2048 容易产出空内容或截断 JSON
_LONG_OUTPUT_TASKS = frozenset(
    {"approval_ai_gate", "payment_risk_assessment", "risk_assessment", "contract_review"}
)


def _max_completion_tokens_for_task(task_type: str) -> int:
    # 扫描件整本转写：20 页合同可达 2 万+ 字，需远大于常规审查的输出预算
    if task_type == "contract_precheck_extract":
        return 16384
    return 4096 if task_type in _LONG_OUTPUT_TASKS else 2048


def _image_part_cap(payload: dict[str, object]) -> int:
    """provider 默认只带 8 张图；OCR 整本转写通过 payload 提示放开上限。"""
    raw = payload.get("_image_part_cap")
    if isinstance(raw, int) and 0 < raw <= 40:
        return raw
    return 8


# 带附件的审查请求：现在会送全部页面，30s 默认超时会让长文档反复中途放弃并重复计费。
# 120s × 2 次仍在 AI 关卡 300s 的任务预算内。
_ATTACHMENT_REQUEST_TIMEOUT_SECONDS = 120.0
_ATTACHMENT_REQUEST_MAX_RETRIES = 1


# 转写被输出上限截断时的终态错误（半截合同进审计会漏条款，宁失败勿截半）
TRUNCATED_EXTRACT_OUTPUT = json.dumps(
    {
        "text": "",
        "chars": 0,
        "error": "扫描件文字量超出单次转写上限，转写不完整；请拆分文件后分别预审",
    },
    ensure_ascii=False,
)


class OpenAIProvider(AiProvider):
    provider_key = "openai"

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-5.5",
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
            "external_log_audit",
            "ocr_extract",
            "approval_ai_gate",
            "bidding_dedup_rewrite",
            "contract_precheck_extract",
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
                attachment_note = build_attachment_note(
                    task_type, payload.get("_evidence_coverage")
                )
                parts: list[dict[str, Any]] = [
                    {
                        "type": "text",
                        "text": f"{user_prompt}\n\n{attachment_note}",
                    }
                ]

                if isinstance(text_blocks, list):
                    # 附件数与字数上限由 executor 统一控制并记入覆盖信息，这里不再二次截断
                    for index, block in enumerate(text_blocks):
                        if not isinstance(block, dict):
                            continue
                        block_text = block.get("text")
                        if not isinstance(block_text, str) or not block_text.strip():
                            continue
                        source = block.get("source") if isinstance(block.get("source"), str) else "attachment"
                        parts.append(
                            {
                                "type": "text",
                                "text": f"[Attachment Text {index + 1} | {source}]\n{block_text}",
                            }
                        )

                if isinstance(image_data_urls, list):
                    for data_url in image_data_urls[: _image_part_cap(payload)]:
                        if not isinstance(data_url, str) or not data_url.startswith("data:image"):
                            continue
                        parts.append({"type": "image_url", "image_url": {"url": data_url}})

                # 附件全部读不出来时也要把读取情况告诉模型，否则它会把"没读到"当成"没有"
                if len(parts) > 1 or payload.get("_evidence_coverage"):
                    user_message_content = parts
                    use_multimodal = True

        selected_model = self._select_model(task_type, payload, use_multimodal)

        start = time.monotonic()
        try:
            request_kwargs: dict[str, Any] = {
                "model": selected_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message_content},
                ],
                "max_completion_tokens": _max_completion_tokens_for_task(task_type),
            }
            if not self._requires_default_temperature(selected_model):
                request_kwargs["temperature"] = 0.2

            # 多页 OCR 转写需要分钟级生成时间：默认 30s 客户端超时会让每次调用
            # 都中途放弃并重试（重复付费视觉输入），必须单独放宽且关掉 SDK 自动重试
            # （240s 且不重试，留在任务队列 timeout_seconds 预算内）
            if task_type == "contract_precheck_extract":
                client = self.client.with_options(timeout=240.0, max_retries=0)
            elif use_multimodal:
                client = self.client.with_options(
                    timeout=_ATTACHMENT_REQUEST_TIMEOUT_SECONDS,
                    max_retries=_ATTACHMENT_REQUEST_MAX_RETRIES,
                )
            else:
                client = self.client
            response = client.chat.completions.create(**request_kwargs)
            latency = int((time.monotonic() - start) * 1000)
            content = ""
            finish_reason = ""
            if response.choices:
                first = response.choices[0]
                if first.message and first.message.content:
                    content = first.message.content
                finish_reason = getattr(first, "finish_reason", "") or ""

            # 转写被输出上限截断：绝不能把半截合同当完整转写返回
            if task_type == "contract_precheck_extract" and finish_reason == "length":
                content = TRUNCATED_EXTRACT_OUTPUT

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

    @staticmethod
    def _requires_default_temperature(model: str) -> bool:
        # AI Gateway 目录模型名带 provider 前缀（如 openai/gpt-6.1-terra），剥前缀后再判。
        # 只有 GPT-4 及更早的模型接受自定义 temperature；GPT-5/6、o 系与 Claude 5 系传了会 400，
        # 用白名单而非黑名单，新模型上线不必再改这里。
        bare = model.strip().lower().split("/", 1)[-1]
        return not bare.startswith(("gpt-3", "gpt-4"))
