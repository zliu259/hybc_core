# pyright: reportImplicitOverride=false
from __future__ import annotations

import json
import os
from typing import cast

from ..providers.claude import ClaudeProvider

from .base import BaseTaskProcessor, TaskResult

DEFAULT_PROMPT: dict[str, str] = {
    "system": (
        "你是恒越百川建设集团的付款风控AI专家。"
        "请基于付款申请、合同信息和历史支付记录识别潜在风险，"
        "输出必须是严格JSON，不要输出额外说明。"
    ),
    "user_template": (
        "请对以下付款申请进行风险评估，并仅返回JSON对象。\\n"
        "必须包含字段：overall_risk, score, summary, frequency_check, "
        "amount_check, duplicate_check, recommendations。\\n"
        "字段要求：\\n"
        "- overall_risk: low/medium/high\\n"
        "- score: 0-100数字（分数越高风险越高）\\n"
        "- summary: 字符串，简要结论\\n"
        "- frequency_check: 对支付频率的检查对象，包含status, findings, evidence\\n"
        "- amount_check: 对金额异常的检查对象，包含status, findings, evidence\\n"
        "- duplicate_check: 对疑似重复支付的检查对象，包含status, findings, evidence\\n"
        "- recommendations: 数组，给出可执行建议\\n"
        "付款数据如下：\\n{payload_json}"
    ),
}


class PaymentRiskTaskProcessor(BaseTaskProcessor):
    def __init__(
        self,
        provider: ClaudeProvider | None = None,
        api_key: str | None = None,
        model: str | None = None,
    ) -> None:
        self._provider: ClaudeProvider
        if provider is not None:
            self._provider = provider
            return

        resolved_api_key = api_key or os.getenv("ANTHROPIC_API_KEY", "")
        if not resolved_api_key:
            raise ValueError(
                "ANTHROPIC_API_KEY is required for payment risk processor"
            )

        resolved_model = model or os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
        self._provider = ClaudeProvider(api_key=resolved_api_key, model=resolved_model)

    def task_type(self) -> str:
        return "payment_risk_assessment"

    def process(
        self,
        payload: dict[str, object],
        prompt_template: dict[str, str] | None = None,
    ) -> TaskResult:
        normalized_payload = self._normalize_payload(payload)
        prompt = self._build_prompt(normalized_payload, prompt_template)
        result = self._provider.execute(self.task_type(), normalized_payload, prompt)
        return TaskResult(
            output=result.output,
            tokens_input=result.tokens_input,
            tokens_output=result.tokens_output,
            latency_ms=result.latency_ms,
            metadata=cast(dict[str, object], result.metadata),
        )

    def _build_prompt(
        self,
        payload: dict[str, object],
        prompt_template: dict[str, str] | None,
    ) -> dict[str, str]:
        system = DEFAULT_PROMPT["system"]
        user_template = DEFAULT_PROMPT["user_template"]

        if isinstance(prompt_template, dict):
            if isinstance(prompt_template.get("system"), str):
                system = prompt_template["system"]
            if isinstance(prompt_template.get("user_template"), str):
                user_template = prompt_template["user_template"]
            elif isinstance(prompt_template.get("user"), str):
                user_template = prompt_template["user"]

        payload_json = json.dumps(payload, ensure_ascii=False, indent=2)
        return {"system": system, "user": user_template.format(payload_json=payload_json)}

    def _normalize_payload(self, payload: dict[str, object]) -> dict[str, object]:
        return {
            "payment_request_id": payload.get("payment_request_id"),
            "serial_no": payload.get("serial_no"),
            "amount": payload.get("amount"),
            "contract": payload.get("contract", {}),
            "recent_payments": payload.get("recent_payments", []),
            "payee_id": payload.get("payee_id"),
        }
