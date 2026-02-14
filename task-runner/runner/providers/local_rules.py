from __future__ import annotations

import json
import logging
import time

from .base import AiProvider, ProviderResult

logger = logging.getLogger(__name__)


class LocalRulesProvider(AiProvider):
    """Rule-based provider for tasks that don't need external AI API calls."""

    def supports(self, task_type: str) -> bool:
        return task_type in ["equipment_recommend", "ocr_extract"]

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
