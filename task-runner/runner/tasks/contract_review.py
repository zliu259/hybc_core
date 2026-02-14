# pyright: reportImplicitOverride=false
from __future__ import annotations

import json
import os
from typing import cast

from ..providers.claude import ClaudeProvider

from .base import BaseTaskProcessor, TaskResult

DEFAULT_PROMPT: dict[str, str] = {
    "system": (
        "你是恒越百川建设集团的合同审查AI专家。"
        "请基于输入的合同信息进行专业审查，重点识别条款风险、"
        "金额合理性和执行风险。输出必须是严格JSON，不要输出额外说明。"
    ),
    "user_template": (
        "请对以下合同进行审查，并仅返回JSON对象。\\n"
        "必须包含字段：overall_risk, score, summary, clause_analysis, "
        "amount_assessment, recommendations。\\n"
        "字段要求：\\n"
        "- overall_risk: low/medium/high\\n"
        "- score: 0-100数字（分数越高风险越高）\\n"
        "- summary: 字符串，简要结论\\n"
        "- clause_analysis: 数组，每项包含clause, risk_level, issue, suggestion\\n"
        "- amount_assessment: 对金额合理性的判断对象，包含reasonableness, basis, risk_points\\n"
        "- recommendations: 数组，给出可执行建议\\n"
        "合同数据如下：\\n{payload_json}"
    ),
}


class ContractReviewTaskProcessor(BaseTaskProcessor):
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
            raise ValueError("ANTHROPIC_API_KEY is required for contract review processor")

        resolved_model = model or os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
        self._provider = ClaudeProvider(api_key=resolved_api_key, model=resolved_model)

    def task_type(self) -> str:
        return "contract_review"

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
            "contract_id": payload.get("contract_id"),
            "contract_no": payload.get("contract_no"),
            "counterparty": payload.get("counterparty"),
            "contract_type": payload.get("contract_type"),
            "total_amount": payload.get("total_amount"),
            "attachments": payload.get("attachments", []),
        }
