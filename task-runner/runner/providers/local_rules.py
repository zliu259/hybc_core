from __future__ import annotations

import json
import logging
import time

from .base import AiProvider, ProviderResult

logger = logging.getLogger(__name__)


class LocalRulesProvider(AiProvider):
    """Rule-based provider for tasks that don't need external AI API calls."""

    def supports(self, task_type: str) -> bool:
        return task_type in [
            "equipment_recommend",
            "ocr_extract",
            "contract_review",
            "payment_risk_assessment",
            "risk_assessment",
            "reimbursement_check",
            "log_analysis",
            "file_generate",
            "approval_ai_gate",
        ]

    def execute(
        self,
        task_type: str,
        payload: dict[str, object],
        prompt: dict[str, str] | None = None,
    ) -> ProviderResult:
        start = time.monotonic()

        if task_type == "equipment_recommend":
            output = self._equipment_recommend(payload)
        elif task_type == "ocr_extract":
            output = self._ocr_extract(payload)
        elif task_type == "contract_review":
            output = self._contract_review(payload)
        elif task_type in ["payment_risk_assessment", "risk_assessment"]:
            output = self._payment_risk_assessment(payload)
        elif task_type == "reimbursement_check":
            output = self._reimbursement_check(payload)
        elif task_type == "log_analysis":
            output = self._log_analysis(payload)
        elif task_type == "file_generate":
            output = self._file_generate(payload)
        elif task_type == "approval_ai_gate":
            output = self._approval_ai_gate(payload)
        else:
            output = json.dumps({"error": f"Unsupported task type: {task_type}"})

        latency = int((time.monotonic() - start) * 1000)
        return ProviderResult(output=output, latency_ms=latency)

    def _equipment_recommend(self, payload: dict[str, object]) -> str:
        """Simple rule-based equipment recommendation."""
        project_type = payload.get("project_type", "general")
        budget_raw = payload.get("budget", 0)
        budget = budget_raw if isinstance(budget_raw, (int, float)) else 0

        recommendations: list[str] = []
        if project_type in ("residential", "commercial"):
            recommendations.append("标准混凝土搅拌站")
            if budget > 500000:
                recommendations.append("塔式起重机")
            else:
                recommendations.append("移动式起重机")
        else:
            recommendations.append("通用施工设备套装")

        return json.dumps(
            {"recommendations": recommendations, "project_type": project_type},
            ensure_ascii=False,
        )

    def _ocr_extract(self, payload: dict[str, object]) -> str:
        """Placeholder for OCR extraction — returns structured format."""
        # In production, this would call an OCR service
        file_url = payload.get("file_url", "")
        return json.dumps(
            {
                "status": "placeholder",
                "message": "OCR extraction not yet implemented",
                "file_url": file_url,
            },
            ensure_ascii=False,
        )

    def _contract_review(self, payload: dict[str, object]) -> str:
        amount_raw = payload.get("total_amount", 0)
        amount = float(amount_raw) if isinstance(amount_raw, (int, float, str)) else 0.0
        risk = "low"
        score = 18
        if amount >= 5_000_000:
            risk = "high"
            score = 76
        elif amount >= 1_000_000:
            risk = "medium"
            score = 48

        return json.dumps(
            {
                "overall_risk": risk,
                "score": score,
                "summary": "本地模拟审查结果（非真实AI调用）。",
                "clause_analysis": [
                    {
                        "clause": "付款条件",
                        "risk_level": risk,
                        "issue": "建议核对付款节点与验收条件是否一一对应。",
                        "suggestion": "补充里程碑验收资料要求。",
                    }
                ],
                "amount_assessment": {
                    "reasonableness": "medium",
                    "basis": "基于合同总额分段规则的本地模拟判断。",
                    "risk_points": ["金额分段触发模拟预警"],
                },
                "recommendations": [
                    "补充违约责任条款",
                    "确认税率与发票类型一致",
                    "在提交审批前完成法务复核",
                ],
            },
            ensure_ascii=False,
        )

    def _payment_risk_assessment(self, payload: dict[str, object]) -> str:
        amount_raw = payload.get("amount", 0)
        amount = float(amount_raw) if isinstance(amount_raw, (int, float, str)) else 0.0
        risk = "low"
        score = 16
        if amount >= 500_000:
            risk = "high"
            score = 81
        elif amount >= 100_000:
            risk = "medium"
            score = 52

        return json.dumps(
            {
                "overall_risk": risk,
                "score": score,
                "summary": "本地模拟风控结果（非真实AI调用）。",
                "recommendations": [
                    "复核合同剩余额度",
                    "校验收款账户与历史记录一致性",
                    "必要时增加经理复核节点",
                ],
                "checks": {
                    "amount_band": amount,
                    "frequency_check": "simulated",
                    "duplicate_check": "simulated",
                },
            },
            ensure_ascii=False,
        )

    def _reimbursement_check(self, payload: dict[str, object]) -> str:
        return json.dumps(
            {
                "duplicate_risk": "low",
                "anomalies": [],
                "summary": "本地模拟报销校验通过。",
                "input": payload,
            },
            ensure_ascii=False,
        )

    def _log_analysis(self, payload: dict[str, object]) -> str:
        return json.dumps(
            {
                "quality_score": 82,
                "warnings": ["施工参数缺少完整上下文，建议补充"],
                "summary": "本地模拟日志分析结果。",
                "input": payload,
            },
            ensure_ascii=False,
        )

    def _file_generate(self, payload: dict[str, object]) -> str:
        return json.dumps(
            {
                "status": "generated",
                "file_name": "local-mock-report.pdf",
                "message": "本地模拟文件生成完成。",
                "input": payload,
            },
            ensure_ascii=False,
        )

    def _approval_ai_gate(self, payload: dict[str, object]) -> str:
        return json.dumps(
            {
                "output": "本地模拟AI关卡建议通过。",
                "metadata": {
                    "outcome": "approve",
                    "comment": "local-mock ai_gate approve",
                },
                "input": payload,
            },
            ensure_ascii=False,
        )
